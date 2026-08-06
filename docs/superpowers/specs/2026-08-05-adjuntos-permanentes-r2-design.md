# Adjuntos permanentes (Documentos → Cloudflare R2)

## Contexto

Hoy los PDF de la pestaña **Documentos** (y los que llegan por **Outlook**) se
persisten como `pdfBase64` dentro de la fila `documents` / arreglos
`docs`/`uploads`. La URL `blob:` de sesión nunca se guarda (correcto), pero el
binario vive en Supabase JSONB. Eso hincha la base, choca con cuotas y fue
documentado en VUL-044 Fase D como residual explícito: *“mover el binario a R2
continúa como fase separada”*.

Ya existen:

- Bucket Cloudflare R2 `siscon-archivos` (cuenta creada; aún sin integración en
  código).
- Columna `documents.storage_key` y campo `storageKey` en el mapeo frontend /
  `document-mapping.js` (siempre `null` en práctica).
- Flujo normalizado de documentos (CRUD, soft-delete, concurrencia) — **Completado**.

Ítem de Pendiente: *Adjuntos permanentes — blob URLs no persisten; requiere
storage en backend (Cloudflare R2, etc.)*.

## Decisiones acordadas (brainstorming 2026-08-05)

| Decisión | Elección |
|----------|----------|
| Alcance v1 | Solo documentos de proyecto (pestaña Documentos + PDF Outlook → uploads) |
| Fuera de alcance | Adjuntos de Mensajes; PDFs de transacciones (`pdf_storage_key`) |
| Acceso al casillero | Backend como proxy (navegador ↔ API Siscon ↔ R2 privado) |
| Migración de `pdfBase64` existente | One-shot al desplegar (no lazy, no re-subida manual) |
| Enfoque de implementación | Endpoints de archivo + metadatos limpios (`storage_key`; sin `pdfBase64` en DB) |
| Autorización Completado | OWNER autorizó tocar Documentos, `openPdfNewTab`, Outlook→PDF, rutas `documents` y script de migración con este alcance |

## Objetivo de experiencia

- Subir / abrir / borrar un documento se ve igual que hoy.
- Tras recargar o cambiar de dispositivo, el PDF sigue abriéndose.
- Los PDF ya existentes se migran una vez; el usuario no re-sube nada.
- La base deja de guardar el archivo entero.

## Arquitectura

Tres piezas:

1. **Frontend** (`Siscon-web/index.html`) — UI Documentos y consumo de API.
2. **Backend** (`siscon-backend`) — único poseedor de credenciales R2; valida
   Cloudflare Access en cada request (como el resto de la API).
3. **R2** bucket `siscon-archivos` — privado; sin acceso público ni URLs permanentes
   expuestas al navegador.

```
[Navegador] --Auth CF Access--> [api.sisconcr.com]
                                      |
                         POST/GET/DELETE /api/files/...
                                      |
                                      v
                               [Cloudflare R2]
                                      ^
                         documents.storage_key (Supabase)
```

### Clave de objeto (`storage_key`)

Formato estable y único:

```
projects/{projectId}/documents/{documentId}/{safeFileName}
```

- `documentId` = id de la fila lógica `documents` (p. ej. `doc:…`).
- `safeFileName` = nombre sanitizado (sin path separators); si hay colisión de
  versión, se puede sufijar timestamp — v1 no versiona: un documento = un objeto.
- Nunca se acepta un `storage_key` arbitrario del cliente en GET/DELETE: el
  servidor resuelve la clave desde la fila `documents` (o valida que el key
  pedido pertenece a un documento accesible).

### Endpoints nuevos (backend)

| Método | Ruta | Rol |
|--------|------|-----|
| `POST` | `/api/files/documents/:documentId` | Multipart upload del binario; escribe en R2; actualiza `storage_key` (+ `size_bytes`/`mime` si aplica); **elimina** cualquier `pdfBase64` residual en `data.upload` |
| `GET` | `/api/files/documents/:documentId` | Stream del objeto R2 (`Content-Type` del mime; `Content-Disposition` inline para PDF) |
| `DELETE` | `/api/files/documents/:documentId` | Borra objeto R2 (usado al eliminar documento o como cleanup interno) |

Notas:

- Auth: mismo middleware `validateCloudflareAccess()` que el resto.
- Política: mismo acceso que `documents` hoy (cualquier rol autenticado
  read/create/update/delete — no endurecer roles en esta fase).
- Límite de tamaño: **25 MB** por archivo (configurable por env
  `R2_MAX_UPLOAD_BYTES`). Rechazo claro `413` / mensaje amigable en UI.
- Tipos: PDF prioritario (Documentos + Outlook). Si la UI hoy permite otros
  tipos en uploads, se aceptan los mismos MIME ya usados; no ampliar el
  catálogo en v1.
- Credenciales R2 solo en env de Render, estilo S3:
  `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET` (`siscon-archivos`), `R2_ENDPOINT` (URL S3 de la cuenta).

Dependencia: cliente S3 compatible (`@aws-sdk/client-s3`) en el backend; no
exponer SDK ni keys al frontend.

### Atomicidad subida ↔ ficha

Orden preferido al **crear** un documento nuevo desde la UI:

1. Crear (o upsert) la fila `documents` **sin** binario (`storage_key` null,
   sin `pdfBase64`) — metadatos: nombre, categoría, fecha, notes, etc.
2. `POST /api/files/documents/:id` con el archivo.
3. Si el paso 2 falla: soft-delete (o hard cleanup) de la fila recién creada y
   mensaje de error; no dejar ficha “abre PDF” sin archivo.
4. Si el paso 2 escribe R2 pero falla el update de `storage_key`: borrar el
   objeto R2 (best-effort) y reportar error.

Al **reemplazar** archivo de un documento existente (si la UI lo permite hoy):
subir nuevo objeto (misma key o key nueva + update + delete old); v1 puede
sobrescribir la misma key.

### Lectura / `openPdfNewTab`

Prioridad al abrir:

1. Si hay `storageKey` / `storage_key` → `GET /api/files/documents/:id` (fetch
   con credenciales de sesión / mismo patrón de auth que otras APIs) → blob URL
   de sesión → `window.open` / visor actual.
2. Fallback temporal solo durante rollout: si aún existe `pdfBase64` (pre-
   migración o fila no migrada) → comportamiento actual.
3. Tras migración one-shot exitosa, el fallback base64 no debería dispararse en
   producción; se puede retirar en un follow-up menor.

La URL `blob:` de sesión sigue **sin** persistirse (regla ya Completada).

### Borrado

Al eliminar un documento en la UI (soft-delete de la fila `documents`, flujo
actual):

1. Soft-delete en Supabase (como hoy).
2. Borrar el objeto R2 asociado (`storage_key`) best-effort; si R2 falla, log +
   no bloquear la UI (el documento ya no es visible); opcional cola de
   reintento fuera de v1.
3. Cascada de proyecto: al borrar proyecto, además de soft-delete de
   documents, eliminar objetos R2 de esos `storage_key` (best-effort).

### Outlook → PDF

Hoy el webhook/scan guarda `pdfBase64` en `pendingBills` y el frontend lo copia
a `uploads`.

Cambio:

1. Tras OCR exitoso, el backend sube el PDF a R2 bajo una key provisional
   (`pending/{pendingBillId}/{fileName}`) **o** crea/actualiza el documento del
   proyecto destino si `projectRef` ya resuelve a un `project_id` estable.
2. Preferencia v1 (mínimo cambio de matching): subir a
   `pending/{pendingBillId}/…`, poner `storageKey` en el `pendingBill`, **no**
   guardar `pdfBase64` en el store del servidor.
3. Cuando el frontend aplica la factura y crea el `upload`/`documents` del
   proyecto: crea la fila como hoy y luego llama
   `POST /api/files/documents/:documentId/from-pending` con el id del
   pending bill. El backend copia/mueve el objeto de `pending/…` a la key
   definitiva, actualiza `storage_key` y limpia el pending. Una sola ruta;
   no crear la fila documents desde el webhook en v1.

OCR sigue necesitando bytes en memoria una vez; no reintroduce `pdfBase64` en
Supabase.

## Migración one-shot

Script nuevo en backend (patrón de `migrate-documents.js`):

1. Preflight dry-run: contar filas `documents` con `pdfBase64` en
   `data.upload` (o doc), tamaños, sin `storage_key`.
2. Respaldo / confirmación de backup (mismo rigor que otras migraciones
   VUL-044).
3. `--apply`: por cada fila, decode base64 → PutObject R2 → set `storage_key`
   → quitar `pdfBase64` del JSON `data` (y espejo en `upload`/`doc` si aplica)
   en una transacción/update por fila; fallos parciales se registran y no
   borran base64 hasta confirmación R2 + DB.
4. Verificación: 0 filas activas con `pdfBase64`; N `storage_key` no nulos;
   spot-check GET de un sample.
5. Rollback de emergencia: restaurar DB desde backup (los objetos R2 pueden
   quedar huérfanos; limpieza posterior aceptable). No hay script de
   “devolver base64 a DB” salvo restore de backup.

Orden de deploy sugerido:

1. Backend con endpoints R2 + env configurado (GET tolera filas aún en
   base64 vía fallback interno si se implementa).
2. Migración `--apply`.
3. Frontend que sube/abre vía `/api/files/...` y deja de escribir `pdfBase64`.

## Cambios en Completado (autorizados, alcance cerrado)

| Área | Cambio |
|------|--------|
| `processDocFiles` / carga Documentos | Subir vía API files; no `FileReader`→`pdfBase64` |
| `openPdfNewTab` (+ anotaciones si leen el mismo blob) | Resolver por `storageKey` / id de documento |
| Persistencia docs/uploads | No incluir `pdfBase64` en payloads; usar `storageKey` |
| Outlook pending → upload | Usar `storageKey`; no copiar base64 a Supabase |
| Backend documents / mapping | `storage_key` poblado; strip de `pdfBase64` al persistir |
| Tests existentes que asumen `pdfBase64` se conserva | Actualizar a “R2 / storage_key”; el comentario *“hasta conectar R2”* se cierra |

No se rediseña el modelo lógico docs+uploads ni la UI visual.

## Errores y límites (resumen)

- Subida > 25 MB → rechazo con mensaje.
- Fallo R2 o red → no ficha huérfana utilizable; toast/alert existente o
  mensaje nuevo breve.
- GET sin objeto / key inválida → 404; UI: “no se pudo cargar el PDF”.
- Sin sesión Access → 403 (comportamiento global).

## Pruebas

### Automáticas (backend)

- Upload → GET bytes idénticos; DELETE quita objeto.
- Sin JWT Access → 403.
- Oversize → 413.
- Migración dry-run / apply sobre fixture con `pdfBase64`.
- Al persistir documento, el JSON guardado no contiene `pdfBase64`.

### Automáticas (frontend, estilo tests actuales por source inspection / harness)

- `processDocFiles` / save path no escribe `pdfBase64`.
- `openPdfNewTab` usa ruta de files cuando hay `storageKey`.

### Manual / smoke producción

1. Subir PDF nuevo → recargar → Ver PDF.
2. Abrir PDF migrado (existente).
3. Eliminar documento → desaparece de lista; GET posterior 404.
4. (Si aplica) factura Outlook → PDF visible en Documentos tras aplicar.

## Fuera de alcance (explícito)

- Mensajes internos (adjuntos base64).
- `transactions.pdf_storage_key`.
- URLs firmadas al navegador.
- Versionado de archivos / UI nueva.
- Aprobaciones WhatsApp u otros ítems de Pendiente.
- Cambiar políticas de rol sobre `documents`.

## Criterio de cierre

- Código desplegado (backend Render + frontend Vercel).
- Migración productiva aplicada y verificada (0 `pdfBase64` activos en
  `documents`).
- Smoke OWNER OK.
- `PROJECT_CONTEXT.md`: ítem *Adjuntos permanentes* movido a Completado con
  fecha; eliminado de Pendiente.

## Riesgos residuales

- Objetos R2 huérfanos si falla el update de DB tras PutObject (mitigado con
  cleanup best-effort).
- Soft-delete de documento + borrado R2: no hay restore de archivo sin backup
  (alineado con “Eliminar” actual y con autorización del diseño).
- Scope R2 credentials: custodia en Render; rotación manual si se filtran.
