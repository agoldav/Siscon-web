# PROJECT_CONTEXT — Administrador de Proyectos Siscon

> Documento de contexto para desarrolladores. Resume todo lo necesario para entender,
> continuar o re-crear el proyecto desde cero.

> ⚠️ **ESTADO ACTUAL (fuente de verdad para el trabajo):** la app en producción es la **versión web**:
> código en el repo GitHub **`agoldav/Siscon-web`** → archivo **`/Users/abraham/siscon-web/index.html`** → Vercel → **`https://app.sisconcr.com`**. Backend en Render (`siscon-backend`); datos en Supabase (registro `settings/1`). Los archivos locales `siscon_adm_app_v5.4.x.html` y las instrucciones de "abrir el HTML por doble clic / localStorage" de más abajo son **legado/respaldo** — editar y desplegar SIEMPRE sobre `siscon-web/index.html` (commit + push → auto-deploy de Vercel; si no despliega, redeploy manual en el dashboard). Ver `MIGRACION_FRONTEND.md` y las sesiones de migración web (2026-07-13 en adelante).

> 🔒 **NUEVA ARQUITECTURA EN IMPLEMENTACIÓN (2026-07-24 a 2026-07-27):** Auditoría de seguridad completada el 2026-07-23. Arquitectura hardened: **Cloudflare Access como IdP único** (Microsoft Entra ID / Outlook 365) + **backend valida el `Cf-Access-JWT`** (cierra el bypass de `onrender.com`) + RLS deny-by-default + auditoría + **QB solo lectura**. Sin Cloudflare Workers (sync QB en backend + cron externo). Ver **Sección 12** para el plan completo y **Sección 11** para las vulnerabilidades. Rama de trabajo: `security-hardening`. Backup en tag `backup-2026-07-23`.

---

## 1. Visión general del proyecto

**Siscon** es una aplicación web de **administración de proyectos de construcción de vivienda
en Costa Rica** (instalación de policarbonato/aluminio/vidrio). Gestiona proyectos compuestos
por **casas**, cada una asignada a un **tipo** de vivienda con su presupuesto de materiales, y
todo el ciclo **financiero**: órdenes de compra, facturas a cliente, facturas de proveedor,
pagos, notas de crédito, requisiciones, avances de subcontratistas y bodega.

**Objetivos principales:**
- Controlar **presupuesto vs. gasto real** por proyecto y por casa.
- Manejar **transacciones financieras** integradas con **QuickBooks Online** (fuente de verdad contable).
- Automatizar lectura de facturas (**OCR con Claude**), tipo de cambio (Hacienda/BCCR) y consultas con IA.
- Dar visibilidad gerencial: estadísticas, flujo de caja proyectado, bitácora de pendientes, informes.

**Público:** uso interno de la empresa Siscon (Rohrmoser, San José, CR). Multiusuario por roles
(Admin / Supervisor / Operador), un solo navegador por sesión (no hay login federado todavía).

---

## 2. Stack tecnológico

### Frontend
- **HTML + CSS + JavaScript vanilla**, todo en **un solo archivo** (`siscon_adm_app_v5.3.html`).
- **Sin frameworks ni librerías** externas en el frontend (no React/Vue/jQuery). Todo se renderiza
  por concatenación de strings con template literals e inyección en `innerHTML`.
- Gráficos: **SVG dibujado a mano** (sin Chart.js).
- Persistencia: **`localStorage`** del navegador (clave `siscon_v5_data`).
- Temas: claro/oscuro vía variables CSS (`html[data-theme="light"]`).

### Backend (proxy) — carpeta `siscon-backend/`
- **Node.js ≥ 18**, **Express 4**, **cors**, **dotenv**.
- Store en archivo JSON (`/tmp/siscon_store.json`): tokens QBO, tokens MS Graph, facturas pendientes de Outlook, suscripciones Graph.
- Pensado para desplegarse en **Render** (plan Free).

### Servicios externos
- **Anthropic Claude API** (OCR de facturas + asistente con acceso a todos los datos de la app).
- **QuickBooks Online API** (OAuth 2.0; contabilidad).
- **Microsoft Graph / Outlook** — buzón `facturas@sisconcr.com`, suscripciones por carpeta de proyecto, webhook automático.
- **API de Hacienda CR** (`api.hacienda.go.cr/indicadores/tc/dolar`) para el tipo de cambio.

---

## 3. Arquitectura y estructura

```
2. App Administración de Proyectos - Claude/
├── siscon_adm_app_v5.3.html   ← APP PRINCIPAL ACTUAL (~6900 líneas)
├── siscon_adm_app_v5.2.html   ← Versión anterior (respaldo)
├── siscon_v5.html             ← Versión original (respaldo, NO editar)
├── siscon_proyecto.md         ← Notas originales del proyecto
├── wireframe_oc.html          ← Wireframe original del módulo de Órdenes de Compra
├── PROJECT_CONTEXT.md         ← Este archivo
└── siscon-backend/            ← BACKEND proxy (Node/Express) — repo GitHub: agoldav/siscon-backend
    ├── server.js              ← Servidor: Claude, tipo de cambio, QBO, Microsoft Graph/Outlook
    ├── package.json
    ├── .gitignore
    ├── .env.example           ← Plantilla de variables de entorno
    └── README.md              ← Guía de despliegue en Render
```

### Anatomía del archivo HTML principal
Un solo archivo con 3 zonas: `<style>` (CSS + variables de tema), `<body>` (login, topbar,
metricbar, tabbar, contenedores de ventanas flotantes, modal, chat) y un gran `<script>`.
El JS está organizado por secciones comentadas con cabeceras `// ===== ... =====`:
estado y persistencia, dashboard/kanban, proyecto/métricas, tabs, tipos, casas, panel de casa,
lista de materiales, gantt, documentos, garantías, **transacciones** (OC, factura cliente,
factura proveedor, genéricas), **QuickBooks**, **Microsoft Graph/Outlook**, **Claude/OCR**,
framework de **ventanas flotantes**, mini-apps (subcontratistas, calculadora de avances,
ruta, bodega, comparación QB, **informes**), bitácora, mapa, chat.

**Patrón de navegación:** el contenido se pinta en `#content`. `setTab(t)` cambia la pestaña activa
del proyecto y llama al `render*()` correspondiente. El dashboard (lista de proyectos) es Kanban por estatus.

---

## 4. Lógica central y conceptos clave

- **Proyecto → Tipos → Casas.** Cada casa referencia un `typeId`.
- **Presupuesto de materiales:** vive en `type.categories[].lines[]`.
- **El gasto del proyecto proviene de las Facturas de Proveedor**, NO de las órdenes de compra.
- **Facturación a cliente por % de avance:** modelo incremental. `ciSyncHouseStatuses()` actualiza estatus de casa.
- **Avances de subcontrato → factura:** la calculadora convierte avances en facturas de proveedor.
- **Ventanas flotantes:** `fwinOpen/fwinMinimize/fwinToggleMax`. Se arrastran, redimensionan, minimizan.
- **Autorizaciones:** `requestAuth()` — razón → solicitud → aprobación con contraseña de supervisor.
- **Tipo de cambio por transacción:** `tcGet()` ← Hacienda, editable por documento.
- **Outlook auto-sync:** al login, `msAutoSync()` suscribe carpetas de Outlook por número de proyecto y lanza polling cada 2 min. El backend procesa PDFs vía webhook Graph + OCR Claude y los guarda en `store.pendingBills`.

---

## 5. Modelos de datos (en `localStorage`, clave `siscon_v5_data`)

Estructura raíz: `{ projects: [...], SYS: {...}, activityLog: [...] }`.

### Project
```js
{ id, name, num, client, razonSocial, correo, status, startDate, lastActivity,
  budget, salePrice, utilityPct, area, areaInstalled, locked, exchangeRate,
  address, lat, lng,
  billCycleDays, paymentTermDays,
  types:[Type], houses:[House],
  docs:[Doc], uploads:[{blobId,url,name,type,category,date}], garantias:[], bitacora:[Bitacora],
  ocs:[OC], invClient:[Invoice], billVendor:[VendorBill],
  payments:[Txn], creditNotes:[Txn], requis:[Txn],
  subAdvances:[], bodega:[BodegaItem] }
```

### VendorBill (actualizado)
```js
{ id, num, party, invoiceNumber, date, status, exchangeRate,
  lines:[{productId,desc,qty,price,discPct,assign:[{houseId|'__bodega__', qty}]}],
  linkedOcId, linkedAdvanceId, subtotalUSD, totalUSD, qboId,
  pdfBlobId, pdfName }   // ← PDF adjunto desde OCR o Outlook
```

### Bitacora (actualizado)
```js
{ id, type, houseId, created, due, responsable, priority, resolved,
  desc, summary,   // summary = resumen 3-5 palabras generado por Claude
  createdBy, createdAt }
```

### SYS (configuración global)
```js
{ supervisorPassword, exchangeRate, theme,
  qbo:{ connected, realmId, environment, vendorCache, customerCache, itemCache, lastSync },
  mailbox:{ user, msConnected },   // Outlook OAuth vía backend
  subcontractors:[...],
  googleMapsKey, claudeKey, backendUrl, backendToken,
  stats:{...}, casasCols:[...],
  subAdvanceRecords:[], unclassified:[],
  users:[{ id, username, name, role, password, color }],
  conversations:[Conversation] }   // ← Mensajes internos
```

### Conversation (Mensajes internos)
```js
{ id, type:'dm'|'group', name,           // name solo para grupos
  memberIds:[userId...], createdBy, createdAt,
  messages:[
    { id, senderId, text, ts,
      attachments:[{ id, kind:'image'|'audio'|'video'|'file', name, mime, dataUrl, size }],
      readBy:[userId...] }             // marca de leído por usuario
  ] }
// Prefijo de módulo: msg*. Adjuntos base64 en localStorage (tope 3 MB c/u).
```

---

## 6. APIs e integraciones

### Backend (`siscon-backend/server.js`)
| Método | Ruta | Función |
|---|---|---|
| GET | `/` | Salud |
| POST | `/api/claude` | Proxy Anthropic |
| GET | `/api/tc` | Tipo de cambio Hacienda |
| GET | `/api/qbo/connect` | OAuth QBO → redirect Intuit |
| GET | `/api/qbo/callback` | Intercambia code por tokens QBO |
| GET | `/api/qbo/status` | Estado conexión QBO |
| POST | `/api/qbo/query` | Query QBO |
| POST | `/api/qbo/create` | Crea entidad QBO |
| GET | `/api/ms/connect` | OAuth Microsoft → redirect Azure |
| GET | `/api/ms/callback` | Intercambia code por tokens MS |
| GET | `/api/ms/status` | Estado conexión Outlook |
| GET | `/api/ms/emails` | Lista emails con PDFs (uso manual) |
| GET | `/api/ms/attachment` | Descarga adjunto PDF como base64 |
| GET | `/api/ms/folders` | Lista carpetas del buzón |
| POST | `/api/ms/subscribe` | Suscribe carpetas por proyecto vía Graph webhooks |
| POST | `/api/ms/webhook` | Recibe notificaciones Graph → OCR → guarda pendingBill |
| GET | `/api/ms/pending` | Facturas pendientes para el frontend |
| POST | `/api/ms/pending/ack` | Marca factura como procesada |

---

## 7. Entorno y configuración

### Variables de entorno del backend (Render o `.env`)
```
ANTHROPIC_API_KEY=sk-ant-...
SISCON_TOKEN=siscon-2026-pmapp
QBO_CLIENT_ID=...
QBO_CLIENT_SECRET=...
QBO_ENV=sandbox
BACKEND_BASE=https://siscon-backend.onrender.com
MS_CLIENT_ID=...          # Azure App Registration
MS_CLIENT_SECRET=...
MS_TENANT_ID=...
PORT=3000
```

### Azure App Registration (Microsoft Graph)
- Redirect URIs registradas: `https://siscon-backend.onrender.com/api/ms/callback`, `http://localhost:3000/api/ms/callback`
- Permisos delegados: `Mail.Read`, `offline_access`
- Tenant: `8887c3de-dcd3-4f79-8fde-76bbf4c41649`

### Configuración del frontend (Ajustes ⚙ — solo Admin)
- Backend URL + token, Claude API key directa (fallback), Google Maps key, QBO connect, Outlook connect.

---

## 8. Convenciones y patrones

- **Un solo archivo HTML** para todo el frontend; sin build step, sin dependencias.
- **Render por strings:** `function render*(){ el.innerHTML = \`...\` }`.
- **Persistencia:** `saveData()` / `loadData()` con migración de campos faltantes (`if(!x)x=[]`).
- **Prefijos por módulo:** `oc*`, `ci*`, `vb*`, `calc*`, `route*`, `bita*`, `stats*`, `fwin*`, `qbo*`, `ms*`, `task*`, `msg*`.
- **Moneda:** valores base USD; `fmt()` → `$1,234.56`; `fmtCRC()` → `₡1.234`. Fechas con `fmtDate()` (dd/mm/aaaa).
- **Ajustes solo para Admin:** botón ⚙ oculto para Supervisor y Operador.
- **Eliminar proyecto:** requiere contraseña de supervisor (`SYS.supervisorPassword`), solo Admin puede ejecutarlo.

---

## 9. ✅ Completado

### Dashboard
- [x] Vista Kanban + vista Lista (toggle ⊞/☰)
- [x] Botón 3-dot (⋯) en cada tarjeta con "Eliminar proyecto" (Admin + contraseña supervisor)
- [x] Sección de gráficos/estadísticas colapsable (ya existía el toggle)

### Ajustes / Acceso
- [x] Panel de Ajustes (⚙) visible únicamente para rol Admin
- [x] Renombrado internamente como "Ajustes del Sistema"

### Outlook / Microsoft Graph (auto-sync)
- [x] OAuth Microsoft Graph en backend (connect/callback/status)
- [x] Webhook automático: Graph notifica al backend cuando llega email a carpeta de proyecto
- [x] Backend descarga PDF adjunto → OCR con Claude → guarda `pendingBill`
- [x] Frontend suscribe carpetas al login (`msAutoSync`) y hace polling cada 2 min
- [x] Deduplicación por número de factura
- [x] PDF guardado en `uploads` y en pestaña Documentos como "Factura de Gastos"
- [x] PDF abre en tab nuevo del navegador (`openPdfNewTab`)
- [x] Importación manual desde Outlook disponible en factura de proveedor (botón "📥 Importar desde Outlook")
- [x] Azure App Registration configurada con redirect URIs de Render y localhost

### Facturas de Proveedor
- [x] OCR extrae descuento por línea (`discPct`) del PDF
- [x] Columna de descuento siempre visible (default 0), sin checkbox de activar
- [x] Columna "Destino" renombrada a "Proyecto"
- [x] Total usa monto final del PDF (después de descuentos e impuestos)
- [x] Botón "Eliminar" movido al footer (junto a nota QBO)
- [x] Fix: click en factura importada desde Outlook ahora abre correctamente (String ID fix)
- [x] Fix: eliminar factura funciona correctamente

### Factura a Cliente
- [x] Botón "💰 Recibir Pago" en el formulario
- [x] Muestra monto pagado y saldo pendiente en el bloque de totales

### Información General del Proyecto
- [x] Presupuesto y Precio de Venta con formato `$1,765.34` cuando el proyecto está bloqueado
- [x] Mapa eliminado de la pestaña Información General

### Bitácora
- [x] Botón "+ Agregar" abre modal con campos: Tipo, Casa, Fecha, Responsable, Prioridad, Estado, Descripción
- [x] Claude genera resumen de 3-5 palabras al guardar
- [x] Lista muestra resumen; hover despliega descripción completa
- [x] Columnas con sort al hacer click en encabezado (asc/desc)
- [x] Botón 3-dot (⋮) con opciones Editar y Eliminar; ✕ eliminado
- [x] Campo "Casa" en cada entrada

### Transacciones (general)
- [x] Botón "Eliminar" movido al footer en OC, factura cliente y genéricas

### Chat / Claude
- [x] Chat mantiene historial mientras la app está abierta (no resetea al cerrar)
- [x] Claude tiene acceso completo a todos los datos de la app (proyectos, facturas, bitácora, etc.)

### Informes
- [x] App "📊 Informes" en el menú 9-dot
- [x] Informe "Gastos Realizados" con rango: Hoy, Semana a la fecha, Semana anterior, Mes actual, Rango de fechas
- [x] Columnas: Proyecto · Fecha · Proveedor · N° Factura · Monto — ordenables por click

### Documentos
- [x] Click en fila de documento abre PDF en tab nuevo
- [x] Menú 3-dot (⋮) con opción Eliminar
- [x] Factura de gastos muestra: Fecha · Proveedor · N° Factura · Monto

### Backend
- [x] Subido a GitHub (`agoldav/siscon-backend`) con `.gitignore` correcto
- [x] Desplegado en Render (`https://siscon-backend.onrender.com`)
- [x] Variables de entorno MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT_ID, BACKEND_BASE configuradas en Render

---

### Sesión 2026-06-03 (v5.4)
- [x] Duplicar Tipo de Vivienda (botón ⧉ en cada tarjeta)
- [x] Duplicar OC, Factura Cliente, Factura Proveedor, Requisición (botón ⧉ en lista)
- [x] Módulo CRM Cotizaciones: pipeline Kanban, formulario completo, convertir en proyecto
- [x] Casas nuevas creadas sin tipo asignado (antes se asignaba Tipo A por defecto)
- [x] Presupuesto/Precio de Venta/Área/Utilidad se calculan automáticamente desde las casas al asignar tipos
- [x] Estatus del proyecto siempre editable (no solo cuando desbloqueado)
- [x] Panel superior: % Avance debajo de Área Instalada con barra de progreso; Salud del Proyecto encima de Proyección; grupos con más separación visual
- [x] OC: número de casa muestra tipo debajo del nombre
- [x] OC: botón "Guardar" como acción predeterminada (split button)
- [x] OC: proveedor y N° proforma en fila 1 (junto a Proyecto); Casas/Bodega en fila 2
- [x] OC: "+ Agregar Casa" despliega lista de casas disponibles con su tipo
- [x] OC: cambiar casa reinicializa materiales con el tipo correcto de la nueva casa
- [x] OC: Resumen consolida materiales iguales en una línea y ordena alfabéticamente
- [x] OC→Factura Proveedor: usa líneas del Resumen (consolidadas) en vez de líneas por casa
- [x] Factura Proveedor: pestañas por casa cuando viene de OC (+ pestaña Resumen = factura real)
- [x] Factura Proveedor: preserva lineId original del presupuesto → compras aparecen en materiales presupuestados de HP
- [x] Casa pasa automáticamente a "Iniciado" al guardar OC o Factura Proveedor con esa casa
- [x] Pago 100% → casas relacionadas pasan a "Pagado"; pago parcial → "Pagado Parcial"
- [x] Disponible en panel superior: verde si positivo, rojo si negativo
- [x] HOUSE_STATUSES incluye "Pagado Parcial"

### Sesión 2026-06-04 (v5.4 — continuación)
- [x] Outlook: backend busca carpetas de primer nivel Y subcarpetas de Bandeja de Entrada (resuelve caso de carpetas anidadas)
- [x] Outlook: matching de carpetas más flexible (coincidencia parcial bidireccional)
- [x] Outlook: `msAutoSync` verifica status real del backend al inicio; muestra toast si tokens expiraron
- [x] Outlook: botón "📂 Re-suscribir carpetas" en Ajustes con reporte detallado de resultado
- [x] Outlook: nuevo endpoint `/api/ms/scan` — escaneo activo de carpetas cada 2 min sin depender de webhooks (resuelve problema de Render Free que duerme)
- [x] Outlook: facturas nuevas aparecen en la UI sin recargar la app (refresca `renderTxnSub` / `renderDocs`)
- [x] PDF de Outlook: se guarda como base64 en `uploads` → sobrevive recargas de página
- [x] PDF de Outlook: `openPdfNewTab` recrea blob URL desde base64 si el URL en memoria ya expiró
- [x] `saveData` ya no guarda blob URLs efímeras; `loadData` restaura blob URLs desde base64 al arrancar
- [x] Factura Proveedor: distingue CRC de USD (`currencyBill`); OCR detecta moneda automáticamente
- [x] Factura Proveedor CRC: precios de líneas se convierten a USD internamente; se guarda `totalCRC` para referencia
- [x] Factura Proveedor CRC: formulario muestra totales en ₡ + equivalente USD; selector de moneda manual
- [x] Lista de Facturas Proveedor: facturas CRC muestran monto en ₡ y su equivalente en USD debajo
- [x] OCR manual (drop zone): también detecta moneda CRC/USD y convierte precios a USD internamente
- [x] `projSpent` siempre suma en USD (sin cambio de lógica; ahora garantizado por conversión en origen)

### Sesión 2026-06-05 (v5.4.1)
- [x] Bug #8 OC: resumen sumaba $0 para "Subcontrato" cuando una casa tenía precio=0 → fix acumulando totalValue en lugar de sobreescribir price
- [x] Encabezados: todas las abreviaciones reemplazadas por palabras completas en tablas de materiales, OC, facturas, calculadora
- [x] OC y Factura Proveedor: pestaña Resumen aparece de primero
- [x] OC: no se puede eliminar si tiene factura pagada; solo Admin puede; botón ⋮ con Editar/Duplicar/Eliminar en lista
- [x] Cmd+click en pestaña del proyecto abre nueva ventana con auto-login
- [x] OC botón Guardar: dropdown con Guardar y Cerrar / Guardar y Enviar / Guardar y Descargar; main button solo guarda sin cerrar
- [x] OC: columna Desc % en todas las pestañas (casas, resumen, bodega)
- [x] Botón ⋮ en todas las listas (OC, Facturas Proveedor, todas las transacciones genéricas) con Editar/Duplicar/Eliminar
- [x] Calculadora de avances: botón "Convertir en Factura" blanco/verde; "Guardar Avance" no cierra, dropdown con "Guardar y Cerrar" y opciones de informe; Excel con fórmulas =E*F; columnas fijas alineadas con encabezados; eliminar avance no facturado; casas con estatus Sin Iniciar/Iniciado/Terminado/Fact. Parcial son seleccionables si tienen saldo
- [x] Botón "+ Crear OC" en lista de materiales de casa: lee inputs DOM, filtra qty>0, cierra ventana, abre OC
- [x] Factura Cliente: dropdown de casas muestra todas (grayed out si 100%); bloque informativo Gastado/Facturado/Pendiente por casa; tipo debajo de nombre de casa
- [x] Ventanas flotantes: redimensionables desde los 8 bordes/esquinas
- [x] Lista de casas (dentro de cada casa): columna "Cantidad Comprada" (de facturas proveedor), "Solicitar Material" vacía c/max=presup-comprado, "Total Gastado" con color verde/rojo; eliminado modal de autorización
- [x] Calc houseSubAdvancedPct usa SYS.subAdvanceRecords; después de Guardar refresca footer mostrando "Convertir en Factura"; después de Convertir actualiza panel de casa
- [x] Sub-Contrato de instalación en panel de casa toma el Total Presupuesto de la línea "Sub-Contrato"; Pagado Sub-Contrato suma solo avances ya facturados para esa casa
- [x] Recuperación Financiera por casa: función getHouseRecovery(), columna "Recuperación" en tabla de casas (barra+%, semáforo 🟢🟡🔴), sección en panel de casa con tabla de facturas y totales, bloque informativo en Factura Cliente

### Sesión 2026-06-07 (v5.4.1 — Outlook persistencia + bugs)
- [x] Gantt: `saveData()` al salir de la pestaña Gantt para preservar cambios de drag al navegar entre pestañas
- [x] Salud del Proyecto: `getCatTotal(t)` usa fallback a `t.budget` cuando categorías están vacías (evita falso "Salud OK")
- [x] Outlook: tokens persisten entre reinicios de Render — nuevo endpoint `GET /api/ms/refresh-token` + botón "🔑 Guardar token" en Ajustes que muestra instrucciones para fijar `MS_REFRESH_TOKEN` en Render
- [x] Outlook: scan de fondo en el servidor cada 2 min (`backgroundScan`) — independiente de que la app esté abierta; usa `store.knownProjects` que el frontend actualiza al login
- [x] Outlook: `msAutoSync` hace doble check de tokens (espera 3s para que bootstrap del servidor recupere) antes de marcar como desconectado
- [x] Outlook: `POST /api/ms/set-projects` guarda lista de proyectos en store para que el scan de fondo funcione aunque se borren las suscripciones
- [x] Outlook: `msAck` (confirmar en servidor) ocurre DESPUÉS de `saveData()` — evita pérdida de facturas si localStorage falla por cuota
- [x] `saveData()`: si falla por quota exceeded, reintenta sin `pdfBase64` en uploads (facturas se guardan, solo el PDF offline se pierde)
- [x] Facturas CRC importadas de Outlook: tipo de cambio siempre desde Hacienda/BCCR para la fecha de la factura (OCR devolvía xr=1 que causaba conversión 1:1)
- [x] Lista Facturas Proveedor CRC: USD equivalente calculado correctamente como `totalCRC / xr` (no desde `totalUSD` guardado con xr incorrecto)
- [x] Formulario Factura Proveedor CRC: líneas muestran precios en ₡ con símbolo correcto; al editar precio se guarda en `priceCRC` y se convierte a USD internamente

### Sesión 2026-06-06 (v5.4.1 — continuación: email, materiales, UI)
- [x] Outlook: backend persiste `refresh_token` en `store.json` + bootstrap automático; usuarios nunca más necesitan reconectar tras redeploy de Render
- [x] Outlook: `/api/ms/scan` con `force=true` flag limpia historial de emails procesados para re-scan (soluciona caso de "0 facturas" cuando las carpetas ya fueron escaneadas)
- [x] Outlook: scan sin filtro `hasAttachments` para capturar PDFs que no marcan correctamente el flag
- [x] Outlook: botón "📥 Refrescar" en lista de Facturas de Proveedores — escanea buzón en tiempo real sin notificaciones de fondo
- [x] Todos los "📋 Historial" renombrados a "Log" sin ícono en toda la app
- [x] Panel superior transacciones: orden uniforme → + Nuevo → (Refrescar si Proveedor) → Log → Sort
- [x] Altura uniforme 34px con padding 7px en todos los botones del header (+ Nuevo, Log, Refrescar, Sort)
- [x] Materiales: `matsCatalog()` usa QB itemCache cuando disponible; fallback a MATS con aviso amarillo si QB no conectado
- [x] Conexión Outlook: validación mejorada de token del backend — mensajes específicos (falta token, token incorrecto, expire)
- [x] Lista Facturas Proveedor CRC: muestra `₡ total` debajo muestra `$ (total ÷ tasaDeCambio)` correctamente convertido
- [x] Polling automático cada 2 min: silencioso sin notificaciones; solo muestra toast cuando usuario clica Refrescar

### Sesión 2026-06-08 — parte 2 (v5.4.2 — Dashboard lista, Documentos, Notificaciones)
- [x] Dashboard: vista Lista como defecto en lugar de Kanban
- [x] Dashboard lista: badge de pendientes en esquina inferior derecha de tarjeta kanban y a la izquierda del nombre en vista lista
- [x] Dashboard lista: columnas configurables con dropdown "Columnas ▾" con checkboxes (sin recargar el dropdown al marcar)
- [x] Dashboard lista: columna "Facturado" (suma de facturas a cliente no anuladas)
- [x] Dashboard lista: reordenar columnas arrastrando encabezados
- [x] Dashboard lista: menú 3-dot usa `position:fixed` y se ve por encima de todas las filas
- [x] Dashboard lista: alineación vertical centrada en filas; barra de avance limitada a 56px
- [x] Centro de Notificaciones: botón burbuja entre menú 9-dot y QB en la barra superior
- [x] Notificaciones: panel callout posicionado dinámicamente bajo el ícono con flecha CSS apuntando al botón; redimensionable
- [x] Notificaciones: badge de no leídos (rojo), estado NUEVO en rojo, punto indicador en rojo
- [x] Notificaciones: checkboxes por mensaje con barra de acciones en grupo (Marcar leído / Eliminar)
- [x] Notificaciones: checkbox "seleccionar todo" en la barra de acciones
- [x] Notificaciones: sin duplicados (mismo mensaje nunca se repite)
- [x] Notificaciones: cierra con ESC o click fuera del panel
- [x] Notificaciones: 15+ eventos QB/Outlook/sistema redirigidos a notificaciones en lugar de toast inferior
- [x] Notificaciones: mensajes con link muestran "Ver →" que navega a la sección correspondiente
- [x] Notificaciones: menú 3-dot por mensaje con opción eliminar
- [x] Documentos: click en cualquier fila abre el documento (fix: `data-cc` con `encodeURIComponent` evita quiebre de atributo HTML)
- [x] Documentos: PDFs subidos manualmente se guardan como base64 → sobreviven recarga de página
- [x] Documentos: `hasBlob` simplificado — cualquier doc con `blobId` es clickable (`openPdfNewTab` maneja recuperación)
- [x] Documentos: checkboxes en cada fila + checkbox "seleccionar todo" en encabezado
- [x] Documentos: dropdown "Acciones en grupo" con Eliminar seleccionados y Cambiar categoría en masa
- [x] Documentos: filtros de categoría multi-selección (click activa/desactiva); "Todos" limpia filtros
- [x] Documentos: layout reorganizado — drop zone arriba, controles (acciones, filtros, columnas) debajo
- [x] Materiales unificados: materiales no presupuestados separados en sección propia con borde ámbar (sin valores negativos)
- [x] Toast "QBO: no hay facturas pagadas aún" eliminado (silencioso)
- [x] Toast "Factura sin proyecto asignado" redirigido a notificaciones

### Sesión 2026-06-08 (v5.4.1 — QB Full Sync + badges + material fuera de lista)
- [x] QB Full Sync: botón verde "QB ↻" en la barra superior reemplaza botones individuales de refresh; llama `qboFullSync()` que sincroniza facturas de venta, consecutivos y bills pagados
- [x] `qboFullSync`: importa facturas nuevas de QBO a la app; match por `p.client` y fallback por `p.name` (resuelve caso donde CustomerRef.name = nombre de proyecto); si no hay match va a "Sin clasificar"
- [x] `qboFullSync`: actualiza `consecutivo` en facturas existentes cuando QBO lo llena con retraso
- [x] Auto-sync QB cada 5 minutos (`_qboSyncInterval` en `msAutoSync`)
- [x] Al login: `qboFullSync` corre 3 segundos después del login (reemplaza `qboSyncPaidBills`)
- [x] QBO token persistence: `server.js` persiste tokens en `store.qboTokens` (JSON permanente); restaura al reiniciar Render sin pedir reconexión
- [x] Facturas QBO importadas llevan `_pending:true`; facturas importadas desde Outlook también
- [x] Tag **NUEVO** (rojo) visible en cada transacción pendiente de trámite en la lista; borde izquierdo rojo en la fila
- [x] Badges de notificación (círculos rojos estilo iOS): en pestaña Transacciones (suma del proyecto), en cada sub-pestaña (OC, Facturas a Cliente, Facturas de Proveedores, Pagos, Notas de Crédito, Requisición), en botón "Sin clasificar" del menú 9-dot, y en el botón 9-dot (solo cuenta "Sin clasificar")
- [x] `_pending` se limpia a `false` al guardar cualquier transacción (generic, client invoice, vendor bill)
- [x] Lista Facturas de Proveedores: muestra `tx.invoiceNumber` (número real del proveedor) en lugar del interno `FP-2026-xxx` cuando está disponible
- [x] Validación al asignar material a casa: si el producto no está en la lista de materiales presupuestados de esa casa, el sistema bloquea la asignación con popup específico
- [x] Popup de bloqueo: mensaje claro + botones Cancelar / Solicitar Autorización
- [x] Flujo de autorización de material fuera de lista: motivo → notificación al admin con contraseña → Aceptar/Denegar → notifica al usuario con resultado; si se aprueba, el material se agrega automáticamente en materiales no presupuestados de esa casa

### Sesión 2026-06-10 (v5.4.2 — fixes + importar tipo Excel)
- [x] Bug fix: Facturas de Outlook sin proyecto ya no generan notificación repetida al reiniciar — se mueven a "Sin Clasificar" y se ackean en el servidor
- [x] Bug fix: Guardar asignación de casa en factura de proveedor de Outlook (fix comparación `String(x.id)===String(curTxnId)`)
- [x] Bug fix: Tokens QBO persisten tras reinicios de Render — bootstrap desde `QBO_REFRESH_TOKEN` env var + endpoint `/api/qbo/refresh-token` + botón "🔑 Guardar token" en Ajustes
- [x] OCR moneda: prompt detecta símbolo ₡/¢/"colones" → CRC, $/"dólares" → USD; default CRC
- [x] Moneda en factura de proveedor: `<select>` reemplazado por botón toggle ₡/$ (un click cambia)
- [x] Búsqueda de producto QB en líneas de factura: `<select>` nativo reemplazado por `<input list>` con datalist — permite escribir palabras completas para filtrar
- [x] Importar Tipo de Vivienda desde Excel: botón "📥 Importar desde Excel" en lista de tipos; carga SheetJS dinámicamente; detecta columnas Categoría/Material/Cantidad/Precio/Moneda/Unidad; detecta metadatos Área/Utilidad/Tipo de Cambio; vista previa antes de crear

### Sesión 2026-07-11 (v5.4.2 — Mensajes Internos)
- [x] Módulo "✉️ Mensajes" en el menú 9-dot (mensajería interna entre usuarios)
- [x] Modelo de datos `SYS.conversations` (migración en `loadData` + default para instalaciones nuevas)
- [x] Conversaciones **directas (DM)** y **grupos** con nombre y múltiples integrantes; DM reutiliza conversación existente (sin duplicar)
- [x] Ventana flotante de dos paneles: lista de conversaciones (con búsqueda, último mensaje, hora, no leídos) + hilo con burbujas estilo chat (propias a la derecha en color acento, ajenas a la izquierda; nombre del remitente en grupos)
- [x] Composer: texto con Enter para enviar / Shift+Enter salto de línea, autogrow; adjuntar archivo/foto/video (input múltiple); grabación de audio con MediaRecorder (corte a 2 min)
- [x] Render de adjuntos: imágenes con visor (lightbox + descargar), audio y video con reproductor nativo, otros archivos como enlace de descarga
- [x] Adjuntos guardados como base64 en localStorage (tope 3 MB por adjunto + reversión si falla el guardado por cuota) — compatible con futura migración a backend
- [x] Badges de no leídos por usuario: en el ícono de Mensajes (`badge-msgs`) y sumados al badge del menú 9-dot (`apps-badge`); se marcan como leídos al abrir la conversación
- [x] Gestión de conversación (menú ⋮): renombrar grupo, administrar miembros, salir del grupo, eliminar conversación (renombrar/miembros solo creador o Administrador)

### Sesión 2026-07-13 (backend — fix matching Outlook)
- [x] Bug: proyecto "Dor" importaba facturas de la carpeta equivocada — el matching flexible (`includes` bidireccional) casaba "Dor" con "Borradores" (carpeta de sistema, enumerada antes que las subcarpetas de Inbox)
- [x] Matching proyecto↔carpeta ahora es **estricto al 100%** (decisión del usuario): la carpeta debe llamarse exactamente igual al nombre o número del proyecto; solo se normalizan mayúsculas y espacios extremos; sin coincidencias parciales
- [x] Lógica unificada en helper `findProjectFolder()` (antes duplicada en `/api/ms/subscribe`, `/api/ms/scan` y `backgroundScan`)
- [x] `/api/ms/subscribe` ahora **elimina las suscripciones previas** de los proyectos entrantes en Graph (DELETE) y en el store antes de re-crear — purga asociaciones incorrectas persistidas (el webhook confiaba en el `clientState` sin validar contra el store)
- [x] Verificado con tests unitarios del matching (6/6 PASS) y `node --check`
- ⚠️ Requiere: deploy a Render + clic en "📂 Re-suscribir carpetas" en Ajustes + limpieza manual de las facturas mal importadas al proyecto Dor
- [x] Deploy hecho: commit `17f7986` pusheado a `agoldav/siscon-backend` → Render

### Sesión 2026-07-13 (migración web — fundación e infraestructura)
- [x] Cuentas creadas por el usuario: Supabase (`siscon-prod`), Cloudflare R2 (bucket `siscon-archivos`), app de Dropbox (`siscon-respaldos`)
- [x] `GUIA_CUENTAS_WEB.md` — guía paso a paso de creación de cuentas
- [x] `CONFIG_WEB.md` — valores públicos + mapa de variables de entorno secretas para Render
- [x] Proyecto Supabase verificado activo; variables de entorno en Render confirmadas
- [x] `SUPABASE_SCHEMA.sql` — esquema v1: 17 tablas + audit_log + soft delete + RLS + triggers
- [x] **Esquema aplicado exitosamente en Supabase** (18 tablas verificadas en Table Editor)
- [x] **Capa API en Render:**
  - [x] Commit `6104e86`: endpoints CRUD manuales para projects (demo)
  - [x] Commit `0f17b0c`: refactor → factory `createCrudRoutes()` genera CRUD para 17 tablas automáticamente (GET/POST/GET:id/PUT/DELETE)
  - [x] POST `/api/db/import` — migrador de localStorage → Supabase (una sola vez, inicial)
  - [x] Autenticación JWT en todos los endpoints (`getSupabaseUser()`)
  - [x] Soft delete en todas las operaciones DELETE
- [x] `MIGRACION_FRONTEND.md` — guía completa para reemplazar saveData/loadData en el HTML

### Sesión 2026-07-15 (migración web — integración completa + despliegue)
- [x] Frontend integrado con API:
  - [x] `saveDataToAPI()` — sincroniza datos con Supabase (PUT `/api/db/settings/1`)
  - [x] `loadDataFromAPI()` — carga datos desde Supabase (GET `/api/db/settings/1`)
  - [x] `login()` — genera tokens locales (formato `local_[base64(JSON)]`)
  - [x] `migrateLocalStorageToSupabase()` — migración automática en primer login (POST `/api/db/import`)
  - [x] Headers de autenticación: `Authorization: Bearer {token}` + `x-siscon-token: siscon-2026-pmapp`
- [x] Backend mejorado (Render):
  - [x] Commit `9c8914b`: logging para tokens locales
  - [x] Commit `c2907a1`: normalización de camelCase → snake_case + soporte jsonb
  - [x] Commit `fea7cc3`: solo agregar `created_by` a tablas que la tienen
  - [x] Commit `355e6fc`: validación de tipos antes de insert (previene errores Postgres)
  - [x] Commit `dfc5334`: auto-normalizar campos desconocidos a jsonb
- [x] Supabase schema fixes:
  - [x] Agregadas columnas `created_at`, `deleted_at` a tabla `settings`
  - [x] Deshabilitado RLS temporalmente para testing (será re-habilitado con políticas correctas)
- [x] **Datos migrados a Supabase**: 2 proyectos importados exitosamente
- [x] **Frontend desplegado en Vercel**: `siscon-web` → repo GitHub + auto-redeploy
  - [x] Commit en GitHub: `siscon_adm_app_v5.4.2.html` como `index.html`
  - [x] URL pública: `https://siscon-web-zip1.vercel.app` (+ alias `siscon-web-nu.vercel.app`)
- [x] **Dominio personalizado configurado**: `app.sisconcr.com`
  - [x] CNAME en Bluehost: `app` → `e7f7cd3f08ce7909.vercel-dns-017.com`
  - [x] Vercel valida "Valid Configuration" en verde
  - [x] URL: `https://app.sisconcr.com` (funcional)

### Sesión 2026-07-17 (v5.4.3 — IVA configurable + UI fixes)
- [x] **Panel de gestión de usuarios** en Ajustes: crear, editar, eliminar usuarios (Admin solo) — ya estaba implementado
- [x] **IVA configurable en Factura a Cliente:**
  - [x] Cada línea de casa tiene dropdown: "13%" / "Sin IVA" (reemplazó QB taxCodeId)
  - [x] Cada línea manual tiene dropdown: "13%" / "Sin IVA"
  - [x] Cambiar `ciLineIVA()` para usar `ivaRate` en lugar de `taxCodeId`
  - [x] Inicializar `ivaRate:0.13` en nuevas líneas (ciPickHouse, ciAddManual)
- [x] **IVA configurable en OC:**
  - [x] Selector global de IVA en formulario: "13% IVA" / "Sin IVA" (debajo de Moneda)
  - [x] Inicializar `ivaRate:0.13` en nuevas OC
  - [x] Actualizar `ocRefreshTotals()` para usar `ocState.ivaRate` en lugar de hardcoded 0.13
  - [x] Label dinámico mostrando el % de IVA seleccionado
- [x] **OC currency toggle:**
  - [x] Crear `ocSwapCurrency()` para alternar `st.showUSD`
  - [x] Reemplazar checkbox "USD" con botón clickeable: "₡ CRC – Colones ⇄" / "$ USD – Dólares ⇄"
  - [x] Botón cambia la moneda mostrada al hacer click
- [x] **Calculadora → Invoicing integration:**
  - [x] Find 'Sub-Contrato' lineId in house type budget
  - [x] Associate invoice lines with Sub-Contrato budget line
  - [x] When applied to house, gasto correctly debited to Sub-Contrato presupuesto
  - [x] House panel shows consumption of Sub-Contrato budget via invoicing
- [x] **Fix Factura Proveedor "Diferencia de OC":**
  - [x] Improved line matching: description-based (case-insensitive) + fallback to position
  - [x] Uses Set to prevent reassigning same OC line
  - [x] Preserves lineId in assign for tracking
  - [x] "Δ Diferencia OC" checkbox now shows price comparison correctly

### Sesión 2026-07-19/20 (web — IVA por línea + permisos async en Factura de Gasto)
> App en producción = repo GitHub `agoldav/Siscon-web` → `index.html` → Vercel → **`app.sisconcr.com`**. (Los `siscon_adm_app_v5.4.x.html` locales quedan como respaldo/legado; ya no son la fuente de verdad.)
- [x] **Dropdown de IVA: flecha visible + no escribible** — los `<select>` de IVA compartían estilo con los inputs y parecían editables; se envolvieron en `.ivasel` (flecha ▾ vía `::after` con `pointer-events:none` + `appearance:none`), theme-aware. Se probó en navegador hasta confirmar que pinta la flecha de forma confiable (el `background-image` en `<select>` no repintaba en algunos casos).
- [x] **Fix "Sin IVA" no ponía 0%** — `ocRefreshTotals` usaba `st.ivaRate||0.13`; como `0` es falsy, "Sin IVA" seguía cobrando 13%. Corregido con chequeo explícito de `===0`.
- [x] **IVA por línea en Factura de Proveedor** (patrón de facturas a cliente): dropdown 13%/Sin IVA en cada renglón (default 13%); se eliminó el dropdown único de los totales; el IVA de totales es informativo (`vbIVATotal()` = Σ `vbLineNet*ivaRate`); `saveVendorBill` usa IVA por línea.
- [x] **IVA por línea en OC**: dropdown 13%/Sin IVA en cada material (casas y bodega); Resumen muestra IVA informativo consolidado; se eliminó el dropdown único de totales; `ocLineIVARate()`/`ocIVATotalUSD()`; columna IVA agregada a grids `.oc-line`/`.oc-tbl-head` (normal/res/bod); PDF de OC usa IVA por línea.
- [x] **Factura de Gasto — solicitud de material fuera de lista va al ADMIN (async)**: antes `vbSubmitMatAuth` pedía la contraseña de admin al MISMO usuario (síncrono). Ahora crea una solicitud pendiente (`type:'vb-extra-material'`) que el admin aprueba desde su sesión, igual que la OC — reutiliza `pendingAuthList`/`showPendingAuthPopup`/`resolveExtraAuth`/`pollPendingAuth`. `applyApprovedVbExtra()` agrega el material a `h.purchases` (idempotente) al aprobar; `isProductAuthorizedForHouse()` evita que el material aprobado siga pidiendo autorización. Se eliminó el flujo síncrono `vbMatAuthResolve`/`_vbMatAuthCtx`.
- [ ] Mejora futura anotada (NO construir aún): **aprobaciones por WhatsApp** (notificación + aprobar/rechazar desde WhatsApp vía webhook al backend; requiere WhatsApp Business API, plantillas de Meta, seguridad por lista blanca).

### Sesión 2026-07-20 (Supabase Auth — gestión de usuarios real, Fase 1)
> Toca DOS repos: `agoldav/Siscon-web` (frontend→Vercel) y `agoldav/siscon-backend` (backend→Render).
- [x] **Aclaración:** el **login ya usaba Supabase Auth real** desde la migración web (`/api/auth/signin` → `signInWithPassword` → JWT real + refresh + forgot/reset). Lo que faltaba era la **gestión de usuarios**.
- [x] **Backend** (`siscon-backend`): 3 endpoints admin nuevos → `GET /api/auth/users` (lista `profiles` + invitaciones pendientes con `code`), `DELETE /api/auth/users/:id` (`auth.admin.deleteUser` + borra profile; no self), `PUT /api/auth/users/:id/role` (cambia rol; no quitarse admin a sí mismo). Ya existían invite-user/accept-invitation/forgot/reset.
- [x] **Frontend** — modal **"Cuentas de acceso"** (`openUsersModal`) completo: lista usuarios reales con **badge de rol** + **dropdown para cambiar rol** + **eliminar cuenta** (excluye al propio admin); **invitaciones pendientes** con botón "Copiar link"; **invitar** con email + rol. `inviteSupabaseUser` ahora envía el rol y muestra/copia el **link de invitación** (el email automático sigue siendo TODO del backend → se comparte a mano). `loadSupabaseUsers` usa `GET /api/auth/users`.
- [x] **Seguridad:** eliminada la creación insegura de usuarios con password `1234`. La sección **Ajustes → Usuarios** pasó a ser **directorio de RRHH** (nombre, correo, cédula, salario, fecha) **sin contraseñas**; el login se gestiona solo en "Cuentas de acceso". Botón "👥 Cuentas de acceso" agregado en Ajustes.
- [x] Verificado en navegador (mock): el modal renderiza roles, cambiar rol, eliminar, invitación pendiente con link, e invitar con rol. Sintaxis OK (frontend + `node --check` backend). Desplegado: frontend en Vercel (`Cuentas de acceso` en vivo) y backend en Render (`GET /api/auth/users` → 401 = existe y pide auth). Stamp `BUILD-5-USUARIOS`.
- [x] **Bug crítico encontrado y resuelto:** al aceptar una invitación salía el error `{}`. Causa: el **trigger `handle_new_user` en Supabase estaba roto** — al crear la cuenta, GoTrue intentaba insertar la fila de `profiles` (columnas `username`/`name` `NOT NULL`) vía ese trigger, fallaba, y abortaba `admin.createUser` con 500 (`AuthRetryableFetchError: {}`). **Fix:** recrear el trigger con `coalesce` para `username`/`name`/`role` + `on conflict (id) do nothing` (corrido en Supabase SQL Editor). También se endureció `accept-invitation` (nunca devuelve `{}`, recupera usuario existente, `needsManualLogin` si el auto-login falla) y `authErrMsg` en el frontend (nunca muestra `{}`). Backend build `auth-invite-fix-4`.
- [ ] **Pendiente de esta línea** (ver sección Pendiente): (a) **RLS** para hacer cumplir roles en el servidor; (b) **email automático** de invitaciones (hoy link manual); (c) **sincronizar `SYS.users` ↔ Auth** para que los usuarios invitados aparezcan en Mensajes/avatares (hoy la mensajería sigue usando el directorio local).

### Sesión 2026-07-20 (RLS activado + bug crítico del cliente Supabase)
> Backend `siscon-backend` → Render. Toca seguridad de datos — leer con cuidado.
- [x] **RLS activado** en todas las tablas `public` de Supabase (estaba desactivado "para testing"). El frontend NO habla directo con Supabase (la anon key está en el HTML pero solo definida, nunca usada) — todo va por el backend con `service_role`, que ignora RLS. Se corrió SQL que hace `enable row level security` + `drop policy` en todas las tablas de `public`. **Se cerró un hueco grave:** con la anon key pública se podía leer `settings`/`profiles` completos; ahora devuelve `[]`.
- [x] **BUG CRÍTICO que RLS destapó:** la app no cargaba datos en sesiones sin caché (incógnito/otro navegador mostraba los proyectos de ejemplo). Causa: el backend usaba **un único cliente global `supabase` (service_role)** y llamaba `signInWithPassword`/`refreshSession` **sobre ese mismo cliente** → lo dejaba en modo `authenticated`, y las consultas siguientes (`/api/db/*`) quedaban sujetas a RLS (sin políticas = vacío). Antes de RLS pasaba desapercibido; también **rompía la sincronización entre dispositivos** (los datos solo vivían en el localStorage del navegador). **Fix:** `signInWithPassword`/`refreshSession` usan un **cliente efímero** (`sbEphemeral`/`sbSignIn`/`sbRefresh`); el cliente principal se crea con `persistSession:false` y NUNCA hace sign-in; se quitó `supabase.auth.signOut()` del logout. Verificado: login + `GET /api/db/settings/1` devuelve el proyecto "Dor". Build backend `signin-client-fix-2`. **Regla:** nunca llamar `signInWithPassword`/`refreshSession`/`signOut`/`setSession` sobre el cliente service_role compartido.
- [x] Nota de datos: la cuenta de prueba `abraham@gmdestudio.com` quedó con pw temporal `DiagTest2026Xy` (cambiar cuando sea posible).

### Sesión 2026-07-23 (v5.4.3 — correcciones en OC)
- [x] **Issue 1 — Botón split azul "Comprar Producto Dentro de Presupuesto":**
  - [x] Reemplazó el botón "Agregar producto fuera de presupuesto" por un botón split azul
  - [x] Botón principal: "+ Comprar Producto Dentro de Presupuesto" (sin autorización)
  - [x] Flecha dropdown: abre opción "Agregar producto fuera de presupuesto" (requiere autorización)
  - [x] Al hacer clic en el principal, abre ventana para elegir casa y producto presupuestado disponible
  - [x] Permite re-agregar productos presupuestados que ya no están en la OC
- [x] **Issue 2 — Botón de moneda (CRC/USD):**
  - [x] El texto del botón ahora cambia al hacer clic: alterna entre "CRC – Colones ⇄" y "USD – Dólares ⇄"
  - [x] Antes solo cambiaba los montos mostrados; ahora el botón refleja la moneda actual
- [x] **Issue 3 — Crear OC desde casa → Guardar no guardaba:**
  - [x] Bug encontrado: `setTab('txn')` reseteaba `curOCId=null`, haciendo que `ocSaveSilent` no reconociera la OC nueva como 'new'
  - [x] Fix: re-fijarse `curOCId='new'` después de `setTab('txn')`
  - [x] Verificado: OC creada desde panel de casa ahora se guarda correctamente
- [x] **Deploy:** sello BUILD-8-OC con los 3 arreglos desplegados y verificados en vivo

### Sesión 2026-07-24 (Hardening FASE 1 — VUL-001/002/003/006 + Infraestructura Cloudflare/Entra)
> **Punto de quiebre:** Auditoría completada 2026-07-23. Implementación de FASE 1 y todos los prerequisitos P1-P6.
> **Rama de trabajo:** `security-hardening`. **Backup:** tag `backup-2026-07-23`.

#### FASE 1 — Contención QB (VUL-001, VUL-002, VUL-003, VUL-006)
- [x] **VUL-001 | Escritura arbitraria a QB:** Eliminado endpoint `POST /api/qbo/create` del backend. Eliminadas funciones `qboCreate()` y botón asociado del frontend.
  - Commit backend: `baac007` — "FIX: VUL-001/002/003/006 - Eliminar endpoints inseguros de QB + agregar middleware Cloudflare Access"
  - Commit frontend: `9df50bd` — "FIX: VUL-001/003/006 - Eliminar llamadas a endpoints inseguros de QB en frontend"
- [x] **VUL-002 | Endpoints contables expuestos (POST/PUT/PATCH/DELETE QB):** Middleware `validateCloudflareAccess()` agregado antes de todas las rutas (excepto public + `/internal/*`). QB ahora solo acepta GET; escritura bloqueada.
  - Validación de JWT de Cloudflare Access en cada request antes de datos/credenciales.
  - Development mode: `CLOUDFLARE_ENABLED=false` permite testing sin Access; producción: enforcement obligatorio.
- [x] **VUL-003 | Exposición de refresh_token:** Eliminado endpoint `GET /api/qbo/refresh-token` que devolvía el token. Tokens QBO solo en secretos de Render (env vars), nunca en HTTP. Renovación OAuth ocurre internamente en servidor.
  - Eliminada función `qboCopyRefreshToken()` del frontend.
- [x] **VUL-006 | Consultas arbitrarias a QB desde frontend:** Eliminado endpoint genérico `POST /api/qbo/query`. Eliminada función `qboApiQuery()` con stub error: "FASE 1: Consultas arbitrarias a QB (POST /api/qbo/query) están desactivadas."
  - Simplificada `qboTestConnection()` para solo usar `qboStatus()` sin queries directas.

#### Prerequisitos de infraestructura (P1-P6)
> Implementados como parte del plan FASE 2 (validación Cf-Access-JWT + `/api/me`). Se completaron el 2026-07-24 como preparación.

- [x] **P1 | DNS a Cloudflare:**
  - Migrados nameservers de `sisconcr.com` desde Bluehost (NS1.BLUEHOST.COM, NS2.BLUEHOST.COM) a Cloudflare (maya.ns.cloudflare.com, hans.ns.cloudflare.com).
  - Registros DNS importados automáticamente. Cloudflare ahora gestiona DNS.
- [x] **P2 | Azure App Registration (Entra ID + Access):**
  - Aplicación NUEVA dedicada (no reutilizar la de Graph/Outlook).
  - Application ID: `cb7c3aa2-ae79-4360-bd80-17198d15181e`
  - Tenant ID: `8887c3de-dcd3-4f79-8fde-76bbf4c41649`
  - Client secret generado.
  - Redirect URI configurado para callback de Cloudflare Access.
- [x] **P3 | Cloudflare Access — IdP integrado:**
  - Microsoft Entra ID conectado como proveedor de identidad en Cloudflare Zero Trust.
  - Verificado: "Microsoft Entra ID" aparece en lista de proveedores integrados.
- [x] **P4 | MFA (Security Defaults en Entra):**
  - Security defaults verificados HABILITADOS en el tenant de Siscon.
  - MFA requerido para los 4 usuarios vía Microsoft Authenticator.
- [x] **P5 | Cloudflare Access Apps:**
  - App 1: `app.sisconcr.com` (frontend Vercel) — tipo public DNS.
  - App 2: `api.sisconcr.com` (backend Render) — tipo public DNS.
  - Ambas con **allow policy** restringiendo acceso a 4 emails: abraham@sisconcr.com, desarrollos2@sisconcr.com, proyectos@sisconcr.com, recepcion@sisconcr.com.
  - **Deny-by-default:** cualquier otro acceso es bloqueado.
- [x] **P6 | Intuit OAuth Redirect URI:**
  - Redirect URI en Intuit Developer Portal actualizado de `https://siscon-backend.onrender.com/api/qbo/callback` a `https://api.sisconcr.com/api/qbo/callback`.
  - QB OAuth ahora apunta al dominio hardened detrás de Cloudflare Access.

#### Estado posterior a FASE 1
- Backend almacena tokens QBO como secretos de Render; ningun token en HTTP.
- QB es solo lectura; cero endpoints de escritura.
- Middleware JWT de Cloudflare Access bloquea requests sin header `Cf-Access-Jwt-Assertion` válido.
- Infraestructura lista para FASE 2 (validación `/api/me` + eliminación login propio de Siscon).

### Sesión 2026-07-24+ (Revisión de seguridad — FASE 1 REALMENTE cerrada; FASE 2 reabierta)
> **Rama de trabajo:** `security-hardening`. Nada de esto está en `main` todavía (ver "Estado de despliegue").

#### ⚠️ Hallazgo de la revisión: FASE 1 nunca quedó funcional
Una auditoría del código y del entorno en vivo encontró que **la pieza central de FASE 1 — validar la
firma del JWT de Cloudflare — estaba como `TODO`**. El middleware solo hacía `base64`-decode del payload
**sin verificar la firma**, así que un `Cf-Access-Jwt-Assertion` falsificado (pegándole directo a
`onrender.com`) era **aceptado**. El bypass de origen (VUL-019/020/021) seguía abierto de facto.
También se detectó que **un primer intento de FASE 2 (commits `4df7078` backend / `3e22f6e` frontend)
no funcionaba**: `/api/me` estaba en la lista de públicos (nunca recibía `req.cf`), el frontend llamaba a
`onrender.com` en vez de `api.sisconcr.com`, `/api/db/*` seguía usando el token `local_` forjable, y había
choque de modelo de roles `OWNER` vs `Administrador`. Por eso las VUL-004..013 **se reabren** (estaban
marcadas como cerradas prematuramente).

#### ✅ FASE 1 — Validación REAL del JWT (commit `cb7d3e0`)
- [x] **Verificación de firma RS256** contra el JWKS de Cloudflare (`createRemoteJWKSet`) + validación de
  `iss` (issuer) y `aud` (audience). Aislada en `cf-access.js` (`makeCfVerifier`) para poder testearla.
- [x] Middleware reescrito: **verifica** el token (firma+aud+iss) antes de setear `req.cf`; **403** si es
  inválido/ausente. **Fail-closed 500** si `CLOUDFLARE_ENABLED=true` pero falta `CLOUDFLARE_TEAM` o
  `CLOUDFLARE_ACCESS_AUD`. Eliminado `loadCloudflareKeys()` (código muerto) y el decode-inseguro.
- [x] `/api/me` sale de la lista de públicos (es quien establece identidad → REQUIERE el JWT verificado).
- [x] Dependencia `jose@^4` (CJS). Nueva env var `CLOUDFLARE_ACCESS_AUD` documentada en `.env.example`.
- [x] Pruebas: `test-cf-access.js` (9/9 PASS: acepta válido; rechaza firma desconocida, aud/iss malos,
  expirado, payload manipulado, sin email, basura). Verificado además por HTTP: sin JWT→403, basura→403,
  payload forjado→403, mal configurado→500, dev (CF off)→pasa.
- Con esto **VUL-019/020/021 quedan realmente cerradas** (a nivel de código; falta el despliegue).

#### ⏳ FASE 2 — reabierta (rehacer sobre la base ya sólida)
Pendiente para que Access sea de verdad el IdP único (ver Sección 10 y 11.1):
- `/api/db/*` y demás rutas deben **consumir `req.cf`** (identidad de Access), no `getSupabaseUser`.
- **Eliminar el token `local_`** (VUL-004) y `SISCON_TOKEN` como auth (VUL-005).
- Frontend: `BACKEND_URL` → **`api.sisconcr.com`** (hoy va directo a `onrender.com`, se salta Cloudflare).
- Unificar **modelo de roles** (`Administrador/Supervisor/Regular` ↔ `OWNER/MEMBER`) y correr la migración
  de `profiles` (columna `email`, rol). Sin eso `/api/me` y `validateOwnerRole` no resuelven bien el rol.
- `/api/me` ya recibe `req.cf` (arreglado arriba), pero depende de la migración de `profiles` para el rol.

#### Estado de despliegue (importante)
- **Producción sigue en `main`:** backend `833f686` (sin middleware CF, con endpoints QB de escritura aún
  vivos) y frontend `b0c184e`. **Ni FASE 1 ni FASE 2 están desplegadas.** La afirmación previa de "FASE 1
  desplegada y verificada en vivo" era inexacta.
- **Turn-on real** (`CLOUDFLARE_ENABLED=true` en Render) **requiere** que la FASE 2 frontend esté lista
  (llamar a `api.sisconcr.com`), o la app se rompe (403 en todo). Secuencia segura: mergear FASE 1 con
  `CLOUDFLARE_ENABLED=false` (no cambia el comportamiento en prod) y activar Access en el cutover de FASE 2.
- Falta (acción del OWNER en consola): obtener el **AUD tag** de la Access App de `api.sisconcr.com` y
  ponerlo como `CLOUDFLARE_ACCESS_AUD` en Render, junto con `CLOUDFLARE_TEAM` y `CLOUDFLARE_ENABLED`.

## 10. ⏳ Pendiente

> Nota: la **Pestaña Tareas** ya está implementada (existe `renderTareas`, `SYS`/`curProj.tasks`, tablero y badge). Queda en el histórico como completada aunque no tiene sesión fechada asociada.

### Próxima sesión (2026-07-17+)
- [~] **Supabase Auth real** — Login ✅, **gestión de usuarios ✅ Fase 1**, **RLS ✅ activado** (cierra el hueco de la anon key; ver sesión 2026-07-20). **Falta:** (a) **email automático** de invitaciones (hoy se comparte link a mano — backend `invite-user` tiene el envío como TODO; requiere proveedor SMTP o el de Supabase); (b) **sincronizar `SYS.users` ↔ Auth** para que los invitados aparezcan en Mensajes/avatares (hoy la mensajería usa el directorio local, con ids numéricos vs uuid de Auth — hacer con cuidado). Nota: RLS solo protege acceso directo; los roles se siguen aplicando en el backend (no hay políticas por-rol porque todo va por service_role).
- [ ] **Backups automáticos** — A Dropbox (integración con Dropbox API OAuth)
- [ ] **Invitar usuarios** — Para que colaboren en tiempo real (gestión de usuarios en la app)
- [ ] **Ajustes finales** — UI, validaciones, seguridad (refactor de código, testing, optimizaciones)

### Funcionalidades nuevas acordadas (Paquete 2)
- (Ambas completadas: Tareas y Mensajes Internos.)

### Integraciones pendientes
- [ ] **QuickBooks:** afinar mapeo de campos en producción (cuentas de gasto, custom field consecutivo Hacienda, monedas CRC/USD)
- [ ] **Materiales por proveedor:** no existe asociación material↔proveedor en el modelo; se hará con catálogo de Items de QuickBooks
- [ ] **Adjuntos permanentes:** blob URLs no persisten entre sesiones. Requiere storage en backend (Cloudflare R2, etc.)

### Infraestructura / Producción
- [ ] Persistencia de tokens en base de datos Supabase (no en `/tmp`)
- [ ] Seguridad: API keys siempre vía backend, nunca expuestas en el navegador
- [ ] Habilitar RLS correctamente en Supabase (políticas por usuario/rol)

### Informes adicionales (pendiente de implementar)
- [ ] Informe de Flujo de Caja proyectado
- [ ] Informe de Avance por Proyecto (% completado, área instalada, casas terminadas)
- [ ] Informe de Facturas a Cliente (emitidas, pagadas, pendientes)
- [ ] Informe de Órdenes de Compra por proveedor

### Mejoras futuras (anotadas, sin fecha)
- [ ] **Aprobaciones por WhatsApp** — que las solicitudes de aprobación lleguen a WhatsApp y el admin apruebe/rechace desde ahí. Arquitectura: frontend crea el request → backend envía WhatsApp → webhook recibe la respuesta → backend cambia `req.status` en Supabase → el polling actual aplica el material. Requiere: WhatsApp Business API (Twilio para prototipo / Meta Cloud API para producción), número dedicado, plantillas pre-aprobadas por Meta, lista blanca de números de admin. Decisiones pendientes: proveedor y mecanismo (botones vs texto+código). **NO construir hasta que el usuario lo pida.**

---

## 11. 🔒 Vulnerabilidades de Seguridad

> **Auditoría externa completada (2026-07-23):** análisis completo de arquitectura y seguridad realizado. Estas vulnerabilidades se corregirán en 4 días según el plan de fases.
>
> **Nota de arquitectura (actualizada 2026-07-23):** el plan de corrección adopta **Cloudflare Access como IdP único**
> (Microsoft Entra ID / Outlook 365) y **validación del JWT de Access en el backend** (ver Sección 12). Esto cambia
> la *forma* de resolver varias vulnerabilidades de autenticación: en lugar de construir un login propio con JWT de
> Supabase + MFA propio, **se elimina la autenticación propia de Siscon**. Con eso, VUL-004, VUL-005, VUL-007, VUL-008,
> VUL-011 se cierran **por diseño** (ya no existe el token `local_`, ni `SISCON_TOKEN` como auth, ni tokens en
> localStorage, ni sesiones propias que revocar — la identidad y el MFA los provee Microsoft, y la revocación es
> central). El faseo de abajo se mantiene; las *acciones* reflejan este enfoque.

### 11.1 Vulnerabilidades Pendientes (Estado actual)

#### FASE 1 — Contención rápida (✅ Completada 2026-07-24)
> Vulnerabilidades críticas de ejecución remota y datos expuestos

- [x] **VUL-001** | Escritura arbitraria a QuickBooks
  - **Estado:** ✅ CERRADA (2026-07-24)
  - Descripción: Endpoint `POST /api/qbo/create` permite crear entidades en QB directamente desde frontend
  - Acción realizada: Eliminado completamente endpoint; eliminadas funciones `qboCreate()` y botón del frontend.
  - Commits: backend `baac007`, frontend `9df50bd`

- [x] **VUL-002** | Endpoints contables expuestos (`POST`, `PUT`, `PATCH`, `DELETE`)
  - **Estado:** ✅ CERRADA (2026-07-24)
  - Descripción: Métodos HTTP de escritura en QB accesibles sin validación de intención
  - Acción realizada: Middleware `validateCloudflareAccess()` valida JWT de Cloudflare Access en cada request. QB solo acepta GET; escritura bloqueada.
  - Commits: backend `baac007`

- [x] **VUL-003** | Exposición de `refresh_token` en respuestas HTTP
  - **Estado:** ✅ CERRADA (2026-07-24)
  - Descripción: Endpoint `GET /api/qbo/refresh-token` devuelve el token de larga duración
  - Acción realizada: Eliminado completamente endpoint. Tokens QBO solo en secretos de Render (env vars), nunca en HTTP. Renovación OAuth internamente en servidor. Eliminada función `qboCopyRefreshToken()` del frontend.
  - Commits: backend `baac007`, frontend `9df50bd`

- [x] **VUL-006** | Frontend puede efectuar consultas arbitrarias a QB
  - **Estado:** ✅ CERRADA (2026-07-24)
  - Descripción: Endpoint genérico `POST /api/qbo/query` acepta cualquier QueryString desde el navegador
  - Acción realizada: Eliminado endpoint genérico. Eliminada función `qboApiQuery()` con stub error. Simplificada `qboTestConnection()` para solo usar `qboStatus()`.
  - Commits: backend `baac007`, frontend `9df50bd`

#### FASE 1.5 — Infraestructura de Cloudflare (✅ Completada 2026-07-24)
> Prerequisitos P1-P6 para FASE 2: IdP único + MFA + cierre del bypass de origen

- [x] **P1 | Migración DNS a Cloudflare**
  - **Estado:** ✅ COMPLETADO (2026-07-24)
  - Nameservers migrados de Bluehost a Cloudflare. Registros importados automáticamente.

- [x] **P2 | Azure App Registration (Entra ID + Access)**
  - **Estado:** ✅ COMPLETADO (2026-07-24)
  - App ID: `cb7c3aa2-ae79-4360-bd80-17198d15181e`, Tenant: `8887c3de-dcd3-4f79-8fde-76bbf4c41649`

- [x] **P3 | Cloudflare Access — IdP integrado**
  - **Estado:** ✅ COMPLETADO (2026-07-24)
  - Microsoft Entra ID conectado como proveedor. Verificado en Cloudflare Zero Trust.

- [x] **P4 | MFA (Security Defaults en Entra)**
  - **Estado:** ✅ COMPLETADO (2026-07-24)
  - Security defaults habilitados. MFA requerido vía Microsoft Authenticator.

- [x] **P5 | Cloudflare Access Apps**
  - **Estado:** ✅ COMPLETADO (2026-07-24)
  - Dos apps públicas (app.sisconcr.com + api.sisconcr.com) con allowlist de 4 emails, deny-by-default.

- [x] **P6 | Intuit OAuth Redirect URI**
  - **Estado:** ✅ COMPLETADO (2026-07-24)
  - Redirect URI actualizado a `https://api.sisconcr.com/api/qbo/callback`.

#### FASE 2 — Autenticación real (En progreso)
> Vulnerabilidades de sesión e identidad — comienza 2026-07-25

- [ ] **VUL-004** | Tokens `local_` sin firma almacenados en localStorage
  - Descripción: Autenticación basada en `local_[base64(JSON)]` sin validación server
  - Severidad: CRÍTICA
  - Ubicación: `index.html` función `login()`, `loadData()` línea ~XXX
  - Riesgo: Token es solo Base64, no hay integridad, vulnerable a XSS, puede ser falsificado
  - Acción: Reemplazar por JWT server-signed; mover a httpOnly cookie
  - Dependencia: VUL-005

- [ ] **VUL-005** | `SISCON_TOKEN` expuesto como secreto compartido débil
  - Descripción: Token `siscon-2026-pmapp` está en el código frontend y usado como validación
  - Severidad: CRÍTICA
  - Ubicación: `index.html` constante `SISCON_TOKEN`, `siscon-backend/server.js` validación
  - Riesgo: Secreto compartido = cualquiera que vea el código puede autenticarse
  - Acción: Eliminar; usar autenticación real (JWT) en su lugar
  - Dependencia: VUL-004

- [ ] **VUL-006** | Frontend puede efectuar consultas arbitrarias a QB
  - Descripción: Endpoint genérico `POST /api/qbo/query` acepta cualquier QueryString desde el navegador
  - Severidad: ALTA
  - Ubicación: `siscon-backend/server.js` `POST /api/qbo/query`, `index.html` función `qboQuery`
  - Riesgo: Acceso a entidades no autorizadas (cuentas bancarias, información sensible)
  - Acción: Eliminar endpoint genérico; crear adaptadores específicos con whitelist
  - Dependencia: VUL-001

#### FASE 2 — Autenticación real (Día 2-3)
> Vulnerabilidades de sesión e identidad

- [ ] **VUL-007** | Sin MFA real en Supabase
  - Descripción: Autenticación solo por email/password sin factor adicional
  - Severidad: ALTA
  - Ubicación: `siscon-backend/server.js` `POST /api/auth/signin`, `index.html` función `login()`
  - Riesgo: Contraseña débil o comprometida = acceso total
  - Acción: Activar TOTP/SMS en Supabase Auth; requerir al login
  - Dependencia: VUL-004

- [ ] **VUL-008** | Tokens en localStorage (vulnerable a XSS)
  - Descripción: JWT se almacena en `localStorage` en lugar de httpOnly cookie
  - Severidad: ALTA
  - Ubicación: `siscon-backend/server.js` respuesta login, `index.html` `saveData()` / `loadData()`
  - Riesgo: XSS puede robar token; localStorage es accesible a cualquier script
  - Acción: Mover tokens a httpOnly + Secure + SameSite cookies
  - Dependencia: VUL-004

- [ ] **VUL-009** | Cookies sin flags de seguridad (HttpOnly, Secure, SameSite)
  - Descripción: Si hay cookies, no tienen atributos de protección
  - Severidad: ALTA
  - Ubicación: `siscon-backend/server.js` `res.setHeader('Set-Cookie', ...)`
  - Riesgo: CSRF, acceso desde scripts no autorizados
  - Acción: Configurar `httpOnly=true`, `secure=true`, `sameSite=Strict`
  - Dependencia: VUL-008

- [ ] **VUL-010** | Validación de rol solo en frontend
  - Descripción: Los botones se ocultan/muestran por rol, pero backend no valida
  - Severidad: ALTA
  - Ubicación: `index.html` funciones renderizado, `siscon-backend/server.js` sin validación
  - Riesgo: Usuario puede modificar `localStorage` para cambiar rol, o usar API directamente
  - Acción: Validar rol en cada endpoint del backend antes de autorizar acción
  - Dependencia: VUL-004

- [ ] **VUL-011** | Usuario revocado puede seguir usando token antiguo
  - Descripción: No hay invalidación de sesiones al eliminar/revocar usuario
  - Severidad: ALTA
  - Ubicación: `siscon-backend/server.js` `DELETE /api/auth/users/:id`, `index.html` sin logout forzado
  - Riesgo: Usuario desvinculado mantiene acceso indefinidamente
  - Acción: Mantener lista de sesiones revocadas server-side; validar en cada request
  - Dependencia: VUL-007

- [ ] **VUL-012** | Sin protección CSRF
  - Descripción: No hay validación de origen o token CSRF en cambios de estado
  - Severidad: MEDIA
  - Ubicación: `siscon-backend/server.js` todas las rutas `POST`, `PUT`, `DELETE`
  - Riesgo: CSRF desde sitio malicioso puede ejecutar acciones en nombre del usuario
  - Acción: Implementar SameSite cookies + validar referer/origin si es necesario
  - Dependencia: VUL-009

- [ ] **VUL-013** | Sin reautenticación para acciones críticas
  - Descripción: Eliminar usuario, conectar QB, no requieren re-verificación de identidad
  - Severidad: MEDIA
  - Ubicación: `siscon-backend/server.js` endpoints críticos, `index.html` funciones
  - Riesgo: Usuario con sesión secuestrada puede realizar cambios irreversibles
  - Acción: Para OWNER-only actions, requerir password/MFA adicional
  - Dependencia: VUL-007

#### FASE 3 — Base de datos segura (Día 3)
> Vulnerabilidades de acceso a datos

- [ ] **VUL-014** | RLS sin políticas específicas
  - Descripción: RLS activado pero sin `create policy` por rol/usuario
  - Severidad: ALTA
  - Ubicación: Supabase SQL editor, tablas `public.*` sin políticas
  - Riesgo: Si se accede directo a Supabase (con anon key), devuelve `[]` vacío; pero no hay protección real
  - Acción: Crear políticas que solo permitan acceso a datos de la propia organización
  - Dependencia: VUL-015

- [ ] **VUL-015** | No valida organización por usuario
  - Descripción: Registros no están asociados a `org_id`; falta constraint de propiedad
  - Severidad: ALTA
  - Ubicación: Supabase schema, tablas `projects`, `settings`, etc.
  - Riesgo: Usuario A podría acceder a datos de usuario B si descubre el ID
  - Acción: Agregar columna `org_id` a todas las tablas; validar en RLS policies
  - Dependencia: VUL-014

- [ ] **VUL-016** | Deny-by-default no implementado en RLS
  - Descripción: Tablas tienen RLS pero sin `alter table ... enable row level security`
  - Severidad: ALTA
  - Ubicación: Supabase SQL para cada tabla
  - Riesgo: Por defecto, todos pueden leer si no hay política explícita
  - Acción: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY; ALTER TABLE ... FORCE ROW LEVEL SECURITY;`
  - Dependencia: VUL-014

- [ ] **VUL-017** | Backend usa global `service_role` sin validación de usuario
  - Descripción: Cliente Supabase server-side usa `service_role` que ignora RLS
  - Severidad: MEDIA
  - Ubicación: `siscon-backend/server.js` cliente Supabase configuración
  - Riesgo: Si hay bug en autorización backend, RLS no protege
  - Acción: Mantener `service_role` en server, pero validar usuario/rol en cada query antes de usarlo
  - Dependencia: VUL-010

- [ ] **VUL-018** | Sin auditoría de acciones
  - Descripción: No existe registro de quién hizo qué, cuándo, desde dónde
  - Severidad: MEDIA
  - Ubicación: Falta tabla `audit_log` o similar
  - Riesgo: No se puede investigar cambios no autorizados; imposible compliance
  - Acción: Crear tabla `audit_log(id, user_id, action, resource, timestamp, ip, ...)`; insertar en cada acción crítica
  - Dependencia: VUL-010

- [ ] **VUL-019** | Backend expone API pública en Render
  - Descripción: `siscon-backend.onrender.com` es accesible para cualquiera sin validación de origen
  - Severidad: CRÍTICA
  - Ubicación: Render configuración de servicio, `siscon-backend/server.js` CORS
  - Riesgo: Cualquiera puede intentar auth bypass, enumerate usuarios, fuerza bruta
  - Acción: Implementar Tailscale Serve O restricción de IP O mantener privado
  - Dependencia: VUL-001 (hasta que QB sea seguro)

- [ ] **VUL-020** | Sin validación de identidad antes de exponer datos
  - Descripción: Endpoint `GET /api/db/settings/1` valida JWT pero no hay rate limit ni auditoría
  - Severidad: ALTA
  - Ubicación: `siscon-backend/server.js` rutas `/api/db/*`
  - Riesgo: Acceso a datos totales del proyecto desde internet
  - Acción: Rate limiting + auditoría + (luego) restricción Tailscale
  - Dependencia: VUL-019

#### FASE 4 — Red privada + Monitoring (Después, en sesión separada)
> Infraestructura de defensa en profundidad

- [ ] **VUL-021** | Sin capa de red privada (Tailscale)
  - Descripción: La app es públicamente accesible en Internet
  - Severidad: CRÍTICA
  - Ubicación: Vercel y Render configuración
  - Riesgo: Superficie de ataque expuesta para 4 usuarios
  - Acción: Implementar Tailscale Serve; acceso solo desde red privada
  - Dependencia: VUL-019

- [ ] **VUL-022** | Sin validación de dispositivo aprobado
  - Descripción: No se rastrea ni se valida qué dispositivo se conecta
  - Severidad: ALTA
  - Ubicación: Falta integración con Tailscale devices
  - Riesgo: Dispositivo robado o infectado puede conectarse indefinidamente
  - Acción: Mantener whitelist de device IDs; requerir aprobación manual
  - Dependencia: VUL-021

- [ ] **VUL-023** | Sin rate limiting
  - Descripción: No hay límite de intentos de login, sync, etc.
  - Severidad: MEDIA
  - Ubicación: `siscon-backend/server.js` sin middleware de rate limit
  - Riesgo: Fuerza bruta, DoS
  - Acción: Implementar `express-rate-limit` en endpoints críticos
  - Dependencia: VUL-019

- [ ] **VUL-024** | Sin alertas de anomalías
  - Descripción: No hay notificación de intentos fallidos, nuevo dispositivo, cambio de rol, etc.
  - Severidad: MEDIA
  - Ubicación: Falta sistema de alertas, logs monitoreados
  - Riesgo: Intruso puede actuar sin ser detectado
  - Acción: Configurar alertas por email/Slack para eventos de seguridad
  - Dependencia: VUL-018

#### FASE 5 — OAuth de QB seguro (Día 3, integrado con FASE 1)
> Flujo de autorización de QuickBooks

- [ ] **VUL-025** | OAuth `state` fijo o no aleatorio
  - Descripción: CSRF token en flow OAuth no es criptográficamente aleatorio
  - Severidad: ALTA
  - Ubicación: `siscon-backend/server.js` `GET /api/qbo/connect`
  - Riesgo: CSRF en flow OAuth; atacante puede autorizar su propia cuenta QB
  - Acción: Generar `state` con `crypto.randomBytes(32).toString('hex')`; guardar en store; validar exactamente en callback
  - Dependencia: VUL-001

- [ ] **VUL-026** | No valida `realmId` autorizado
  - Descripción: Frontend puede proporcionar cualquier `realmId`; no se valida contra el autorizado
  - Severidad: ALTA
  - Ubicación: `siscon-backend/server.js` callback OAuth, `index.html` al guardar QB
  - Riesgo: Usuario A podría cambiar a cuenta QB de usuario B
  - Acción: Guardar `realmId` autorizadoserver-side; rechazar cambios desde frontend
  - Dependencia: VUL-001

- [ ] **VUL-027** | Sin protección PKCE en OAuth
  - Descripción: Flow OAuth no implementa PKCE (Proof Key for Public Clients)
  - Severidad: MEDIA
  - Ubicación: `siscon-backend/server.js` `GET /api/qbo/connect`, callback
  - Riesgo: Interceptación de `code` puede llevar a token hijacking
  - Acción: Implementar PKCE si Intuit lo permite; generar `code_verifier`, `code_challenge`
  - Dependencia: VUL-025

#### FASE 6 — Frontend seguro (Integrado en fases anteriores)
> XSS y seguridad del navegador

- [ ] **VUL-028** | Riesgo XSS almacenado (innerHTML inseguro)
  - Descripción: Uso de `innerHTML` con datos de usuario sin sanitización completa
  - Severidad: ALTA
  - Ubicación: `index.html` múltiples funciones renderizado (búsqueda necesaria con grep)
  - Riesgo: Script malicioso en nombre de proyecto, descripción, etc. se ejecuta para todos los usuarios
  - Acción: Auditoría de `innerHTML`; reemplazar con `textContent` o `createElement` para datos dinámicos
  - Dependencia: Integrado en VUL-010

- [ ] **VUL-029** | API keys expuestas en el navegador
  - Descripción: `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_KEY`, etc. pueden estar en el HTML
  - Severidad: MEDIA
  - Ubicación: `index.html` búsqueda de `_KEY`, `apiKey`, etc.
  - Riesgo: Terceros pueden usar las claves del usuario
  - Acción: Nunca exponer keys en frontend; todas via backend con `x-siscon-token` validado
  - Dependencia: VUL-005

- [ ] **VUL-030** | Sin CSP (Content Security Policy) estricta
  - Descripción: No hay CSP header para prevenir inyección de scripts
  - Severidad: MEDIA
  - Ubicación: `siscon-backend/server.js` headers de respuesta
  - Riesgo: XSS más fácil de explotar
  - Acción: Agregar header `Content-Security-Policy: default-src 'self'; ...`
  - Dependencia: VUL-028

- [ ] **VUL-031** | Falta security headers completos
  - Descripción: No hay HSTS, X-Frame-Options, X-Content-Type-Options, etc.
  - Severidad: MEDIA
  - Ubicación: `siscon-backend/server.js` middleware de headers
  - Riesgo: Clickjacking, MIME sniffing, SSL stripping
  - Acción: Implementar todos los headers recomendados (helmet.js o manual)
  - Dependencia: VUL-030

---

### 11.2 Vulnerabilidades Corregidas (Por fecha)

#### Sesión 2026-07-24 (FASE 1 — VUL-001, VUL-002, VUL-003, VUL-006)

- [x] **VUL-001 | Escritura arbitraria a QuickBooks** ✅ CERRADA
  - Acción: Eliminado `POST /api/qbo/create` del backend; eliminadas `qboCreate()` y botón del frontend.
  - Backend commit: `baac007` — FIX: VUL-001/002/003/006 - Eliminar endpoints inseguros de QB + agregar middleware Cloudflare Access
  - Frontend commit: `9df50bd` — FIX: VUL-001/003/006 - Eliminar llamadas a endpoints inseguros de QB en frontend

- [x] **VUL-002 | Endpoints contables expuestos (POST/PUT/PATCH/DELETE QB)** ✅ CERRADA
  - Acción: Middleware `validateCloudflareAccess()` valida JWT firmado de Cloudflare Access en cada request. QB bloqueado de escritura.
  - Backend commit: `baac007`

- [x] **VUL-003 | Exposición de refresh_token en respuestas HTTP** ✅ CERRADA
  - Acción: Eliminado `GET /api/qbo/refresh-token`. Tokens QBO solo en env vars de Render. Eliminada `qboCopyRefreshToken()` del frontend.
  - Backend commit: `baac007`
  - Frontend commit: `9df50bd`

- [x] **VUL-006 | Frontend puede efectuar consultas arbitrarias a QB** ✅ CERRADA
  - Acción: Eliminado `POST /api/qbo/query`. Eliminada `qboApiQuery()` con stub error.
  - Backend commit: `baac007`
  - Frontend commit: `9df50bd`

> **Infraestructura completada:** P1-P6 (DNS, Entra, Access, MFA, apps públicas, Intuit redirect). Listo para FASE 2.

#### Sesión 2026-07-24+ (FASE 1 — JWT de Cloudflare validado de verdad)

- [x] **Bypass de origen (soporte de VUL-002/019/020/021) — validación REAL del JWT de Access** ✅ CERRADA a nivel de código
  - **Estado:** ✅ Código cerrado (commit `cb7d3e0`, rama `security-hardening`); ⏳ pendiente de despliegue.
  - Descripción: el middleware de FASE 1 solo hacía `base64`-decode del payload **sin verificar la firma**;
    un `Cf-Access-Jwt-Assertion` forjado contra `onrender.com` era aceptado.
  - Acción: verificación RS256 contra el JWKS de Cloudflare + `iss` + `aud` (`cf-access.js` / `makeCfVerifier`);
    403 si inválido/ausente; fail-closed 500 si falta config. Pruebas 9/9 + verificación HTTP.
  - Turn-on requiere `CLOUDFLARE_ENABLED=true` + `CLOUDFLARE_TEAM` + `CLOUDFLARE_ACCESS_AUD` en Render, y la
    FASE 2 frontend (llamar a `api.sisconcr.com`).

> ⚠️ **REVERTIDO — cierres prematuros de FASE 2.** En una sesión previa se marcaron como "cerradas por
> diseño" VUL-004, 005, 007, 008, 009, 010, 011, 012 y 013 con los commits `4df7078`/`3e22f6e`. La revisión
> encontró que esa FASE 2 **no funcionaba** (ver Sección 9, "Revisión de seguridad"): `/api/me` no recibía
> identidad, el frontend se saltaba Cloudflare, `/api/db/*` seguía aceptando el token `local_`, y los roles
> chocaban (`OWNER` vs `Administrador`). Por eso **estas VUL vuelven a 11.1 (Pendientes)** hasta rehacer
> FASE 2 correctamente sobre la validación de JWT ya arreglada.

---

## 12. 🏗️ NUEVA ARQUITECTURA — Objetivo 4 días (2026-07-24 a 2026-07-27)

> **Decisión de arquitectura (corregida 2026-07-23 tras revisión crítica):** Opción A —
> **Cloudflare Access como IdP único** (Microsoft Entra ID / Outlook 365), **backend valida el JWT de Access**
> para cerrar el bypass de origen, **sin Cloudflare Workers** (sync QB en backend + cron externo), $0 extra.
> **Estado:** Planificación completa. Decisiones confirmadas por el OWNER. Implementación comienza 2026-07-24.
>
> **Decisiones confirmadas:** (1) Identidad = Cloudflare Access como IdP único (se elimina el login propio de
> Siscon); (2) MFA = Microsoft Entra ID (los 4 usuarios tienen cuenta `@sisconcr.com` en el mismo tenant M365)
> + Microsoft Authenticator; (3) QB Sync = sin Workers, corre en el backend disparado por cron externo.

### 12.1 Diagrama de arquitectura propuesta

```
Internet
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│ CLOUDFLARE (plan Free)                                        │
│  • Access = IdP ÚNICO → Microsoft Entra ID (Outlook 365)      │
│      - Login con cuenta @sisconcr.com + MFA (Authenticator)   │
│      - Policy: allowlist de 4 correos (deny-by-default)       │
│  • WAF + Rate Limiting (login / API / OAuth)                  │
│  • DNS de sisconcr.com gestionado aquí (proxied)              │
│  Inyecta header FIRMADO: Cf-Access-Jwt-Assertion              │
└───────────────┬───────────────────────────┬──────────────────┘
                │                           │
        app.sisconcr.com            api.sisconcr.com
                │                           │
                ▼                           ▼
   ┌──────────────────────┐  ┌───────────────────────────────────┐
   │ VERCEL (frontend)    │  │ RENDER (backend / API)            │
   │ • index.html         │  │ 1) VALIDA Cf-Access-JWT ◄─── cierra el bypass a onrender.com
   │ • SIN secretos       │  │ 2) email → rol (OWNER / MEMBER)   │
   │ • NO usa anon key    │  │ 3) valida permiso en cada request │
   │ • CSP / HSTS         │  │ 4) audita la acción               │
   │ • NO login propio    │  │ 5) rate limit por usuario         │
   └──────────┬───────────┘  └────────────────┬──────────────────┘
              │                               │ service_role
              └───────────────┬───────────────┘
                              ▼
                   ┌────────────────────────────┐
                   │ SUPABASE                   │
                   │ • RLS deny-by-default      │ ← red secundaria
                   │ • org_id por registro      │
                   │ • audit_log                │
                   │ • profiles: email → rol    │
                   └────────────────────────────┘

QB SYNC (dentro del backend Render — NO Worker)
├─ refresh_token QB = secreto de plataforma (env var Render); NUNCA al navegador/Git/logs/HTTP
├─ Disparo: cron externo gratis (GitHub Actions */5 min) → despierta endpoint interno server-to-server
├─ Solo LECTURA con adaptadores whitelist (clientes, facturas, pagos)
├─ Idempotente → upsert por qbo_id en Supabase
└─ CERO endpoints de escritura a QB
```

> **Por qué este diagrama y no el anterior:** el control de seguridad central no es "esconder el dominio", es que
> **el backend rechace (403) todo request que no traiga el `Cf-Access-Jwt-Assertion` firmado por Cloudflare**. Así,
> aunque `siscon-backend.onrender.com` siga siendo una URL pública, un request directo a ella (sin pasar por Access)
> es rechazado antes de tocar credenciales o datos. Ese es el punto 3 de la auditoría ("evitar saltarse Cloudflare").

### 12.2 Componentes principales

#### A. Cloudflare Access (IdP único + puerta de entrada)
- **Proveedor de identidad:** Microsoft Entra ID (tenant existente `8887c3de-...`, el mismo de Outlook/Graph). Login con la cuenta `@sisconcr.com` que los 4 usuarios ya usan a diario.
- **MFA:** lo aplica Microsoft (Security Defaults → Microsoft Authenticator). Gratis, incluido en M365.
- **Autorización:** policy con allowlist de los 4 correos; **deny-by-default** (nadie más entra).
- **Revocación central:** quitar al usuario en Microsoft / en la allowlist → pierde acceso a Siscon de inmediato.
- **App Registration:** una **NUEVA y dedicada** en Entra para Access (no reutilizar la de Graph/Outlook; propósitos distintos: "iniciar sesión" vs "leer buzón").
- **Alcance:** protege **ambos** hostnames — `app.sisconcr.com` (frontend) y `api.sisconcr.com` (backend).

#### B. Cierre del bypass de origen (el control CENTRAL)
- El backend valida el header **`Cf-Access-Jwt-Assertion`** en **cada** request, contra las llaves públicas de Cloudflare (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`), **antes** de tocar credenciales o datos.
- Sin JWT válido de Access → **403**. Un request directo a `siscon-backend.onrender.com` no trae ese header → rechazado.
- El frontend en `app.sisconcr.com` va detrás de Access; el dominio `*.vercel.app` no expone secretos (no hay API keys ni anon key en uso), así que el control real sigue siendo el backend.

#### C. Frontend (Vercel)
- **Archivo:** `/siscon-web/index.html`.
- **Sin login propio:** la sesión la establece Cloudflare Access (cookie `CF_Authorization`). Se **elimina** el login por email/password de Siscon, los tokens `local_` y el uso de `localStorage` para autenticación.
- **Identidad:** el frontend obtiene el usuario actual desde `GET /api/me` (el backend lo deriva del JWT de Access: email + rol).
- **Sin secretos:** ninguna API key ni la anon key de Supabase en uso.
- **Headers de seguridad:** CSP, HSTS, X-Frame-Options, X-Content-Type-Options.

#### D. Backend (Render)
- **Responsabilidades (en orden por request):**
  1. Validar `Cf-Access-Jwt-Assertion` (cierra el bypass).
  2. Derivar email del JWT y mapear a **rol** (`profiles`: email → OWNER/MEMBER).
  3. Validar **permiso** de la acción según rol.
  4. **Auditar** la acción crítica.
  5. **Rate limit** por usuario.
- **QB:** solo lectura; **cero** endpoints de escritura.
- **Se eliminan:** login propio, tokens `local_`, `SISCON_TOKEN` como auth, `/api/qbo/create`, `/api/qbo/refresh-token`, `/api/qbo/query`, y todo `POST/PUT/PATCH/DELETE` a QB.

#### E. Supabase (Base de datos)
- **RLS `deny-by-default`** como **red secundaria** (el guardián primario es el backend; todo pasa por él con `service_role`).
- **`org_id`** en todos los registros para evitar mezcla accidental de datos.
- **`audit_log`** para trazabilidad.
- **`profiles`**: mapea email (de Entra/Access) → rol.
- El **frontend nunca** habla directo con Supabase.

#### F. QB Sync (módulo dentro del backend — NO Worker)
- **Ubicación:** módulo `qb-sync` dentro del backend de Render (no una pieza separada).
- **Secreto:** `QB_REFRESH` como variable de entorno de Render. Nunca al navegador, Git, logs ni respuestas HTTP.
- **Disparo:** cron externo gratis (GitHub Actions `*/5 * * * *`) que hace `POST /internal/qb-sync` server-to-server con un secreto propio (nunca en el navegador). Necesario porque **Render Free se duerme** y su cron interno no correría.
- **Flujo:** renovar `access_token` → leer QB (adaptadores whitelist) → mapear a formato Siscon → **upsert por `qbo_id`** en Supabase → auditar. Idempotente. Solo lectura de QB.

### 12.3 Decisiones arquitectónicas

| Decisión | Por qué | Alternativa rechazada |
|----------|---------|----------------------|
| **Access como IdP único (Entra ID)** | Ya usan Outlook 365; MFA de Microsoft; SSO; revocación central; elimina medio código de auth | Login propio en Supabase (más código, doble MFA, más superficie de bugs) |
| **Backend valida `Cf-Access-JWT`** | Cierra el bypass de `onrender.com`/`vercel.app` sin costo — el control real | Confiar solo en proteger el dominio (teatro de seguridad) |
| **Mover DNS de sisconcr.com a Cloudflare** | Requisito para que Access + WAF protejan los hostnames; gratis | Dejar DNS en Bluehost (Access no podría aplicarse) |
| **Sin Cloudflare Workers (por ahora)** | Menos piezas nuevas en 4 días; el token QB vive seguro en el backend | Worker separado (runtime + deploy nuevos, riesgo de calendario) |
| **Cron externo (GitHub Actions)** | Render Free se duerme; el cron externo despierta el sync de forma confiable | `setInterval` en Render (no corre cuando el servicio duerme) |
| **RLS como defensa secundaria** | Todo pasa por el backend con `service_role`; el backend es el guardián | RLS como control primario (no aplica con `service_role`) |
| **`refresh_token` QB como secreto de plataforma** | Nunca en navegador/Git/logs; suficiente y simple | "Cifrado" propio con una llave maestra que también hay que custodiar |
| **Mantener Vercel + Render Free** | $0; el bypass se cierra por validación de JWT, no por infra paga | Migrar a Render Private ($12/mes) u otra infra de pago |

### 12.4 Prerequisitos de infraestructura (antes / durante Día 1)

> Son pasos de consola (Cloudflare, Entra ID, Microsoft 365). Varios requieren al **OWNER** con acceso de
> administrador. Los haremos juntos; Claude no puede ejecutarlos solo.

- **P1 — DNS de `sisconcr.com` a Cloudflare.** Cambiar los nameservers en Bluehost a los de Cloudflare (plan Free). Requisito para que Access y WAF protejan los hostnames. Propaga en minutos–horas. Re-crear los registros DNS existentes (incluido el CNAME de Vercel) en Cloudflare antes de cambiar NS para no cortar el sitio.
- **P2 — App Registration nueva en Entra ID** para Cloudflare Access: obtener Directory (tenant) ID, Application (client) ID y un client secret; registrar el redirect URI de Cloudflare. **No** reutilizar la App de Graph/Outlook.
- **P3 — Conectar Entra ID como IdP** en Cloudflare Zero Trust (Settings → Authentication → Add → Azure AD) con los datos de P2.
- **P4 — Activar MFA en Microsoft 365** (Security Defaults en Entra) para los 4 usuarios → Microsoft Authenticator.
- **P5 — Crear las Access Apps + policies:** `app.sisconcr.com` y `api.sisconcr.com`, cada una con policy allowlist de los 4 correos, deny-by-default.
- **P6 — Confirmar redirect URI de Intuit** sigue válido para el callback OAuth de QB tras los cambios de dominio.

### 12.5 Plan de migración — 4 días

> **Principio:** el cierre del bypass de origen (validar `Cf-Access-JWT` en el backend) es lo primero, porque hasta
> que esté, el backend sigue expuesto. No se mezcla todo en un solo cambio difícil de revisar.

#### **Día 1 (2026-07-24): FASE 1 — Cerrar el bypass + contención de QB**
- Crear rama `security-hardening` en ambos repos (`Siscon-web`, `siscon-backend`).
- Prerequisitos P1–P3, P5 (DNS a Cloudflare, Entra como IdP, Access apps para `app.` y `api.`).
- Backend: **middleware que valida `Cf-Access-Jwt-Assertion` en cada request** (403 si falta/!válido). ← prioridad
- Backend: **eliminar** `/api/qbo/create`, `/api/qbo/refresh-token`, `/api/qbo/query` y todo `POST/PUT/PATCH/DELETE` a QB.
- Verificar: request directo a `onrender.com` sin JWT → 403; QB responde solo a lecturas.
- **Cierra:** VUL-001, VUL-002, VUL-003, VUL-006, VUL-019, VUL-020, VUL-021.
- **Deploy:** Access + validación de JWT pueden ir en cuanto propague el DNS (con verificación).

#### **Día 2 (2026-07-25): FASE 2 — Access como IdP único (elimina auth propia)**
- Backend: `GET /api/me` devuelve email + rol derivados del JWT de Access; mapear email → rol en `profiles`.
- Backend: validar **rol por endpoint** (OWNER vs MEMBER); acciones OWNER-only chequean rol en servidor.
- Frontend: **eliminar** login propio, tokens `local_`, uso de `localStorage` para auth y `SISCON_TOKEN`; cargar usuario desde `/api/me`.
- Confirmar P4 (MFA / Security Defaults activo para los 4).
- **Cierra:** VUL-004, VUL-005, VUL-007, VUL-008, VUL-009, VUL-010, VUL-011, VUL-012, VUL-013.
- **Deploy:** no aún (o incremental controlado).

#### **Día 3 (2026-07-26): FASE 3 — Datos + WAF + auditoría + XSS**
- Supabase: **quitar el uso de la anon key** en el frontend; confirmar RLS deny-by-default; agregar `org_id` donde falte.
- Backend: crear tabla `audit_log`; insertar en cada acción crítica (`POST/PUT/DELETE`); `GET /api/audit-log` (solo OWNER).
- Cloudflare: WAF rules + rate limiting (login/API/OAuth); rate limit por usuario en backend.
- Frontend: CSP + HSTS + X-Frame-Options; **auditar `innerHTML`** y sanitizar datos de usuario (XSS).
- **Cierra:** VUL-014, VUL-015, VUL-016, VUL-017, VUL-018, VUL-023, VUL-028, VUL-029, VUL-030, VUL-031.
- **Deploy incremental:** headers + WAF.

#### **Día 4 (2026-07-27): FASE 4/5 — OAuth QB seguro + sync + deploy final**
- Backend: OAuth QB seguro — `state` aleatorio guardado server-side y validado en callback; validar `realmId` autorizado; PKCE si Intuit lo permite; solo OWNER inicia.
- Backend: módulo `qb-sync` (adaptadores whitelist, idempotente, upsert por `qbo_id`).
- Cron externo: workflow de GitHub Actions (`*/5 min`) → `POST /internal/qb-sync` (P6 confirmado).
- Ejecutar la **suite de pruebas negativas** (ver 12.9-tests).
- Merge `security-hardening` → `main` en ambos repos; deploy Vercel + Render.
- **Go-live:** los 4 usuarios entran vía Access + MFA con su cuenta `@sisconcr.com`.
- **Cierra:** VUL-025, VUL-026, VUL-027.

### 12.6 Plan de rollback

Si algo falla en deploy:

```bash
# Rollback frontend (Vercel)
git revert HEAD~1 && git push
# → Vercel redeploya automáticamente en ~2 min

# Rollback backend (Render)
git revert HEAD~1 && git push
# → Render redeploya automáticamente en ~2 min
```

**Cloudflare (desde el dashboard, sin código):**
- Access: desactivar la policy de la app (Zero Trust → Access → Applications → editar → desactivar) para restaurar acceso mientras se depura.
- WAF / Rate limiting: desactivar las reglas si bloquean tráfico legítimo.
- DNS: si el cambio de nameservers (P1) causa problemas, revertir NS en Bluehost restaura el estado previo (propaga en minutos–horas).

**Punto de retorno seguro:** el estado actual está respaldado en el tag `backup-2026-07-23`. Antes de eliminar endpoints de QB, verificar que el tag apunta al commit correcto.

### 12.7 Sincronización de QuickBooks (sin Workers)

> El sync corre **dentro del backend de Render**, disparado por un **cron externo** (GitHub Actions) porque Render
> Free se duerme. Es la opción con menos piezas nuevas para el plazo de 4 días. Migrar a un Worker/servicio
> separado queda como mejora futura (ver 12.11).

#### Secretos (solo servidor)
- `QB_REFRESH` — refresh_token de QuickBooks. Env var de Render. Nunca al navegador/Git/logs/HTTP.
- `QB_REALM_ID` — realmId autorizado. Env var de Render.
- `INTERNAL_SYNC_SECRET` — secreto compartido solo entre GitHub Actions y el backend para autorizar el disparo. Env var + secret de GitHub.

#### Disparo: GitHub Actions (cron externo gratis)

```yaml
# .github/workflows/qb-sync.yml (en el repo del backend)
name: QB Sync
on:
  schedule:
    - cron: '*/5 * * * *'   # cada 5 minutos
  workflow_dispatch: {}       # permite ejecutar a mano
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Disparar sync en el backend
        run: |
          curl -fsS -X POST "https://api.sisconcr.com/internal/qb-sync" \
            -H "x-internal-secret: ${{ secrets.INTERNAL_SYNC_SECRET }}"
```

#### Endpoint interno (esqueleto en el backend)

```javascript
// POST /internal/qb-sync  — server-to-server, NO expuesto al navegador
app.post('/internal/qb-sync', async (req, res) => {
  // 1) Autorizar SOLO por el secreto interno (este endpoint no pasa por Access;
  //    va de GitHub Actions al backend). Validar x-internal-secret con timing-safe compare.
  if (!safeEqual(req.get('x-internal-secret'), process.env.INTERNAL_SYNC_SECRET)) {
    return res.status(403).end();
  }
  try {
    const accessToken = await refreshQBToken(process.env.QB_REFRESH);        // renueva OAuth (única POST permitida a Intuit)
    const rows = await readQBWhitelist(accessToken, process.env.QB_REALM_ID); // SOLO lectura: clientes, facturas, pagos
    const mapped = rows.map(mapQBtoSiscon);                                   // adaptador con lista blanca de campos
    await upsertSupabase(mapped);                                            // idempotente: upsert por qbo_id
    await audit('qb-sync', { count: mapped.length });
    res.json({ ok: true, count: mapped.length });
  } catch (err) {
    await audit('qb-sync-error', { message: String(err && err.message) });    // sin secretos en el log
    res.status(500).json({ ok: false });
  }
});
```

- **Solo lectura:** el adaptador nunca emite `POST/PUT/PATCH/DELETE` contables a Intuit. La única `POST` a Intuit es la renovación OAuth interna.
- **Idempotente:** `upsert` por `qbo_id` → repetir el sync no duplica.
- **Whitelist de campos:** el mapeo importa solo los campos que Siscon usa; no importa datos bancarios ni tokens.

### 12.8 Inventario de endpoints que se eliminan/reemplazan

#### Se eliminan (escritura a QB o auth insegura):

| Endpoint | Método | Razón |
|----------|--------|-------|
| `/api/qbo/create` | POST | Nunca permitir crear en QB |
| `/api/qbo/refresh-token` | GET | Token nunca al navegador |
| `/api/qbo/query` | POST | Consultas arbitrarias desde el frontend |
| `/api/qbo/*` (write) | POST/PUT/PATCH/DELETE | Cualquier escritura a QB |
| `/api/auth/signin` | POST | Login propio → lo reemplaza Cloudflare Access |
| Auth por `SISCON_TOKEN` | — | Secreto compartido → lo reemplaza el JWT de Access |
| Auth por token `local_` | — | Base64 sin firma → eliminado |

#### Se reemplazan / endurecen:

| Endpoint actual | Cambio |
|-----------------|--------|
| `GET /api/db/*` | Anteponer validación de `Cf-Access-JWT` + rol antes de responder |
| `PUT /api/db/*` | Validar rol + auditar; nunca campos `qbo_*` desde el frontend |
| `GET /api/qbo/status` | Mantener, pero tras validación de Access |
| (conectar QB) | Solo OWNER; `state` aleatorio; token queda en env var del servidor |

#### Nuevos endpoints:

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `GET /api/me` | GET | Devuelve email + rol derivados del JWT de Access (reemplaza el login propio) |
| `GET /api/audit-log` | GET | Ver auditoría (solo OWNER) |
| `POST /api/qbo/oauth/init` | POST | OWNER inicia flow OAuth (genera `state` aleatorio) |
| `GET /api/qbo/oauth/callback` | GET | Callback de Intuit; valida `state` + `realmId` |
| `POST /internal/qb-sync` | POST | Disparo server-to-server del sync (secreto interno, no navegador) |

### 12.9 Cambios en modelos de datos

#### Supabase: Nuevas columnas / tablas

```sql
-- Tabla settings (existente)
ALTER TABLE settings ADD COLUMN org_id UUID DEFAULT gen_random_uuid();
ALTER TABLE settings ADD COLUMN created_at TIMESTAMP DEFAULT now();
ALTER TABLE settings ADD COLUMN updated_at TIMESTAMP DEFAULT now();

-- Tabla profiles: mapea la identidad de Entra/Access → rol de Siscon
-- (email viene del JWT de Cloudflare Access; NO hay password en Siscon)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT
  CHECK (role IN ('OWNER','MEMBER')) DEFAULT 'MEMBER';

-- Nueva tabla: audit_log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  user_email TEXT,               -- del JWT de Access
  table_name TEXT NOT NULL,
  action TEXT NOT NULL,          -- 'INSERT', 'UPDATE', 'DELETE', 'qb-sync', ...
  resource_id TEXT,
  data_before JSONB,
  data_after JSONB,
  ip_address INET,
  created_at TIMESTAMP DEFAULT now()
);

-- RLS deny-by-default (red secundaria; el guardián primario es el backend)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
-- Sin políticas permisivas: con service_role el backend accede; el acceso directo queda denegado.
```

#### Frontend: se elimina la autenticación propia

```javascript
// ANTES: login propio + token sin firma en localStorage
localStorage.setItem('auth_token_local_eyJ0...', ...);   // ← ELIMINADO (VUL-004/008)
const SISCON_TOKEN = 'siscon-2026-pmapp';                // ← ELIMINADO como auth (VUL-005)

// DESPUÉS: la sesión la da Cloudflare Access (cookie CF_Authorization, gestionada por Cloudflare).
// El frontend solo pregunta quién es el usuario:
const me = await fetch('/api/me', { credentials: 'include' }).then(r => r.json());
// → { email: 'persona@sisconcr.com', role: 'OWNER' | 'MEMBER' }
// Los datos de negocio siguen cargando desde /api/db/* (el backend valida Access + rol).
// El frontend NUNCA usa la anon key de Supabase ni habla directo con Supabase.
```

### 12.9-tests — Suite de pruebas negativas (Día 4)

- Request directo a `siscon-backend.onrender.com` **sin** `Cf-Access-JWT` → **403**.
- Un correo fuera de la allowlist de Access → **no entra**.
- `SISCON_TOKEN` y token `local_` → **ya no conceden acceso**.
- Ningún endpoint devuelve `access_token` / `refresh_token`.
- MEMBER no puede administrar usuarios ni conectar QB; solo OWNER inicia OAuth.
- `state` inválido/expirado/reutilizado → rechazado; `realmId` distinto → rechazado.
- Ningún `POST/PUT/PATCH/DELETE` contable llega a QB.
- Payload con HTML/script en un campo → no produce XSS (render seguro).
- Logs no contienen `access_token`, `refresh_token` ni secretos.

### 12.10 Cronograma visual

```
Lunes 2026-07-24      Martes 2026-07-25     Miércoles 2026-07-26    Jueves 2026-07-27
│                     │                     │                        │
├─ FASE 1             ├─ FASE 2             ├─ FASE 3                ├─ FASE 4/5
│  Cerrar bypass      │  Access = IdP       │  Datos + WAF + XSS     │  OAuth QB + sync
│  + contención QB    │  (elimina auth      │  + auditoría           │  + deploy final
│                     │   propia)           │                        │  + go-live
├─ VUL-001/002/003    ├─ VUL-004/005/007    ├─ VUL-014/015/016/017   ├─ VUL-025/026/027
│  /006/019/020/021   │  /008..013          │  /018/023/028..031     │
└─────────────────────┴─────────────────────┴────────────────────────┴──────────
                                                                        ↓
                                                          PRODUCCIÓN SEGURA
                                                          • Cloudflare Access (Entra/MFA)
                                                          • Backend valida Cf-Access-JWT
                                                          • Sin auth propia (local_/SISCON_TOKEN)
                                                          • RLS deny-by-default
                                                          • Auditoría
                                                          • QB SOLO lectura
```

### 12.11 Riesgos residuales (no abordados en estos 4 días)

| Riesgo | Severidad | Mitigación temporal / plan |
|--------|-----------|----------------------------|
| Sin worker QB físicamente separado | BAJA | Token QB en env var del backend; sync aislado en su módulo. Migrar a servicio separado a futuro |
| Sin aprobación de dispositivos (VUL-022) | MEDIA | MFA de Microsoft es el control principal; device posture en backlog |
| Sin alertas de anomalías (VUL-024) | MEDIA | Logs de Cloudflare + auditoría; alertas automáticas en sesión siguiente |
| Dependencia de Cloudflare + Microsoft | BAJA | Aceptable para uso interno; si Access cae, se puede desactivar la policy temporalmente |
| Cobertura de tests | MEDIA | Suite negativa manual en Día 4; automatización en sesión siguiente |
| Secretos históricos en Git (VUL-histórico) | ALTA | Requiere **rotación manual** por el OWNER (ver 12.12) — borrar el archivo no invalida copias previas |

### 12.12 Plan de rotación de secretos (acciones manuales del OWNER)

> Los secretos que alguna vez estuvieron en Git o en el frontend deben considerarse **comprometidos**. Claude no
> ejecuta estas acciones; las prepara y el OWNER las realiza.

- Rotar `SISCON_TOKEN` (dejará de usarse como auth, pero rotarlo cierra el valor viejo).
- Rotar el `client_secret` de Intuit (QuickBooks).
- Rotar la `ANTHROPIC_API_KEY` si estuvo expuesta en el frontend.
- Revisar en QuickBooks: Apps conectadas, Audit Log, facturas/proveedores/pagos recientes.
- Revocar y volver a autorizar la conexión de QuickBooks **después** del despliegue corregido.
- Invalidar sesiones existentes (con Access como IdP, se logra revocando en Entra / rotando la config de Access).
- **No** reescribir el historial de Git de forma destructiva sin autorización; la rotación es obligatoria porque borrar el archivo actual no invalida las copias anteriores.

---

## 13. Guía rápida (Quick Start)

> ⚠️ Producción actual = **web** en `https://app.sisconcr.com` (repo `agoldav/Siscon-web`, archivo `siscon-web/index.html`). El login es con **email** contra Supabase Auth, no con usuario/localStorage. Lo de abajo es el modo **legado** (archivo local, localStorage) que se conserva solo como referencia histórica.

### (Legado) Solo el frontend local
1. Abrir `siscon_adm_app_v5.4.x.html` en el navegador (doble clic).
2. Login: usuario `admin` / contraseña `siscon2026`.
3. Los datos se guardan solos en `localStorage`. Para empezar limpio: Ajustes → "Borrar datos guardados".

### Con backend (recomendado)
1. Backend en Render: `https://siscon-backend.onrender.com` (ya desplegado).
2. En la app → **Ajustes → Backend** → pegar URL → "Probar backend".
3. Para Outlook: Ajustes → "Conectar Outlook" → autorizar con `facturas@sisconcr.com` → "Probar conexión".
4. Para QuickBooks: Ajustes → QuickBooks → "Conectar" → autorizar en Intuit → "Probar conexión" → Sync.

### Correr el backend en local (pruebas)
```bash
cd siscon-backend
cp .env.example .env      # editar con tus keys
npm install
npm start                 # http://localhost:3000
```
En la app, poner `http://localhost:3000` como URL del backend.

---

### Credenciales de ejemplo (datos demo)
- Usuarios: `admin/siscon2026` (Admin), `abraham/13/11/81` (Supervisor), `inutil/1234` (Operador).
- Contraseña de supervisor/autorizaciones: `13/11/81`.
- > Cambiar todas estas credenciales antes de cualquier uso real.

---

## 14. Instrucciones para Claude

### Flujo de trabajo general
- Al inicio de cada sesión: lee este archivo completo antes de escribir cualquier código.
- Todo lo que está en la sección **Completado** ya funciona. No modifiques nada de esa sección sin avisarme primero. Si para resolver algo de Pendiente necesitas tocar algo que está en Completado, detente, explícame qué necesitas cambiar y por qué, y espera mi aprobación antes de proceder.
- Solo trabaja en lo que está en las secciones **Pendiente** o **Vulnerabilidades Pendientes**.
- Al final de cada sesión: actualiza este archivo — mueve a Completado lo que se resolvió con la fecha de hoy, y elimínalo de Pendiente. No agregues nada que no hayamos trabajado en esta sesión.

### Manejo de Vulnerabilidades de Seguridad
- **Cada vulnerabilidad tiene un ID único** (VUL-001, VUL-002, etc.) con severidad, ubicación, descripción y acción requerida.
- **Al completar una vulnerabilidad:**
  1. Commit con mensaje: `FIX: VUL-NNN - [Descripción corta]` + explicación
  2. Actualiza esta sección: marca `[x]` en Vulnerabilidades Pendientes
  3. Mueve la línea a **11.2 Vulnerabilidades Corregidas** con fecha y hash del commit
  4. Borra de Pendientes
- **Las dependencias entre vulnerabilidades están documentadas** — resuelve primero la que no depende de otras en la misma fase.
- **Reporta al terminar cada fase:** qué se cerró, qué queda, qué riesgos residuales hay.
