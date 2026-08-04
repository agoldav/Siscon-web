# Zoom en tiempo real + slider en las 3 gráficas restantes + eje Y con referencias

## Contexto

Sesión anterior (`2026-08-03-charts-tooltip-click-zoom-design.md`) agregó tooltip a todas las
gráficas, click-a-proyecto en las 4 gráficas del Dashboard, y un slider de zoom (1x-2.5x, con
scroll horizontal si no cabe) **solo** en "Valor de Venta por Proyecto" (`svgChart1`), persistido
en `SYS.stats.zoomVenta` vía `statsSet()` (que guarda + re-renderiza toda la sección con
`onchange`, a propósito, para no destruir el slider a medio arrastre con `oninput`).

El usuario pide, sobre esa base:
1. El mismo slider de zoom en las otras 3 gráficas del Dashboard: "Proyección de Flujo de
   Efectivo" (`svgNetBars`), "Gastos No Facturados" y "Facturas Pendientes de Pago" (ambas
   `svgBars`).
2. Que el zoom sea **en tiempo real** — la gráfica crece/encoge mientras se arrastra el slider,
   no solo al soltarlo.
3. Números de referencia a la izquierda de la gráfica, alineados con las líneas horizontales
   (un eje Y).

Confirmado con el usuario: las 3 mejoras aplican **solo a las 4 gráficas del Dashboard**
(Valor de Venta, Flujo de Efectivo, Gastos No Facturados, Facturas Pendientes de Pago) — las
gráficas internas de un proyecto ya abierto (presupuesto por categoría, estado de casas, etc.,
que reutilizan `svgBars`/`svgDonut`/`svgLine` vía `infoCharts(p)`) quedan exactamente igual que
hoy.

## Decisiones de diseño

### 1. Zoom en tiempo real sin romper el arrastre del slider

Se separa "vista previa en vivo" de "guardar":
- Cada una de las 4 gráficas se envuelve en un `<div>` con id fijo y predecible
  (`chart-body-venta`, `chart-body-cash`, `chart-body-unb`, `chart-body-pend`).
- Cada slider gana **dos** handlers:
  - `oninput="chartZoomLive('venta',this.value)"` — dispara en cada tick del arrastre. Reescribe
    **solo** el `innerHTML` de su propio contenedor con el tamaño nuevo, usando datos ya
    calculados en el último render completo (cacheados en una variable de módulo
    `_statsChartData`, para no recalcular `items`/`cashRaw`/`unbItems`/`pendPayItems` en cada
    tick). No guarda ni toca el resto del DOM — el slider nunca se destruye a medio arrastre.
  - `onchange="statsSet('zoomVenta',this.value)"` — dispara una sola vez, al soltar. Es el mismo
    mecanismo que ya existía: persiste en `SYS.stats` y re-renderiza toda la sección
    (`updateStats()`), que de paso refresca `_statsChartData` con el estado ya persistido.
- `chartZoomLive` también actualiza `dstats().zoomXxx` en memoria (sin `saveData()`) para que el
  valor quede consistente si el usuario interactúa con otro control antes de soltar el slider.

### 2. Slider en las 3 gráficas restantes

- `SYS.stats` gana 3 campos nuevos: `zoomCash`, `zoomUnb`, `zoomPend` (default `1`, con
  migración para instalaciones existentes — mismo patrón que `zoomVenta`).
- `svgNetBars(items, zoom)` gana el parámetro `zoom` (antes no lo tenía) con la misma mecánica
  ya usada en `svgChart1`: a `zoom<=1` se ve igual que hoy; a `zoom>1` crece proporcional y pasa
  a scroll horizontal. Como `svgNetBars` solo se usa en el Dashboard, no hace falta ningún flag
  de compatibilidad.
- `svgBars(items, zoom, showAxis)` gana **dos** parámetros nuevos, ambos opcionales y
  retrocompatibles: sin pasarlos (como hacen hoy todas las llamadas de `infoCharts(p)`, las
  gráficas internas de un proyecto), el resultado es **matemáticamente idéntico** al actual — se
  verifica en la Tarea 1 del plan. Los 2 usos de `svgBars` en el Dashboard (Gastos No
  Facturados, Facturas Pendientes de Pago) pasan `zoom` y `showAxis:true` explícitamente.

### 3. Eje Y con números de referencia (izquierda)

Se agrega un helper compartido `chartYAxis(vals, padLeft, W, zoom)` que recibe pares ya
calculados `{y, val}` (cada gráfica calcula sus propios pares porque cada una tiene su propia
fórmula de escala valor→píxel) y dibuja la línea horizontal + el número (`fmtShort()`, igual
formato abreviado que ya usan las etiquetas sobre cada barra — el valor exacto sigue disponible
en el tooltip al hacer hover) alineado a la izquierda de esa línea.

- `svgChart1` y `svgNetBars` lo usan siempre (su único llamador ya es una de las 4 gráficas del
  Dashboard) — reemplaza la llamada actual a `chartGrid(...)`.
- `svgBars` lo usa **solo si `showAxis` es `true`** — si no, sigue usando `chartGrid(...)` como
  hoy, así las gráficas internas de un proyecto no cambian.
- Los pares `{y,val}` se calculan con la **misma fórmula que ya usa cada gráfica para posicionar
  las barras** (no con la fórmula genérica y aproximada de `chartGrid`), así las líneas quedan
  alineadas exactamente con la escala real: 4 referencias `0, max/3, 2·max/3, max` para
  `svgChart1`/`svgBars`; 5 referencias `−max, −max/2, 0, max/2, max` para `svgNetBars` (gráfica
  con valores negativos, centrada en cero).
- Esto requiere reservar espacio a la izquierda (`padLeft`) que hoy no existe — se agrega solo
  cuando hay eje (siempre en `svgChart1`/`svgNetBars`; condicional a `showAxis` en `svgBars`), y
  se descuenta del punto donde arrancan las barras.

## Fuera de alcance

- No se toca `svgDonut` ni `svgLine` (no forman parte de las 4 gráficas del Dashboard).
- No se agrega slider ni eje Y a las gráficas internas de un proyecto (`infoCharts(p)`).
- No cambia ninguna fórmula de datos — solo tamaño/interacción/presentación.

## Verificación

Mismo método que la sesión anterior: abrir `index.html` sin login (el `<script>` completo se
ejecuta igual), reasignar la variable global `projects` (identificador suelto, **no**
`window.projects` — confirmado en la sesión anterior que son bindings distintos), llamar
`renderDashStats()` real con datos de prueba, e interactuar con `computer`/`javascript_tool`
(disparar `input`/`change` sintéticos sobre cada slider, leer `innerHTML` del contenedor
correspondiente y las coordenadas de las líneas/etiquetas del eje). `node --check` sobre el JS
extraído después de cada tarea.
