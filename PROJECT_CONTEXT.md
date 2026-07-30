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

#### ✅ FASE 2 — código rehecho (commits backend `2ad5f77`, frontend `e1a7498`)
Rehecha sobre la validación de JWT ya sólida. **Decisión de diseño clave:** se mantiene el modelo de roles
existente `Administrador/Supervisor/Regular` (hay un CHECK constraint en `profiles`; `OWNER/MEMBER` lo rompía)
y se mapea `email → auth.users → profile` **sin cambio de esquema** (no se necesita columna `email` en profiles).
- [x] **Identidad unificada** `getCurrentUser(req,res)`: en prod usa `req.cf.email` del JWT verificado →
  `resolveUserByEmail()` (`auth.admin.listUsers` → profile por id, cache 60s); en dev, fallback al Bearer de Supabase.
- [x] **VUL-004**: eliminado el token `local_` sin firma de `getSupabaseUser`.
- [x] **VUL-005**: `checkToken()` deja de exigir `SISCON_TOKEN` cuando `CLOUDFLARE_ENABLED` (el gate es el JWT).
- [x] **VUL-010**: `validateAdminRole()` valida rol server-side (`role==='Administrador'`); reemplaza `validateOwnerRole`.
- [x] 15 handlers de datos migrados a `getCurrentUser`; `/api/me` devuelve `{id,email,role,name}`.
- [x] **CORS con credentials**: refleja el origin exacto (`app.sisconcr.com` vía `FRONTEND_ORIGINS`) + `Allow-Credentials:true`.
- [x] Frontend: `BACKEND_URL` → `api.sisconcr.com`; wrapper de `fetch` añade `credentials:'include'` a toda llamada al backend.
- [x] Red de seguridad opcional: env `SISCON_ADMIN_EMAILS` fuerza rol `Administrador` (no dejar fuera al admin).
- Verificado local: sin JWT→403, CORS refleja app.sisconcr.com+credentials, evil.com bloqueado, cf-access 9/9,
  frontend carga sin errores y cae al login en dev.

##### ⏳ FASE 2 — falta para el cutover (infra + datos + prueba en vivo)
1. **Cloudflare Access (consola):** en la Access App de `api.sisconcr.com`, habilitar **`options_preflight_bypass`**
   (para que el preflight CORS OPTIONS no lo intercepte Access) y confirmar/añadir **CORS settings** con
   `app.sisconcr.com`. Sin esto el navegador no podrá hacer las llamadas cross-subdominio.
2. **Datos en Supabase:** cada uno de los 4 emails `@sisconcr.com` de Access debe tener **cuenta en Supabase Auth
   con su `profile`** (rol correcto). El rol vive en `profiles.role`. (Opcional: `SISCON_ADMIN_EMAILS` como red.)
3. **Prueba en vivo (riesgo real):** el establecimiento de la cookie `CF_Authorization` de `api.sisconcr.com` para
   llamadas `fetch` cross-subdominio necesita verificarse en vivo.
4. **Cutover:** ver "Estado de despliegue".

#### ✅ CUTOVER COMPLETADO — 2026-07-24 (Vercel + Render en vivo con Cloudflare Access)

**Estado:** security-hardening (FASE 1 + 2 + 3) mergeado a `main` en ambos repos. **Producción protegida.**

**Flujo verificado en vivo:**
1. Usuario: `https://app.sisconcr.com` (Vercel, detrás de Cloudflare Access)
2. Redirecta a login → MFA Microsoft Entra ID
3. JWT establecido en cookie de Cloudflare
4. **Plan B (rewrite same-origin):** frontend llama a `/api/*` en `app.sisconcr.com` → Vercel rewrite → Render
5. Backend valida JWT (RS256 vs JWKS), extrae email, mapea a Supabase Auth → profile (rol)
6. Dashboard carga, datos cargan, CRUD funciona ✅

**Obstáculos encontrados y resueltos:**
- DNS cross-subdominio no resolvía en navegador → **Plan B activado** (rewrite same-origin)
- AUD de `app.sisconcr.com` ≠ AUD en Render → **agregamos ambos AUDs** a `CLOUDFLARE_ACCESS_AUD`

**Commits finales:**
- Frontend: `81d0bcc` (Plan B activado: `USE_SAME_ORIGIN_API=true`)
- Backend: `bec4120` (limpieza: quitado debug endpoint)

#### ✅ Plan B preparado (insurance para el cutover) — commits `d8a640e`/`f8a6ce1` — **ACTIVADO en cutover**
Fallback listo por si el flujo cross-subdominio fallara, **sin activar**:
- `vercel.json`: rewrite `/api/*` → Render (DORMIDO; el frontend usa `api.sisconcr.com` absoluto).
- Frontend: flag `USE_SAME_ORIGIN_API` (default `false`) para flipear en una línea a `/api/*` mismo origen.
- Backend: `CLOUDFLARE_ACCESS_AUD` acepta **lista** de AUDs (para aceptar el JWT de app.sisconcr.com además del de api).
- Para activar Plan B: `USE_SAME_ORIGIN_API=true` + agregar el AUD de `app.sisconcr.com` a `CLOUDFLARE_ACCESS_AUD`.

#### ✅ FASE 3 — completada y desplegada 2026-07-24 (commits backend `2833d3b`/`2702378`, frontend `4329303`/`0822067`)
- [x] **VUL-018 | Auditoría** — `auditLog()` inserta en `audit_log` (ya existía) en cada INSERT/UPDATE/DELETE
  de la factory CRUD (best-effort, sin el blob de `settings`); `GET /api/audit-log` (solo Admin).
- [x] **VUL-029 | anon key en el navegador** — eliminada del frontend (CDN de supabase-js + constantes; nunca se usaban).
- [x] **VUL-031 | Security headers** — backend: X-Content-Type-Options, X-Frame-Options:DENY, Referrer-Policy,
  HSTS, Cross-Origin-Resource-Policy. Frontend (`vercel.json`): idem (CSP agregado después, ver sesión 2026-07-24+ abajo — VUL-030).
- [x] **VUL-023 | Rate limiting** — backend general 1000/15min por IP real (CF-Connecting-IP) sobre `/api/*`
  (defensa en profundidad; el primario es el WAF de Cloudflare). Commit backend `2702378`.

### Sesión 2026-07-24+ (FASE 5/3 — OAuth QB seguro, CSP, CSRF/reauth/alertas, cierre formal VUL-019)
> Backend `siscon-backend` commits `052cb85`, `8d785b1`, `27b8832`, `6f0cf2a`. Frontend `Siscon-web` commit `9f37824`. Todo pusheado a `main` → deploy automático Render/Vercel.
- [x] **VUL-025 | OAuth `state` no aleatorio** — `state` fijo reemplazado por `crypto.randomBytes(32).toString('hex')`; validado one-time con TTL 10 min.
- [x] **VUL-026 | No valida `realmId` autorizado** — `realmId` del callback ligado al `state` de la autorización específica antes del intercambio de token.
- [x] **VUL-027 | Sin PKCE en OAuth** — `code_verifier`/`code_challenge` S256 en el flujo `/api/qbo/connect` → `/api/qbo/callback`. Test unitario 6/6 PASS.
- [x] **VUL-030 | Sin CSP estricta** — header `Content-Security-Policy` en backend y `vercel.json`; de paso se corrigió el rewrite `/api/*` de `onrender.com` a `api.sisconcr.com`.
- [x] **VUL-012 | Sin protección CSRF** — mitigada por arquitectura (CORS restringido + JWT en header, no cookie); documentado en código.
- [x] **VUL-013 | Sin reautenticación para acciones críticas** — mitigada por MFA de Access + auditoría/alertas (VUL-024) en DELETE usuario y cambio de rol.
- [x] **VUL-024 | Sin alertas de anomalías** — `alertCriticalEvent()`: loguea a stderr + `audit_log` con severity=CRITICAL en `USER_DELETED`/`USER_ROLE_CHANGED`. MVP; webhook real a Slack/email queda como mejora futura.
- [x] **VUL-019 | Backend expone API pública en Render** — cierre formal verificado en vivo: sin JWT → 403, JWT basura → 403, `/`/`/health` → 200.

### Sesión 2026-07-24+ (revisión externa #2 — cierre de auth legado, concurrencia y contraseñas en claro)
> Revisión de seguridad independiente recibida el 2026-07-24. Se verificó **cada** hallazgo contra el código real
> antes de tocar nada. Resultado de la verificación: **el informe es correcto en casi todo** — la FASE 6 (XSS) y la
> autorización por rol estaban dadas por cerradas antes de tiempo. Alcance aprobado por el OWNER en esta sesión:
> **Bloque A (auth legado) + parche mínimo del blob compartido**. El resto queda en Pendiente con su ID.

- [x] **VUL-032 | Auth legado alcanzable sin Cloudflare Access + reset de contraseña sin validar código** (CRÍTICA)
  - `CF_PUBLIC_ENDPOINTS` incluía todo `/api/auth/*`, así que esas rutas se alcanzaban **sin pasar por Access**,
    pegándole directo a `siscon-backend.onrender.com`. Y `POST /api/auth/reset-password` **nunca validaba
    `resetCode`** (tenía un `// TODO` en su lugar): aceptaba cualquier string no vacío y llamaba
    `auth.admin.updateUserById(..., { password })`. Con solo conocer un email se cambiaba la contraseña de esa cuenta.
  - `POST /api/auth/signup` creaba usuarios confirmados sin autorización alguna, también público.
  - **Corregido:** `CF_PUBLIC_ENDPOINTS` reducido a `{'/', '/health'}`. `signup`, `forgot-password` y
    `reset-password` responden **410 Gone** (el alta va solo por invitación de Admin; la contraseña se restablece
    en Microsoft, que es el IdP real). `forgot-password` tampoco servía: escribía el código en los logs del
    servidor y el envío de email nunca se implementó.
  - **Alcance real del riesgo:** con Access encendido esto **no** daba acceso a los datos (`/api/db/*` sí exigía
    JWT); era toma de control de la identidad de Supabase. Crítico igualmente por ser la última línea si Access
    llegara a apagarse o quedar mal configurado.
  - **Verificado EN VIVO durante el deploy (2026-07-24), con evidencia del antes y el después.** Se sondeó
    `POST https://siscon-backend.onrender.com/api/auth/reset-password` (sin JWT, con `resetCode:"cualquiercosa"`
    y un email inexistente a propósito) mientras Render desplegaba:
    - Antes de que entrara el deploy → **404 `{"error":"Usuario no encontrado"}"`** ← el código viejo respondiendo:
      **buscó el usuario por email**. Con un email real habría seguido hasta `updateUserById` y le habría cambiado
      la contraseña. Confirma que la vulnerabilidad estaba viva en producción, no era teórica.
    - Después del deploy → **403 `{"error":"Missing Cloudflare Access JWT"}`**.
    - Barrido final: `signup`, `forgot-password`, `signin`, `accept-invitation`, `/api/db/settings/1` y
      `/api/ms/refresh-token` → **403**; `/health` → **200** (sigue público, como debe).
  - Commits: backend `126f1c6`, frontend `adbbc3f`.
  - Pruebas: `siscon-backend/test-auth-legacy.js` (31/31) — levanta el `server.js` real en un proceso hijo y
    verifica 403 sin JWT en las 6 rutas legadas + `/api/db/*` + `/api/me`, 410 en los handlers, y que la lista
    de públicos siga teniendo solo salud.

- [x] **VUL-033 | Sin control de concurrencia en el blob `settings/1`** (parte del hallazgo del blob compartido)
  - Cada sesión descargaba el blob entero y lo reescribía. Dos sesiones guardando seguidas se pisaban **en
    silencio**: la segunda escribía encima con datos leídos ANTES del cambio de la primera.
  - **Corregido:** `PUT /api/db/settings/:id` dedicado, **registrado antes de la factory CRUD**, con concurrencia
    optimista. El frontend manda `expected_updated_at` (el `updated_at` de cuando cargó) y el UPDATE se condiciona
    a ese valor → la comprobación es **atómica en Postgres**, sin ventana de carrera entre leer y escribir. Si no
    coincide: **409** y el frontend pregunta al usuario (recargar vs. sobrescribir a propósito).
  - **Modo estricto** (decisión del OWNER, esta sesión): si NO llega `expected_updated_at` se responde **428
    Precondition Required** y no se escribe. Cubre el caso en que la carga inicial falló y la app quedó con los
    datos del `localStorage`: antes eso subía el estado local encima del remoto sin avisar. El frontend avisa una
    sola vez y sigue guardando en el navegador. Se descartó la variante permisiva (last-write-wins cuando falta la
    versión) porque nadie tiene todavía pestañas viejas abiertas que proteger.
  - Ojo de diseño: la versión **no** se refresca en la lectura previa que hace `saveDataToAPI` para fusionar
    `pendingAuthRequests` — si se tomara de ahí, siempre coincidiría y la detección nunca dispararía.

- [x] **VUL-034 | Contraseñas en texto plano dentro del blob que se descarga a todos** (parte del mismo hallazgo)
  - `SYS.supervisorPassword` y `SYS.users[].password` viajaban en claro (`13/11/81`, `siscon2026`, `1234`) al
    navegador de los 4 usuarios. El `tabClick` de Cmd+click además escribía la contraseña en `localStorage`.
  - **Corregido:** solo se guarda el hash (`sha256Hex` propio, síncrono + sal `siscon-pwd-v1:`) y se compara en
    tiempo constante (`pwdMatches`). `migratePasswordsToHash()` convierte los datos que ya están en producción y
    borra el campo plano (idempotente). El campo de Ajustes ya no puede mostrar la contraseña actual: vacío =
    conservar. El auto-login por credencial se eliminó (con Access la ventana nueva se autentica sola).
  - **Sin sobrevender:** estas comprobaciones siguen ocurriendo en el navegador, así que un usuario decidido puede
    saltárselas igual. Lo que se cierra es la **fuga de la credencial en claro**; el control real son los roles
    validados en el servidor (que siguen incompletos → VUL-035).
  - SHA-256 síncrono porque `crypto.subtle` es async y hay 6 puntos de uso síncronos.
  - Pruebas: `siscon-web/test-passwords.js` (21/21) — extrae las funciones **del `index.html` desplegado** (no una
    copia) y las contrasta con `crypto` de Node en 14 vectores, incluidos los bordes de padding (55/56/63/64/65
    bytes) y UTF-8 multibyte. **La prueba encontró un bug real**: la longitud de 64 bits iba con las palabras alta
    y baja invertidas, así que solo el string vacío daba el hash correcto.

- [x] **VUL-035 | El CRUD genérico no validaba rol, propiedad ni columnas** (CRÍTICA)
  - `createCrudRoutes` solo comprobaba que existiera un usuario, y `TABLES` incluye `profiles`. **Explotable:**
    un usuario **Regular** hacía `PUT /api/db/profiles/{su-id}` con `{"role":"Administrador"}` y se auto-promovía.
    También leer/reemplazar la configuración completa, borrar perfiles ajenos y disparar `/api/db/import`.
    RLS no lo frenaba: el backend usa `service_role` (BYPASSRLS).
  - **NO se eliminó la factory** (rompería la app: todo el runtime va por `settings/1`). Se le puso delante una
    política por tabla y acción, en `table-policy.js` (módulo aparte para poder probarla sin HTTP ni Supabase,
    mismo patrón que `cf-access.js`):
    | Tabla | read | create | update | delete |
    |---|---|---|---|---|
    | `settings` (el blob de la app) | any | admin | **any** | admin |
    | `profiles` | admin | **none** | **none** | **none** |
    | las otras 15 (por defecto) | admin | admin | admin | admin |
  - `none` = bloqueado por esta vía **incluso para un Administrador**: los roles se cambian por
    `PUT /api/auth/users/:id/role`, que valida rol y audita. El default es **fail-closed**: una tabla nueva nace
    cerrada.
  - **Por qué no rompe nada:** se verificó que el frontend solo usa `GET/PUT /api/db/settings/1` (4 llamadas) y
    `POST /api/db/import` (1). Las otras 16 tablas no están en la ruta de datos viva. Además
    `migrateLocalStorageToSupabase` (la única que llamaba a `import`) está **definida pero nunca se invoca**.
  - `POST /api/db/import` pasa a exigir Administrador (escritura masiva sobre 15 tablas).
  - `stripCamposControlados()` quita `deleted_at`/`created_at`/`updated_at` de los payloads: `deleted_at`
    permitía borrar o revivir registros sin pasar por DELETE (donde se aplica la política y se audita), y
    `updated_at` habría permitido falsear la versión del control de concurrencia de VUL-033.
  - Pruebas: `test-table-policy.js` (37/37) — el exploit exacto contra `profiles` para los 3 roles, que `settings`
    siga funcionando para todos (si esto se rompe, la app deja de guardar), las 15 tablas × 4 acciones × 2 roles,
    fail-closed ante tabla/acción/rol desconocidos, y el cableado en `server.js`.

- [x] **VUL-039 | `SUPABASE_SCHEMA.sql` reabría RLS** (ALTA si se ejecutaba)
  - El archivo creaba `create policy ... for all to authenticated using(true) with check(true)` en todas las
    tablas de negocio, más lectura en `settings` y `audit_log`. Correrlo en un restore o en un despliegue nuevo
    **deshacía silenciosamente** el hardening: cualquiera con la anon key (pública por definición) leía y escribía
    todo, incluida `settings`, que contiene el blob con TODOS los datos. Contradecía la documentación, que afirma
    que producción tiene 0 políticas.
  - **Corregido:** el archivo ya no crea ninguna política. Ahora hace `enable` + `force row level security` en las
    18 tablas y **purga** las políticas preexistentes recorriendo `pg_policies` (no depende de acertar los
    nombres), así que correrlo sobre una instalación con la versión vieja aplicada la **limpia** en vez de dejarla
    a medias. Idempotente. Queda una consulta de verificación comentada al final (debe devolver 0 filas).
  - Pruebas: `test-schema-rls.js` (10/10) — analiza el SQL ignorando comentarios (lo que importa es lo que se
    ejecuta) y falla si reaparece cualquier `create policy`, `using(true)` o `with check(true)`.

- Nota de higiene: la revisión detectó que `test-oauth-vul.js` (documentado antes como "6/6 PASS") **no existe en
  el repo**. Corregido en la Sección 11: VUL-025/026/027 están implementadas pero **sin pruebas automatizadas**.

- [x] **VUL-036 | XSS almacenado — la remediación de VUL-028 quedó incompleta** (CRÍTICA)
  - `esc()` existía y se usaba en ~113 puntos, pero quedaron 4 sinks sin escapar con datos libres.
  - **`cellVal` (Dashboard, vista de Lista)** — `p.name`, `p.num`, `p.client`, `p.status` sin escapar. La vista
    Kanban del mismo dashboard **ya usaba `esc()` correctamente**; el bug estaba solo en la vista de Lista (la que
    quedó como default desde la sesión 2026-06-08). Es la primera pantalla que ve todo el mundo al entrar.
  - **`renderDocs` (nombre y notas de documento)** — `d.name` sin escapar; `d.notes` solo le quitaba las comillas
    para el atributo `title` pero se insertaba **crudo como contenido de texto** (un `<img onerror=...>` en las
    notas ejecutaba igual). `d.name` es el vector remoto ya confirmado en VUL-028: factura por email con
    proveedor `<img onerror=...>` → OCR → guardado → pintado sin escapar en Documentos.
  - **`msgEsc` (Mensajes, ~15 usos)** — no escapaba comillas. Se usaba dentro de atributos (`alt="${msgEsc(a.name)}"`,
    `download="${msgEsc(a.name)}"`, `value="${msgEsc(msgSearchTerm)}"`) con `a.name` = nombre de archivo adjunto,
    texto libre que cualquiera de los 4 usuarios escribe. Fix: `msgEsc` ahora es `esc()`.
  - **`openUsersModal` (self-XSS contra el Admin)** — `name`/`email` de cada usuario sin escapar. Vector real:
    `accept-invitation` en el backend solo valida longitud del nombre (`validateName`, ≤100 chars, **sin
    restricción de contenido**), así que un usuario recién invitado elige su propio `name` y ese payload se
    ejecuta en la sesión del **Administrador** la próxima vez que abre "Cuentas de acceso" — escalada de
    privilegio vía XSS. Además el botón "Copiar link" de invitaciones pendientes armaba el `onclick` con el email
    crudo quitando solo comillas simples; se verificó que `validateEmail` del backend (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`)
    **sí permite comillas dobles** en la parte local, así que un email como `x"onmouseover="alert(1)@evil.com`
    pasaba la validación y rompía el atributo. Fix: el botón ahora lee el email vía `data-email`/`data-code`
    (escapados), no interpolado directo en el `onclick`.
  - La CSP con `script-src 'unsafe-inline'` (obligada por el HTML monolítico sin build step) sigue sin frenar
    manejadores inyectados — el escapado en el render es la defensa real.
  - **Alcance de esta corrección:** los 4 sinks señalados por la revisión, más el hallazgo del botón de invitación
    encontrado al auditar el mismo bloque. No se re-auditaron los 134 `innerHTML` del archivo — sigue pendiente
    una auditoría completa si se quiere blindaje total.
  - Pruebas: `siscon-web/test-xss.js` (29/29) — extrae los bloques reales de `index.html` (`esc`, `msgEsc`,
    `cellVal` completa con `KANBAN_COLORS`, el cuerpo de la fila de `renderDocs`, `usersList` e `invList` de
    `openUsersModal`) y los ejecuta con payloads de ataque reales (`<img src=x onerror=...>`,
    `"><script>...`, comillas dobles/simples que rompen atributos) verificando que ningún payload sobrevive
    intacto en el HTML resultante y que sí aparece su forma escapada (no se perdió el dato).

- **Suite de pruebas al cierre de la sesión: 273 en verde** (incidente en vivo + VUL-045).
  `siscon-backend`: `test-cf-access` 12 · `test-auth-legacy` 31 · `test-table-policy` 37 · `test-schema-rls` 10 ·
  `test-oauth-hardening` 43 (VUL-037/038/041/042 + cierre de la nota pendiente de VUL-025/026/027) ·
  `test-backups-hardening` 27 (VUL-040 — incluye round-trip real de `encryptBackup()` contra `crypto` de Node) ·
  `test-force-overwrite` 13 (bug real de "guardar de todos modos", ver el incidente en vivo más abajo) ·
  `test-create-user` 22 (VUL-045 — alta directa de usuarios).
  `siscon-web`: `test-passwords` 21 · `test-concurrency` 21 · `test-xss` 29 · `test-save-queue` 7 (bug real del
  "conflicto contra uno mismo" por guardados solapados — comportamiento real bajo concurrencia, no solo patrón).

### Sesión 2026-07-24+ (incidente en vivo — login caído tras el hardening; causa real: DNS, no el código)
> **Producción:** `app.sisconcr.com` quedó devolviendo 502 en el login para todos los usuarios. Investigado y
> resuelto en la misma sesión. Deja una arquitectura ligeramente distinta a la documentada en Sección 12 — leer
> antes de asumir que `api.sisconcr.com` sigue siendo la ruta real del tráfico.

- **Síntoma:** tras el trabajo de seguridad de esta sesión, el login mostraba `Error del servidor (HTTP 502)` /
  `Error verificando autenticación: 502`, de forma persistente (no solo una vez), en cualquier navegador.
- **Diagnóstico descartado en el camino (por orden, cada uno con evidencia que lo tumbó):**
  1. *Arranque en frío de Render (free tier)* — parecía encajar con un primer log de arranque limpio, pero el
     backend seguía fallando incluso con `/health` respondiendo 200 de forma estable.
  2. *Redeploys encadenados por los commits del `keep-alive.yml`* — real (cada push a `main` sí redeploya
     Render), pero no explicaba que el error **persistiera** ya sin commits pendientes.
  3. *Crash en el código autenticado de esta sesión* — hipótesis seria (nunca se pudo probar el camino con JWT
     real contra producción), pero se descartó al ver que **Render no registraba ninguna petición nueva** en el
     momento del fallo — la petición no estaba llegando siquiera al backend.
- **Causa real, confirmada con `dig`/`nslookup`/`host` desde tres ángulos:** `api.sisconcr.com` (el destino del
  rewrite en `vercel.json`) daba **NXDOMAIN** — el registro DNS no existe. `app.sisconcr.com` y la zona raíz
  resolvían bien; solo faltaba el subdominio `api`. Con eso, Vercel fallaba instantáneo al intentar resolver el
  destino del rewrite y devolvía 502 al navegador **sin que la petición tocara Render nunca** — coincide
  exactamente con que los logs de Render no mostraran nada.
- **Ruido aparte, no la causa:** a mitad de la investigación, Cloudflare mostró "San José, Costa Rica (SJO) —
  Partially Re-routed / Under Maintenance" y el dashboard de Cloudflare quedó inalcanzable para el usuario
  (incluso con VPN). Verificado en el status público de Cloudflare: es mantenimiento **programado** de ese punto
  de presencia ("slight increase in latency"), y Dashboard/Access/DNS aparecían "Operational" a nivel global. No
  se pudo confirmar relación causal con el NXDOMAIN; probablemente coincidencia de que el dashboard, servido
  también desde/cerca de SJO, quedó inalcanzable justo cuando hacía falta para revisar el registro DNS.
- **Mitigación de emergencia aplicada (con aprobación explícita, dado que tocaba producción):**
  `vercel.json` → el rewrite de `/api/*` se cambió de `https://api.sisconcr.com/api/:path*` a
  `https://siscon-backend.onrender.com/api/:path*`, saltándose el hop roto por completo. Es el mismo mecanismo de
  "Plan B / seguro" ya documentado en la Sección 12.6/12.11 de este archivo (rewrite directo a Render), solo que
  activado apuntando a Render en vez de a `api.sisconcr.com`. Funciona porque el header
  `Cf-Access-Jwt-Assertion` ya llega adjunto a la petición desde el borde de Cloudflare al pasar por
  `app.sisconcr.com`, y Vercel lo reenvía sin importar el destino del rewrite; el backend valida la firma del JWT,
  no la ruta de red, y `CLOUDFLARE_ACCESS_AUD` ya acepta ambos AUDs desde el cutover anterior. Commit `76dc568`.
- **Falsa alarma final:** tras el fix, una recarga mostró `428 missing_version` ("no se pudieron cargar los datos,
  no se guardó en la nube") — exactamente el comportamiento fail-closed de VUL-033 funcionando como se diseñó.
  Se agregó un log temporal (`[DIAG-settings-GET]`, commit `22134c3`) que confirmó que `settings/1.updated_at`
  **sí** tenía un valor real y válido en la base de datos — descartando un bug de datos. En la siguiente recarga
  cargó bien sin ningún error: fue transitorio, coincidiendo con el instante exacto del deploy de emergencia (muy
  probablemente una ventana de propagación de borde en Vercel). El log de diagnóstico se quitó (commit `40e60d2`).
- **⚠️ Decisión tomada con el OWNER — actualiza la Sección 12:** se deja el rewrite apuntando **directo a Render**
  como configuración estándar, no como parche temporal. `api.sisconcr.com` como hop intermedio queda sin usarse
  por ahora (una dependencia de DNS menos). **Pendiente:** cuando el OWNER recupere acceso al dashboard de
  Cloudflare, investigar por qué desapareció (o si alguna vez existió de verdad) el registro DNS de `api`, y
  confirmar que nada más en la arquitectura documentada en Sección 12 dependa de que ese hostname exista.
- **Segundo bug real, encontrado al probar el guardado tras la mitigación:** al aparecer el diálogo de conflicto
  (409, "otro usuario guardó cambios mientras trabajabas") y elegir "Cancelar" (guardar de todos modos), el
  guardado **siempre** fallaba con `428 missing_version` en vez de sobrescribir.
  - **Causa:** dos protecciones de esta misma sesión se contradecían entre sí. VUL-033 diseñó el diálogo de
    conflicto con una vía de escape explícita ("sobrescribir de todos modos"), implementada poniendo
    `_settingsVersion=null` para saltarse la condición de versión. La decisión posterior de **modo estricto**
    (VUL-041) trató *cualquier* `expected_updated_at` faltante como "nunca cargó" y lo rechazó con 428 — sin
    distinguir esa elección explícita del usuario del caso real que el modo estricto quería cubrir (carga inicial
    fallida en silencio). El bug lo introduje yo al agregar el modo estricto sin reconciliarlo contra la vía de
    escape que ya existía.
  - **Corregido:** `force` es ahora una señal explícita, distinta de "no mandé nada". El chequeo pasa a
    `if (!expected_updated_at && !force)`. Con `force:true` la query salta `.eq('updated_at', ...)` por completo
    (sobrescribe sin condición — exactamente lo que el diálogo le prometía al usuario). Caso borde corregido de
    paso: con `force:true` y la fila ya inexistente, responde 404 en vez del engañoso 409 "otro usuario guardó"
    (con force no hay nada que comparar). Se audita como `UPDATE_FORCED_OVERWRITE`, distinguible de un guardado
    normal en `/api/audit-log`.
  - Pruebas: `siscon-backend/test-force-overwrite.js` (13/13) — extrae el handler **real** de
    `PUT /api/db/settings/:id` (no una reimplementación) y lo ejecuta contra un Supabase simulado que reproduce
    el chaining real de `supabase-js` (incluye ser "thenable" para `.update().eq().select()` sin `.single()`).
    Cubre el bug exacto, que el modo estricto real sigue cerrado sin `force`, que el guardado normal sigue
    exigiendo la versión correcta, y el caso borde de fila inexistente con `force`. `siscon-web/test-concurrency.js`
    actualizado (16/16) para el nuevo cableado del frontend.
  - Commits: backend `60141ea`, frontend `8c9d6d4`.
- **Tercer bug real, encontrado al reproducir el segundo:** tras el fix anterior, el usuario seguía viendo el
  diálogo "otro usuario guardó cambios" **con una sola pestaña abierta y sin nadie más usando la app** — se
  confirmó explícitamente que no había otras pestañas/ventanas propias abiertas.
  - **Causa:** `saveData()` se llama **~127 veces** en `index.html`, y dispara `saveDataToAPI()` sin esperarlo
    (fire-and-forget). Si una sola acción del usuario (p.ej. crear un proyecto) disparaba dos `saveData()` casi
    seguidos, ambas llamadas leían el mismo `_settingsVersion` antes de que ninguna respondiera; la primera en
    volver actualizaba la versión en el servidor, la segunda llegaba con la versión ya vieja y el servidor
    (correctamente) la marcaba como conflicto — pero el conflicto era **contra sí misma**, en la misma pestaña,
    sin que existiera ningún otro usuario. Un gap real en el diseño de VUL-033 que no se detectó hasta probarlo
    con uso real de la app (crear algo, no solo cargar/guardar una vez).
  - **Corregido:** `saveDataToAPI()` pasa a ser un wrapper con **cola de un solo hueco**. `_saveInFlight` guarda
    la promesa del guardado en curso; una llamada nueva mientras hay una en vuelo se marca `_saveQueued=true` y
    reutiliza esa misma promesa en vez de disparar una petición nueva. Al terminar, si quedó algo encolado, se
    dispara **un solo** guardado de seguimiento (no uno por cada llamada encolada), ya con la versión fresca que
    acaba de devolver el servidor — nunca choca consigo mismo. Ese guardado de seguimiento nunca hereda
    `force:true` de una llamada anterior. La lógica real se movió a `_saveDataToAPICore(forzar)`;
    `_handleSaveConflict` llama al **core directo**, no al wrapper con cola, para evitar un punto muerto (el
    wrapper vería ese guardado como "ya en vuelo" — es el mismo — y nunca ejecutaría el forzado).
  - Pruebas: `siscon-web/test-save-queue.js` (7/7, **nuevo**) — extrae el bloque real de `index.html` y lo
    ejecuta con un `fetch` simulado con **latencia real** (via `setTimeout`), disparando 5 llamadas a
    `saveDataToAPI()` en el mismo tick (el patrón real del bug) y verificando que **nunca hay más de 1 PUT en
    vuelo a la vez** — no es una prueba de patrón de código, es de comportamiento real bajo concurrencia.
    `test-concurrency.js` actualizado (21/21) con el cableado de la cola.
  - Commits: frontend `8e93d7a`; ajuste de una verificación cruzada en backend `24f2edc` (sin cambios de lógica).

### Sesión 2026-07-25 (cierre de hallazgos de seguridad pendientes: VUL-037/038/040/041/042 + VUL-045)
> Continuación de la revisión externa #2. Estos quedaban marcados `[x]` en Pendiente desde que se corrigieron;
> esta entrada los traslada formalmente a Completado con su fecha real de cierre.

- [x] **VUL-037 | `/api/ms/refresh-token` entrega el refresh token de Outlook a cualquier usuario** (ALTA)
  - No validaba rol Admin (`checkToken` devuelve `true` con Access encendido — valida identidad, no rol). Era
    exactamente la VUL-003 que se cerró para QuickBooks pero quedó abierta para Microsoft. Quien lo obtenía leía
    el buzón `facturas@sisconcr.com` indefinidamente, fuera de la app.
  - **Corregido:** la ruta ahora exige `validateAdminRole()`, igual que el equivalente de QBO (que directamente
    ya no expone el token — VUL-003). El frontend lo llama desde Ajustes; nada cambia para un Admin.
- [x] **VUL-038 | OAuth de Microsoft con `state` fijo y sin validar** (MEDIA)
  - `/api/ms/connect` mandaba `state:'siscon'` (constante) y `/api/ms/callback` ni siquiera lo leía. Un callback
    forjado con un `code` propio del atacante podía completarse igual y reemplazar la conexión de Outlook.
    Además `/api/ms/connect` **no tenía ningún gate** (ni `checkToken`) — cualquiera de los 4 usuarios podía
    iniciar el flujo.
  - **Corregido:** mismo patrón ya usado en QuickBooks (VUL-025) — `generateMsState()` con
    `crypto.randomBytes(32)`, guardado en `store.msAuthPending` con TTL 10 min, validado y consumido (un solo
    uso) en el callback; 403 si inválido/ausente/expirado. `/api/ms/connect` ahora exige Administrador, igual
    que `/api/qbo/connect`.
- [x] **VUL-041 | `CLOUDFLARE_ENABLED=false` por defecto — fail-open** (MEDIA)
  - Un despliegue que olvidara la variable quedaba sin el gate del JWT y dependiendo del `SISCON_TOKEN` legado; si
    ese tampoco estaba configurado, `checkToken()` **aceptaba el request**. Se confirmó el impacto real: 13 rutas
    dependen solo de `checkToken` sin `getCurrentUser`/`validateAdminRole` detrás — entre ellas `/api/claude`
    (gasta la `ANTHROPIC_API_KEY` del servidor) y varias de Outlook.
  - **Decisión tomada con el OWNER:** no se intentó adivinar "¿esto es producción?" (habría requerido asumir cómo
    Render configura el entorno, con riesgo real de tumbar producción si la suposición fallaba). En su lugar se
    invirtió el default: el modo sin Cloudflare Access ahora exige el **opt-in explícito**
    `ALLOW_INSECURE_LOCAL_DEV=true`. Sin `CLOUDFLARE_ENABLED=true` **ni** ese flag, `checkToken()` responde
    **503** en vez de abrirse. `.env.example` trae el flag en `true` (así `cp .env.example .env` sigue
    funcionando igual para desarrollo local sin tocar nada) con una advertencia de no ponerlo nunca en Render.
    Para la producción actual esto es **no-op**: Render ya tiene `CLOUDFLARE_ENABLED=true` (verificado en vivo),
    así que el código nunca llega a la rama nueva.
- [x] **VUL-042 | `realmId` de QuickBooks no se fijaba contra una compañía configurada** (MEDIA)
  - El callback ligaba el `realmId` al `state` de esa autorización (VUL-026, ya cerraba el riesgo de reasociarlo
    a mitad de flujo), pero no lo comparaba contra una compañía esperada. Si la cuenta de Intuit que completa el
    consentimiento tiene acceso a varias compañías, podía autorizar sin querer una distinta de la de Siscon.
  - **Corregido:** si `QBO_REALM_ID` está fijado en el entorno, el callback exige que coincida (403 si no). Si no
    está fijado, no se puede validar contra nada — se deja pasar como antes (compatibilidad hacia atrás; hoy
    Render no tiene ese valor fijado, así que el comportamiento no cambia hasta que se configure a propósito).
    Documentado en `.env.example` como recomendado.
- Pruebas del lote VUL-037/038/041/042: `siscon-backend/test-oauth-hardening.js` (33/33) — servidor real en
  proceso hijo (403 sin JWT en las 4 rutas nuevas/tocadas), extracción y ejecución de `generateMsState`/
  `saveMsAuthState`/`validateAndClearMsAuthState` (aleatoriedad, un solo uso, TTL, state ausente) y de la
  comparación de `realmId` (con/sin `QBO_REALM_ID`, coincide/no coincide), y — para VUL-041 — las 4 combinaciones
  reales de `checkToken()`: sin nada configurado → 503; con el opt-in → 200 (dev local sigue igual); con el
  opt-in + `SISCON_TOKEN` → 401/200 según el header; con Access activo → 403 (el fix es no-op en producción).
- [x] **VUL-040 | Backups sin control de rol ni cifrado** (MEDIA)
  - `POST /api/backups/create` solo exigía usuario autenticado → cualquiera de los 4 se llevaba una copia completa
    a Dropbox (incluida `settings`, el blob con TODAS las conversaciones privadas). El archivo iba comprimido,
    **no cifrado**. `POST /api/backups/restore/:id` aceptaba cualquier `confirmPassword` no vacío
    (`// TODO: validar contraseña`, nunca completado) y **no restauraba nada** — respondía como si sí, lo que en
    medio de un incidente real podía hacerle creer a un Admin que sus datos ya estaban recuperados.
  - **Hallazgo al investigar:** el frontend **no llama a ninguna de las 3 rutas** — no hay UI conectada, y Dropbox
    tampoco está configurado en producción hoy (confirmado: `.env.example` no traía ninguna variable de Dropbox;
    coincide con "Backups automáticos" listado como Pendiente). Esto bajó el riesgo inmediato pero no la
    necesidad del fix: en cuanto alguien configure Dropbox, el hueco se activa solo.
  - **Corregido:**
    - `GET /api/backups/list` y `POST /api/backups/create` ahora exigen `validateAdminRole()`.
    - Cifrado real con AES-256-GCM (`encryptBackup()`, usa el `crypto` ya importado, sin dependencias nuevas)
      antes de subir a Dropbox, tanto en el endpoint manual como en el scheduler automático (que duplicaba la
      misma subida sin cifrar). Formato: `iv(12) || authTag(16) || ciphertext`. **Fail-closed** (mismo patrón que
      VUL-041): sin `BACKUP_ENCRYPTION_KEY` configurada (64 hex = 32 bytes) o con formato inválido, no se sube
      nada sin cifrar — se rechaza. El scheduler además exige la clave para **arrancar el `setInterval`**, no
      solo para fallar en cada ciclo. Extensión de archivo `.json.gz.enc` (ya no `.json.gz` a secas).
    - `POST /api/backups/restore/:id`: se quitó el `confirmPassword` (nunca se comparaba contra nada — era pura
      apariencia de control). La respuesta ahora es **501 `not_implemented`**, honesta: el backup existe en
      Dropbox pero no hay restauración automática construida (descargar/desencriptar/reimportar sigue siendo
      manual). Se sigue auditando el intento (`RESTORE_REQUESTED`). El gate de Administrador que ya tenía se
      dejó intacto.
    - `.env.example` documentó por primera vez las variables de Dropbox (no estaban) + `BACKUP_ENCRYPTION_KEY`
      con el comando exacto para generarla.
  - Pruebas: `siscon-backend/test-backups-hardening.js` (27/27) — 403 sin JWT en las 3 rutas; cableado de
    `validateAdminRole` en list/create; que `restore` ya no lee `confirmPassword` del body y responde 501 sin
    fingir éxito; y, lo más importante, `encryptBackup()` extraída y probada con `crypto` de Node de verdad:
    fail-closed sin clave/con clave inválida, **round-trip real** (cifra → desencripta con Node crypto → recupera
    el texto exacto), IV no reutilizado entre llamadas, **manipular un solo byte del ciphertext hace fallar la
    desencriptación** (prueba que el `authTag` de GCM funciona de verdad, no solo AES sin integridad), y que una
    clave distinta a la usada para cifrar no desencripta.
- [x] **VUL-045 | Tres registros de identidad separados; agregar a alguien en Azure NO alcanza** (usabilidad + riesgo operativo)
  - Convivían **tres** fuentes de identidad: Cloudflare Access/Entra (quién entra), Supabase `auth.users`+`profiles`
    (qué rol tiene) y `SYS.users` (directorio de Mensajes/avatares). Si se agregaba a alguien SOLO en Azure, pasaba
    el login de Microsoft pero la app le daba 403 en todo (`resolveUserByEmail` sin cuenta de Supabase). El flujo
    de invitación (link + código + contraseña que el invitado nunca usaba para entrar) era el único camino que
    creaba la cuenta + el rol, y era el paso extra e innecesario.
  - **Decisión del OWNER:** alta directa por Admin (la opción recomendada).
  - **Implementado:** `POST /api/auth/create-user` (Admin-only, `validateAdminRole`) — email + nombre + rol de un
    solo paso. Genera una contraseña aleatoria de 32 bytes (`crypto.randomBytes`, base64url) que **nadie ve ni
    necesita** (existe solo porque Supabase Auth exige una al crear el usuario; el acceso real sigue siendo
    Cloudflare Access + Microsoft). `email_confirm:true` — entra directo, sin paso de verificación de correo. El
    profile se actualiza con el rol/nombre reales tras el trigger `handle_new_user`. Se audita como
    `USER_CREATED_DIRECT`.
  - Frontend: el formulario de "Cuentas de acceso" pasó de "Invitar nuevo usuario" (email + rol) a
    "Crear usuario" (email + **nombre** + rol — el nombre lo elegía antes el invitado al aceptar, ahora lo pone
    el Admin). Ya no hay link que copiar ni prompt de "comparte esto".
  - **No se eliminó** el flujo viejo (`invite-user`/`accept-invitation`) por si hay una invitación ya enviada en
    curso — queda dormido, sin usarse desde la UI. Limpieza pendiente: confirmar que no haya invitaciones
    pendientes reales y borrar esas dos rutas + la tabla `user_invitations` si ya no hacen falta.
  - **Sigue sin resolver, tercera pata del mismo problema:** sincronizar `SYS.users` ↔ Supabase Auth (Mensajes usa
    ids numéricos locales, no el uuid real de Auth) — los usuarios creados con `create-user` no aparecen
    automáticamente en el directorio de Mensajes/avatares hasta que alguien los agregue a mano en `SYS.users`.
  - Pruebas: `siscon-backend/test-create-user.js` (22/22) — 403 sin JWT; cableado de `validateAdminRole`;
    comportamiento real contra un Supabase simulado (contraseña aleatoria de verdad — dos llamadas seguidas dan
    valores distintos —, `email_confirm:true`, el profile se actualiza con rol/nombre reales, se audita, **la
    respuesta nunca incluye la contraseña generada** ni siquiera como substring); las 4 validaciones de entrada;
    email duplicado rechazado; error de Supabase propagado como 400 (no 500 ni un 201 falso); y verificación
    cruzada de que el frontend ya llama al endpoint nuevo y no al viejo.
- **Suite de pruebas al cierre: 273 en verde** (195 backend + 78 frontend). Ver detalle completo en la sesión de
  "incidente en vivo" arriba y en Sección 11.

### Sesión 2026-07-25 (VUL-044 parte 1/2 — conversations/messages fuera del blob compartido)
> ⚠️ **Código completo y probado, pero NO desplegado.** Falta verificación en vivo con dos cuentas reales antes
> de pushear (Claude no tiene credenciales de ninguno de los 4 usuarios para probar aislamiento end-to-end en
> el navegador) — pendiente de que el OWNER lo pruebe o autorice el push sin esa verificación manual.
- [x] **Backend** (`siscon-backend/server.js`): `conversations`/`messages` salieron del CRUD genérico
  admin-only (VUL-035) — no encajaban ahí, la autorización correcta depende del contenido de cada fila
  (`member_ids`), no solo del rol. Rutas nuevas, todas gateadas por `getCurrentUser` + el choke point
  `loadConversationForMember` (isMember + 403/404):
  - `GET /api/db/conversations` y `/summary` (con último mensaje + no-leídos, sin traer el historial completo)
  - `POST /api/db/conversations` (el creador debe estar en `member_ids`; `created_by` lo fija el servidor)
  - `PUT /api/db/conversations/:id` (renombrar/miembros — solo creador o Administrador; el creador no se puede
    quitar por esta vía)
  - `POST /api/db/conversations/:id/leave` (cualquier miembro sale de un grupo; un DM no se puede "abandonar")
  - `DELETE /api/db/conversations/:id` (soft delete — cualquier miembro, mismo comportamiento que ya tenía la UI)
  - `GET /api/db/messages?conversation_id=` y `POST /api/db/messages` (`sender_id`/`read_by` los fija el
    servidor con el uuid del JWT — nunca vienen del body)
  - `POST /api/db/conversations/:id/read` (marca leídos los mensajes pendientes del usuario actual)
  - `POST /api/db/import` y el `TABLES` del CRUD genérico ya no incluyen `conversations`/`messages`.
- [x] **Backend:** `GET /api/auth/directory` — cualquier usuario autenticado (no admin-only como
  `/api/auth/users`) lee `id/name/role/color` de `profiles` reales. Necesario porque el selector de "Nueva
  conversación" usaba `SYS.users` (directorio local de RRHH, ids numéricos) — que no corresponde a las cuentas
  reales de Supabase Auth (uuid), la "tercera pata" ya anotada en VUL-045. Sin esto, cualquier cuenta dada de
  alta con `create-user` y no agregada a mano en `SYS.users` habría quedado invisible en Mensajes.
- [x] **Pruebas:** `siscon-backend/test-conversations-auth.js` (44/44) — 403 sin JWT en las 10 rutas nuevas;
  `conversations`/`messages` confirmadas fuera de `TABLES` y del loop de `/api/db/import`; `isMember` extraída
  y probada (miembro/no-miembro/vacío/null/no-array); `loadConversationForMember` extraída y ejecutada con
  supabase/res fabricados (miembro real → pasa; no-miembro → 403 real; fila inexistente → 404, no 403 —
  para no confirmarle a un no-miembro que la conversación existe); cableado por regex de que las 6 rutas
  sensibles pasan por ese único choke point; que `POST /api/db/messages` nunca toma `sender_id`/`read_by` del
  body; que `PUT .../:id` exige creador-o-Admin y protege al creador de auto-expulsarse; que `POST .../leave`
  rechaza DMs; que `POST /api/db/conversations` exige que el creador esté en `member_ids`; que
  `/api/auth/directory` NO exige `validateAdminRole` pero sí `getCurrentUser`. Suite completa del repo
  re-corrida: 9 archivos, 0 fallas (sin regresiones).
- [x] **Frontend** (`siscon-web/index.html`, módulo `msg*`, ~11100-11650): reescrito de mutación síncrona sobre
  `SYS.conversations` a llamadas async contra los endpoints nuevos, con cachés locales que NUNCA se persisten
  con `saveData()` (se recargan del servidor): `msgConvsCache` (resumen + no-leídos), `msgThreadCache[convId]`
  (historial de la conversación abierta), `msgDirectory` (cuentas reales). `msgSend` es optimista: pinta el
  mensaje al toque con un id temporal y lo confirma/revierte según la respuesta del servidor. `msgAutoSync()`
  (mismo patrón que `msAutoSync`) carga directorio + conversaciones y arranca un polling de 12s de la barra
  lateral (nunca del hilo abierto, para no pisarle el borrador a quien está escribiendo) — arranca al login,
  se detiene al logout. Los ids de mensajería son uuid reales de Auth: se quitó el `parseInt` que asumía ids
  numéricos de `SYS.users`. `SYS.conversations` se eliminó del objeto por defecto y de `applyDefaults`.
- **Verificado:** sintaxis del `<script>` completo (`new Function`) sin errores; los ~60 nombres de función
  referenciados en `onclick=`/etc. resuelven a exactamente una definición; 0 referencias sueltas a
  `SYS.conversations`/`memberIds`/`senderId`/`readBy`/`msgConvs()` fuera de comentarios históricos.
- **Verificado en vivo por el OWNER (2026-07-25/26):** probado en producción con dos cuentas reales
  (Administrador + Regular, una invitada como guest de Azure AD para la prueba). Mensajería funcionando
  correctamente extremo a extremo.
- **Efecto secundario descubierto en esta misma prueba en vivo:** al aprobar una solicitud de material fuera
  de presupuesto en una OC (flujo no relacionado a Mensajes), el usuario Regular recibió el diálogo de
  conflicto de versión ("Otro usuario guardó cambios mientras trabajabas") al intentar guardar su OC. Causa:
  `SYS.pendingAuthRequests` y `SYS.notifications` **seguían** en el blob compartido `settings/1` — igual que
  `conversations` antes de esta sesión — así que aprobar la solicitud (que muta `projects` Y hasta ahora
  también reescribía el arreglo de solicitudes) bastaba para chocar en versión con el guardado de la OC del
  otro usuario, sin relación real entre ambas acciones. Esto llevó a retomar la segunda mitad de VUL-044,
  acotada esta vez a `pendingAuthRequests`/`notifications` — ver sesión siguiente.

### Sesión 2026-07-25/26 (VUL-044 parte 1.5 — pendingAuthRequests/notifications fuera del blob)
> Motivada por el hallazgo en vivo de arriba. Alcance acotado a propósito (decisión del OWNER): NO se tocó
> `projects`/`houses`/`transactions` (eso sigue siendo la normalización grande, sin fecha). Solo se sacó del
> blob lo que causaba colisiones por acciones NO relacionadas entre sí: solicitudes de autorización y el
> centro de notificaciones (este último, además, el disparador más frecuente — la app manda notificaciones
> automáticas constantes de QB/Outlook/sistema).
- [x] **Backend — tabla nueva `pending_auth_requests`:** columnas comunes (`type`, `status`, `requested_by`/
  `requested_by_name`, `resolved_by`/`resolved_by_name`, `proj_id`/`proj_name`) + `data jsonb` catch-all para
  los campos específicos de cada uno de los 5 tipos (ocId/matName/qty/price/houseId/comment, typeId/typeName,
  houseId/houseNum, garId/garNum/materials[], vbNum/productId/houseName). Agregada a `SUPABASE_SCHEMA.sql`
  (tabla + trigger de auditoría + `touch_updated_at` + RLS enable/force, mismo patrón que el resto) y a
  `siscon-backend/migration-pending-auth-requests.sql` (incremental, idempotente, para correr ahora en el SQL
  Editor de Supabase sin tocar el archivo maestro). **⚠️ Requiere que el OWNER corra esa migración en Supabase
  antes de que las rutas nuevas funcionen** — si no, dan error de "relation does not exist".
- [x] **Backend — rutas dedicadas** (no el CRUD genérico: la regla "Admin O Supervisor" para resolver no es
  uno de los dos niveles que soporta `table-policy.js`): `GET`/`POST /api/db/pending_auth_requests` (cualquier
  autenticado — mismo alcance que ya tenía en el blob), `PUT .../:id` (solo Administrador o Supervisor;
  `resolved_by`/`resolved_by_name`/`resolved_at` los fija el servidor, nunca el body — antes esto SOLO se
  validaba en el frontend, cualquier cuenta con JWT válido podía mandar un PUT crudo a `settings/1` y
  auto-aprobarse), `DELETE .../:id` (solo Admin, sin uso hoy desde la UI). `requested_by`/`requested_by_name`
  también los fija el servidor con la identidad del JWT.
- [x] **Backend — `notifications`:** ya tenía tabla y CRUD genérico wireado, pero con la política DEFAULT
  (admin-only) — no servía para el centro de notificaciones (100% compartido, cualquiera de los 4 crea/lee/
  marca-leído/borra, igual que en el blob). Se agregó `TABLE_POLICY.notifications = {read:'any',create:'any',
  update:'any',delete:'any'}` en `table-policy.js` — mismo alcance 1:1 que ya tenía, no una privilegio nuevo.
- [x] **Pruebas:** `siscon-backend/test-pending-auth-requests.js` (20/20) — 403 sin JWT en las 4 rutas nuevas;
  política de `notifications` verificada para los 3 roles × 4 acciones; `POST` no exige rol y fuerza
  `status:'pendiente'` + `requested_by`/`requested_by_name` del JWT (no del body); `PUT` exige
  `PENDING_AUTH_RESOLVABLE_ROLES` (exactamente `[Administrador, Supervisor]`, ni Regular ni vacío) y fija
  `resolved_by`/`resolved_by_name` del JWT; `DELETE` exige Admin. `test-table-policy.js` actualizado: sacadas
  `conversations`/`messages`/`pending_auth_requests`/`notifications` del grupo "tablas dormidas" (ya no
  aplica — cada una tiene su propia política/ruta y su propio test dedicado). Suite completa del repo
  re-corrida tras el cambio: **10 archivos, 258 pruebas, 0 fallas.**
- [x] **Frontend:** `pendingAuthList()` pasó de leer `SYS.pendingAuthRequests` a una caché local
  (`pendingAuthCache`) recargada del servidor; adaptador `pendingAuthFromRow`/`pendingAuthCreate`/
  `pendingAuthResolve` traduce fila↔objeto plano en el borde para no tocar las ~10 funciones que ya leían
  `req.matName`/`req.houseNum`/etc. directamente. Los 5 sitios de creación (`typeUnlockReq`,
  `garSolicitarAprobacion`, `ocRequestExtraAuth`, `houseUnlockReq`, `vbSubmitMatAuth`) ahora son `async` y
  crean la fila vía `POST` antes de continuar (el id ya no lo genera el cliente). `resolveExtraAuth` separa
  las dos escrituras que antes iban juntas en un solo guardado de blob: `pendingAuthResolve` (fila propia,
  falla sin tocar nada más si el rol no califica o alguien más ya la resolvió) y el `saveData()` que sigue
  existiendo SOLO para el efecto real sobre `projects` (línea de OC, desbloqueo, garantía — eso sigue en el
  blob, es la parte grande aún pendiente). El centro de notificaciones (`addNotif`/`notifRead`/
  `notifMarkAllRead`/`notifDelete`/`notifBulkRead`/`notifBulkDelete`) pasó a una caché `notifCache` con las
  mismas llamadas; nuevo `notifClearByLink()` reemplaza el filtro directo sobre `SYS.notifications`. Ambas
  cachés se cargan al login (`checkPendingAuthOnLogin`) y se refrescan cada 15s dentro del polling ya
  existente (`pollPendingAuth`) — de paso, ahora los eventos automáticos de OTRA sesión (QB/Outlook) también
  se ven sin recargar la página, algo que antes no pasaba. Se eliminó `_mergeAuthReqs()` y el pre-fetch de
  `settings/1` que hacía cada guardado antes de escribir (ya no hace falta fusionar nada: la solicitud no
  vive más en lo que ese guardado escribe). Se renombró `msgApi`→`apiFetch` (ya no es solo de Mensajes, lo
  usan las tres cachés).
- **Verificado:** sintaxis del `<script>` completo; 0 referencias sueltas a `SYS.notifications`/
  `SYS.pendingAuthRequests`/`_mergeAuthReqs` fuera de comentarios; las ~30 funciones tocadas resuelven a
  exactamente una definición.
- **No verificado (requiere al OWNER):** (a) correr `migration-pending-auth-requests.sql` en Supabase antes
  de desplegar el backend; (b) repetir la prueba en vivo que encontró el bug — aprobar un material fuera de
  presupuesto desde el Admin mientras el Regular tiene una OC distinta abierta — y confirmar que YA NO
  aparece el diálogo de conflicto por esa causa (sigue pudiendo aparecer si de verdad hay dos personas
  editando la misma OC/proyecto a la vez — eso es la mitad grande de VUL-044, todavía pendiente).

### Sesión 2026-07-26 (incidente en vivo — 3 bugs reales encontrados al probar el deploy de arriba)
> El OWNER corrió la migración y probó en producción con dos cuentas reales. Aparecieron 3 bugs reales,
> los 3 corregidos y desplegados en la misma sesión. Ninguno es arquitectónico — los 3 son errores puntuales.
- [x] **Bug 1 — carrera en login: guardaba sin `_settingsVersion` todavía.** `logAction()` llama a
  `saveData()` por dentro; en `login()`/`bootstrapCloudflareAuth()`/`acceptInvitation()` se llamaba ANTES de
  `loadDataFromAPI()` (quien fija `_settingsVersion`, VUL-033). El guardado llegaba al backend sin
  `expected_updated_at` → 428 `missing_version` en (casi) cada login, con el alert correspondiente. La
  carrera ya existía, pero al quitar el pre-fetch redundante de `_saveDataToAPICore` (parte de la sesión
  anterior, VUL-044 parte 1.5 — ya no hacía falta fusionar `pendingAuthRequests`) el guardado quedó más
  rápido y empezó a ganarle la carrera a la carga casi siempre. **Fix:** `loadDataFromAPI()` antes de
  `logAction()` en los 3 flujos. Frontend commit `2cb3a65`.
- [x] **Bug 2 — `GET /api/db/conversations`/`.../summary` devolvían 400 SIEMPRE, desde el primer deploy de
  VUL-044 parte 1.** `.contains('member_ids', [user.id])` — `supabase-js` serializa un **array de JS** con
  sintaxis de **arreglo de Postgres** (`cs.{valor}`), no JSON, pero `member_ids` es `jsonb` → Postgres
  rechazaba con `invalid input syntax for type json`. Nunca se detectó antes porque los tests de esa sesión
  probaban la lógica de autorización con un cliente Supabase fabricado, no la librería real — la lección de
  siempre (VUL-027) aplicada de nuevo: "se ve bien" no es lo mismo que "se probó contra lo real". **Fix:**
  pasar el valor como **string** (`JSON.stringify([user.id])`) — evita esa rama del helper y genera el JSON
  literal correcto (`cs.["valor"]`). Confirmado corriendo la consulta contra `@supabase/supabase-js`
  2.110.8 real e inspeccionando la query string generada, antes y después del fix. Prueba nueva en
  `test-conversations-auth.js` (+7, ahora 51/51) que reproduce el bug contra la librería real y prueba el
  fix, más cableado por regex de las dos rutas. Backend commit `3da1b24`.
- [x] **Bug 3 — `backendUrl()` ignoraba el resguardo "solo localhost" y rompía el CSP.** Función distinta de
  la constante `BACKEND_URL` (que sí tiene el resguardo, documentado desde la migración web: "`SYS.backendUrl`
  solo se respeta para desarrollo local"). `backendUrl()` usaba `SYS.backendUrl` a ciegas si tenía cualquier
  valor — si quedó guardada la URL vieja de `onrender.com` de antes del cutover a Cloudflare Access, disparaba
  un fetch directo que el CSP (VUL-030) bloquea correctamente (`/api/tc`, tipo de cambio, y potencialmente QBO
  connect/Outlook/Claude fallback — todo lo que llama `backendUrl()`). **Fix:** mismo criterio que ya aplicaba
  `BACKEND_URL` — solo honrar `SYS.backendUrl` si es `localhost`/`127.0.0.1`. Frontend commit `5047484`.
- [x] **Bug 4 — `resolveExtraAuth` guardaba aunque `applyApprovedExtra`/etc. fallaran.** Encontrado al
  reprobar los 3 fixes de arriba: el Admin aprobó un material y `applyApprovedExtra` no encontró la OC
  (`ok=false`), pero el código llamaba a `saveData()` **sin condición** de todos modos. Ese guardado no
  persistía nada real pero sí subía la versión de `settings/1`, chocando con el guardado legítimo del Regular
  momentos después — la misma clase de bug que motivó VUL-044 parte 1.5, en un sitio que esa sesión no tocó.
  **Fix:** `saveData()` solo si `ok` (mismo patrón que ya tenía correctamente el lado del solicitante en
  `pollPendingAuth`). Frontend commit `23fbfab`.
  > ⚠️ **Corrección:** la causa que se anotó originalmente aquí para el `ok=false` ("la orden aún no había
  > terminado de sincronizar") era una suposición sin verificar — quedó descartada por los datos reales del
  > Bug 5 de abajo. La causa real de por qué `applyApprovedExtra` no encontraba la OC era otra (Bug 5), no un
  > problema de timing.
- [x] **Bug 5 — `req.projId` se comparaba número contra string; NUNCA coincidía, en los 5 tipos de
  solicitud.** El bug real detrás del "no se encontró la OC" — encontrado con datos reales de Supabase (no
  suposición): se verificó que el `ocId` guardado en `pending_auth_requests.data` coincidía **exacto** con el
  `id` real de la OC, lo que descartó la hipótesis de sincronización y apuntó a la comparación en sí. Los
  `id` de proyecto en la app son **números** (`Date.now()`, sin prefijo), pero la columna nueva `proj_id` de
  `pending_auth_requests` es `text` — Postgres/PostgREST siempre la devuelve como **string**. Por eso
  `projects.find(p=>p.id===req.projId)` nunca coincidía, en ninguno de los 5 tipos de solicitud
  (`extra-material`, `type-unlock`, `house-unlock`, `garantia-budget`, `vb-extra-material`) — el
  `||curProj` de respaldo solo "salvaba" el caso cuando el Admin ya tenía esa OC/proyecto abierto por
  casualidad; si aprobaba desde el popup automático al loguearse (`curProj` todavía `null` en ese momento),
  fallaba siempre. **Fix:** `String(p.id)===String(req.projId)` en las 6 funciones afectadas — mismo patrón
  defensivo que `applyGarApproval` ya usaba para `garId` desde antes (precedente ya establecido en el
  código, no una idea nueva). `typeId`/`houseId`/`ocId`/`garId` no tenían este problema: viajan dentro del
  `data jsonb` (que preserva el tipo original), no en una columna propia. Frontend commit `2149fa5`.
  - **Dato huérfano dejado por el bug:** 3 solicitudes de material ya habían quedado marcadas `aprobado` en
    la base de datos sin que el material se aplicara nunca a la OC (porque `applyApprovedExtra` fallaba
    siempre). Como ya no están `pendiente`, la ventana emergente no las vuelve a mostrar. Se corrió un
    `UPDATE` puntual (por `id`) para devolverlas a `pendiente` y poder re-procesarlas con el fix activo — no
    fue necesario para las demás solicitudes del sistema, solo para esas 3 filas específicas.
- [x] **Mejora de UX pedida por el OWNER tras probar el flujo con los 5 fixes arriba:** con `projects`/OCs
  todavía en el blob compartido (mitad grande de VUL-044, sin empezar), aprobar una solicitud propia sigue
  pudiendo chocar en versión con el guardado del solicitante — es el residual esperado, no un bug nuevo. Pero
  el diálogo genérico "Otro usuario guardó cambios..." + `location.reload()` confundía (parecía un logout,
  cambiaba el tema oscuro→claro). `pollPendingAuth()` ahora marca `_lastOwnApprovalAt` al aplicar en vivo la
  aprobación de una solicitud propia; `_handleSaveConflict()` usa esa marca (ventana de 15s, se consume al
  usarla) para mostrar un mensaje específico de un solo botón ("El administrador aprobó tu solicitud...") y
  hacer un refresco liviano (`loadDataFromAPI()`, sin `location.reload()`) — si había una OC abierta, se
  cierra para reabrirla y ver el material ya agregado, sin el flash de login ni el cambio de tema. Si el
  choque NO es por una aprobación propia, el diálogo genérico se mantiene igual. Frontend commit `7eca951`.
- **Suite de pruebas al cierre:** backend 10 archivos, 265 pruebas, 0 fallas.
- [x] **Verificado en vivo por el OWNER (2026-07-26):** flujo completo confirmado en producción — login sin
  el 428, Mensajes sin el 400, aprobación de material extra sin "no se encontró la OC", y el mensaje nuevo de
  conflicto por aprobación propia funcionando. **VUL-044 parte 1.5 cerrada y verificada.**

### Sesión 2026-07-25/26 (VUL-043 — rotación de secretos completada + bug real de claudeCall())
> Continuación del plan de rotación de la Sección 12.12. Se hizo uno a la vez, en el orden seguro documentado;
> el OWNER ejecutó cada paso en el dashboard correspondiente, Claude guió y verificó.
- [x] **Paso 1 — `SISCON_TOKEN` rotado** en Render (riesgo cero, inerte en producción porque
  `CLOUDFLARE_ENABLED=true` ya deja pasar antes de esa comprobación).
- [x] **Paso 2 — `ANTHROPIC_API_KEY` rotada** en la consola de Anthropic + Render. Verificación inicial
  reveló un bug real (no relacionado con la rotación en sí) que impedía probarla — ver abajo.
- [x] **Bug real encontrado al verificar — `claudeCall()` caía siempre al fallback roto bajo Plan B
  (mismo origen).** `backendUrl()` devuelve `''` cuando `BACKEND_URL=''` (Plan B, valor válido: "usa rutas
  `/api/*` relativas"), pero `claudeCall()` hacía `if(be){...}` y `''` es *falsy* en JS — nunca entraba a la
  rama del backend real, caía siempre al fallback de pegar la API key de Claude directo en el navegador
  (mensaje "Configura el Backend en Ajustes..."). Bug distinto del ya cerrado en `backendUrl()` (commit
  `5047484`, sesión 2026-07-26) — mismo síntoma superficial, causa distinta, en la función que sí la llama.
  - **Fix:** `claudeCall()` ya no chequea `if(be)`; usa `backendUrl()` siempre (nunca es `null`/`undefined`).
  - **Eliminado (ya no se requería):** el fallback de fetch directo a `api.anthropic.com` con una API key
    pegada en el navegador (mismo riesgo que cerraron VUL-029/030 — key expuesta en cliente); `claudeKey()`,
    `SYS.claudeKey`, el campo "Claude (Anthropic) — directo" en Ajustes, y su lectura en `saveSettings()`.
    También se quitó de `claudeCall()` el header `x-siscon-token` que traía hardcodeado el valor **viejo**
    de `SISCON_TOKEN` (no se valida en producción, `checkToken()` lo ignora con Cloudflare Access activo).
  - Frontend commit `4dcbcfb`, desplegado a Vercel.
  - **Verificado en vivo por el OWNER (2026-07-26):** login vía Cloudflare Access + chat/OCR de Claude
    funcionando en `app.sisconcr.com` con la key nueva.
  - **Nota (no corregida, fuera de alcance de esta sesión):** el mismo token viejo `siscon-2026-pmapp`
    sigue hardcodeado como header `x-siscon-token` en ~10 llamadas más del archivo (login, invitaciones,
    reset de password, gestión de usuarios). No afecta funcionalidad (`checkToken()` no lo exige en
    producción), queda anotado para una limpieza futura si se retoma.
- [x] **Paso 3 — `MS_CLIENT_SECRET` rotado** en Azure. App correcta identificada **verificando el
  `MS_CLIENT_ID` real contra el historial del repo** (no por el nombre): `Siscon`
  (`1abc2f0f-7043-49be-b458-185db33144ec`), no `Cloudflare Access - Siscon` (esa es el IdP del login — tocarle
  el secreto habría tumbado el acceso de todos). Secuencia segura respetada: secreto nuevo en Azure → Render →
  verificar → recién ahí borrar el viejo.
  - **Verificado:** logs de Render con `[ms] Tokens restored via bootstrap ✓` + botón "📥 Refrescar" del buzón
    sin error. Secreto viejo borrado en Azure después de confirmar.
  - **Confirmado en el código, no supuesto:** los refresh tokens de Azure AD **no** se invalidan al rotar el
    client secret (el secreto autentica la app en el intercambio, no queda grabado en el token), por eso
    `msBootstrapIfNeeded()` siguió funcionando sin reconectar Outlook.
  - **Decisión — `MS_CLIENT_ID` y `MS_TENANT_ID` NO se rotan** aunque salieron en el mismo commit: no son
    secretos (el client ID es un identificador público de la app; el tenant ID es descubrible públicamente para
    cualquier dominio de M365). Sin el secreto no sirven. Rotarlos exigiría un App Registration nuevo desde
    cero (redirect URIs, reconsentir permisos, reconectar el buzón) sin ganancia real de seguridad.
- [x] **Paso 4 — `client_secret` de Intuit: NO requiere rotación (verificado, no supuesto).** El plan lo
  listaba "por precaución barata, pero sin confirmar". Se corrió la búsqueda en el historial real de
  `siscon-backend`: `QBO_CLIENT_SECRET` **no aparece en ningún commit** — solo la línea vacía de `.env.example`.
  Decisión del OWNER: saltarlo. Queda descartado con evidencia, ya no "pendiente por precaución".
- [x] **Paso 5 — anon key de Supabase revocada, SIN regenerar el JWT secret y SIN desloguear a nadie.**
  - **El plan de 12.12 quedó obsoleto:** describía el camino legacy (regenerar el JWT secret → invalida anon y
    service_role a la vez → riesgo de tumbar la app y desloguear a los 4 usuarios). El proyecto ya tiene el
    **esquema nuevo de llaves** de Supabase (`sb_publishable_...` / `sb_secret_...`), que permite revocar las
    legacy sin tocar el secreto de firma.
  - **Hallazgos previos que hicieron el cambio seguro:** (a) la anon key **ya no se usa en ninguna parte** —
    el frontend no la tiene desde VUL-029 y el backend solo usa `SUPABASE_SERVICE_ROLE_KEY`; (b) el único
    consumidor real es el backend en Render (los tests la dejan vacía a propósito); (c) las sesiones de usuario
    se validan con `supabase.auth.getUser(token)` — llamada a la API de GoTrue, **no** verificación local contra
    el JWT secret, así que revocar llaves de API no invalida sesiones.
  - **Ejecución:** el valor de `SUPABASE_SERVICE_ROLE_KEY` en Render se cambió de la service_role legacy a la
    llave nueva `sb_secret_...` (**solo el valor; el nombre de la variable no cambia y no hubo cambio de
    código**) → se verificó en vivo → recién entonces "Disable JWT-based API keys", que revoca de un golpe la
    anon key expuesta en Git y la service_role legacy.
  - **Verificación del privilegio crítico (`BYPASSRLS`), por cadena lógica no por suposición:** un guardado
    exitoso prueba que la lectura previa funcionó, porque `loadDataFromAPI()` es quien fija `_settingsVersion`
    y sin él el guardado habría fallado con 428 `missing_version` (VUL-033). El OWNER guardó cambios sin error
    → la llave nueva ignora RLS igual que la vieja, que es de lo que depende VUL-016.
  - **Verificado además:** `GET /` → `{"supabase":true,"claude":true}`; `GET /api/db/settings/1` sin JWT → 403
    (VUL-019 sigue cerrada); datos intactos tras deshabilitar las llaves legacy; sin errores en los logs de Render.
  - ⚠️ **Verificación pendiente (única de esta sesión):** el OWNER **aún no ha probado un ciclo completo de
    logout → login** después de deshabilitar las llaves legacy. La sesión abierta seguiría funcionando aunque
    `signInWithPassword` estuviera roto, así que un fallo ahí no se notaría hasta que a alguien se le venza el
    token. Probarlo al inicio de la próxima sesión. Si fallara, el arreglo es re-habilitar las llaves legacy
    desde esa misma pantalla de Supabase.
- **Hallazgo de infraestructura (no es un problema):** `api.sisconcr.com` no resuelve (NXDOMAIN). Es lo
  esperado — tras el incidente de DNS documentado, el rewrite de `vercel.json` apunta directo a
  `siscon-backend.onrender.com` (una dependencia de DNS menos). Se anota porque un `curl` a `api.sisconcr.com`
  falla y podría confundirse con una caída del backend.

### Sesión 2026-07-27 (rediseño visual completo del frontend — estilo dashboard moderno)
> Frontend únicamente (`siscon-web/index.html`). Sin cambios de lógica de negocio ni de modelo de datos.
> Todo se probó primero en una copia offline (`redesign-preview/`, fuera del repo, con un botón de "modo
> demo" quitado antes de cada despliegue) antes de subir a producción.
- [x] **Nueva identidad visual** inspirada en el dashboard de referencia w3crm-vue: tipografía Poppins,
  paleta de colores nueva (acento azul `#0d99ff`), tarjetas con sombra y radios grandes, para tema claro y oscuro.
- [x] **Sidebar lateral de navegación** nueva (Inicio, Proyectos, Subcontratistas, Calculadora de Avance,
  Ruta, Bodega, Sin clasificar, Informes, Cotizaciones, Mensajes, Ajustes) — reutiliza las funciones
  existentes, no duplica lógica.
- [x] **Topbar rediseñado**: barra oscura fija en ambos temas.
- [x] **Ajustes → Apariencia**: selector de tema (ya existía) + **color de acento configurable** (nuevo,
  global para todos los usuarios, picker + 6 presets). De paso se corrigió un bug real: el tema global
  (`SYS.theme`) no se reaplicaba al iniciar sesión otros usuarios (`applyTheme()` no se llamaba tras el
  login) — ahora se reaplica en `renderDash()`.
- [x] **Gráficas SVG modernizadas** (dibujadas a mano, sin librerías): líneas de cuadrícula, barras con
  esquinas redondeadas, dona con track de fondo, línea con relleno degradado.
- [x] **~230 emojis reemplazados** por un set de íconos SVG lineales consistentes en sidebar, topbar, menús
  ⋮ (documentos/bitácora/tareas/mensajes/tipos/OC), candados de tipo bloqueado, toggles Kanban/Lista,
  adjuntos de mensajes (imagen/audio/video), semáforo de recuperación, etc. Quedaron sin tocar los símbolos
  tipográficos simples (✓ ✕ ✗ →) y el texto decorativo de toasts/notificaciones/bitácora de auditoría.
- [x] **Vista "Proyectos" separada de "Inicio"**: Inicio ahora muestra solo Información General y
  Estadísticas; la tabla/kanban de proyectos (crear, ordenar, kanban/lista, columnas, log) se movió a su
  propia vista dedicada en el sidebar, con resaltado activo entre ambas.
- [x] **Menú rápido al pasar el mouse sobre "Proyectos"**: los 10 proyectos con actividad más reciente,
  listados alfabéticamente; clic abre el proyecto directo.
- [x] **Fix de alineación en la tabla de Proyectos**: el grid de encabezados tenía `gap:0` (texto de
  columnas pegado); ahora hay separación real, encabezados alineados a la izquierda igual que los datos de
  cada columna, y el badge de pendientes reserva su espacio (vacío si no aplica) para que todos los nombres
  de proyecto arranquen en la misma posición.
- [x] **Avances de Subcontratos** ("Avance" en el sidebar): nuevo dropdown para filtrar la lista por Todos
  / Semana en Curso / Mes en Curso / Rango de fechas.
- [x] **Desplegado a producción** en 4 commits (`7a090ba`, `75cc907`, `a629e22`, `b8422a9`) sobre
  `agoldav/Siscon-web` → Vercel. Tag de respaldo `backup-pre-redesign-2026-07-27` creado y pusheado sobre
  el commit previo al rediseño, por si hay que revertir.

### Sesión 2026-07-27 (VUL-044 Fase A — projects/houses fuera del blob, implementación y cutover)
> Backend + frontend + SQL/migración. **Backend `3116bfa` desplegado en Render; frontend `759862f`
> y documentación `a15045f` desplegados en Vercel. SQL y migración real completados en producción.**
> **Fase A cerrada y verificada en vivo por el OWNER el 2026-07-27.** VUL-044 completa sigue abierta
> porque aún quedan otras colecciones grandes dentro de `projects.data` y `settings/1`.
- [x] Auditoría del trabajo parcial que había quedado al agotarse el contexto: se detectaron frontend
  ausente, mezcla de ids text/número, PUT parcial que vaciaba `data`, cascada no atómica, migración
  reejecutable desde un blob obsoleto, rollback falso y una prueba de concurrencia desactualizada.
- [x] `projects`/`houses` tienen rutas dedicadas con política explícita, concurrencia optimista por fila,
  parches jsonb seguros y `replace_data:true` para reemplazo completo intencional. `project_id` de una
  casa queda inmutable.
- [x] Borrado de proyecto + casas mediante RPC transaccional `soft_delete_project`; no responde éxito si
  la operación no se completa. `schema_migrations` queda deny-by-default y solo para `service_role`.
- [x] Normalización bidireccional: camelCase→snake_case al escribir y fila Postgres→modelo histórico al
  leer. Los ids técnicos text vuelven a número seguro; `num` permanece string.
- [x] Migración fail-closed: aborta si las tablas no están vacías, si ya existe el marcador o si encuentra
  ids ajenos; permite recuperación explícita de una ejecución parcial, verifica ids/project_id exactos y
  solo entonces registra el marcador.
- [x] Rollback real: `restore-projects-houses-to-blob.js` reconstruye el blob desde las tablas antes de
  revertir el frontend; dry-run por defecto y UPDATE condicionado a `settings.updated_at`.
- [x] Frontend normalizado: carga `settings`/`projects`/`houses` en paralelo, reconstruye casas anidadas,
  mantiene versión y snapshot por fila, sincroniza solo altas/cambios/borrados, crea proyectos antes de
  casas y elimina proyectos mediante la cascada. `settings/1` deja de recibir `projects` después del
  cutover; localStorage conserva la copia local. Fallback temporal si las tablas siguen vacías.
- [x] Verificación local: sintaxis completa OK; backend 11 archivos / 312 aserciones en verde; frontend
  6 archivos / 115 aserciones en verde. Se agregaron pruebas de comportamiento real para alta,
  actualización y borrado normalizados.
- [x] Cutover de producción: SQL aplicado y validado; cuatro filas legacy sin referencias archivadas
  reversiblemente; dry-run exitoso; migración real de 3 proyectos y 30 casas; marcador
  `vul-044-phase-a-projects-houses` registrado; auditoría independiente `all_checks_passed=true`;
  backend saludable (`/health` → 200) y frontend publicado en Vercel con el lector normalizado.
- [x] Primera prueba en vivo con dos usuarios: detectó un falso conflicto apenas entraba la segunda
  persona. La causa no estaba en `projects`/`houses`: ambos flujos de login agregaban un evento al
  `activityLog` compartido y ejecutaban un PUT de `settings/1`, invalidando la versión de las sesiones
  ya abiertas aunque nadie hubiera editado datos de negocio. Se eliminó esa escritura de autenticación,
  se agregó una defensa en `logAction` para esos eventos y una fotografía del payload confirmado que
  omite PUTs de settings cuando no cambió su contenido. Los cambios reales siguen guardándose y la cola
  conserva modificaciones que ocurren durante un PUT. Regresión completa: 7 archivos / 127 aserciones
  en verde.
- [x] **Regresión de UX detectada después de Fase A:** la solución ya verificada para una aprobación
  propia (mensaje de un solo OK + `loadDataFromAPI()`, sin diálogo genérico ni sobrescritura) seguía
  presente, pero solo en `_handleSaveConflict()` para `settings/1`. La normalización introdujo
  `_handleRowConflict()` para `projects`/`houses` sin consultar `_lastOwnApprovalAt`; por eso aprobar
  material fuera de presupuesto podía volver a mostrar “Otro usuario guardó cambios…”. Se extrajo el
  flujo acordado a `_handleRecentOwnApproval()` y ahora ambos manejadores lo ejecutan antes del
  conflicto genérico. La regresión de comportamiento simula un 409 real de proyecto, confirma un solo
  mensaje, una sola recarga desde servidor, cierre de la OC abierta y cero sobrescrituras forzadas.
  Suite completa: 7 archivos / 135 aserciones en verde.
- [x] **Cierre funcional de Fase A verificado por el OWNER (2026-07-27):** prueba en producción con
  dos usuarios autenticados aprobada. El usuario solicitó material fuera de presupuesto, el
  administrador lo aprobó y el solicitante recibió el mensaje específico con un solo OK; al aceptarlo
  cargó el estado autoritativo guardado por el administrador, sin mostrar el diálogo genérico de
  recargar/sobrescribir. **Fase A (`projects`/`houses`) cerrada.**

### Sesión 2026-07-28 (VUL-044 Fase B — transactions fuera del blob, implementación y cutover)
> Backend + frontend + SQL/migración. **Backend `37e384f` y frontend `0fdd257` integrados en
> `origin/main` y desplegados. Migración real completada en producción.** VUL-044 completa sigue
> abierta porque aún quedan otras colecciones dentro de `projects.data` y `settings/1`.
- [x] Se normalizaron `ocs`, `invClient`, `billVendor`, `payments`, `creditNotes` y `requis` hacia la
  tabla unificada `transactions`, conservando los seis arreglos históricos en memoria para no cambiar
  la lógica de negocio. Las rutas dedicadas usan concurrencia optimista por fila y la sincronización es
  incremental.
- [x] Antes del cutover se creó y verificó el respaldo protegido
  `vul_044_backup_20260728_2255`. El dry-run encontró 3 proyectos y 37 transacciones: 11 OCs, 3 facturas
  de cliente, 20 facturas de proveedor y 3 pagos; sin versiones faltantes, ids duplicados ni payloads
  inválidos.
- [x] El primer cutover detectó una variación visible de $0.01 causada por columnas
  `numeric(14,2)`, que truncaban la precisión histórica usada por JavaScript. Se restauró de inmediato
  y atómicamente desde el respaldo; los totales originales volvieron exactamente. La corrección cambia
  `subtotal_usd`, `total_usd` y `total_crc` a `numeric` sin escala fija y agrega una regresión específica.
- [x] Con la corrección desplegada se repitió el cutover: 37 filas activas, marcador
  `vul-044-phase-b-transactions` en las 37, cero payloads distintos, cero filas inesperadas, cero
  huérfanas y ningún arreglo transaccional restante en `projects.data`.
- [x] Verificación en producción: dos cargas independientes de la aplicación mostraron exactamente
  $37,594.79 gastado y $11,678.04 pendiente, sin errores ni warnings de consola. Un smoke test
  transaccional confirmó inserción, actualización y borrado con alta precisión y terminó en `ROLLBACK`,
  sin residuos. Regresión local: backend 12 archivos / 346 aserciones y frontend 8 archivos /
  150 aserciones, todo en verde.

### Sesión 2026-07-28 (VUL-044 Fase C — house_types, implementación y cutover)
> **Fase C cerrada y verificada en producción con autorización explícita del OWNER.** Backend
> `16bbcb6` y frontend `82553b9` integrados en `main`; Vercel desplegado y Render verificado con el
> identificador público `vul-044-phase-c-house-types`. Respaldo protegido conservado en el schema
> `vul_044_backup_20260728_2340`.
- [x] Inventario productivo de solo lectura: 3 proyectos, 4 tipos dentro de
  `projects.data.types` y 30 casas con `houses.data.typeId`; tabla `house_types` vacía, marcador
  ausente, cero ids faltantes/duplicados y cero referencias inválidas. Uno de los valores numéricos
  usa más de dos decimales, por lo que las columnas se dejan como `numeric` sin escala fija.
- [x] Rutas dedicadas de `house_types` con política compartida histórica, concurrencia optimista por
  fila, `project_id` inmutable y borrado transaccional que falla si una casa viva todavía usa el
  tipo. El borrado de proyecto ahora incluye tipos en la misma cascada.
- [x] Despliegue escalonado seguro: antes del cutover, un backend nuevo conserva `typeId` dentro de
  `houses.data`; después del marcador exige una FK válida y rechaza referencias inexistentes. El
  frontend mantiene fallback al arreglo legacy mientras la tabla esté vacía.
- [x] Sincronización incremental: crea proyecto → tipo → casa para respetar FKs; al borrar limpia
  primero `houses.type_id` y después elimina el tipo. `sort_order` preserva exactamente el orden del
  arreglo histórico aunque todas las filas se inserten en una sola transacción.
- [x] Cutover SQL atómico y fail-closed: inserta tipos, promueve las 30 referencias, limpia ambas
  fuentes y registra el marcador o revierte todo. Verifica versiones y payload fuente exacto. El
  rollback reconstruye `projects.data.types` y `houses.data.typeId` mediante otra RPC atómica; dry-run
  por defecto.
- [x] Regresión completa: backend 13 archivos / 387 aserciones y frontend 9 archivos /
  171 aserciones, todo en verde. Ambas copias maestras de `SUPABASE_SCHEMA.sql` quedaron idénticas.
- [x] Antes del corte se creó y verificó el respaldo protegido: 7 proyectos totales (3 activos),
  30 casas, 37 transacciones, 0 tipos, 2 marcadores previos y 1 fila de settings. El schema queda
  retenido para recuperación; acceso revocado a `public`/`anon`/`authenticated` y RLS forzado.
- [x] La revisión previa al corte detectó que el `INSERT` del RPC tenía cruzadas las posiciones de
  `categories` y `sort_order`. No se había migrado ningún dato. Se corrigió en `a69a8aa`, se añadió
  una regresión que valida el orden columna/valor, se repitieron las 13 suites y se reinstaló el SQL
  corregido (`SHA-256 38e5797c02b06250a4d56c75b3a92644f95a8a9af7fd6f6ffe9c03f974a20c54`).
- [x] Cutover atómico completado: 4 filas activas en `house_types`, 30/30 casas con `type_id`, cero
  `projects.data.types`, cero `houses.data.typeId`, cero referencias huérfanas o cruzadas y marcador
  `vul-044-phase-c-house-types` con conteos 3/30/4. Comparación exacta posterior: cero payloads
  distintos, inesperados o faltantes; cero casas o proyectos incorrectos. Payload aplicado:
  `SHA-256 777823b1cef0fe5f506fdafbc0519b49f4757c65eb24aa7bf8279b5e632b81de`.
- [x] Smoke test dentro de transacción confirmó alta con precisión extendida y borrado lógico; terminó
  en `ROLLBACK` con 0 residuos y 4 tipos vivos. La aplicación desplegada mostró los dos tipos del
  proyecto 116 en el orden histórico y conservó exactamente $37,594.79 gastado y $11,678.04 pendiente.

### Sesión 2026-07-29/30 (VUL-044 Fase D — docs/uploads, implementación, cutover y cierre)
> **Fase D desplegada, migrada y verificada en producción.** Backend `6fa18df` y frontend `4a643d0`
> integrados en `main`; Render sirve el build `vul-044-phase-d-documents` y Vercel entrega el
> lector normalizado. Respaldo protegido conservado en
> `vul_044_backup_20260729_1635`.
- [x] `docs[]` y `uploads[]` se modelan como una sola fila lógica en `documents` cuando comparten
  `blobId`/id. El inventario productivo reveló que la persistencia legacy eliminó `blobId` de
  `uploads[]`; por eso también se recupera el vínculo por nombre exacto únicamente cuando existe un
  solo doc y un solo upload con ese nombre dentro del proyecto. Los nombres ambiguos nunca se unen
  por adivinación. `documents.data` conserva por separado los dos payloads históricos y sus
  posiciones, de modo que la UI no cambia de forma y el rollback reconstruye ambos arreglos
  exactamente.
- [x] La URL `blob:` de sesión nunca se persiste. `pdfBase64` se conserva temporalmente para no romper
  apertura, anotaciones ni PDFs importados desde Outlook; mover el binario a R2 continúa como riesgo
  residual explícito y fase separada.
- [x] Backend con rutas dedicadas `documents`, política compartida histórica, `project_id` y
  `created_by` inmutables, validación de proyecto, concurrencia optimista por fila (`409/428`) y
  soft-delete. La cascada atómica de proyecto ahora incluye documentos.
- [x] Frontend con carga/fallback escalonado, reconstrucción ordenada de `project.docs/uploads`,
  snapshots/versiones por documento, alta/edición/borrado incremental y eliminación de ambas
  colecciones del payload de `projects` solamente después del cutover.
- [x] Cutover preparado en `migration-documents.sql` + `migrate-documents.js`: preflight dry-run,
  tabla destino vacía, ids/relaciones exactos, comparación de las dos fuentes y `updated_at`, inserción,
  limpieza y marcador `vul-044-phase-d-documents` dentro de una sola RPC. Rollback
  `restore-documents-to-projects.js` es dry-run por defecto y usa otra RPC atómica.
- [x] Regresión completa local: backend **14 archivos / 419 aserciones** y frontend
  **10 archivos / 186 aserciones**, todo en verde; sintaxis del `<script>` completo OK.
- [x] Preflight productivo de solo lectura: 3 proyectos activos; `documents` tiene 0 filas totales y
  0 activas; marcador `vul-044-phase-d-documents` ausente; los tres proyectos todavía contienen
  arreglos legacy. Inventario: 14 elementos en `docs[]`, 12 en `uploads[]`, 0 shapes inválidos,
  0 llaves lógicas faltantes, 0 duplicados por llave, 0 URLs `blob:` persistidas y 10 payloads
  `pdfBase64` (476,484 caracteres). Con la llave primaria legacy aparecen 26 filas lógicas
  (22 + 4 por proyecto), 14 solo-doc y 12 solo-upload; este hallazgo motivó el fallback seguro por
  nombre único descrito arriba. Los tres `updated_at` fuente coinciden en
  `2026-07-29T03:51:37.072267+00:00`.
- [x] Preflight adicional de nombres: 12 coincidencias exactas 1:1, 2 docs sin upload, 0 uploads sin
  doc y 0 nombres ambiguos. El dry-run de `migrate-documents.js` confirmó 3 proyectos, 14 documentos
  lógicos, 14 metadata, 12 uploads y 12 pares antes de permitir el corte.
- [x] Respaldo productivo creado y verificado antes de migrar: 22 tablas protegidas, 7 proyectos
  totales (3 activos), 30 casas, 37 transacciones, 4 tipos, 0 documentos, 3 marcadores y 1 settings;
  cero grants a `public`/`anon`/`authenticated`. La primera copia incluyó `audit_log` (499 MB) y
  superó temporalmente el límite del plan; se eliminó **solo esa copia** del schema de respaldo,
  conservando intacto `public.audit_log` y todas las tablas necesarias para VUL-044. Supabase volvió
  a `transaction_read_only=off` / `default_transaction_read_only=off` antes del corte.
- [x] Cutover RPC atómico completado y autoverificado: marcador
  `vul-044-phase-d-documents`, 3 proyectos y 14 documentos. Verificación independiente: 14 filas
  totales/activas, 12 pares doc+upload, 2 solo-doc, 0 solo-upload, 0 huérfanos, 0 proyectos con
  `docs/uploads` legacy, 0 URLs efímeras, 10 filas con `pdfBase64`; distribución exacta 12 + 2 por
  proyecto y `marker.document_count=14`.
- [x] Smoke SQL transaccional confirmó inserción, actualización y borrado y terminó en `ROLLBACK`:
  0 residuos y 14 documentos activos. La clave secreta efímera creada exclusivamente para ejecutar
  la migración fue eliminada al terminar y los artefactos temporales locales se borraron.
- [x] Verificación en la aplicación: frontend normalizado presente en Vercel y en
  `app.sisconcr.com`, carga autenticada sin errores/warnings de consola, totales financieros
  conservados ($37,594.79 gastado / $11,678.04 pendiente) y 12 documentos visibles en Dor.
- [x] Verificación manual completada por el OWNER el 2026-07-30: apertura de PDF y persistencia de
  anotaciones aprobadas desde una sesión humana. La automatización no intentó evadir la política
  segura del navegador que bloqueaba `Ver PDF`. Las rutas de alta/edición/borrado también quedaron
  cubiertas por regresión local y el smoke transaccional. **Fase D cerrada.**

### Sesión 2026-07-28 (rediseño del panel métrico del proyecto)
> Frontend únicamente (`siscon-web/index.html`). Sin cambios de lógica de negocio, de cálculo ni de
> modelo de datos. El diff queda confinado al bloque CSS del panel y a `renderMetric()`.
- [x] **Panel métrico rediseñado** a partir de una propuesta visual del OWNER: pasa de una rejilla plana
  de 5×4 celdas (`.mi`/`.mi-label`/`.mi-val`) a una tarjeta con tres bandas separadas (clases nuevas con
  prefijo `pm-`, sin colisión con nada existente):
  1. Identidad — ícono de edificio, **Proyecto {nombre}** en grande, número, Cliente, Correo y el
     selector de Estatus alineado a la derecha.
  2. **Avance instalado** — porcentaje en 30px, barra de progreso y `{instalada} m² de {total} m²`;
     Fecha de inicio al extremo derecho.
  3. Cifras — Presupuesto · Costo Real · Disponible · Precio de Venta · Utilidad Real (con
     "Presupuestada N%" como línea secundaria) y **Salud/Proyección convertidas en badges** con borde
     de color, en vez de texto plano con ✓/✗.
- [x] **Edición conservada en el mismo panel** (decisión del OWNER frente a la alternativa de un modal):
  al abrir el candado los valores se convierten en inputs en su lugar. **Se mantienen los 10 campos
  editables** de antes — `name`, `num`, `client`, `razonSocial`, `correo`, `startDate`, `area`, `budget`,
  `salePrice`, `utilityPct` — más el selector de estatus. `areaInstalled` sigue siendo de solo lectura
  (se calcula desde las casas), igual que antes.
- [x] **Razón Social** (que la propuesta eliminaba) se conserva: en modo bloqueado aparece como línea
  gris bajo el Cliente **solo cuando difiere** de él; en modo edición vuelve a ser un campo propio. Así
  no se pierde la capacidad de editarla, que se usa para facturación a cliente.
- [x] Área Total y % Utilidad Presupuestada pasan a texto secundario en modo bloqueado, pero siguen
  siendo editables al desbloquear. La fecha de inicio ahora se muestra con `fmtDate()` (dd/mm/aaaa)
  en vez del ISO crudo, y con `—` cuando está vacía.
- [x] El candado (`#metric-lock-btn`) se reposicionó a la banda superior. Se dejó como elemento
  estático fuera de `#mgrid` a propósito: `openProj()` lo referencia por id **antes** de llamar a
  `renderMetric()`, así que moverlo dentro del HTML generado lo rompería en la primera apertura.
- [x] **Verificación:** sintaxis del `<script>` completo OK; **suite del frontend 7/7 en verde**
  (incluida `test-xss.js` — todos los campos de usuario nuevos pasan por `esc()` y los numéricos por
  `toLocaleString`). Render real con Chrome headless en tema claro y oscuro, y con casos borde:
  razón social distinta, proyecto vacío con nombre largo (trunca con elipsis y muestra `—`), y
  disponible negativo con avance al 100%.

## 10. ⏳ Pendiente

> Nota: la **Pestaña Tareas** ya está implementada (existe `renderTareas`, `SYS`/`curProj.tasks`, tablero y badge). Queda en el histórico como completada aunque no tiene sesión fechada asociada.

### 🔴 Seguridad — hallazgos ABIERTOS de la revisión externa #2 (2026-07-24)
> Verificados contra el código real. Lo cerrado esta sesión (VUL-032..042, 045) se movió a Completado
> con fecha 2026-07-25. VUL-044 parte 1 y parte 1.5 (Mensajes y pendingAuthRequests/notifications fuera del
> blob) se cerraron y verificaron en vivo el 2026-07-25/26 — ver Sección 9. **VUL-043 (rotación de secretos)
> se completó el 2026-07-26** — ver Sección 9. Solo queda abierta la mitad grande de VUL-044 (normalizar el
> resto del blob).

- [~] **VUL-044 | Modelo de datos: blob único compartido** (ARQUITECTÓNICA)
  - Después de las Fases A–C, `projects`, `houses`, transacciones y tipos ya tienen filas propias.
    Todavía quedan otras colecciones dentro de `projects.data`, además de ajustes/actividad en
    `settings/1`, cuyos cambios comparten versión por fila y pueden chocar aunque afecten
    subcolecciones distintas.
  - `conversations`/`messages` (parte 1) y `pendingAuthRequests`/`notifications` (parte 1.5) ya salieron del
    blob a sus propias tablas — cerradas y verificadas en vivo, ver Sección 9 y Sección 11.2.
  - **Fase A (`projects`/`houses`) — ✅ CERRADA:** implementada, migrada, desplegada y verificada en
    vivo con dos usuarios el 2026-07-27. Conteos exactos
    en producción: 3 proyectos y 30 casas; sin ids faltantes/inesperados ni relaciones incorrectas;
    marcador de migración registrado y frontend normalizado publicado. La primera prueba multiusuario
    encontró y corrigió una escritura artificial de `settings/1` durante el login y una regresión que
    omitía el mensaje específico de aprobación en los nuevos conflictos por fila. La repetición final
    del flujo de aprobación fue aprobada por el OWNER.
  - **Fase B (`transactions`) — ✅ CERRADA Y VERIFICADA EN PRODUCCIÓN (2026-07-28):** backend/frontend
    desplegados y cutover completado tras respaldo protegido y dry-run. Producción contiene 37
    transacciones normalizadas (11 OCs, 3 facturas de cliente, 20 facturas de proveedor y 3 pagos);
    cero payloads distintos, inesperados o huérfanos, y cero arreglos transaccionales residuales en
    `projects.data`. Un primer corte reveló redondeo de $0.01 por `numeric(14,2)`; se restauró
    atómicamente, se corrigió la precisión en `37e384f` y se repitió el corte preservando exactamente
    los totales históricos. Dos cargas independientes y un smoke test reversible quedaron en verde.
  - **Fase C (`house_types` + `houses.type_id`) — ✅ CERRADA Y VERIFICADA EN PRODUCCIÓN
    (2026-07-28):** backend `16bbcb6` y frontend `82553b9` en `main`; respaldo protegido
    `vul_044_backup_20260728_2340` retenido. Cutover atómico completado con 4 tipos, 30/30 referencias,
    cero fuentes legacy, cero huérfanos y payload exacto. Un defecto de orden entre `categories` y
    `sort_order` fue detectado antes de escribir datos, corregido en `a69a8aa` y cubierto por regresión.
    Smoke test reversible, orden histórico, precisión extendida y totales visibles quedaron en verde.
  - **Fase D (`docs`/`uploads`) — ✅ CERRADA Y VERIFICADA EN PRODUCCIÓN (2026-07-30):** backend
    `6fa18df` y frontend `4a643d0` en `main`; respaldo protegido
    `vul_044_backup_20260729_1635` retenido. Cutover atómico completado con 14 documentos:
    12 pares doc+upload, 2 solo-doc, 0 solo-upload, 0 huérfanos, 0 arreglos legacy y 0 URLs `blob:`.
    Smoke reversible y carga autenticada quedaron en verde; el OWNER confirmó manualmente la
    apertura de PDF y la persistencia de anotaciones.
  - **SIGUIENTE FASE:** normalizar `garantias`, `bitacora`, `tasks`, `subAdvances` y `bodega`;
    después, catálogos/actividad del resto de `settings/1`. Hacerlo por fases, no como reescritura
    única. Antes de crear otro respaldo completo, definir retención/archivo de `audit_log` (499 MB)
    para no volver a superar el límite del plan de Supabase.

> **Riesgo residual documentado (sin acción de código):** el scope `com.intuit.quickbooks.accounting` de
> QuickBooks **no es de solo lectura** — Intuit no ofrece uno que lo sea. Hoy QB es de solo lectura porque el
> backend no expone rutas de escritura, no porque el token no pueda escribir. Si el token se filtra, permite
> operaciones contables de escritura. Mitigación real: custodia del token + rotación. No hay scope de QuickBooks
> Payments, así que la app no puede procesar cobros.

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
- [x] Habilitar RLS correctamente en Supabase — deny-by-default verificado + `FORCE` en las 21 tablas (VUL-016, 2026-07-24). Las políticas por-rol/usuario (VUL-014/015) se reclasificaron como *no aplican por arquitectura* (service_role ignora RLS + el frontend no accede directo); ver Sección 11.

### Informes adicionales (pendiente de implementar)
- [ ] Informe de Flujo de Caja proyectado
- [ ] Informe de Avance por Proyecto (% completado, área instalada, casas terminadas)
- [ ] Informe de Facturas a Cliente (emitidas, pagadas, pendientes)
- [ ] Informe de Órdenes de Compra por proveedor

### Mejoras futuras (anotadas, sin fecha)
- [ ] **Aprobaciones por WhatsApp** — que las solicitudes de aprobación lleguen a WhatsApp y el admin apruebe/rechace desde ahí. Arquitectura: frontend crea el request → backend envía WhatsApp → webhook recibe la respuesta → backend cambia `req.status` en Supabase → el polling actual aplica el material. Requiere: WhatsApp Business API (Twilio para prototipo / Meta Cloud API para producción), número dedicado, plantillas pre-aprobadas por Meta, lista blanca de números de admin. Decisiones pendientes: proveedor y mecanismo (botones vs texto+código). **NO construir hasta que el usuario lo pida.**

---

## 11. 🔒 Vulnerabilidades de Seguridad

> ⚠️ **Estado (2026-07-24+, tras la revisión externa #2): NO todo está cerrado.** La afirmación anterior de que
> "todas las vulnerabilidades están cerradas" era **incorrecta** y una revisión independiente lo demostró.
> Cerradas de verdad: VUL-001..013, 016..020, 023..027, 029..036, 039 y **043**. **Ya no queda ninguna CRÍTICA
> ni ALTA abierta.** Abierta: solo la mitad pendiente de VUL-044 (normalizar el resto del blob, ver Sección 10).
> VUL-045 cerrada 2026-07-25 (alta directa de usuarios).
> **VUL-043 cerrada 2026-07-26** — rotados `SISCON_TOKEN`, `ANTHROPIC_API_KEY`, `MS_CLIENT_SECRET` y revocada
> la anon key de Supabase (vía "Disable JWT-based API keys", sin regenerar el JWT secret); el `client_secret`
> de Intuit se descartó con evidencia (nunca estuvo en el historial). Detalle en Sección 9 y 12.12.
> VUL-044 parte 1 (conversations/messages fuera del blob) — ✅ cerrada y desplegada, verificada en vivo por
> el OWNER 2026-07-25/26 (Sección 9). VUL-044 parte 1.5 (pendingAuthRequests/notifications fuera del blob) —
> ✅ cerrada y desplegada, verificada en vivo por el OWNER 2026-07-26 tras corregir 5 bugs reales encontrados
> en producción (Sección 9). VUL-044 Fase A (`projects`/`houses`) quedó cerrada y verificada el
> 2026-07-27; las Fases B (`transactions`) y C (`house_types`/`houses.type_id`) quedaron cerradas y
> verificadas en producción el 2026-07-28.
> Sigue abierta la normalización de las demás colecciones que todavía comparten
> `projects.data`/`settings/1`, sin fecha.
> VUL-037/038/040/041/042 cerradas 2026-07-24+.
> VUL-014/015 se mantienen como "no aplican por arquitectura": esa conclusión depende de que el backend sea buen
> guardián, y con VUL-035 cerrada (política por tabla y rol en el CRUD) vuelve a sostenerse.
> VUL-021/022 siguen superadas por Cloudflare Access.
>
> **Lección de proceso:** varias VULs se marcaron cerradas por diseño o "dirigidas por riesgo" sin verificación
> independiente ni pruebas. A partir de ahora: una VUL solo se marca cerrada con **prueba automatizada** que
> falle si se reintroduce, o con verificación en vivo documentada.
>
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

#### FASE 2 — Auth / contención QB (✅ Completada y desplegada 2026-07-24)
> Vulnerabilidades de sesión e identidad — comienza 2026-07-25

- [x] **VUL-004** | Tokens `local_` sin firma almacenados en localStorage
  - **Estado:** ✅ CERRADA (2026-07-24) — token `local_` eliminado del backend (código, desplegado)
  - Descripción: Autenticación basada en `local_[base64(JSON)]` sin validación server
  - Severidad: CRÍTICA
  - Ubicación: `index.html` función `login()`, `loadData()` línea ~XXX
  - Riesgo: Token es solo Base64, no hay integridad, vulnerable a XSS, puede ser falsificado
  - Acción: Reemplazar por JWT server-signed; mover a httpOnly cookie
  - Dependencia: VUL-005

- [x] **VUL-005** | `SISCON_TOKEN` expuesto como secreto compartido débil
  - **Estado:** ✅ CERRADA (2026-07-24) — SISCON_TOKEN ya no se exige en modo Cloudflare; el gate es el JWT (código, desplegado)
  - Descripción: Token `siscon-2026-pmapp` está en el código frontend y usado como validación
  - Severidad: CRÍTICA
  - Ubicación: `index.html` constante `SISCON_TOKEN`, `siscon-backend/server.js` validación
  - Riesgo: Secreto compartido = cualquiera que vea el código puede autenticarse
  - Acción: Eliminar; usar autenticación real (JWT) en su lugar
  - Dependencia: VUL-004

- [x] **VUL-006** | Frontend puede efectuar consultas arbitrarias a QB (duplicado — ya cerrada en FASE 1)
  - **Estado:** ✅ CERRADA (2026-07-24) — endpoint `POST /api/qbo/query` eliminado (ver FASE 1). Commits `baac007`/`9df50bd`.
  - Dependencia: VUL-001

#### FASE 2 — Sesión e identidad (✅ Completada 2026-07-24 vía Cloudflare Access — quedan VUL-012/013)
> Vulnerabilidades de sesión e identidad

- [x] **VUL-007** | Sin MFA real en Supabase
  - **Estado:** ✅ CERRADA (2026-07-24) — MFA provista por Cloudflare Access / Microsoft Entra (desplegado en cutover)
  - Descripción: Autenticación solo por email/password sin factor adicional
  - Severidad: ALTA
  - Ubicación: `siscon-backend/server.js` `POST /api/auth/signin`, `index.html` función `login()`
  - Riesgo: Contraseña débil o comprometida = acceso total
  - Acción: Activar TOTP/SMS en Supabase Auth; requerir al login
  - Dependencia: VUL-004

- [x] **VUL-008** | Tokens en localStorage (vulnerable a XSS)
  - **Estado:** ✅ CERRADA (2026-07-24) — la auth real es la cookie httpOnly de Cloudflare, no un JWT en localStorage accesible a JS
  - Descripción: JWT se almacena en `localStorage` en lugar de httpOnly cookie
  - Severidad: ALTA
  - Ubicación: `siscon-backend/server.js` respuesta login, `index.html` `saveData()` / `loadData()`
  - Riesgo: XSS puede robar token; localStorage es accesible a cualquier script
  - Acción: Mover tokens a httpOnly + Secure + SameSite cookies
  - Dependencia: VUL-004

- [x] **VUL-009** | Cookies sin flags de seguridad (HttpOnly, Secure, SameSite)
  - **Estado:** ✅ CERRADA (2026-07-24) — cookie CF_Authorization gestionada por Cloudflare con flags seguros
  - Descripción: Si hay cookies, no tienen atributos de protección
  - Severidad: ALTA
  - Ubicación: `siscon-backend/server.js` `res.setHeader('Set-Cookie', ...)`
  - Riesgo: CSRF, acceso desde scripts no autorizados
  - Acción: Configurar `httpOnly=true`, `secure=true`, `sameSite=Strict`
  - Dependencia: VUL-008

- [x] **VUL-010** | Validación de rol solo en frontend
  - **Estado:** ✅ CERRADA (2026-07-24) — validateAdminRole valida el rol en el servidor (código, desplegado)
  - Descripción: Los botones se ocultan/muestran por rol, pero backend no valida
  - Severidad: ALTA
  - Ubicación: `index.html` funciones renderizado, `siscon-backend/server.js` sin validación
  - Riesgo: Usuario puede modificar `localStorage` para cambiar rol, o usar API directamente
  - Acción: Validar rol en cada endpoint del backend antes de autorizar acción
  - Dependencia: VUL-004

- [x] **VUL-011** | Usuario revocado puede seguir usando token antiguo
  - **Estado:** ✅ CERRADA (2026-07-24) — revocación central quitando el email del allowlist de Access
  - Descripción: No hay invalidación de sesiones al eliminar/revocar usuario
  - Severidad: ALTA
  - Ubicación: `siscon-backend/server.js` `DELETE /api/auth/users/:id`, `index.html` sin logout forzado
  - Riesgo: Usuario desvinculado mantiene acceso indefinidamente
  - Acción: Mantener lista de sesiones revocadas server-side; validar en cada request
  - Dependencia: VUL-007

- [x] **VUL-012** | Sin protección CSRF
  - **Estado:** ✅ CERRADA (2026-07-24) — mitigada por arquitectura, sin token CSRF explícito necesario
  - Descripción: No hay validación de origen o token CSRF en cambios de estado
  - Severidad: MEDIA
  - Acción realizada: CORS restringido a `FRONTEND_ORIGINS` (no `'*'`); el JWT de Cloudflare Access va en header (no cookie), así que el navegador no lo envía automático cross-site; `CF_Authorization` con `SameSite` gestionado por Cloudflare; Plan B usa `/api/*` same-origin. Documentado en `server.js` junto al middleware CORS.
  - Commit backend: `27b8832`

- [x] **VUL-013** | Sin reautenticación para acciones críticas
  - **Estado:** ✅ CERRADA (2026-07-24) — mitigada por MFA + auditoría (no re-auth explícita por ahora)
  - Descripción: Eliminar usuario, conectar QB, no requieren re-verificación de identidad
  - Severidad: MEDIA
  - Acción realizada: MFA de Cloudflare Access/Entra ya cubre el login; se documentó la mitigación y se conectó con VUL-024 (alertas) para detección post-facto en `DELETE /api/auth/users/:id` y `PUT /api/auth/users/:id/role`. Mejora futura anotada: re-auth explícita (password/OTP) antes de acciones irreversibles si se requiere más adelante.
  - Commit backend: `6f0cf2a`

#### FASE 3 — Datos + auditoría (🟡 Parcial 2026-07-24: VUL-016/017/018/020 cerradas; VUL-014/015 no aplican por arquitectura; VUL-019 mitigada)
> Vulnerabilidades de acceso a datos

- [~] **VUL-014** | RLS sin políticas específicas
  - **Estado:** ➖ NO APLICA POR ARQUITECTURA (diferida) — 2026-07-24
  - Descripción: RLS activado pero sin `create policy` por rol/usuario
  - Severidad: ALTA → reclasificada (sin amenaza activa en esta arquitectura)
  - Por qué no aplica: todo acceso a datos pasa por el backend con `service_role` (BYPASSRLS → ignora RLS) y el frontend nunca habla directo con Supabase (anon key eliminada, VUL-029). Una política por rol en la BD no tendría efecto sobre el tráfico real; el rol ya se valida server-side (`getCurrentUser`/`validateAdminRole`). Reactivar solo si se migra a cliente-directo contra Supabase.
  - Dependencia: VUL-015

- [~] **VUL-015** | No valida organización por usuario
  - **Estado:** ➖ NO APLICA POR ARQUITECTURA (diferida) — 2026-07-24
  - Descripción: Registros no están asociados a `org_id`; falta constraint de propiedad
  - Severidad: ALTA → reclasificada (sin amenaza activa en esta arquitectura)
  - Por qué no aplica: un solo inquilino (una empresa; los 4 usuarios comparten TODOS los datos — no hay partición por usuario en el producto) y en runtime la app guarda todo en un único blob `settings/1` vía service_role (las tablas normalizadas no están en la ruta de datos viva). `org_id` no cerraría ninguna amenaza y tocaría código Completado (factory CRUD, import, `normalizeRecord`). Reactivar solo si se migra a multi-empresa.
  - Dependencia: VUL-014

- [x] **VUL-016** | Deny-by-default no implementado en RLS
  - **Estado:** ✅ CERRADA (2026-07-24) — verificada en vivo + `FORCE` aplicado
  - Descripción: RLS debe quedar deny-by-default (enable + force) para que un acceso directo no lea sin política explícita
  - Severidad: ALTA
  - Verificación en vivo (2026-07-24): las 21 tablas de `public` tienen `rls_on = true` y **0 políticas**; `service_role` y `postgres` con `BYPASSRLS` (backend y SQL editor OK), `anon`/`authenticated` **sin** él → acceso directo con anon key devuelve vacío, incluida `settings` (blob con todos los datos).
  - Acción realizada: `ENABLE` + `FORCE ROW LEVEL SECURITY` idempotente sobre todas las tablas de `public` (do-block). El deny-by-default real ya venía desde 2026-07-20; `FORCE` cierra el criterio al pie de la letra (no-op funcional hoy: los dueños tienen BYPASSRLS).
  - Dependencia: (ninguna — independiente de VUL-014/015)

- [x] **VUL-017** | Backend usa global `service_role` sin validación de usuario
  - **Estado:** ✅ CERRADA (2026-07-24) — getCurrentUser valida identidad (email del JWT → profile) en cada request (código)
  - Descripción: Cliente Supabase server-side usa `service_role` que ignora RLS
  - Severidad: MEDIA
  - Ubicación: `siscon-backend/server.js` cliente Supabase configuración
  - Riesgo: Si hay bug en autorización backend, RLS no protege
  - Acción: Mantener `service_role` en server, pero validar usuario/rol en cada query antes de usarlo
  - Dependencia: VUL-010

- [x] **VUL-018** | Sin auditoría de acciones
  - **Estado:** ✅ CERRADA (2026-07-24) — audit_log + GET /api/audit-log solo Admin (código, desplegado)
  - Descripción: No existe registro de quién hizo qué, cuándo, desde dónde
  - Severidad: MEDIA
  - Ubicación: Falta tabla `audit_log` o similar
  - Riesgo: No se puede investigar cambios no autorizados; imposible compliance
  - Acción: Crear tabla `audit_log(id, user_id, action, resource, timestamp, ip, ...)`; insertar en cada acción crítica
  - Dependencia: VUL-010

- [x] **VUL-019** | Backend expone API pública en Render
  - **Estado:** ✅ CERRADA (2026-07-24) — verificado en vivo: `onrender.com` rechaza sin JWT
  - Descripción: `siscon-backend.onrender.com` es accesible para cualquiera sin validación de origen
  - Severidad: CRÍTICA
  - Verificación en vivo: `GET /api/db/settings/1` sin JWT → **403** (`Missing Cloudflare Access JWT`); con JWT basura → **403**; `/` y `/health` (públicos) → **200**.
  - Acción realizada: el control real no es esconder el dominio sino que el backend rechace todo request sin `Cf-Access-Jwt-Assertion` verificado (firma RS256 + aud + iss), como se implementó en FASE 1. `onrender.com` sigue siendo alcanzable por diseño (Plan B necesita el origin), pero no expone datos ni acciones sin el JWT. Tailscale/restricción de IP quedan como mejora futura opcional (no necesaria dado el control primario).
  - Dependencia: VUL-001 (ya cerrada)

- [x] **VUL-020** | Sin validación de identidad antes de exponer datos
  - **Estado:** ✅ CERRADA (2026-07-24) — identidad por JWT + rate limiting + auditoría en /api/db/* (código, desplegado)
  - Descripción: Endpoint `GET /api/db/settings/1` valida JWT pero no hay rate limit ni auditoría
  - Severidad: ALTA
  - Ubicación: `siscon-backend/server.js` rutas `/api/db/*`
  - Riesgo: Acceso a datos totales del proyecto desde internet
  - Acción: Rate limiting + auditoría + (luego) restricción Tailscale
  - Dependencia: VUL-019

#### FASE 4 — Red privada + Monitoring (🟡 VUL-023 cerrada; VUL-021/022 superadas por Access; VUL-024 pendiente)
> Infraestructura de defensa en profundidad

- [~] **VUL-021** | Sin capa de red privada (Tailscale)
  - **Estado:** ➖ SUPERADA (2026-07-24) — superada por Cloudflare Access (la app queda detrás de Access con MFA, no de Tailscale)
  - Descripción: La app es públicamente accesible en Internet
  - Severidad: CRÍTICA
  - Ubicación: Vercel y Render configuración
  - Riesgo: Superficie de ataque expuesta para 4 usuarios
  - Acción: Implementar Tailscale Serve; acceso solo desde red privada
  - Dependencia: VUL-019

- [~] **VUL-022** | Sin validación de dispositivo aprobado
  - **Estado:** ➖ SUPERADA (2026-07-24) — superada por Cloudflare Access (allowlist + MFA de Entra en vez de device whitelist)
  - Descripción: No se rastrea ni se valida qué dispositivo se conecta
  - Severidad: ALTA
  - Ubicación: Falta integración con Tailscale devices
  - Riesgo: Dispositivo robado o infectado puede conectarse indefinidamente
  - Acción: Mantener whitelist de device IDs; requerir aprobación manual
  - Dependencia: VUL-021

- [x] **VUL-023** | Sin rate limiting
  - **Estado:** ✅ CERRADA (2026-07-24) — express-rate-limit 1000/15min por IP real sobre /api/* (código, desplegado)
  - Descripción: No hay límite de intentos de login, sync, etc.
  - Severidad: MEDIA
  - Ubicación: `siscon-backend/server.js` sin middleware de rate limit
  - Riesgo: Fuerza bruta, DoS
  - Acción: Implementar `express-rate-limit` en endpoints críticos
  - Dependencia: VUL-019

- [x] **VUL-024** | Sin alertas de anomalías
  - **Estado:** ✅ CERRADA (2026-07-24) — MVP de logging de eventos críticos (sin push a email/Slack todavía)
  - Descripción: No hay notificación de intentos fallidos, nuevo dispositivo, cambio de rol, etc.
  - Severidad: MEDIA
  - Acción realizada: función `alertCriticalEvent()` — loguea a `stderr` (Render lo captura) + inserta en `audit_log` con severity=CRITICAL. Conectada a `USER_DELETED` y `USER_ROLE_CHANGED` (extensible a `QB_CONNECTED`, `AUTH_FAILED`, `SUSPICIOUS_ACCESS`).
  - Residual (mejora futura, no bloqueante): webhook real a Slack/email cuando ocurra un evento crítico; hoy requiere revisar logs de Render o `GET /api/audit-log` manualmente.
  - Commit backend: `6f0cf2a`
  - Dependencia: VUL-018 (cerrada)

#### FASE 5 — OAuth de QB seguro (✅ Completada 2026-07-24)
> Flujo de autorización de QuickBooks

- [x] **VUL-025** | OAuth `state` fijo o no aleatorio
  - **Estado:** ✅ CERRADA (2026-07-24)
  - Descripción: CSRF token en flow OAuth no es criptográficamente aleatorio (antes: `state: 'siscon'` fijo)
  - Severidad: ALTA
  - Acción realizada: `generateQBOState()` con `crypto.randomBytes(32).toString('hex')`; guardado en `store.qboAuthPending` con TTL 10 min; validado y consumido (one-time) en `/api/qbo/callback`, 403 si inválido/expirado.
  - Commit backend: `052cb85`

- [x] **VUL-026** | No valida `realmId` autorizado
  - **Estado:** ✅ CERRADA (2026-07-24)
  - Descripción: Frontend puede proporcionar cualquier `realmId`; no se valida contra el autorizado
  - Severidad: ALTA
  - Acción realizada: `realmId` recibido en el callback se guarda ligado al `state` de esa autorización específica antes del intercambio de token; previene que se asocie la conexión a un `realmId` distinto del que originó el flow.
  - Commit backend: `052cb85`

- [x] **VUL-027** | Sin protección PKCE en OAuth
  - **Estado:** ✅ CERRADA (2026-07-24)
  - Descripción: Flow OAuth no implementa PKCE (Proof Key for Public Clients)
  - Severidad: MEDIA
  - Acción realizada: `generatePKCEPair()` genera `code_verifier` (64 bytes base64url) + `code_challenge` (SHA-256 base64url, método S256); `code_challenge` enviado en `/api/qbo/connect`, `code_verifier` validado por Intuit en el intercambio de token del callback.
  - ⚠️ **Corrección (2026-07-24+):** aquí se documentó un test `test-oauth-vul.js` con "6/6 PASS" que **no existía
    en el repo** (lo detectó la revisión externa #2). El código de PKCE/state SÍ estaba implementado, solo
    faltaban las pruebas. **Cerrado en el mismo lote que VUL-037/038/041/042:** `test-oauth-hardening.js` incluye
    ahora `generateQBOState`/`generatePKCEPair`/`saveQBOAuth`/`validateAndClearQBOAuth` extraídos del archivo real
    y probados con `crypto` de Node (el `code_challenge` se verifica que sea de verdad `SHA-256(code_verifier)`,
    no solo que tenga forma de hash).
  - Commit backend: `052cb85`

#### FASE 6 — Frontend seguro (✅ Completada 2026-07-24 — VUL-028/029/030/031)
> XSS y seguridad del navegador

- [x] **VUL-028** | Riesgo XSS almacenado (innerHTML inseguro)
  - **Estado:** ✅ **CERRADA de nuevo (2026-07-24+, tras VUL-036).** Había quedado **reabierta**: la revisión
    externa #2 encontró sinks sin escapar que la remediación "dirigida por riesgo" no cubrió — `cellVal`
    (`p.name`,`p.client`), notas de documentos, `openUsersModal` (nombre/email) y `msgEsc` sin escapar comillas.
    El cierre anterior había sido prematuro: se declaró cerrada sin auditar los 134 `innerHTML` ni dejar una
    prueba de regresión. Esta vez sí queda con prueba: ver VUL-036 en la Sección 10 para el detalle completo y
    `test-xss.js` (29/29), que extrae y ejecuta los bloques reales del archivo con payloads de ataque.
  - Descripción: Uso de `innerHTML` con datos de usuario/externos sin sanitización
  - Severidad: ALTA
  - Vector confirmado (remoto, sin insider): factura PDF a `facturas@sisconcr.com` con proveedor `<img onerror=…>` → OCR → guardado → pintado en la lista de transacciones → ejecutaba en el navegador del admin.
  - Acción realizada: helper `esc()` (escapa `& < > " '`, seguro en texto y en atributos con comillas) + envueltos ~90 sinks de campos controlables por atacante en ~40 funciones de render: OCR/QB/Outlook (party, invoiceNumber, vendorName, consecutivo, desc de línea, nombre de documento) y datos de usuario cruzado (nombre de proyecto/cliente/tipo/casa, notas, proforma, responsable, cuadrilla, CRM, bitácora, usuarios). Helpers `fld()`/`ro()`/`crewDropHtml()` corregidos en origen. `<textarea>` incluidos (breakout de `</textarea>`).
  - Verificación: el `<script>` completo compila sin `SyntaxError` (`new Function`); `esc()` neutraliza payloads de tag/atributo/textarea; 0 doble-escape; 0 sinks de texto crudos de los campos clave.
  - Residual (defensa en profundidad, NO bloqueante): no se auditó cada uno de los 134 `innerHTML` individualmente (sí un barrido exhaustivo de los campos controlables conocidos); los `on*="fn(${id})"` usan ids internos (no texto libre); **CSP estricta (VUL-030) sigue pendiente** como backstop.
  - Dependencia: Integrado en VUL-010

- [x] **VUL-029** | API keys expuestas en el navegador
  - **Estado:** ✅ CERRADA (2026-07-24) — anon key + CDN de supabase-js removidos del frontend (código, desplegado)
  - Descripción: `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_KEY`, etc. pueden estar en el HTML
  - Severidad: MEDIA
  - Ubicación: `index.html` búsqueda de `_KEY`, `apiKey`, etc.
  - Riesgo: Terceros pueden usar las claves del usuario
  - Acción: Nunca exponer keys en frontend; todas via backend con `x-siscon-token` validado
  - Dependencia: VUL-005

- [x] **VUL-030** | Sin CSP (Content Security Policy) estricta
  - **Estado:** ✅ CERRADA (2026-07-24)
  - Descripción: No hay CSP header para prevenir inyección de scripts
  - Severidad: MEDIA
  - Acción realizada: header `Content-Security-Policy` agregado en backend (`server.js`) y en `vercel.json` del frontend. Política: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; upgrade-insecure-requests`. `unsafe-inline` en script/style es necesario por el HTML monolítico sin build step; el riesgo de XSS ya está mitigado por `esc()` (VUL-028) — CSP funciona como 2ª capa de defensa (bloquea `object-src`, `frame-ancestors`, fuentes/imágenes externas no declaradas).
  - De paso: `vercel.json` rewrite de `/api/*` corregido de `onrender.com` a `api.sisconcr.com` (para que las llamadas pasen por Cloudflare Access consistentemente).
  - Commits: backend `8d785b1`, frontend (`Siscon-web`) `9f37824`
  - Dependencia: VUL-028 (cerrada)

- [x] **VUL-031** | Falta security headers completos
  - **Estado:** ✅ CERRADA (2026-07-24) — security headers en backend y vercel.json (código, desplegado)
  - Descripción: No hay HSTS, X-Frame-Options, X-Content-Type-Options, etc.
  - Severidad: MEDIA
  - Ubicación: `siscon-backend/server.js` middleware de headers
  - Riesgo: Clickjacking, MIME sniffing, SSL stripping
  - Acción: Implementar todos los headers recomendados (helmet.js o manual)
  - Dependencia: VUL-030

---

### 11.2 Vulnerabilidades Corregidas (Por fecha)

#### Sesión 2026-07-24+ (FASE 5/12/3 — VUL-025/026/027 OAuth QB, VUL-030 CSP, VUL-012/013/019/024)
> Solo backend `siscon-backend` (commits `052cb85`, `8d785b1`, `27b8832`, `6f0cf2a`) y frontend `Siscon-web` (commit `9f37824`). Todo pusheado a `main` en ambos repos → Render/Vercel redespliegan automático.

- [x] **VUL-025 | OAuth `state` no aleatorio** ✅ CERRADA — `state` fijo `'siscon'` reemplazado por `crypto.randomBytes(32).toString('hex')`, validado one-time con TTL 10 min en `store.qboAuthPending`. Commit `052cb85`.
- [x] **VUL-026 | No valida `realmId` autorizado** ✅ CERRADA — `realmId` del callback se liga al `state` de esa autorización específica antes de intercambiar el token. Commit `052cb85`.
- [x] **VUL-027 | Sin PKCE en OAuth** ✅ CERRADA — `code_verifier`/`code_challenge` (S256) generados en `/api/qbo/connect`, validados por Intuit en el callback. Test unitario 6/6 PASS. Commit `052cb85`.
- [x] **VUL-030 | Sin CSP estricta** ✅ CERRADA — header `Content-Security-Policy` en backend y en `vercel.json` del frontend; de paso se corrigió el rewrite de `/api/*` de `onrender.com` a `api.sisconcr.com`. Commits: backend `8d785b1`, frontend `9f37824`.
- [x] **VUL-012 | Sin protección CSRF** ✅ CERRADA (mitigada por arquitectura) — CORS restringido + JWT en header (no cookie) + `SameSite` de Cloudflare. Documentado en código. Commit `27b8832`.
- [x] **VUL-013 | Sin reautenticación para acciones críticas** ✅ CERRADA (mitigada por MFA + auditoría) — conectada con VUL-024 para detección post-facto en DELETE usuario / cambio de rol. Commit `6f0cf2a`.
- [x] **VUL-024 | Sin alertas de anomalías** ✅ CERRADA (MVP) — `alertCriticalEvent()` loguea a stderr + `audit_log` con severity=CRITICAL en `USER_DELETED` y `USER_ROLE_CHANGED`. Webhook real a Slack/email queda como mejora futura. Commit `6f0cf2a`.
- [x] **VUL-019 | Backend expone API pública en Render** ✅ CERRADA — verificado en vivo: `GET /api/db/settings/1` sin JWT → 403; con JWT basura → 403; `/` y `/health` (públicos) → 200. El control real es el rechazo del backend, no ocultar el dominio.

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

- [x] **Bypass de origen (soporte de VUL-002/019/020) — validación REAL del JWT de Access** ✅ CERRADA
  - **Estado:** ✅ Cerrada y **desplegada 2026-07-24** (commit `cb7d3e0`, ahora en `main`). Verificada en vivo.
  - Descripción: el middleware de FASE 1 solo hacía `base64`-decode del payload **sin verificar la firma**;
    un `Cf-Access-Jwt-Assertion` forjado contra `onrender.com` era aceptado.
  - Acción: verificación RS256 contra el JWKS de Cloudflare + `iss` + `aud` (`cf-access.js` / `makeCfVerifier`);
    403 si inválido/ausente; fail-closed 500 si falta config. Pruebas 9/9 + verificación HTTP.
  - Turn-on requiere `CLOUDFLARE_ENABLED=true` + `CLOUDFLARE_TEAM` + `CLOUDFLARE_ACCESS_AUD` en Render, y la
    FASE 2 frontend (llamar a `api.sisconcr.com`).

> ⚠️ **REVERTIDO — cierres prematuros de FASE 2.** En una sesión previa se marcaron como "cerradas por
> diseño" VUL-004, 005, 007, 008, 009, 010, 011, 012 y 013 con los commits `4df7078`/`3e22f6e`. La revisión
> encontró que esa FASE 2 **no funcionaba**. Se **rehízo** correctamente (ver abajo).

#### Sesión 2026-07-24 (FASE 2 rehecha — ✅ DESPLEGADA en el cutover)
> Commits: backend `2ad5f77`, frontend `e1a7498`. Mergeado a `main` y verificado en vivo.

- [x] **VUL-004 | Token `local_` sin firma** — ✅ eliminado de `getSupabaseUser`; en prod la identidad viene del
  JWT de Access (`getCurrentUser`).
- [x] **VUL-005 | `SISCON_TOKEN` como secreto compartido** — ✅ `checkToken()` ya no exige el token cuando
  `CLOUDFLARE_ENABLED`; el gate es el JWT. (El header sigue en el frontend pero es inerte.)
- [x] **VUL-010 | Rol validado solo en frontend** — ✅ `validateAdminRole()` valida en servidor.
- [x] **VUL-007/008/009/011** — ✅ cerradas **por diseño con Access en vivo**: MFA de Microsoft Entra, cookie
  `CF_Authorization` HttpOnly/Secure/SameSite gestionada por Cloudflare, revocación central por allowlist.
- [x] **VUL-012 (CSRF) / VUL-013 (reauth para acciones críticas)** — ✅ cerradas **2026-07-24+** (ver sesión más
  reciente arriba en 11.2): CSRF mitigada por arquitectura (CORS + JWT en header, no cookie); reauth mitigada por
  MFA + auditoría/alertas (VUL-024).

#### Sesión 2026-07-24 (Cutover + FASE 3 — ✅ desplegado y verificado en vivo)
> Merge `security-hardening` → `main` en ambos repos. Frontend `81d0bcc`, backend `bec4120`. Probado en producción.

- [x] **Cutover a Cloudflare Access** ✅ — login por Access/MFA, JWT validado, dashboard y CRUD funcionando en prod.
  - **Plan B activado** (`USE_SAME_ORIGIN_API=true`): el frontend llama a `/api/*` en `app.sisconcr.com` → rewrite
    de Vercel → Render (el DNS cross-subdominio `app.→api.` no resolvía en el navegador).
  - `CLOUDFLARE_ACCESS_AUD` en Render ahora incluye **ambos** AUDs (app + api); el JWT llega con el AUD de `app`.
- [x] **VUL-018 | Auditoría** ✅ — `auditLog()` en INSERT/UPDATE/DELETE + `GET /api/audit-log` (Admin). Backend `2833d3b`.
- [x] **VUL-023 | Rate limiting** ✅ — 1000/15min por IP real sobre `/api/*`. Backend `2702378`.
- [x] **VUL-029 | anon key en el navegador** ✅ — removida del frontend (con el CDN de supabase-js). Frontend `4329303`.
- [x] **VUL-031 | Security headers** ✅ — backend + `vercel.json` (sin CSP aún). Backend `2833d3b`, frontend `0822067`.

#### Sesión 2026-07-24 (FASE 3 — VUL-016 cerrada; VUL-014/015 reclasificadas por arquitectura)
> Solo cambios en Supabase (SQL) + documentación. NO tocó código de backend/frontend. Verificado en vivo antes de actuar.
> Nota de higiene: al inicio, el checkout local de `siscon-backend` estaba 9 commits atrás de `origin/main` (código pre-hardening, sin `cf-access.js`); se corrigió con `git pull --ff-only` (fast-forward limpio) antes de trabajar. El repo `Siscon-web` ya estaba al día.

- [x] **VUL-016 | Deny-by-default en RLS** ✅ CERRADA — verificación en vivo: las 21 tablas de `public` con RLS `on` + **0 políticas**; `service_role`/`postgres` con `BYPASSRLS` (backend y SQL editor operan), `anon`/`authenticated` **sin** él → acceso directo con la anon key (incluida `settings`, que contiene todo el blob) devuelve vacío. Aplicado `ENABLE` + `FORCE ROW LEVEL SECURITY` idempotente en todas las tablas de `public`. (`FORCE` = belt-and-suspenders: no-op funcional hoy porque los dueños tienen `BYPASSRLS`, pero cierra VUL-016 literalmente y deja el flag consistente.) El deny-by-default real ya venía desde 2026-07-20.
- [~] **VUL-014 / VUL-015 | políticas por rol / `org_id`** ➖ **NO APLICAN POR ARQUITECTURA** (diferidas). Motivo: backend-as-guardian con `service_role` (ignora RLS) + frontend que nunca habla directo con Supabase (anon key eliminada, VUL-029) + un solo inquilino (una empresa, 4 usuarios que comparten TODOS los datos) + runtime sobre un único blob `settings/1` (las tablas normalizadas no están en la ruta de datos viva). Políticas por-rol/usuario y `org_id` no cerrarían amenaza activa y tocarían código Completado (factory CRUD, `/api/db/import`, `normalizeRecord`). Reactivar **solo** si se migra a cliente-directo contra Supabase o a multi-empresa.

#### Sesión 2026-07-24 (FASE 6 — VUL-028 XSS remediación dirigida)
> Solo frontend (`siscon-web/index.html`). Sin cambios de backend ni de datos. **Sin commit/deploy todavía.**

- [x] **VUL-028 | XSS almacenado por `innerHTML`** ✅ CERRADA (dirigida) — helper `esc()` (`& < > " '`) + ~90 sinks de datos controlables por atacante envueltos en ~40 funciones de render: vector remoto de OCR (party/invoiceNumber/vendorName/desc de línea) + datos de usuario cruzado (proyecto/cliente/tipo/casa/notas/proforma/responsable/cuadrilla/CRM/bitácora/usuarios); helpers `fld()`/`ro()`/`crewDropHtml()` corregidos en origen; `<textarea>` cubiertos. Verificado: compila sin SyntaxError, `esc()` neutraliza payloads, 0 doble-escape. **Residual:** CSP estricta (VUL-030) pendiente como defensa en profundidad; los `on*=` usan solo ids internos.

---

## 12. 🏗️ NUEVA ARQUITECTURA — Objetivo 4 días (2026-07-24 a 2026-07-27)

> ⚠️ **Actualización 2026-07-24+ (incidente en vivo, ver Sección 9 al final de esta fecha):** el diagrama y las
> referencias más abajo a `api.sisconcr.com` como destino del rewrite de Vercel **ya no reflejan lo desplegado**.
> `api.sisconcr.com` dejó de resolver (DNS roto, causa aún sin diagnosticar) y tumbó el login para todos.
> `vercel.json` ahora apunta el rewrite de `/api/*` **directo a `siscon-backend.onrender.com`**, decisión tomada
> con el OWNER como configuración estándar (no como parche temporal) — una dependencia de DNS menos. Todo lo que
> menciona `api.sisconcr.com` en esta sección describe la intención original de diseño, no el estado real actual.

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
| ~~Secretos históricos en Git (VUL-043)~~ | ~~ALTA~~ → **CERRADO** | ✅ Rotación ejecutada por el OWNER el 2026-07-26 (ver 12.12). Las copias en el historial quedaron inservibles al rotar los secretos |

### 12.12 Plan de rotación de secretos — ✅ EJECUTADO Y COMPLETADO (2026-07-26)

> **Estado: cerrado.** Los 5 puntos quedaron resueltos el 2026-07-26 (VUL-043). Se conserva el plan como
> registro de lo ejecutado y del razonamiento de cada decisión. Bitácora paso a paso en la Sección 9, sesión
> 2026-07-25/26.
>
> Los secretos que alguna vez estuvieron en Git o en el frontend se trataron como **comprometidos**. Claude no
> ejecuta estas acciones; las preparó y el OWNER las realizó. **Re-verificado contra el historial real de ambos
> repos el 2026-07-24+** (no repetido de memoria) — ver evidencia exacta abajo.
>
> Orden pensado para minimizar riesgo de romper algo: primero lo que no tiene impacto operativo, al final lo más
> delicado. Para las credenciales OAuth (Microsoft, Intuit) la secuencia importa: crear el secreto nuevo → ponerlo
> en Render → confirmar que sigue funcionando → **recién ahí** borrar el viejo. Invertir ese orden corta la
> integración hasta corregirlo.
>
> **Evidencia original de exposición** (verificada línea por línea contra el historial, no de memoria):
> - `siscon-backend`, `.env` y `.env.save`, commit `abadc64`: `ANTHROPIC_API_KEY` (real, 108 chars),
>   `SISCON_TOKEN` (real), y `MS_CLIENT_SECRET`/`MS_CLIENT_ID`/`MS_TENANT_ID` (reales, formato Azure — este trío
>   fue un hallazgo nuevo de esa re-verificación, no estaba en el plan anterior).
> - `siscon-web/index.html`, commits `5e8a9fb` (se agregó) / `4329303` (se quitó): anon key de Supabase, JWT
>   completo visible en el diff.
> - `SUPABASE_SERVICE_ROLE_KEY` (la llave que ignora RLS) **nunca apareció** en el historial de ningún repo.
> - Borrar los archivos no invalida las copias ya presentes en el historial — por eso la rotación era obligatoria.

1. **`SISCON_TOKEN`** ✅ **Rotado y confirmado (2026-07-25).** — riesgo cero. Hoy es inerte en producción:
   `checkToken()` nunca lo revisa porque `CLOUDFLARE_ENABLED=true` ya deja pasar antes de llegar a esa
   comprobación.

2. **`ANTHROPIC_API_KEY`** ✅ **Rotada y verificada en vivo (2026-07-26)** — bajo riesgo, ~1 minuto de pausa.
   Se encontró y corrigió de paso un bug real en `claudeCall()` que impedía probarla (ver Sección 9, sesión
   2026-07-25/26). Key vieja revocada en Anthropic tras confirmar que la nueva funciona.

3. **`MS_CLIENT_SECRET`** ✅ **Rotado y verificado en vivo (2026-07-26).** App correcta identificada
   comparando el `MS_CLIENT_ID` real del historial contra el dashboard: **`Siscon`**
   (`1abc2f0f-7043-49be-b458-185db33144ec`) — *no* `Cloudflare Access - Siscon`, que es el IdP del login y
   tocarle el secreto habría tumbado el acceso de todos. Secuencia respetada: secreto nuevo en Azure → Render →
   confirmar (`[ms] Tokens restored via bootstrap ✓` + "📥 Refrescar" sin error) → borrar el viejo.
   - **`MS_CLIENT_ID`/`MS_TENANT_ID`: NO se rotan.** Aunque salieron en el mismo commit, no son secretos (el
     client ID es un identificador público; el tenant ID es descubrible públicamente para cualquier dominio de
     M365) y sin el secreto no sirven. Rotarlos exigiría un App Registration nuevo desde cero, sin ganancia real.
   - **Verificado en el código, no supuesto:** los refresh tokens de Azure AD sobreviven a la rotación del client
     secret, por eso `msBootstrapIfNeeded()` siguió funcionando sin reconectar Outlook.

4. **`client_secret` de Intuit (QuickBooks)** ✅ **Descartado con evidencia (2026-07-26) — no requiere rotación.**
   Se buscó `QBO_CLIENT_SECRET` en el historial completo de `siscon-backend`: **no aparece en ningún commit**,
   solo la línea vacía de `.env.example`. Nunca estuvo expuesto. Decisión del OWNER: saltarlo.
   *(Si algún día se rota igual: mismo patrón que Microsoft, pero además hay que **reconectar QuickBooks desde
   Ajustes**, porque el refresh token de Intuit sí queda asociado al secreto viejo.)*

5. **Anon key de Supabase** ✅ **Revocada (2026-07-26), sin regenerar el JWT secret y sin desloguear a nadie.**
   - **El plan original de este punto quedó obsoleto:** asumía el esquema legacy (anon y `service_role` firmadas
     por el mismo JWT secret → revocar implicaba regenerarlo → tumbar sesiones y arriesgar la app). El proyecto
     ya tiene el **esquema nuevo de llaves** (`sb_publishable_...` / `sb_secret_...`), que permite revocar las
     legacy sin tocar el secreto de firma.
   - **Camino real ejecutado:** (1) `SUPABASE_SERVICE_ROLE_KEY` en Render cambió de valor a la llave nueva
     `sb_secret_...` — solo el valor, el nombre de la variable no cambia y **no hubo cambio de código**;
     (2) verificación en vivo; (3) **"Disable JWT-based API keys"**, que revoca de un golpe la anon key expuesta
     en Git y la service_role legacy.
   - **Por qué fue seguro (verificado antes de ejecutar):** la anon key ya no se usaba en ninguna parte (el
     frontend no la tiene desde VUL-029, el backend solo usa `SUPABASE_SERVICE_ROLE_KEY`); el único consumidor
     real es el backend en Render; y las sesiones se validan con `supabase.auth.getUser(token)` — llamada a la
     API de GoTrue, no verificación local contra el JWT secret.
   - **Verificación del privilegio crítico (`BYPASSRLS`), por cadena lógica:** un guardado exitoso prueba que la
     lectura previa funcionó, porque `loadDataFromAPI()` es quien fija `_settingsVersion` y sin él el guardado
     habría fallado con 428 `missing_version` (VUL-033). El guardado del OWNER pasó limpio → la llave nueva
     ignora RLS igual que la vieja, que es de lo que depende VUL-016.
   - ⚠️ **Verificación pendiente:** falta un ciclo completo **logout → login** tras deshabilitar las llaves
     legacy (una sesión ya abierta seguiría funcionando aunque `signInWithPassword` estuviera roto). Probar al
     inicio de la próxima sesión; si fallara, re-habilitar las llaves legacy desde esa misma pantalla.

- `SUPABASE_SERVICE_ROLE_KEY` (la llave que ignora RLS) **nunca apareció** en el historial de ninguno de los dos
  repos — verificado, no requirió rotación por este motivo.
- **No** reescribir el historial de Git de forma destructiva sin autorización explícita; la rotación era
  obligatoria precisamente porque borrar el archivo actual no invalida las copias anteriores en el historial.

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
