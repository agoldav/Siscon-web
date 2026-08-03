# Importar cotización (PDF/Excel) para crear un Tipo de Vivienda

## Contexto

Hoy existe un botón "📥 Importar desde Excel" en la lista de Tipos (`renderTypes`, fuera del
modal de Crear Tipo) que solo acepta Excel con columnas fijas (Categoría/Material/Cantidad/
Precio/Moneda) y construye un Tipo directo, sin match contra ningún catálogo de materiales
(siempre `matId:0, manualName:<texto del archivo>`) y sin paso de edición por línea (solo
edita 4 campos globales: nombre, área, utilidad, tipo de cambio).

El usuario quiere poder subir una **cotización** (PDF o Excel) con líneas de
Descripción/Cantidad/Total, que el sistema intente reconocer cada producto contra el catálogo
de materiales existente, y que pueda revisar/editar todo antes de guardar el Tipo.

## Decisiones de arquitectura (confirmadas con el usuario)

1. **No se escribe a ningún catálogo global.** `matsCatalog()` es QuickBooks Items de solo
   lectura cuando QB está conectado (regla dura de seguridad del proyecto, sin excepciones), o
   el arreglo `MATS` fijo en código cuando no lo está. Un producto de la cotización que no
   matchea con el catálogo **no se crea en ningún lado global** — simplemente se agrega como
   línea de presupuesto de este Tipo, con `matId:0` y `manualName:<descripción del documento>`,
   igual que cualquier línea manual hoy.
2. **El precio de la línea siempre viene del documento**, nunca del catálogo, aunque haya
   match. El match solo sirve para vincular `matId` (referencia/consistencia de nombre), no
   para sobrescribir costos.
3. **Este importador reemplaza** al botón "📥 Importar desde Excel" de la lista de Tipos. Ese
   botón, su input de archivo y el flujo `ctImportExcelPicker` / `ctImportExcelFile` /
   `ctParseExcelRows` (parte de detección) / `ctImportConfirm` se eliminan como entry point
   independiente; la lógica de parseo de Excel se reutiliza pero ahora se invoca solo desde
   dentro de "Crear Tipo".

## Diseño

### 1. Punto de entrada

En `renderCreateType()`, junto al título ("Crear Nuevo Tipo"), se agrega un botón
"📤 Importar" — visible solo cuando `!typeEditId` (creando un tipo nuevo, no editando uno
existente). Al hacer click abre un `<input type="file" accept=".pdf,.xlsx,.xls,.csv,image/*">`
oculto.

Se elimina de `renderTypes()`: el botón "📥 Importar desde Excel" y el input
`#ct-excel-input`.

### 2. Lectura del archivo

Función nueva `ctImportFile(file)` que decide por MIME/extensión:

- **PDF o imagen** → `ctImportOcr(file)`:
  - Lee el archivo a base64 (mismo patrón que `txnFile`/`ocrInvoice`).
  - Llama `claudeCall` con un `document`/`image` block + un prompt de extracción para
    cotizaciones: devuelve JSON `{"currency":"CRC|USD","lines":[{"desc":"...","qty":n,
    "total":n}]}`. (Se pide `total`, no precio unitario, porque así describió el usuario el
    formato del documento; el precio unitario se calcula como `total/qty` en el código, más
    robusto que confiar en que el OCR infiera el unitario.)
  - Si `currency==='CRC'`, convierte cada `total`/derivado a USD con `tgt.exchangeRate ||
    tcGet()` (mismo patrón que `ocrInvoice`).
  - Reusa `ocrShowProgress()` para el modal de progreso mientras se espera la respuesta.
  - Error de red/API → `alert(...)` (igual que `ocrInvoice`) y se abre el formulario vacío.

- **Excel/CSV** → reutiliza `ctParseExcelRows`, con dos ajustes:
  - Se agrega detección de columna **Total** (regex `/total|importe/`) además de la columna
    Precio unitario ya existente. Si se encuentra `Total` y no `Precio`, `price =
    total/qty`. Si existe `Precio`, se usa como hoy (comportamiento retrocompatible con
    archivos viejos).
  - Si no se detecta columna de Categoría (caso cotización simple), todas las líneas van a una
    única categoría por defecto `"Importado"` (editable después en el formulario).
  - Error de parseo / sin líneas reconocibles → mismo `alert(...)` que existe hoy.

### 3. Match contra catálogo de materiales

Función nueva `ctMatchCatalog(desc)`:
- Normaliza (`toLowerCase().trim()`, colapsa espacios).
- Busca en `matsCatalog()` (QB itemCache o `MATS`, lo que esté activo vía la función
  existente): 1) coincidencia exacta normalizada, 2) si no hay, primera coincidencia parcial
  (`catalogName.includes(desc)` o `desc.includes(catalogName)`).
- Devuelve el item del catálogo o `null`.

**Corrección tras revisar el código real:** las líneas de Tipo nunca guardan un `matId`
persistente de catálogo — `selectMatFromCatalog` (línea ~4301, el mismo selector que ya usa
el editor manual) siempre hace `l.matId=0; l.manualName=itemName` con el comentario explícito
"Always store as manualName so it works regardless of QB/local source". El importador sigue
exactamente ese mismo patrón, no uno nuevo:
- Si hay match: `matId:0, manualName:<nombre canónico del catálogo>` (no el texto crudo del
  documento — así la línea se ve y se busca igual que si el usuario la hubiera seleccionado a
  mano del catálogo).
- Si no hay match: `matId:0, manualName:<descripción tal cual vino del documento>`.
- En ambos casos, `price:<precio calculado del documento>` (regla #2 de arquitectura — el
  catálogo nunca sobrescribe el costo, ni en el match ni fuera de él).

### 4. Revisión y edición — reutiliza el formulario existente

En vez de una pantalla de revisión aparte: las líneas resultantes (de OCR o Excel) se cargan
directamente en el estado global `ctCategories` que ya usa el editor manual de "Crear Tipo"
(agregar/quitar categoría, agregar/quitar línea, buscador de material con autocompletado ya
existente vía `matsCatalog()`). También se pre-llenan los campos superiores del formulario
(`ctForm.name`, `ctForm.area`; para Excel además `ctForm.margen`/utilidad si el archivo trae
metadatos, para PDF quedan en 0 y el usuario los ajusta).

Después de cargar, se llama `renderCreateType()` (ya con `ctCategories` poblado) y se muestra
un toast: `"✓ N líneas importadas desde <archivo>. M coincidieron con el catálogo."` — así el
usuario sabe qué se detectó automáticamente y qué quedó como material nuevo, antes de revisar
y darle "Guardar Tipo" (botón que ya existe y no cambia).

### 5. Manejo de errores

- Falla de red/API de Claude (PDF): alerta + formulario de Crear Tipo vacío (no bloquea).
- Excel sin líneas reconocibles: mismo alert que hoy en `ctParseExcelRows`.
- Ningún cambio al guardado final: sigue usando la validación y el flujo de guardado actual de
  Tipos (sin tocar `saveType`/lógica de guardado).

## Fuera de alcance

- No se crea ni edita nada en QuickBooks ni en ningún catálogo global de materiales.
- No se construye un catálogo local nuevo de "materiales propios de Siscon" (se descartó en
  brainstorming).
- No se toca el importador desde el flujo de edición de un Tipo existente (`typeEditId` !=
  null) — solo aplica al crear un Tipo nuevo.
- No se cambia el matching cuando el usuario edita manualmente una línea después de importar
  (usa el mismo buscador con datalist que ya existe para líneas manuales).
