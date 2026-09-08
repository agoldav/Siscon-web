# Cadena de custodia de la compra y recuperación — Diseño

## Problema

La operación real hoy es:

1. El PM le pide a la asistente comprar materiales para las casas x, y, z del proyecto A.
2. La asistente revisa cantidades, monta la OC y la envía por Slack (un canal por proyecto).
3. El dueño paga por transferencia o pide que se pague con tarjeta.
4. Si fue transferencia, sube el comprobante al canal de Slack y a una carpeta mensual en
   iCloud, con el nombre `PROVEEDOR-MONTO-#OC-#PROFORMA-NOMBRE DEL PROYECTO`.
5. Cuando llega la factura, la asistente clasifica cada línea al proyecto que corresponde.

Seis problemas concretos, en palabras del dueño:

| | Problema |
|---|---|
| **A** | Después de pagar, no sabe si el proveedor efectivamente envió la factura. |
| **B** | No sabe si la asistente clasificó el material al proyecto correcto. |
| **C** | No hay forma de saber qué materiales de la factura van a cada casa. |
| **D** | El cliente pide por correo que se le facture un monto. |
| **E** | No sabe si ese monto recupera lo gastado desde la última facturación, si corresponde al precio de las casas facturadas, ni qué utilidad deja. |
| **F** | Los workflows existen en la app pero son manuales; la administradora se equivoca, se atrasa o no los hace. |

### Causa raíz

**Los modelos de datos ya existen y son correctos. Lo que no existe es un solo punto del
proceso donde el dato sea obligatorio.**

- La OC con casas asignadas: opcional. Hoy se crea de forma inconsistente.
- El avance de instalación por casa y m²: opcional. Igual de inconsistente.
- La clasificación de la factura por casa: opcional y manual.

Como cada eslabón puede faltar, ninguno sirve de base para automatizar nada. No es un problema
de features faltantes: es un problema de datos que a veces existen y a veces no.

### La palanca disponible

Todos los datos que faltan son **anteriores a un momento en que el dueño mueve plata**. Él paga
al proveedor y al subcontratista; nadie cobra sin pasar por él. El dato se puede volver
obligatorio sin depender de que nadie cambie de hábitos: el proveedor y el subcontratista
quieren cobrar, y ese incentivo sí es confiable.

## Principios de diseño

1. **El dinero no se mueve sin el dato.** El punto obligatorio se coloca en el pago, no en la
   buena voluntad de quien registra.
2. **La IA investiga, el código calcula.** El plan de corte y todo cálculo monetario son
   funciones puras deterministas, testeables con `node:test`. Claude solo se usa para normalizar
   nombres de productos, nunca para aritmética. (Mismo principio ya establecido en
   `ARQUITECTURA_Calculadora_Importacion.md`.)
3. **Reusar el motor financiero existente.** Ninguna fórmula de cálculo cambia:
   `hpMatBoughtData()`, `houseBilling()`, `projSpent()`, `getProjectRecoveryData()` y la
   Recuperación de Dinero quedan intactas. Se alimentan las estructuras que ya consumen. La
   única excepción es `vbApplyToHouses()`, que debe propagar los campos nuevos de bodega
   dimensionada al crear la entrada de inventario — es un cambio aditivo, no de lógica.
4. **Ambigüedad va a una bandeja, nunca a una suposición.** Lo que no se puede resolver con
   certeza se muestra como excepción con su evidencia, en vez de asignarse mal en silencio.

## Arquitectura general

La OC deja de ser un documento y pasa a ser **el contrato del que cuelga todo lo demás**:

```
OC (con plan de corte)  ──►  Pago (comprobante)  ──►  Factura del proveedor
        │                          │                        │
        │                          │                        └─► auto-match contra la OC
        │                          │                            → reparto por casa YA resuelto
        │                          └─► reloj: pagada sin factura = alerta
        └─► demanda por casa + plan de corte + destino del sobrante

Avance de instalación  ──►  Factura del cliente (QBO)  ──►  atribución por casa
        │                                                     → houseLines[]
        └─► candado: no se paga al subcontratista sin avance     → recuperación y utilidad
```

Se construye en tres fases independientes, cada una con su propio plan de implementación.

---

# Fase 0 — El candado del pago

> Resuelve **A**. Es la fase más barata: casi todo ya existe.

## Estados de la OC

La OC pasa a ser una máquina de estados con reloj:

| Estado | Significado | Transición |
|---|---|---|
| `Borrador` | En construcción | Manual |
| `Completa` | Tiene proveedor, casas asignadas, líneas contra presupuesto y monto | Automática al cumplir requisitos |
| `Pagada` | Con comprobante adjunto | Manual, desde "Listo para pagar" |
| `Facturada` | Llegó la factura y quedó ligada | Automática (Fase 1) o manual |
| `Conciliada` | Cuadra con QuickBooks | Automática vía `QB ↻` |

Los estados actuales (`Borrador/Enviada/Recibida/Facturada/Cancelada`) se mapean a los nuevos;
`Cancelada` se conserva como estado terminal fuera de la máquina.

## Pantalla "Listo para pagar"

Vista global (no por proyecto), en el menú lateral. Lista **solo OCs en estado `Completa`**,
agrupadas por proveedor, con monto, proyecto, casas y antigüedad.

Una OC incompleta **no aparece** — y ese es el candado. Lo que no está ahí, no se paga.

Cada fila permite: ver el PDF, marcar como pagada (abre el modal de comprobante) o devolver a
`Borrador` con un comentario que le llega a quien la creó.

## Registro del pago

Modal con: monto, fecha, método (Transferencia / Tarjeta / Caja Chica / Reembolso) y
**comprobante adjunto** (opcional para tarjeta, obligatorio para transferencia).

El adjunto va a R2 por el proxy del backend, igual que los documentos actuales.

**Parser del nombre del archivo.** La convención existente
`PROVEEDOR-MONTO-#OC-#PROFORMA-NOMBRE DEL PROYECTO` se parsea para prellenar el modal y
proponer la OC a la que corresponde. Si el nombre no calza con el patrón, el modal se llena a
mano — el parser es una conveniencia, nunca un requisito.

## Reloj y alertas

Una OC en `Pagada` sin factura ligada por más de `SYS.alertas.diasSinFactura` días (default 10)
genera:

- Entrada en 🔔 Notificaciones.
- Línea en el correo diario, agrupada por proveedor.

Este es exactamente el problema A, y hoy es irrespondible solo porque el pago no se registra en
ningún lado que la app pueda leer.

## Activación del digest existente

`sendPendingBillsDigest()` y `POST /internal/cron/pending-bills-digest` **ya están escritos y
desplegados** (backend `8b413e7`, frontend `c9d2295`). Están inertes por 5 pasos manuales
pendientes, que no requieren código:

1. Reconectar Outlook desde Ajustes (el `refresh_token` actual no tiene el scope `Mail.Send`).
2. Generar `INTERNAL_CRON_SECRET` con
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Cargarlo como variable de entorno en Render, servicio `siscon-backend`.
4. Crear un Render Cron Job con schedule `0 4 * * *` (UTC = 10pm en Costa Rica, sin DST) que
   haga `POST` al endpoint con el header `x-internal-secret`.
5. Agregar destinatarios en Ajustes → Correos.

El digest de esta fase **extiende** ese mismo correo con la sección de OCs pagadas sin factura;
no se construye un mecanismo nuevo.

---

# Fase 1 — Plan de corte y auto-matching

> Resuelve **B** y **C**. Es el grueso del trabajo y el único componente con algoritmo real.

## El problema del corte

El presupuesto de una casa pide 3 láminas de 8.70m. El proveedor solo vende láminas de 11.60m.
La factura llega por 3 láminas de 11.60m.

Hoy la asistente resuelve esto **al clasificar la factura**: por cada lámina declara que el 75%
va a la casa Y, el 25% a bodega, y que ese 75% equivale a 1 lámina de 8.70m del presupuesto.
Tres veces para la misma factura.

El problema no es que el sistema sea torpe: **está resolviendo al final un problema que
pertenece al principio**. La traducción entre "unidades de presupuesto" y "unidades de compra"
ocurre semanas después de la decisión, bajo backlog, hecha por quien no estuvo en la
conversación con el PM.

## Escaleras de corte

Las medidas comerciales no son una lista arbitraria: son **divisiones exactas de la lámina** en
cuartos o en tercios. Los nombres del catálogo están redondeados, pero la medida real es
`base × n/4` o `base × n/3`.

| Marca | Base | En cuartos (÷4) | En tercios (÷3) |
|---|---|---|---|
| Polyglas | 11.60 | 2.90 · 5.80 · 8.70 | 3.87 · 7.73 *(rotulados 3.86 y 7.70)* |
| Glanze, Polyforte, ByT | 11.80 | 2.95 · 5.90 · 8.85 | 3.93 · 7.87 *(rotulado 7.86)* |

**Las escaleras son configuración, no código.** Tabla editable en Ajustes, expresada como base
más divisores:

```js
SYS.cutLadders = [
  { id:'polyglas', marcas:['Polyglas'],                  base:11.60, divisores:[4,3] },
  { id:'glanze',   marcas:['Glanze','Polyforte','ByT'],  base:11.80, divisores:[4,3] }
]
```

Si aparece una marca nueva o un proveedor cambia una medida, se edita ahí; nadie toca código ni
espera un deploy.

### Aritmética en fracciones, no en metros

El motor **no trabaja en metros**: trabaja en fracciones de lámina, que es como el usuario ya
piensa el problema ("el 75% va a la casa Y y el 25% restante a bodega" es literalmente `3/4` y
`1/4`).

Con cuartos y tercios, el denominador común es 12. Una lámina son `12/12`, un cuarto `3/12`, un
tercio `4/12`. **Toda la aritmética es entera y exacta**: sin decimales, sin error de punto
flotante y sin tolerancias que calibrar.

De ahí cae sola la regla de que las dos escaleras no se mezclan:

```
9/12 + 3/12 = 12/12   exacto      (8.85 + 2.95)
8/12 + 4/12 = 12/12   exacto      (7.86 + 3.93)
9/12 + 4/12 = 13/12   no cabe
8/12 + 3/12 = 11/12   sobra 1/12 inservible
```

El motor no necesita una regla especial que le prohíba mezclar escaleras: los cortes mixtos
simplemente puntúan peor por el sobrante que dejan.

## Identificación de marca y largo

El catálogo autoritativo de productos es **QuickBooks** (`SYS.qbo.itemCache` vía `qboItems()`);
el array `MATS` es solo un fallback y la propia UI lo marca como "lista temporal".

El parser extrae `{marca, largoM, color}` del nombre del producto con un regex tolerante
(`Glanze 8.85m - Color - Humo`) y luego **traduce el largo a doceavos** buscando la fracción
`n/4` o `n/3` de la base de esa marca que quede a menos de 5 cm del valor leído. Es esa
traducción la que absorbe los redondeos comerciales (`3.86` → `4/12`, `7.70` → `8/12`).

Cuando un nombre no se puede parsear, o su largo no cae cerca de ninguna fracción válida, el
producto simplemente **no participa del plan de corte** y se comporta exactamente como hoy.

Los materiales sin dimensión (tornillos, silicón, perfiles, tape) nunca entran al plan de corte.

## El motor

Función pura, sin dependencias:

```
planCorte(demandas, escalera, existenciasBodega, opciones) → plan
```

- **Entrada:** demandas por casa (`[{projId, houseId, lineId, doceavos, qty}]`), la escalera de
  la marca, y las piezas disponibles en bodega del proyecto.
- **Salida:** cuántas unidades comprar, cómo se corta cada una, qué casa recibe cada pieza y
  qué sobrante queda.
- **Estrategia:** empaquetado *first-fit-decreasing* de piezas en láminas de capacidad `12`,
  consumiendo primero las piezas de bodega que quepan y prefiriendo los planes que dejan
  sobrante estándar (múltiplo de `3/12` o `4/12`) sobre los que dejan retazo inservible.
- **Aritmética entera.** Todas las cantidades son doceavos: sin decimales, sin acumulación de
  error. Determinista — las mismas entradas dan siempre el mismo plan, lo que la hace trivial
  de probar con `node:test`.

El plan es una **propuesta editable**, no una imposición: el corte depende del trabajo, así que
la UI permite ajustar el destino de cada pieza antes de guardar.

La demanda se agrega **a nivel de OC**, combinando todas las casas de esa orden. Ahí es donde
hoy se pierde material: comprando casa por casa, cada retazo se cae del mapa.

## Sobrantes y bodega dimensionada

Un corte dentro de la misma escalera produce un sobrante que **también es un producto del
catálogo** (`11.80 − 8.85 = 2.95`). Pero un corte a una medida de otra escalera produce una
pieza no estándar (`11.80 − 8.70 = 3.10`), que tiene valor real pero no existe en ningún
catálogo.

Por lo tanto **la bodega debe guardar piezas con largo**, no solo cantidades de un producto.
Entradas de `p.bodega[]` ganan:

```js
{ ...campos actuales,
  largoM: 3.10,          // largo de la pieza; null para materiales sin dimensión
  doceavos: null,        // 3 para una pieza de 2.95; null si no es fracción válida
  esEstandar: false,     // true si la pieza cae en la escalera de su marca
  marca: 'Glanze',
  origenOcId: 'oc-...'   // trazabilidad del corte que la produjo
}
```

El costo de cada pieza es proporcional a su largo: `precioUnidad × (largoM / base)`. De una
lámina de 11.80 que costó $156.40 se corta una pieza de 8.85 que vale $117.30 y un sobrante de
2.95 que vale $39.10; la suma cierra exacta contra el costo de la lámina. Comprando 3 láminas,
la casa recibe $351.90 y la bodega $117.30.

Una pieza de 3.10 en bodega puede satisfacer una demanda futura de 2.90 o 2.95. Los retazos
dejan de ser un cementerio y pasan a ser inventario que el plan de corte consulta.

## Sustitución de marca

Si el presupuesto pide **Polyglas 8.70** y se compra **Glanze 11.80**, físicamente se puede
cortar, pero es otro producto, otro precio y otra calidad.

- **Dentro de la misma marca:** automático, sin molestar a nadie.
- **Entre marcas:** requiere autorización del administrador vía `requestAuth()`, el mecanismo
  que ya existe. La solicitud muestra ambos productos con sus precios.
- **Al aprobarse:** la lámina se corta a la medida que pide el presupuesto (8.70), y el resto
  (3.10) va a bodega como **pieza no estándar más grande que el sobrante habitual**.

Hoy nada impide que alguien declare esa equivalencia por su cuenta.

## Modelo de datos de la OC

El plan vive en la OC, a nivel de orden (no de línea), porque agrega demanda de varias casas:

```js
oc.cutPlan = [
  { id, marca:'Glanze', color:'Humo',
    compra: { matId, name:'Glanze 11.80m - Color - Humo', largoM:11.80, qty:3, precioUSD:156.40 },
    cortes: [
      { unidad:1,
        piezas:  [{ doceavos:9, largoM:8.85, projId, houseId:'h-7', lineId:'l-33', qty:1 }],
        sobrante:{ doceavos:3, largoM:2.95, esEstandar:true, destino:'bodega', projId } }
      // … una entrada por unidad comprada
    ],
    sustitucionMarca: null   // o { desde:'Polyglas', hacia:'Glanze', authReqId }
  }
]
```

### Serialización al formato existente

**Restricción de diseño clave:** el plan debe poder serializarse exactamente al shape que
`vbOCConsolidatedLines()` ya produce, para que `vbLinkToOC()` lo consuma sin cambios.

`ocPlanToAssign(oc)` devuelve, por producto comprado, las filas de `assign`:

```js
{ houseId:'h-7', projId, qty:2.25,          // en unidades COMPRADAS (3 × 8.85/11.80)
  lineId:'l-33',                             // línea de presupuesto que satisface
  substitutesName:'Glanze 8.85m - Color - Humo',
  substitutesQty:3 }                         // en unidades PRESUPUESTADAS
```

Esta es exactamente la semántica que `hpMatBoughtData()` ya espera: `qty` en unidades compradas
para el gasto, `substitutesQty` como la equivalencia declarada para rebajar el disponible del
renglón presupuestado. **Cero cambios río abajo.**

### Etiqueta de origen

Una compra por corte se registra técnicamente como sustitución, lo que hoy la mostraría bajo
"Materiales No Presupuestados" — engañoso, porque sí está presupuestada, solo que en otro largo.
Se agrega `origen:'corte'` a la compra y la UI la etiqueta como **"corte de 11.80m"** en vez de
"no presupuestado". Es una distinción de presentación, no un camino de datos nuevo.

## La OC le habla al proveedor en su idioma

Con el plan guardado, el PDF de la OC sale en **unidades de compra** (3 × Glanze 11.80m) en vez
de unidades de presupuesto (3 × 8.85m, que nadie vende). Se acaba el desfase entre la OC que
sale y la proforma que vuelve.

## Auto-matching factura ↔ OC

Cuando entra una factura (Outlook OCR, QBO o manual) se busca su OC por:

1. `linkedOcId` explícito, si existe.
2. Número de proforma normalizado + proveedor.
3. Proveedor + monto + moneda dentro de una ventana de fechas.

**Match fuerte** (proforma coincidente, o proveedor + monto exacto con una sola OC candidata) →
se aplica `vbLinkToOC()` automáticamente y el reparto por casa sale del plan de corte.

**Ambiguo** (dos OCs candidatas con igual evidencia, monto que no cuadra, proveedor distinto) →
**bandeja de excepciones**, que muestra la factura, las OCs candidatas y *por qué* no se pudo
decidir. Nunca se elige por defecto.

La lógica de "evidencia fuerte vs. ambiguo" ya existe y está probada para Outlook↔QBO
(`test-qbo-bill-matching.js`, 16/16). Se extiende, no se reinventa.

Con la OC hablando en unidades de compra, el match deja de ser difuso: 3 × 11.80 en la factura
**es igual** a 3 × 11.80 en la OC.

## Cambio en el rol de la asistente

Deja de "clasificar facturas" y pasa a **resolver excepciones**: un trabajo mucho más chico,
acotado y verificable. El caso normal no la toca.

---

# Fase 2 — Atribución de facturas de cliente

> Resuelve **D** y **E**.

## Cómo se factura hoy

La factura al cliente **se emite en QuickBooks**, no en Siscon, con **una sola línea de
instalación** que cubre todas las casas trabajadas esa semana. Siscon la importa después desde
QBO Projects. Por eso `inv.houseLines[]` queda vacío para facturas reales, `houseBilling()`
devuelve 0 y no hay forma de saber a qué casas corresponde el monto.

## Derivar las casas desde los avances

La Calculadora de Avances de Subcontratistas ya guarda `SYS.subAdvanceRecords[]` con `date` y,
adentro, `state.sections[].lines[] = {projId, houseId, area, subId}`. **La app ya sabe qué casas
se trabajaron, cuántos m² y cuándo** — que es exactamente lo que cubre la línea de instalación.

El algoritmo:

1. **Período** = desde la fecha de la factura anterior de ese proyecto hasta la fecha de esta.
   Es literalmente el "entre la última facturación y esta" del problema E.
2. **Avances del período** → casas y m² de cada una.
3. **Reparto** del monto de la factura proporcional al valor de venta del avance de cada casa
   (`m² × precio de venta por m² del tipo`).
4. **Escritura** como `houseLines[] = {houseId, pct, prevPct}`, el shape que la app ya usa.

A partir de ahí `houseBilling()`, `ciSyncHouseStatuses()` y la Recuperación de Dinero se
encienden solos, sin lógica nueva.

El reparto se muestra como **propuesta editable** antes de confirmarse.

## Panel de recuperación del período

Al abrir una factura de cliente importada:

- Gasto del proyecto en el período, desglosado por casa.
- Lo que se debería facturar para recuperar ese gasto más la utilidad presupuestada
  (`gastado × salePrice/budget`, la fórmula que `getProjectRecoveryData()` ya usa).
- Si el monto facturado **cubre o no** ese objetivo, y por cuánto.
- Utilidad de esta factura y acumulada del proyecto.
- Cómo queda el % facturado de cada casa involucrada.

## Candado del subcontratista

Los avances son tan inconsistentes como las OCs, así que la atribución no se sostiene sin el
mismo principio: **no se le paga al subcontratista sin avance registrado por casa**. El avance
aprobado es el requisito para que aparezca en la pantalla de pagos.

## Casos sin avance registrado

Si una factura de cliente cae en un período sin avances registrados, **no se inventa un
reparto**: la factura queda marcada como "sin atribuir", visible en el panel del proyecto y en
el digest, hasta que alguien registre el avance o asigne las casas a mano.

---

# Modelo de datos — resumen de cambios

| Objeto | Campo nuevo | Propósito |
|---|---|---|
| `SYS.cutLadders[]` | *(nuevo)* | Base y divisores de corte por marca, editables |
| `SYS.alertas.diasSinFactura` | *(nuevo)* | Umbral de la alerta de OC pagada sin factura |
| `oc.status` | valores nuevos | Máquina de estados con reloj |
| `oc.cutPlan[]` | *(nuevo)* | Plan de corte de la orden |
| `oc.pago` | *(nuevo)* | `{monto, fecha, metodo, comprobanteKey}` |
| `p.bodega[]` | `largoM`, `doceavos`, `esEstandar`, `marca`, `origenOcId` | Piezas dimensionadas |
| `h.purchases[]` | `origen:'corte'` | Etiqueta de presentación |
| `inv.houseLines[]` | *(se puebla)* | Atribución derivada de avances |

Todos los campos son aditivos. Los registros existentes sin ellos siguen funcionando: `oc.cutPlan`
ausente = comportamiento actual, `largoM` ausente = material sin dimensión.

# Casos borde

- **Producto que no se puede parsear.** No entra al plan de corte; flujo actual intacto.
- **Factura por más unidades que la OC.** La OC es la expectativa, la factura es la realidad. Se
  liga igual y la app pregunta solo por el delta, no por la factura entera.
- **Factura que abarca varias OCs.** Va a la bandeja de excepciones; no se reparte automáticamente.
- **OC sin plan de corte** (solo materiales sin dimensión). Funciona como hoy.
- **Pago urgente sin OC.** No existe: quedó definido que toda compra debe tener OC y que una
  factura sin OC es una excepción a corregir, no un caso válido.
- **Sobrante no estándar sin uso.** Queda en bodega con su largo; el plan de corte lo ofrece
  cuando aparezca una demanda que quepa.
- **Cambio de base o divisores en Ajustes.** No recalcula planes ya guardados; aplica a OCs nuevas.

# Fuera de alcance

- Integración con Slack en cualquier dirección. Decisión explícita: todo dentro de la app,
  notificaciones por 🔔 y correo. Slack queda para conversación humana.
- Escritura hacia QuickBooks más allá de la OC como Purchase Order, que ya existe.
- Optimización global de corte a nivel de proyecto o entre proyectos. El plan se calcula por OC.
- Historial de movimientos de bodega por producto (diferido previamente por el usuario).
- Migración de OCs históricas al nuevo modelo de estados.

# Riesgos

1. **El candado depende de que el dueño lo sostenga.** Si se paga por fuera de "Listo para
   pagar", la cadena se rompe igual que hoy. Es un riesgo de proceso, no de código.
2. **El plan de corte es la pieza cara.** Es el único componente con algoritmo real. Si hay que
   recortar alcance, se defiende solo porque reduce desperdicio de material, no solo trabajo
   administrativo.
3. **Nombres de producto escritos por humanos en QuickBooks.** El parser será tolerante, pero
   habrá nombres que no calcen. Mitigación: no participan del plan de corte y se comportan como
   hoy; nunca se adivina.
4. **Los nombres del catálogo están redondeados.** QuickBooks dice `3.86m` donde la medida real
   es `11.60/3 = 3.8667`, y `7.70m` donde es `7.7333`. El parser no puede comparar el número
   literalmente: tiene que mapear la etiqueta a la fracción más cercana de la base de su marca
   (dentro de un margen de ±5 cm) y trabajar con la fracción. Un nombre que no caiga cerca de
   ningún `n/4` ni `n/3` no participa del plan de corte.

# Orden de construcción

| Fase | Alcance | Resuelve | Costo |
|---|---|---|---|
| **0** | Activar digest + candado del pago | A | Días; casi todo existe |
| **1** | Plan de corte + auto-matching | B, C | El grueso |
| **2** | Atribución de facturas de cliente | D, E | Media |
| *Después* | Bodega alimenta el plan de corte | Desperdicio | Baja, alto valor |

Cada fase recibe su propio plan de implementación. Empezar por la Fase 0 da una respuesta real
en una semana y permite verificar que el candado se sostiene en la operación **antes** de
invertir en el plan de corte.
