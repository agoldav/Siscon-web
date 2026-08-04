# Tooltip interactivo, click-a-proyecto y zoom en gráficas del Dashboard

## Contexto

Las gráficas de la app son SVG dibujado a mano (sin librería), generadas por un puñado de
funciones reutilizables: `svgBars`, `svgDonut`, `svgLine` (definidas junto a `chartGrid`,
~línea 9371) y `svgChart1`/`svgNetBars` (específicas del Dashboard, ~línea 11866). Hay dos
familias de uso:

- **Gráficas del Dashboard** (`renderDashStats`, dentro de la sección "Información General y
  Estadísticas" que se ve antes de entrar a un proyecto): cada barra representa **un proyecto**.
  Son 4: "Valor de Venta por Proyecto" (`svgChart1`), "Proyección de Flujo de Efectivo"
  (`svgNetBars`), "Gastos No Facturados" (`svgBars`) y "Facturas Pendientes de Pago` (`svgBars`).
- **Gráficas internas de un proyecto** (`infoCharts(p)`, pestaña Información General de un
  proyecto ya abierto): cada barra/segmento representa una categoría de presupuesto, un estado
  de casa, o una serie temporal — nunca otro proyecto.

Además, la tarjeta "Recuperación de Dinero" del Dashboard (`globalRecoveryCardHtml`) no es un
SVG — es una tabla HTML con una fila de detalle por proyecto (visible al expandir "Ver detalle
por proyecto").

El usuario pidió 3 mejoras, confirmadas en conversación:

1. Las filas de proyecto en el detalle de "Recuperación de Dinero" deben llevar a la página del
   proyecto al hacer click.
2. Todas las gráficas de la app deben mostrar, al hacer hover sobre una barra, un tooltip
   flotante con el número exacto (no abreviado), grande y legible, que **sigue al cursor**. El
   click debe llevar a la página del proyecto **solo** en las barras que efectivamente
   representan un proyecto — las 4 gráficas del Dashboard. En las gráficas internas de un
   proyecto (categorías, casas, etc.) solo aplica el tooltip; el click no hace nada nuevo.
3. La tarjeta "Valor de Venta por Proyecto" (y solo esa) lleva un slider de zoom. En 1x (valor
   por defecto) se ve exactamente igual que hoy. Al subir el zoom, la gráfica crece en altura y
   en tamaño de barra/letra; si el ancho resultante no cabe en la tarjeta, aparece scroll
   horizontal dentro de esa tarjeta (no se afecta el resto de la página ni las otras tarjetas).

Navegación a un proyecto: función ya existente `openProj(id)` (línea 3705), la misma que usan
las tarjetas Kanban y las filas de la vista Lista del Dashboard.

## Decisiones de diseño

### 1. Tooltip flotante compartido, reutilizable en toda gráfica

Un único componente, no uno por función de gráfica:

- Una `<div id="chart-tip">` creada una sola vez (lazy, la primera vez que se necesita) y
  agregada a `document.body`. CSS: `position:fixed`, fondo/borde con las variables de tema
  (`--bg1`/`--border`/`--t1`), texto ~15-16px, `pointer-events:none` (para que nunca bloquee el
  mouse ni interfiera con el hover de la barra), `z-index` alto, oculta por defecto.
- Tres funciones globales nuevas:
  - `chartTipShow(e)`: lee `data-label`/`data-value` de `e.currentTarget`, arma el texto
    (`label` + valor formateado con `fmt()` — número exacto, no `fmtShort()`), posiciona la
    `div` cerca del cursor (con offset para no quedar tapada por el puntero) y la muestra.
  - `chartTipMove(e)`: reposiciona la `div` en cada `mousemove` mientras el mouse sigue sobre la
    marca (clamp a los bordes del viewport para que nunca se salga de pantalla).
  - `chartTipHide()`: la oculta al salir del hover (`mouseleave`).
- Cada marca visual (rect de barra, círculo de `svgDonut`, punto de `svgLine`) gana:
  `data-label="${esc(label)}"` (via el helper `esc()` ya existente, seguro para atributos),
  `data-value="${value}"`, y los tres handlers (`onmouseenter="chartTipShow(event)"`,
  `onmousemove="chartTipMove(event)"`, `onmouseleave="chartTipHide()"`).
- Se usan `data-*` + `dataset` en vez de pasar el label como argumento literal del handler
  inline, para no arrastrar problemas de escape de comillas si un nombre de proyecto/categoría
  trae apóstrofes o comillas.

### 2. Click a proyecto — solo donde la barra es un proyecto

Se aprovecha el mismo mecanismo de datos: si el item que arma la barra trae un campo `id` (el
id del proyecto), la marca gana además `data-projid="${id}"`, `style="cursor:pointer"` y
`onclick="openProj(${id})"`. Si el item no trae `id`, no se agrega nada de esto — la barra
sigue teniendo tooltip pero no reacciona al click. Esto evita cualquier parámetro nuevo tipo
"modo dashboard sí/no": la presencia de `id` en el item ya distingue los dos casos.

Cambios de datos (no de función) para que el `id` llegue a donde corresponde, todos dentro de
`renderDashStats`:
- `items` (para `svgChart1`, línea ~11915): agregar `id:p.id` a cada objeto.
- `cashRaw` (para `svgNetBars`, línea ~11918): agregar `id:p.id`.
- `unbItems` (para `svgBars`, línea ~11921): agregar `id:p.id`.
- `pendPayItems` (para `svgBars`, línea ~11925): agregar `id:p.id`.

Las llamadas a `svgBars`/`svgDonut`/`svgLine` dentro de `infoCharts(p)` (gráficas internas de
un proyecto) no se tocan — sus items no tienen `id` de proyecto, así que naturalmente no ganan
click, solo tooltip.

### 3. Recuperación de Dinero — filas de detalle clickeables

En `globalRecoveryCardHtml`, la fila `<tr>` del detalle por proyecto (línea ~11803) gana
`onclick="openProj(${p.id})"`, `style="cursor:pointer"` y el mismo patrón de hover que ya usan
las filas de la vista Lista del Dashboard (`onmouseover`/`onmouseout` cambiando
`background:var(--bg3)`). Esto no es parte del sistema de tooltip — es una tabla HTML, no un
SVG — así que no lleva `data-value`/tooltip, solo navegación.

### 4. Slider de zoom en "Valor de Venta por Proyecto"

- Nuevo campo en `dstats()` (línea ~11902): `zoomVenta:1` en el objeto default.
- Control `<input type="range" min="1" max="2.5" step="0.25">` en el header de esa tarjeta
  (junto a los otros controles de esa gráfica), con
  `oninput="statsSet('zoomVenta',this.value)"` — reutiliza el `statsSet`/`updateStats()` que ya
  existe para los demás filtros de esta sección (sin plomería nueva).
- `svgChart1(items, showG, showP, zoom)` gana un cuarto parámetro (`zoom`, default `1`). Con
  `zoom>1`: `H`, `groupW`, el ancho de cada rect (hoy fijo en 36) y el `font-size` de las
  etiquetas se multiplican por `zoom`; `W` sale de la misma fórmula que hoy pero con el
  `groupW` ya escalado.
- Envoltorio de salida: en vez de `width="100%" style="max-width:${W}px;height:auto"` fijo
  siempre, se decide según `zoom`:
  - `zoom<=1` (o sin tocar el slider): exactamente el render de hoy — sin cambios visuales.
  - `zoom>1`: el SVG se renderiza a tamaño real en píxeles (`width="${W}" height="${H}"`, sin
    `%`), envuelto en un `<div style="overflow-x:auto">` — así, si `W` no cabe en el ancho de la
    tarjeta, aparece scroll horizontal solo ahí; el resto de la página no se mueve.

## Fuera de alcance

- No se toca ninguna otra tarjeta de la sección de Estadísticas (Flujo de Caja, Gastos No
  Facturados, Facturas Pendientes) con el slider de zoom — solo ganan tooltip + click, según lo
  descrito arriba.
- No se agrega tooltip ni click a la barra de progreso resumen de "Recuperación de Dinero"
  (`recoveryBarHtml`, la barra verde/ámbar de arriba) — el pedido del usuario fue sobre las
  **filas del detalle por proyecto**, no sobre esa barra agregada global.
- No se cambia la fórmula de datos de ninguna gráfica (montos, porcentajes, filtros) — solo
  interacción (tooltip/click/zoom).

## Verificación

El frontend de producción exige login contra Supabase Auth vía el backend; no hay manera de
levantar la app real sin credenciales de un usuario. Para verificar visualmente el
comportamiento (tooltip siguiendo el cursor, click, zoom + scroll) sin tocar producción ni
necesitar login, se arma un harness HTML standalone en el scratchpad que carga las funciones de
gráficas modificadas con datos de proyecto de prueba (mock), y se prueba interactivamente en el
Browser pane. Además, `node --check` sobre el JS extraído de `index.html` después de cada
cambio, igual que en la sesión anterior.
