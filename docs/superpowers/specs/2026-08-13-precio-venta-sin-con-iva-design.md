# Toggle "ver con IVA" para el Precio de Venta (tarjetas de tipo + barra superior)

## Contexto

El frontend es un solo archivo (`index.html`), renderizado por concatenación de strings.
Hay dos lugares donde se muestra el "Precio de Venta" de forma prominente:

- **Tarjetas de tipo** (`renderTypes()`, ~línea 4433): cada tarjeta tiene una grilla con
  Área / Presupuesto / Precio Venta / % Utilidad, usando `t.salePrice` directamente
  ([index.html:4457](../../../index.html)).
- **Barra de información general del proyecto** (`renderMetric()`, ~línea 4288, pinta
  `#mgrid`): campo editable "Precio de Venta" con `p.salePrice`
  ([index.html:4312](../../../index.html)).

`t.salePrice` (por tipo) y `p.salePrice` (agregado del proyecto, suma de los tipos de sus
casas) **no llevan ningún flag que indique si el 13% de IVA quedó incluido al guardarse**. El
formulario de crear/editar tipo (`renderCreateType()`, checkbox local `ctIVA`) sí permite
incluir el IVA en el cálculo al momento de guardar, pero `ctIVA` **siempre se reinicia a
`false`** cada vez que se abre el formulario (`openCreateType()`, línea 4481) — nunca se
persiste en el objeto `type`. En la práctica, la convención implícita de la app es que el
valor guardado es la base sin impuesto.

El patrón de "ver con/sin IVA" ya existe en otra parte de la app: `calcState.ivaShow`
(calculadora de avances de subcontratistas, ~línea 11762) es un booleano no persistido que,
al activarse, multiplica los totales mostrados por 1.13 para la vista de factura. Este mismo
patrón es el que se replica aquí.

## Decisión de diseño

- **Un solo estado global**, no persistido: `let showIVAPrices = false;`, declarado junto a
  las demás variables de estado transitorio de UI (cerca de `ctIVA`/`showCreate`). Se
  reinicia a `false` en cada carga de la app — no se guarda en `localStorage` ni en `SYS`.
- **Un solo checkbox**, ubicado en la barra superior de información del proyecto (dentro de
  `renderMetric()`, junto al campo "Precio de Venta"). Etiqueta: "Ver con IVA (13%)".
- El checkbox controla **ambas vistas** a la vez: al cambiar, se llama `renderMetric()` y,
  si la pestaña activa es "tipos", también `renderTypes()`.
- **Cálculo:** el valor guardado (`p.salePrice`, `t.salePrice`) se sigue tratando siempre
  como la base "sin IVA". Cuando `showIVAPrices` es `true`, el valor mostrado (solo en
  pantalla, nunca se escribe al modelo) es `salePrice * 1.13`. Cuando es `false`, se muestra
  el valor tal cual está guardado hoy (sin cambio de comportamiento).
- **Alcance:** únicamente el campo "Precio de Venta" en esos dos lugares exactos.
  "Presupuesto", "% Utilidad" y cualquier otro monto (facturas, OC, garantías, que ya
  tienen su propio manejo de IVA por línea) no se tocan.
- **Fuera de alcance:** no se agrega ningún flag `ivaOn` a los objetos `type`/`project` para
  registrar si el IVA quedó incluido al crearse — es un gap real del modelo de datos, pero
  no bloquea esta mejora (que es puramente de visualización) y se deja para otra sesión si
  hace falta.

## UI

En `renderMetric()`, junto al `efld('Precio de Venta', ...)` actual: un `<label>` con
checkbox, mismo patrón visual que el checkbox "IVA" de `renderCreateType()` (línea 4565),
p.ej.:

```html
<label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--t2);cursor:pointer">
  <input type="checkbox" ${showIVAPrices?'checked':''} onchange="showIVAPrices=this.checked;renderMetric();if(curTab==='tipos')renderTypes();" style="width:auto"/>
  Ver con IVA (13%)
</label>
```

- El valor mostrado de "Precio de Venta" en la barra superior sigue siendo editable
  (`efld`) cuando el proyecto no está bloqueado; al estar en modo "con IVA" se edita el
  monto con IVA incluido y se recalcula hacia atrás la base al guardar (dividiendo entre
  1.13), igual que hace `updateCtFromSalePrice()` en el formulario de tipo. Si esto agrega
  complejidad innecesaria, alternativa más simple: cuando `showIVAPrices` está activo, el
  campo se muestra como solo lectura (no editable) para evitar ambigüedad de qué se está
  editando — **se opta por esta alternativa más simple** para no introducir un flujo de
  edición nuevo fuera del alcance pedido.
- En las tarjetas de tipo, el tile "Precio Venta" pasa de `fmt(t.salePrice)` a
  `fmt(showIVAPrices ? t.salePrice*1.13 : t.salePrice)`.

## Testing

Verificación manual en navegador (no hay suite de tests automatizados para el frontend):
1. Abrir un proyecto con al menos un tipo con `salePrice > 0`.
2. Confirmar que por defecto (checkbox sin marcar) ambos lugares muestran el mismo número
   que hoy en producción.
3. Marcar el checkbox → confirmar que ambos lugares (barra superior y tarjetas de tipo, si
   se navega a esa pestaña) muestran el valor × 1.13, formateado igual que el resto de la
   app (`fmt()`).
4. Recargar la página → confirmar que el checkbox vuelve a estar sin marcar (no persiste).
5. Confirmar que "Presupuesto" y "% Utilidad" no cambian con el toggle.
