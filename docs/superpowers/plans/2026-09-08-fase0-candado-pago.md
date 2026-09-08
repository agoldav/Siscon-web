# Fase 0 — Candado del pago · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una OC no se pueda pagar si está incompleta, que el pago quede registrado con su
comprobante dentro de la app, y que una OC pagada sin factura del proveedor genere alerta.

**Architecture:** Todo vive en `siscon-web/index.html` (un solo archivo, sin build step) más una
extensión del digest diario en `siscon-backend/server.js`. La completitud de la OC es una
**función pura derivada**, no un estado nuevo almacenado — así no colisiona con el `status`
existente (`Borrador/Enviada/Recibida/Facturada/Cancelada`), que ya se usa para el ciclo de
QuickBooks. El pago se guarda en `oc.pago`, y el comprobante reutiliza el pipeline de adjuntos a
R2 que ya usa Documentos (`curProj.uploads[]` + `_pendingDocFiles` + `saveData()`).

**Tech Stack:** HTML/CSS/JS vanilla (sin frameworks, sin bundler) · Node ≥18 + Express en el
backend · Supabase (tabla `transactions`, `kind='oc'`) · Cloudflare R2 vía proxy del backend ·
Microsoft Graph (`Mail.Send`) para el correo · pruebas con scripts `node` planos.

## Global Constraints

- **Un solo archivo de frontend.** Todo el código nuevo va en `siscon-web/index.html`. Sin
  dependencias externas, sin build step, sin frameworks.
- **Prefijo de módulo `oc*`** para toda función nueva de este plan, según la convención de
  prefijos por módulo del repo.
- **Render por strings:** `el.innerHTML = \`...\`` con template literals. Escapar SIEMPRE el
  texto de usuario con `esc()`.
- **Moneda base USD.** Formatear con `fmt()` (`$1,234.56`); fechas con `fmtDate()` (dd/mm/aaaa).
- **Las funciones puras no tocan globals.** Reciben `projects` / `SYS` por parámetro para que las
  pruebas las puedan ejecutar en un sandbox de `vm` sin cargar la app.
- **Pruebas:** scripts `node` planos, sin dependencias. Se corren con `node test-<nombre>.js` y
  terminan con `process.exit(fail ? 1 : 0)`.
- **Deploy:** commit + push a `main` dispara auto-deploy de Vercel (frontend) y Render (backend).
  **Este plan NO hace push ni merge a `main`** — todo queda en la rama
  `feature/cadena-custodia-compra`.
- **Verificación de sintaxis obligatoria** después de cada cambio en `index.html`:
  extraer el `<script>` principal y correr `node --check`. Un error de sintaxis rompe la app
  entera en producción, porque no hay build step que lo atrape.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `siscon-web/index.html` | Funciones puras (`ocIsComplete`, `parseComprobanteName`, selectores), modal de pago, ventana "Listo para pagar", alerta al login, defaults de `SYS` |
| `siscon-web/test-oc-candado-pago.js` | **Nuevo.** Pruebas de las funciones puras + assertions de cableado sobre el HTML |
| `siscon-backend/server.js` | `buildPaidOcsDigestRows()` (pura) + `sendPaidOcsNoInvoiceDigest()` (I/O) + llamada desde el cron existente |
| `siscon-backend/test-paid-ocs-digest.js` | **Nuevo.** Pruebas de la función pura del digest |
| `PROJECT_CONTEXT.md` | Entrada de sesión + guía de los 5 pasos manuales de activación |

---

### Task 1: `ocIsComplete()` — completitud derivada de la OC

**Files:**
- Modify: `siscon-web/index.html` (sección `// ========== OC HELPERS ==========`, ~línea 7540)
- Modify: `siscon-web/index.html` (default de `SYS`, ~línea 985, junto a `emailAutomations`)
- Test: `siscon-web/test-oc-candado-pago.js` (crear)

**Interfaces:**
- Consumes: nada.
- Produces: `ocIsComplete(oc) → boolean`. Lo usan las Tasks 3, 4 y 5.
  `SYS.alertas = { diasSinFactura: 10 }`, usado por la Task 3.

**Nota de diseño:** una OC está *completa* cuando se puede pagar sin ambigüedad: tiene proveedor,
tiene destino (casas o bodega), toda línea con cantidad tiene a qué renglón de presupuesto
imputarse (o autorización si es extra), y tiene monto. No es un `status` nuevo: se calcula.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `siscon-web/test-oc-candado-pago.js`:

```js
// ============================================================
//  Fase 0 — Candado del pago. Corre:  node test-oc-candado-pago.js
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`No se encontró ${name}`);
  const brace = html.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name, extra !== undefined ? '→ ' + extra : ''); }
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(['ocIsComplete'].map(extractFunction).join('\n'), sandbox);

// OC mínima válida: proveedor, una casa, una línea imputada al presupuesto, monto.
const ocOk = {
  status: 'Borrador', vendorName: 'Polycenter', totalUSD: 883.11,
  houseIds: ['h-7'], bodegaMode: false, bodegaLines: [],
  lines: { 'h-7': [{ lineId: 'l-33', qty: 3, price: 156.4, isExtra: false }] },
};

console.log('\nocIsComplete:');
ok('OC completa con casa, línea presupuestada y monto', sandbox.ocIsComplete(ocOk) === true);
ok('sin proveedor no está completa',
  sandbox.ocIsComplete({ ...ocOk, vendorName: '' }) === false);
ok('proveedor solo con espacios no cuenta',
  sandbox.ocIsComplete({ ...ocOk, vendorName: '   ' }) === false);
ok('sin casas ni bodega no está completa',
  sandbox.ocIsComplete({ ...ocOk, houseIds: [], bodegaLines: [] }) === false);
ok('monto en cero no está completa',
  sandbox.ocIsComplete({ ...ocOk, totalUSD: 0 }) === false);
ok('línea con cantidad pero sin lineId no está completa',
  sandbox.ocIsComplete({ ...ocOk, lines: { 'h-7': [{ lineId: '', qty: 3 }] } }) === false);
ok('línea extra sin autorización no está completa',
  sandbox.ocIsComplete({ ...ocOk, lines: { 'h-7': [{ lineId: 'x', qty: 3, isExtra: true, authorizedBy: '' }] } }) === false);
ok('línea extra autorizada sí completa',
  sandbox.ocIsComplete({ ...ocOk, lines: { 'h-7': [{ lineId: 'x', qty: 3, isExtra: true, authorizedBy: 'Abraham' }] } }) === true);
ok('línea en cero se ignora y no invalida',
  sandbox.ocIsComplete({ ...ocOk, lines: { 'h-7': [{ lineId: 'l-33', qty: 3 }, { lineId: '', qty: 0 }] } }) === true);
ok('OC solo de bodega con línea válida está completa',
  sandbox.ocIsComplete({ ...ocOk, houseIds: [], bodegaMode: true,
    lines: {}, bodegaLines: [{ name: 'Tornillo', qty: 100, price: 0.05 }] }) === true);
ok('OC sin ninguna línea con cantidad no está completa',
  sandbox.ocIsComplete({ ...ocOk, lines: { 'h-7': [{ lineId: 'l-33', qty: 0 }] } }) === false);
ok('OC cancelada nunca está completa',
  sandbox.ocIsComplete({ ...ocOk, status: 'Cancelada' }) === false);
ok('null / undefined no revientan',
  sandbox.ocIsComplete(null) === false && sandbox.ocIsComplete(undefined) === false);

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
cd siscon-web && node test-oc-candado-pago.js
```

Esperado: `Error: No se encontró ocIsComplete`.

- [ ] **Step 3: Implementar `ocIsComplete()`**

En `index.html`, dentro de `// ========== OC HELPERS ==========`, agregar:

```js
// Fase 0 — una OC está "completa" (lista para pagar) cuando se puede pagar sin ambigüedad.
// NO es un status nuevo: se deriva. El status existente (Borrador/Enviada/...) sigue reflejando
// el ciclo de QuickBooks y no se toca.
function ocIsComplete(oc){
  if(!oc) return false;
  if(oc.status==='Cancelada') return false;
  if(!String(oc.vendorName||'').trim()) return false;
  if(!(Number(oc.totalUSD)>0)) return false;
  const houseIds=Array.isArray(oc.houseIds)?oc.houseIds:[];
  const bodegaLines=(Array.isArray(oc.bodegaLines)?oc.bodegaLines:[]).filter(l=>(Number(l.qty)||0)>0);
  if(!houseIds.length && !bodegaLines.length) return false;
  let anyLine=bodegaLines.length>0;
  for(const hid of houseIds){
    const lines=(oc.lines&&oc.lines[hid])||[];
    for(const l of lines){
      if((Number(l.qty)||0)<=0) continue;   // línea en cero: no bloquea
      anyLine=true;
      if(l.isExtra){ if(!String(l.authorizedBy||'').trim()) return false; }
      else if(l.lineId==null||l.lineId==='') return false;
    }
  }
  return anyLine;
}
```

En el default de `SYS` (junto a `emailAutomations`, ~línea 985), agregar:

```js
  // Fase 0 — umbral de la alerta "OC pagada sin factura del proveedor".
  alertas: { diasSinFactura: 10 },
```

Y en la migración de campos faltantes (junto a `if(!SYS.emailAutomations)SYS.emailAutomations={};`,
~línea 2786), agregar:

```js
  if(!SYS.alertas)SYS.alertas={};
  if(!(Number(SYS.alertas.diasSinFactura)>0))SYS.alertas.diasSinFactura=10;
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

```bash
cd siscon-web && node test-oc-candado-pago.js
```

Esperado: `13 pruebas OK, 0 fallas`.

- [ ] **Step 5: Verificar sintaxis del archivo completo**

```bash
cd siscon-web && node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];fs.writeFileSync('/tmp/siscon-check.js',m.map(x=>x[1]).join('\n;\n'));" && node --check /tmp/siscon-check.js && echo "SINTAXIS OK"
```

Esperado: `SINTAXIS OK`.

- [ ] **Step 6: Commit**

```bash
git add index.html test-oc-candado-pago.js
git commit -m "Fase 0: ocIsComplete() — completitud derivada de la OC + SYS.alertas"
```

---

### Task 2: `parseComprobanteName()` — parser del nombre del comprobante

**Files:**
- Modify: `siscon-web/index.html` (junto a `ocIsComplete`, en OC HELPERS)
- Test: `siscon-web/test-oc-candado-pago.js` (extender)

**Interfaces:**
- Consumes: nada.
- Produces: `parseComprobanteName(fileName) → {proveedor, montoUSD, ocNum, proforma, proyecto} | null`.
  Lo usa la Task 4 para prellenar el modal de pago.

**Nota de diseño:** el usuario ya nombra sus comprobantes
`PROVEEDOR-MONTO-#OC-#PROFORMA-NOMBRE DEL PROYECTO`. El parser es **una conveniencia, nunca un
requisito**: si el nombre no calza, devuelve `null` y el modal se llena a mano. Nunca lanza.

El número de OC contiene guiones (`OC-2026-014`), así que no se puede hacer un `split('-')`
ingenuo del medio: se toma el primer token como proveedor, el segundo como monto, el último como
proyecto, y sobre lo que queda en el medio se busca el patrón de OC con regex.

- [ ] **Step 1: Escribir la prueba que falla**

En `test-oc-candado-pago.js`, cambiar la línea de extracción a:

```js
vm.runInContext(['ocIsComplete', 'parseComprobanteName'].map(extractFunction).join('\n'), sandbox);
```

y agregar antes del resumen final:

```js
console.log('\nparseComprobanteName:');
const p1 = sandbox.parseComprobanteName('Polycenter-883.11-OC-2026-014-PRO 5567-116 Este.pdf');
ok('proveedor', p1 && p1.proveedor === 'Polycenter', p1 && p1.proveedor);
ok('monto', p1 && p1.montoUSD === 883.11, p1 && p1.montoUSD);
ok('número de OC reconstruido', p1 && p1.ocNum === 'OC-2026-014', p1 && p1.ocNum);
ok('proforma', p1 && p1.proforma === 'PRO 5567', p1 && p1.proforma);
ok('proyecto', p1 && p1.proyecto === '116 Este', p1 && p1.proyecto);

const p2 = sandbox.parseComprobanteName('Extralum-1,250.00-OC-2026-7-4821-Dor.jpg');
ok('monto con separador de miles', p2 && p2.montoUSD === 1250, p2 && p2.montoUSD);
ok('consecutivo de OC de un dígito se rellena a 3', p2 && p2.ocNum === 'OC-2026-007', p2 && p2.ocNum);

ok('nombre sin suficientes partes devuelve null',
  sandbox.parseComprobanteName('comprobante.pdf') === null);
ok('nombre vacío devuelve null', sandbox.parseComprobanteName('') === null);
ok('null no revienta', sandbox.parseComprobanteName(null) === null);
ok('sin OC en el nombre igual devuelve el resto',
  (() => { const r = sandbox.parseComprobanteName('Ferretería X-45.00-sin ref-Proyecto Z.pdf');
           return r && r.ocNum === '' && r.proveedor === 'Ferretería X' && r.proyecto === 'Proyecto Z'; })());
ok('monto no numérico queda en null',
  (() => { const r = sandbox.parseComprobanteName('Prov-abc-OC-2026-001-x-Proy.pdf');
           return r && r.montoUSD === null; })());
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
cd siscon-web && node test-oc-candado-pago.js
```

Esperado: `Error: No se encontró parseComprobanteName`.

- [ ] **Step 3: Implementar `parseComprobanteName()`**

```js
// Fase 0 — lee la convención de nombre que el usuario ya usa para los comprobantes:
//   PROVEEDOR-MONTO-#OC-#PROFORMA-NOMBRE DEL PROYECTO
// Conveniencia para prellenar el modal de pago. Nunca lanza; si no calza, devuelve null.
function parseComprobanteName(fileName){
  const base=String(fileName==null?'':fileName).replace(/\.[A-Za-z0-9]{1,5}$/,'').trim();
  if(!base) return null;
  const parts=base.split('-').map(s=>s.trim()).filter(s=>s!=='');
  if(parts.length<3) return null;
  const monto=parseFloat(String(parts[1]).replace(/,/g,'').replace(/[^\d.]/g,''));
  const medio=parts.slice(2,-1).join('-');
  const ocM=medio.match(/OC-?(\d{4})-?(\d{1,4})/i);
  const ocNum=ocM?('OC-'+ocM[1]+'-'+String(ocM[2]).padStart(3,'0')):'';
  const proforma=medio.replace(/OC-?\d{4}-?\d{1,4}/i,'').replace(/^[-\s]+|[-\s]+$/g,'').trim();
  return {
    proveedor: parts[0],
    montoUSD: Number.isFinite(monto)?monto:null,
    ocNum,
    proforma,
    proyecto: parts[parts.length-1],
  };
}
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

```bash
cd siscon-web && node test-oc-candado-pago.js
```

Esperado: `25 pruebas OK, 0 fallas`.

- [ ] **Step 5: Commit**

```bash
git add index.html test-oc-candado-pago.js
git commit -m "Fase 0: parseComprobanteName() — prellenado del modal desde el nombre del archivo"
```

---

### Task 3: Selectores globales de OCs

**Files:**
- Modify: `siscon-web/index.html` (junto a las anteriores, en OC HELPERS)
- Test: `siscon-web/test-oc-candado-pago.js` (extender)

**Interfaces:**
- Consumes: `ocIsComplete(oc)` (Task 1).
- Produces:
  - `ocsListasParaPagar(projectList) → [{proj, oc}]`
  - `ocDiasSinFactura(oc, hoyISO) → number | null`
  - `ocsPagadasSinFactura(projectList, umbralDias, hoyISO) → [{proj, oc, dias}]`

  Las usan las Tasks 5 (pantalla) y 6 (alerta). Reciben `projectList` y `hoyISO` por parámetro
  — sin globals — para poder probarlas en sandbox.

**Nota de diseño:** "pagada sin factura" = tiene `oc.pago` y su `status` **no** es `Facturada`.
`saveVendorBill()` ya pone `oc.status='Facturada'` cuando una factura se liga a la OC
(`index.html:14457`), así que no hace falta consultar `billVendor`: el estado ya lo dice.

- [ ] **Step 1: Escribir la prueba que falla**

Cambiar la extracción a:

```js
vm.runInContext(['ocIsComplete', 'parseComprobanteName', 'ocsListasParaPagar',
  'ocDiasSinFactura', 'ocsPagadasSinFactura'].map(extractFunction).join('\n'), sandbox);
```

y agregar:

```js
console.log('\nSelectores:');
const mkOc = extra => ({ id: 'oc-1', num: 'OC-2026-014', status: 'Borrador', vendorName: 'Polycenter',
  totalUSD: 100, houseIds: ['h-1'], bodegaLines: [],
  lines: { 'h-1': [{ lineId: 'l-1', qty: 1 }] }, ...extra });

const projs = [
  { id: 1, name: 'A', ocs: [mkOc({ id: 'oc-a' }), mkOc({ id: 'oc-b', vendorName: '' })] },
  { id: 2, name: 'B', ocs: [mkOc({ id: 'oc-c', pago: { fecha: '2026-09-01' } })] },
  { id: 3, name: 'C' },   // sin arreglo ocs
];

const listas = sandbox.ocsListasParaPagar(projs);
ok('solo lista OCs completas y sin pago', listas.length === 1 && listas[0].oc.id === 'oc-a',
  listas.map(x => x.oc.id).join(','));
ok('incluye el proyecto dueño', listas[0].proj.name === 'A');
ok('proyecto sin ocs no revienta', Array.isArray(sandbox.ocsListasParaPagar(projs)));
ok('lista vacía con entrada vacía', sandbox.ocsListasParaPagar([]).length === 0);

ok('días desde el pago', sandbox.ocDiasSinFactura({ pago: { fecha: '2026-09-01' } }, '2026-09-11') === 10);
ok('OC sin pago devuelve null', sandbox.ocDiasSinFactura({}, '2026-09-11') === null);
ok('OC ya facturada devuelve null',
  sandbox.ocDiasSinFactura({ status: 'Facturada', pago: { fecha: '2026-09-01' } }, '2026-09-11') === null);

const alertas = sandbox.ocsPagadasSinFactura(projs, 10, '2026-09-11');
ok('alerta cuando pasa el umbral', alertas.length === 1 && alertas[0].oc.id === 'oc-c');
ok('reporta los días', alertas[0].dias === 10);
ok('no alerta antes del umbral', sandbox.ocsPagadasSinFactura(projs, 10, '2026-09-05').length === 0);
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
cd siscon-web && node test-oc-candado-pago.js
```

Esperado: `Error: No se encontró ocsListasParaPagar`.

- [ ] **Step 3: Implementar los tres selectores**

```js
// Fase 0 — OCs completas que todavía no tienen pago registrado: son las únicas pagables.
function ocsListasParaPagar(projectList){
  const out=[];
  (Array.isArray(projectList)?projectList:[]).forEach(proj=>{
    (Array.isArray(proj&&proj.ocs)?proj.ocs:[]).forEach(oc=>{
      if(oc&&!oc.pago&&ocIsComplete(oc)) out.push({proj,oc});
    });
  });
  return out;
}
// Días transcurridos desde el pago sin que llegue la factura del proveedor.
// null = no aplica (sin pago, o la factura ya llegó y saveVendorBill puso status='Facturada').
function ocDiasSinFactura(oc,hoyISO){
  if(!oc||!oc.pago||!oc.pago.fecha) return null;
  if(oc.status==='Facturada') return null;
  const pagado=new Date(oc.pago.fecha+'T00:00:00');
  const hoy=new Date(String(hoyISO||new Date().toISOString().slice(0,10))+'T00:00:00');
  if(isNaN(pagado)||isNaN(hoy)) return null;
  return Math.floor((hoy-pagado)/864e5);
}
function ocsPagadasSinFactura(projectList,umbralDias,hoyISO){
  const umbral=Number(umbralDias)>0?Number(umbralDias):10;
  const out=[];
  (Array.isArray(projectList)?projectList:[]).forEach(proj=>{
    (Array.isArray(proj&&proj.ocs)?proj.ocs:[]).forEach(oc=>{
      const dias=ocDiasSinFactura(oc,hoyISO);
      if(dias!=null&&dias>=umbral) out.push({proj,oc,dias});
    });
  });
  return out.sort((a,b)=>b.dias-a.dias);
}
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

```bash
cd siscon-web && node test-oc-candado-pago.js
```

Esperado: `35 pruebas OK, 0 fallas`.

- [ ] **Step 5: Commit**

```bash
git add index.html test-oc-candado-pago.js
git commit -m "Fase 0: selectores de OCs listas para pagar y pagadas sin factura"
```

---

### Task 4: Modal de registro de pago con comprobante

**Files:**
- Modify: `siscon-web/index.html` (después de los selectores, en OC HELPERS)
- Test: `siscon-web/test-oc-candado-pago.js` (extender con assertions de cableado)

**Interfaces:**
- Consumes: `ocIsComplete()` (Task 1), `parseComprobanteName()` (Task 2).
- Produces:
  - `ocOpenPagoModal(projId, ocId)` — abre el modal.
  - `ocPagoFilePicked(input)` — lee el archivo elegido y prellena desde el nombre.
  - `ocConfirmPago()` — valida, escribe `oc.pago` y encola el comprobante para R2.
  - Escribe `oc.pago = {montoUSD, fecha, metodo, blobId, comprobanteName, registradoPor, registradoAt}`.

  Lo usa la Task 5 (botón "Registrar pago" de cada fila).

**⚠️ Trampa conocida — multiproyecto.** El modal se abre desde una ventana **global**, así que la
OC puede pertenecer a un proyecto distinto de `curProj`. El comprobante debe empujarse a
`proj.uploads` del **proyecto dueño de la OC**, nunca a `curProj.uploads`. Este repo ya tuvo ese
bug exacto en la sesión 2026-08-07 (`vbApplyToHouses` tocaba solo `curProj`).

- [ ] **Step 1: Escribir la prueba que falla**

Agregar al final de `test-oc-candado-pago.js`, antes del resumen:

```js
console.log('\nCableado del modal de pago:');
ok('existe ocOpenPagoModal', /function ocOpenPagoModal\(/.test(html));
ok('existe ocConfirmPago', /function ocConfirmPago\(/.test(html));
ok('el modal prellena desde el nombre del archivo',
  /function ocPagoFilePicked[\s\S]{0,900}parseComprobanteName\(/.test(html));
ok('el comprobante va al proyecto dueño de la OC, no a curProj',
  /function ocConfirmPago[\s\S]{0,2600}proj\.uploads/.test(html) &&
  !/function ocConfirmPago[\s\S]{0,2600}curProj\.uploads/.test(html));
ok('transferencia exige comprobante',
  /function ocConfirmPago[\s\S]{0,2000}Transferencia[\s\S]{0,400}alert\(/.test(html));
ok('el comprobante se encola para subir a R2',
  /function ocConfirmPago[\s\S]{0,2600}_pendingDocFiles\.set\(/.test(html));
ok('el pago queda registrado con autor y fecha',
  /registradoPor:/.test(html) && /registradoAt:/.test(html));
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
cd siscon-web && node test-oc-candado-pago.js
```

Esperado: 7 fallas nuevas (`✗ FALLA: existe ocOpenPagoModal`, etc.).

- [ ] **Step 3: Implementar el modal**

```js
// Fase 0 — registro del pago de una OC. Se abre desde la ventana global "Listo para pagar",
// así que SIEMPRE trabaja sobre el proyecto dueño de la OC, nunca sobre curProj.
let _ocPagoCtx=null;   // {proj, oc, file}
function ocOpenPagoModal(projId,ocId){
  const proj=projects.find(p=>String(p.id)===String(projId));
  const oc=proj&&(proj.ocs||[]).find(o=>String(o.id)===String(ocId));
  if(!proj||!oc){ alert('No se encontró la orden de compra.'); return; }
  if(!ocIsComplete(oc)){ alert('Esta OC está incompleta y no se puede pagar.'); return; }
  _ocPagoCtx={proj,oc,file:null};
  const hoy=new Date().toISOString().slice(0,10);
  document.getElementById('modal-inner').innerHTML=`
    <div class="modal-title">Registrar pago — ${esc(oc.num||'OC')}
      <button onclick="closeModal()" style="background:transparent;border:none;color:var(--t3);font-size:18px;cursor:pointer">✕</button>
    </div>
    <div style="font-size:12px;color:var(--t2);margin-bottom:12px">
      ${esc(oc.vendorName||'—')} · ${esc(proj.name)} · ${fmt(oc.totalUSD||0)}
    </div>
    <div class="ff-row">
      <div class="ff"><label>Monto pagado (USD)</label>
        <input id="oc-pago-monto" type="number" step="0.01" min="0" value="${Number(oc.totalUSD||0).toFixed(2)}"/></div>
      <div class="ff"><label>Fecha de pago</label>
        <input id="oc-pago-fecha" type="date" value="${hoy}"/></div>
    </div>
    <div class="ff"><label>Método de pago</label>
      <span class="ivasel" style="display:block"><select id="oc-pago-metodo" onchange="ocPagoRenderHint()">
        <option>Transferencia</option><option>Tarjeta</option>
        <option>Caja Chica</option><option>Reembolso</option>
      </select></span>
    </div>
    <div class="ff"><label>Comprobante</label>
      <button class="btn-sm" onclick="document.getElementById('oc-pago-file').click()">📎 Elegir archivo</button>
      <input id="oc-pago-file" type="file" accept="application/pdf,image/*" style="display:none" onchange="ocPagoFilePicked(this)"/>
      <div id="oc-pago-fname" style="font-size:11px;color:var(--t3);margin-top:5px">Ninguno seleccionado</div>
      <div id="oc-pago-hint" style="font-size:10px;color:var(--amb);margin-top:3px"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      <button class="btn-save" onclick="ocConfirmPago()">Registrar pago</button>
    </div>`;
  ocPagoRenderHint();
  document.getElementById('modal').classList.remove('hidden');
}
function ocPagoRenderHint(){
  const el=document.getElementById('oc-pago-hint'); if(!el)return;
  const metodo=(document.getElementById('oc-pago-metodo')||{}).value||'';
  el.textContent=metodo==='Transferencia'?'El comprobante es obligatorio para transferencias.':'';
}
// Prellena monto y fecha desde la convención PROVEEDOR-MONTO-#OC-#PROFORMA-PROYECTO.
function ocPagoFilePicked(input){
  const f=input&&input.files&&input.files[0]; if(!f||!_ocPagoCtx)return;
  _ocPagoCtx.file=f;
  const el=document.getElementById('oc-pago-fname'); if(el)el.textContent=f.name;
  const parsed=parseComprobanteName(f.name);
  if(parsed&&parsed.montoUSD!=null){
    const inp=document.getElementById('oc-pago-monto');
    if(inp)inp.value=parsed.montoUSD.toFixed(2);
  }
}
function ocConfirmPago(){
  if(!_ocPagoCtx)return;
  const {proj,oc,file}=_ocPagoCtx;
  const montoUSD=parseFloat((document.getElementById('oc-pago-monto')||{}).value)||0;
  const fecha=(document.getElementById('oc-pago-fecha')||{}).value||new Date().toISOString().slice(0,10);
  const metodo=(document.getElementById('oc-pago-metodo')||{}).value||'Transferencia';
  if(!(montoUSD>0)){ alert('Ingresa un monto mayor a 0.'); return; }
  if(metodo==='Transferencia'&&!file){ alert('Adjunta el comprobante de la transferencia.'); return; }
  let blobId='';
  if(file){
    blobId='blob_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    docBlobMap[blobId]=URL.createObjectURL(file);
    if(!proj.uploads)proj.uploads=[];
    proj.uploads.push({
      id:'up-'+Date.now()+'_'+Math.random().toString(36).slice(2),
      name:file.name, type:(file.name.split('.').pop()||'PDF').toUpperCase(),
      category:'Comprobante de Pago', date:fecha,
      size:(file.size/1024).toFixed(0)+' KB', blobId, url:docBlobMap[blobId],
      notes:'Pago de '+(oc.num||'OC'),
    });
    _pendingDocFiles.set(blobId,file);
  }
  oc.pago={ montoUSD, fecha, metodo, blobId,
    comprobanteName:file?file.name:'',
    registradoPor:currentUser?currentUser.name:'Sistema',
    registradoAt:new Date().toISOString() };
  proj.lastActivity=Date.now();
  logAction(`Pago registrado para "${oc.num||'OC'}" (${metodo})`,'log-create','OC',null,
    {num:oc.num,monto:montoUSD,metodo,proyecto:proj.name});
  _ocPagoCtx=null;
  closeModal();
  saveData();
  showToast('✅ Pago registrado');
  if(typeof renderPagosBody==='function'&&fwinExists('pagos'))renderPagosBody();
}
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

```bash
cd siscon-web && node test-oc-candado-pago.js
```

Esperado: `42 pruebas OK, 0 fallas`.

- [ ] **Step 5: Verificar sintaxis**

```bash
cd siscon-web && node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];fs.writeFileSync('/tmp/siscon-check.js',m.map(x=>x[1]).join('\n;\n'));" && node --check /tmp/siscon-check.js && echo "SINTAXIS OK"
```

- [ ] **Step 6: Commit**

```bash
git add index.html test-oc-candado-pago.js
git commit -m "Fase 0: modal de registro de pago con comprobante a R2"
```

---

### Task 5: Pantalla "Listo para pagar"

**Files:**
- Modify: `siscon-web/index.html` (nueva sección `// ========== LISTO PARA PAGAR ==========`, justo antes de `// ========== INFORMES`)
- Modify: `siscon-web/index.html` (barra lateral, ~línea 825, junto al botón de Bodega)
- Test: `siscon-web/test-oc-candado-pago.js` (extender)

**Interfaces:**
- Consumes: `ocsListasParaPagar()` (Task 3), `ocOpenPagoModal()` (Task 4).
- Produces: `openPagosWin()`, `renderPagosBody()`. Los usa el botón de la barra lateral.

Sigue el patrón exacto de `openBodegaWin()` / `renderBodegaBody()`: ventana flotante con
`fwinOpen('pagos',{...})` y cuerpo re-renderizable.

- [ ] **Step 1: Escribir la prueba que falla**

```js
console.log('\nPantalla Listo para pagar:');
ok('existe openPagosWin', /function openPagosWin\(/.test(html));
ok('existe renderPagosBody', /function renderPagosBody\(/.test(html));
ok('la lista se arma solo con OCs listas para pagar',
  /function renderPagosBody[\s\S]{0,1200}ocsListasParaPagar\(projects\)/.test(html));
ok('cada fila ofrece registrar el pago',
  /function renderPagosBody[\s\S]{0,3000}ocOpenPagoModal\(/.test(html));
ok('hay botón en la barra lateral', /onclick="openPagosWin\(\)"/.test(html));
ok('el vacío explica el candado en vez de decir solo "sin datos"',
  /function renderPagosBody[\s\S]{0,3000}incompleta/i.test(html));
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
cd siscon-web && node test-oc-candado-pago.js
```

Esperado: 6 fallas nuevas.

- [ ] **Step 3: Implementar la ventana**

```js
// ========== LISTO PARA PAGAR ==========
// Vista global: SOLO OCs completas y sin pago registrado. Una OC incompleta no aparece —
// ese es el candado: lo que no está acá, no se paga.
function openPagosWin(){
  if(fwinExists('pagos')){ fwinRestore('pagos'); return; }
  fwinOpen('pagos',{title:'Listo para pagar',width:940,height:600,dirtyFn:()=>false,
    bodyHTML:'<div id="pagos-body" style="padding:12px 16px"></div>',
    footerHTML:`<button class="btn-cancel" onclick="fwinClose('pagos',true)">Cerrar</button>`});
  renderPagosBody();
}
function renderPagosBody(){
  const el=document.getElementById('pagos-body'); if(!el)return;
  const filas=ocsListasParaPagar(projects);
  const total=filas.reduce((s,x)=>s+(Number(x.oc.totalUSD)||0),0);
  const porProveedor={};
  filas.forEach(x=>{
    const k=String(x.oc.vendorName||'— Sin proveedor —');
    (porProveedor[k]=porProveedor[k]||[]).push(x);
  });
  const nombres=Object.keys(porProveedor).sort((a,b)=>a.localeCompare(b,'es'));
  el.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-size:12px;color:var(--t2)">${filas.length} orden(es) lista(s) para pagar</div>
      <div style="font-size:15px;font-weight:700;color:var(--grn)">Total: ${fmt(total)}</div>
    </div>
    ${filas.length?nombres.map(nombre=>`
      <div style="margin-bottom:16px">
        <div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--border)">${esc(nombre)}</div>
        ${porProveedor[nombre].map(({proj,oc})=>`
          <div class="oc-list-item">
            <span class="oc-num-badge">${esc(oc.num||'OC')}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;color:var(--t1)">${esc(proj.name)}</div>
              <div style="font-size:10px;color:var(--t3)">
                ${oc.houseIds&&oc.houseIds.length?'Casas: '+oc.houseIds.map(id=>{const h=(proj.houses||[]).find(x=>String(x.id)===String(id));return h?esc(h.num):'?';}).join(', '):'Bodega'}
                ${oc.proforma?' · Proforma: '+esc(oc.proforma):''}
              </div>
            </div>
            <span style="font-size:12px;font-weight:600;color:var(--grn)">${fmt(oc.totalUSD||0)}</span>
            <button class="btn-sm" onclick="ocOpenPagoModal('${proj.id}','${oc.id}')">💰 Registrar pago</button>
          </div>`).join('')}
      </div>`).join('')
    :`<div style="color:var(--t3);text-align:center;padding:34px;font-size:12px;line-height:1.7">
        No hay órdenes de compra listas para pagar.<br>
        <span style="font-size:11px">Una OC aparece acá solo cuando está completa: con proveedor, con casas o bodega,
        con todas sus líneas imputadas al presupuesto y con monto. Si una OC que esperabas no aparece,
        está <strong>incompleta</strong> — ábrela y revisá qué le falta.</span>
      </div>`}`;
}
```

En la barra lateral (junto al botón de Bodega, ~línea 825):

```html
      <button class="sb-icon" onclick="openPagosWin()" title="Listo para pagar"><span class="ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5.5" width="19" height="13" rx="2"/><line x1="2.5" y1="10" x2="21.5" y2="10"/><line x1="6" y1="14.5" x2="10" y2="14.5"/></svg></span><span class="sb-txt">Pagar</span></button>
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

```bash
cd siscon-web && node test-oc-candado-pago.js
```

Esperado: `48 pruebas OK, 0 fallas`.

- [ ] **Step 5: Verificar sintaxis**

```bash
cd siscon-web && node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];fs.writeFileSync('/tmp/siscon-check.js',m.map(x=>x[1]).join('\n;\n'));" && node --check /tmp/siscon-check.js && echo "SINTAXIS OK"
```

- [ ] **Step 6: Commit**

```bash
git add index.html test-oc-candado-pago.js
git commit -m "Fase 0: pantalla global Listo para pagar"
```

---

### Task 6: Alerta al login de OCs pagadas sin factura

**Files:**
- Modify: `siscon-web/index.html` (junto a los selectores, en OC HELPERS)
- Modify: `siscon-web/index.html:3248` y `index.html:3346` (los dos puntos donde se llama `msgAutoSync()` tras el login)
- Modify: `siscon-web/index.html` (default de `SYS.emailAutomations`, ~línea 992)
- Test: `siscon-web/test-oc-candado-pago.js` (extender)

**Interfaces:**
- Consumes: `ocsPagadasSinFactura()` (Task 3), `addNotif()` (ya existe, `index.html:8941`).
- Produces: `ocAlertasAutoCheck()` — se llama al login.
  `SYS.emailAutomations.paidOcsNoInvoice`, que la Task 7 lee desde el backend.

**Nota:** `addNotif()` ya deduplica por texto exacto (`notifCache.some(n=>n.msg===msg)`), así que
incluir el número de OC y los días en el mensaje evita que se repita la misma alerta cada login
pero sí deja avanzar el contador de días.

- [ ] **Step 1: Escribir la prueba que falla**

```js
console.log('\nAlerta de OC pagada sin factura:');
ok('existe ocAlertasAutoCheck', /function ocAlertasAutoCheck\(/.test(html));
ok('usa el umbral configurable', /function ocAlertasAutoCheck[\s\S]{0,700}SYS\.alertas/.test(html));
ok('crea notificación con addNotif',
  /function ocAlertasAutoCheck[\s\S]{0,900}addNotif\(/.test(html));
ok('se dispara tras el login', (html.match(/ocAlertasAutoCheck\(\);/g) || []).length >= 2);
ok('la automatización de correo está declarada', /paidOcsNoInvoice/.test(html));
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
cd siscon-web && node test-oc-candado-pago.js
```

Esperado: 5 fallas nuevas.

- [ ] **Step 3: Implementar la alerta**

```js
// Fase 0 — al entrar a la app, avisa de OCs pagadas cuya factura nunca llegó.
// addNotif() deduplica por texto exacto: al incluir los días, la alerta se refresca al avanzar
// el contador pero no se repite el mismo día.
function ocAlertasAutoCheck(){
  const umbral=(SYS.alertas&&Number(SYS.alertas.diasSinFactura))||10;
  const pendientes=ocsPagadasSinFactura(projects,umbral,new Date().toISOString().slice(0,10));
  pendientes.forEach(({proj,oc,dias})=>{
    addNotif(`⏳ ${oc.num||'OC'} (${proj.name}) — pagada hace ${dias} días y el proveedor no ha enviado la factura`);
  });
}
```

En el default de `SYS.emailAutomations` (~línea 992), agregar la segunda automatización:

```js
    paidOcsNoInvoice: {
      label: 'OCs pagadas sin factura del proveedor',
      description: 'Resumen diario (10:00pm) de órdenes de compra ya pagadas cuya factura del proveedor todavía no llega.',
      enabled: true,
      recipients: [],
    },
```

En la migración de campos faltantes (junto a la de `pendingBillsDigest`, ~línea 2787):

```js
  if(!SYS.emailAutomations.paidOcsNoInvoice)SYS.emailAutomations.paidOcsNoInvoice={
    label:'OCs pagadas sin factura del proveedor',
    description:'Resumen diario (10:00pm) de órdenes de compra ya pagadas cuya factura del proveedor todavía no llega.',
    enabled:true, recipients:[],
  };
  if(!Array.isArray(SYS.emailAutomations.paidOcsNoInvoice.recipients))SYS.emailAutomations.paidOcsNoInvoice.recipients=[];
```

En `index.html:3248` y `index.html:3346`, agregar la llamada justo después de `msgAutoSync();`:

```js
    msgAutoSync();
    ocAlertasAutoCheck();
```

**La UI de Ajustes → Correos no necesita cambios:** `renderEmailAutomationsSettings()` itera
`Object.keys(SYS.emailAutomations)`, así que la automatización nueva aparece sola con su
checkbox y su lista de destinatarios.

- [ ] **Step 4: Correr la prueba para verificar que pasa**

```bash
cd siscon-web && node test-oc-candado-pago.js
```

Esperado: `53 pruebas OK, 0 fallas`.

- [ ] **Step 5: Verificar sintaxis**

```bash
cd siscon-web && node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];fs.writeFileSync('/tmp/siscon-check.js',m.map(x=>x[1]).join('\n;\n'));" && node --check /tmp/siscon-check.js && echo "SINTAXIS OK"
```

- [ ] **Step 6: Correr TODA la suite del frontend para descartar regresiones**

```bash
cd siscon-web && for f in test-*.js; do echo "── $f"; node "$f" >/dev/null 2>&1 && echo "   OK" || echo "   FALLA"; done
```

Esperado: todo OK salvo `test-login-concurrency.js`, que **ya falla en `HEAD`** desde antes de
este trabajo (busca `function openSettings` cuando la real es `async function openSettings`).
Fallo preexistente y documentado — no intentar arreglarlo acá.

- [ ] **Step 7: Commit**

```bash
git add index.html test-oc-candado-pago.js
git commit -m "Fase 0: alerta de OC pagada sin factura al login + automatización de correo"
```

---

### Task 7: Backend — sección de OCs pagadas sin factura en el digest diario

**Files:**
- Modify: `siscon-backend/server.js` (junto a `sendPendingBillsDigest`, ~línea 5186)
- Modify: `siscon-backend/server.js` (handler `POST /internal/cron/pending-bills-digest`, ~línea 5249)
- Test: `siscon-backend/test-paid-ocs-digest.js` (crear)

**Interfaces:**
- Consumes: `msSendMail(to, subject, htmlBody)` (ya existe, `server.js:3553`), `supabase`.
- Produces:
  - `buildPaidOcsDigestRows(ocRows, projectNames, umbralDias, hoyISO) → [{projectName, filas:[...]}]` (pura).
  - `sendPaidOcsNoInvoiceDigest() → {ok, sent, ...}` (I/O).

**Nota de diseño:** se agrega una **función nueva**, no se modifica `sendPendingBillsDigest()`.
El cron existente llama a las dos y devuelve ambos resultados — así no hace falta un segundo
Cron Job en Render (que cuesta aparte).

Las OCs viven en `transactions` con `kind='oc'`. `num` y `status` son columnas reales;
`vendorName` y `pago` viajan en el catch-all `data` (no están en el `FIELD_MAP` de
`record-normalizer.js`).

- [ ] **Step 1: Escribir la prueba que falla**

Crear `siscon-backend/test-paid-ocs-digest.js`:

```js
// ============================================================
//  Fase 0 — digest de OCs pagadas sin factura.
//  Corre:  node test-paid-ocs-digest.js
//  Extrae la función pura real de server.js; no reimplementa nada.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function extractFunction(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`No se encontró ${name}`);
  const brace = src.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name, extra !== undefined ? '→ ' + extra : ''); }
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(extractFunction('buildPaidOcsDigestRows'), sandbox);

const names = new Map([['p1', '116 Este'], ['p2', 'Dor']]);
const rows = [
  { id: 'oc-a', project_id: 'p1', num: 'OC-2026-014', status: 'Enviada', total_usd: 883.11,
    data: { vendorName: 'Polycenter', pago: { fecha: '2026-08-20', metodo: 'Transferencia' } } },
  { id: 'oc-b', project_id: 'p1', num: 'OC-2026-015', status: 'Facturada', total_usd: 100,
    data: { vendorName: 'Extralum', pago: { fecha: '2026-08-01', metodo: 'Transferencia' } } },
  { id: 'oc-c', project_id: 'p2', num: 'OC-2026-016', status: 'Borrador', total_usd: 50,
    data: { vendorName: 'Extralum' } },
  { id: 'oc-d', project_id: 'p2', num: 'OC-2026-017', status: 'Enviada', total_usd: 75,
    data: { vendorName: 'Ferretería X', pago: { fecha: '2026-09-05', metodo: 'Tarjeta' } } },
];

console.log('\nbuildPaidOcsDigestRows:');
const grupos = sandbox.buildPaidOcsDigestRows(rows, names, 10, '2026-09-08');
ok('agrupa por proyecto', grupos.length === 1, JSON.stringify(grupos.map(g => g.projectName)));
ok('usa el nombre del proyecto', grupos[0] && grupos[0].projectName === '116 Este');
ok('solo la OC pagada, vencida y no facturada', grupos[0].filas.length === 1 && grupos[0].filas[0].num === 'OC-2026-014');
ok('calcula los días', grupos[0].filas[0].dias === 19, grupos[0] && grupos[0].filas[0].dias);
ok('trae proveedor y monto', grupos[0].filas[0].vendorName === 'Polycenter' && grupos[0].filas[0].totalUSD === 883.11);
ok('excluye OC ya facturada', !JSON.stringify(grupos).includes('OC-2026-015'));
ok('excluye OC sin pago', !JSON.stringify(grupos).includes('OC-2026-016'));
ok('excluye OC dentro del umbral', !JSON.stringify(grupos).includes('OC-2026-017'));
ok('proyecto sin nombre cae a un rótulo legible',
  sandbox.buildPaidOcsDigestRows(rows, new Map(), 10, '2026-09-08')[0].projectName.includes('p1'));
ok('sin filas devuelve arreglo vacío', sandbox.buildPaidOcsDigestRows([], names, 10, '2026-09-08').length === 0);
ok('entrada nula no revienta', sandbox.buildPaidOcsDigestRows(null, names, 10, '2026-09-08').length === 0);

console.log('\nCableado:');
ok('existe sendPaidOcsNoInvoiceDigest', /async function sendPaidOcsNoInvoiceDigest\(/.test(src));
ok('lee la automatización paidOcsNoInvoice', /paidOcsNoInvoice/.test(src));
ok('respeta el umbral configurable', /alertas[\s\S]{0,120}diasSinFactura/.test(src));
ok('el cron dispara ambos digests',
  /pending-bills-digest'[\s\S]{0,1400}sendPendingBillsDigest\(\)[\s\S]{0,900}sendPaidOcsNoInvoiceDigest\(\)/.test(src));
ok('envía con msSendMail', /sendPaidOcsNoInvoiceDigest[\s\S]{0,3000}msSendMail\(/.test(src));

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
cd siscon-backend && node test-paid-ocs-digest.js
```

Esperado: `Error: No se encontró buildPaidOcsDigestRows`.

- [ ] **Step 3: Implementar en `server.js`**

Justo **antes** de `async function sendPendingBillsDigest()`:

```js
// Fase 0 — OCs ya pagadas cuya factura del proveedor nunca llegó.
// Pura y sin I/O para poder probarla: recibe filas de `transactions` (kind='oc') ya leídas.
// `num` y `status` son columnas reales; `vendorName` y `pago` viajan en el catch-all `data`.
function buildPaidOcsDigestRows(ocRows, projectNames, umbralDias, hoyISO) {
  const umbral = Number(umbralDias) > 0 ? Number(umbralDias) : 10;
  const hoy = new Date(String(hoyISO || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
  const byProject = new Map();
  for (const row of (Array.isArray(ocRows) ? ocRows : [])) {
    const data = (row && row.data) || {};
    const pago = data.pago;
    if (!pago || !pago.fecha) continue;
    if (row.status === 'Facturada' || row.status === 'Cancelada') continue;
    const pagado = new Date(String(pago.fecha) + 'T00:00:00');
    if (isNaN(pagado) || isNaN(hoy)) continue;
    const dias = Math.floor((hoy - pagado) / 864e5);
    if (dias < umbral) continue;
    const key = String(row.project_id);
    if (!byProject.has(key)) {
      byProject.set(key, {
        projectName: projectNames.get(key) || ('Proyecto ' + key),
        filas: [],
      });
    }
    byProject.get(key).filas.push({
      num: row.num || '—',
      vendorName: data.vendorName || '—',
      totalUSD: Number(row.total_usd) || 0,
      fechaPago: pago.fecha,
      metodo: pago.metodo || '—',
      dias,
    });
  }
  const out = [...byProject.values()];
  out.forEach(g => g.filas.sort((a, b) => b.dias - a.dias));
  return out;
}

async function sendPaidOcsNoInvoiceDigest() {
  const { data: settingsRow, error: settingsErr } = await supabase.from('settings')
    .select('data').eq('id', 1).is('deleted_at', null).single();
  if (settingsErr) throw new Error('No se pudo leer settings: ' + settingsErr.message);
  const sys = (settingsRow && settingsRow.data && settingsRow.data.SYS) || {};
  const automation = sys.emailAutomations && sys.emailAutomations.paidOcsNoInvoice;
  if (!automation || !automation.enabled) return { ok: true, sent: false, reason: 'automatización deshabilitada' };
  const recipients = Array.isArray(automation.recipients) ? automation.recipients.filter(Boolean) : [];
  if (!recipients.length) return { ok: true, sent: false, reason: 'sin destinatarios configurados' };
  const umbral = (sys.alertas && Number(sys.alertas.diasSinFactura)) || 10;

  const { data: ocs, error: ocsErr } = await supabase.from('transactions')
    .select('id, project_id, num, status, total_usd, data').eq('kind', 'oc').is('deleted_at', null);
  if (ocsErr) throw new Error('No se pudo leer órdenes de compra: ' + ocsErr.message);

  const projectIds = [...new Set((ocs || []).map(row => row.project_id))];
  const { data: projectRows, error: projErr } = await supabase.from('projects')
    .select('id, name').in('id', projectIds.length ? projectIds : ['__none__']);
  if (projErr) throw new Error('No se pudo leer proyectos: ' + projErr.message);
  const projectNames = new Map((projectRows || []).map(p => [String(p.id), p.name || ('Proyecto ' + p.id)]));

  const grupos = buildPaidOcsDigestRows(ocs, projectNames, umbral, new Date().toISOString().slice(0, 10));
  const total = grupos.reduce((s, g) => s + g.filas.length, 0);
  if (!total) return { ok: true, sent: false, reason: 'no hay OCs pagadas sin factura', count: 0 };

  const escHtml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fmtUsd = n => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let html = `<div style="font-family:sans-serif">
    <h2>Órdenes de compra pagadas sin factura del proveedor</h2>
    <p style="color:#555">Pagadas hace ${umbral} días o más y el proveedor todavía no ha enviado la factura. Total: ${total}.</p>`;
  for (const g of grupos) {
    html += `<h3 style="margin-top:22px">${escHtml(g.projectName)}</h3>
      <table style="border-collapse:collapse;font-size:13px;width:100%">
        <thead><tr style="background:#f0f0f0;text-align:left">
          <th style="border:1px solid #ddd;padding:6px">OC</th>
          <th style="border:1px solid #ddd;padding:6px">Proveedor</th>
          <th style="border:1px solid #ddd;padding:6px;text-align:right">Monto</th>
          <th style="border:1px solid #ddd;padding:6px">Pagada el</th>
          <th style="border:1px solid #ddd;padding:6px">Método</th>
          <th style="border:1px solid #ddd;padding:6px;text-align:right">Días</th>
        </tr></thead><tbody>
        ${g.filas.map(f => `<tr>
          <td style="border:1px solid #ddd;padding:6px">${escHtml(f.num)}</td>
          <td style="border:1px solid #ddd;padding:6px">${escHtml(f.vendorName)}</td>
          <td style="border:1px solid #ddd;padding:6px;text-align:right">${fmtUsd(f.totalUSD)}</td>
          <td style="border:1px solid #ddd;padding:6px">${escHtml(f.fechaPago)}</td>
          <td style="border:1px solid #ddd;padding:6px">${escHtml(f.metodo)}</td>
          <td style="border:1px solid #ddd;padding:6px;text-align:right">${f.dias}</td>
        </tr>`).join('')}
      </tbody></table>`;
  }
  html += `<p style="color:#999;font-size:11px;margin-top:24px">Enviado automáticamente por Siscon todos los días a las 10:00pm.</p></div>`;

  await msSendMail(recipients, `Siscon · ${total} OC(s) pagada(s) sin factura`, html);
  return { ok: true, sent: true, count: total, projects: grupos.length, recipients: recipients.length };
}
```

En el handler `POST /internal/cron/pending-bills-digest`, cambiar la línea
`const result = await sendPendingBillsDigest();` por:

```js
    const result = await sendPendingBillsDigest();
    let paidOcs = null;
    try { paidOcs = await sendPaidOcsNoInvoiceDigest(); }
    catch (e) {
      // Un fallo del digest nuevo no debe tumbar el que ya funcionaba en producción.
      console.error('[CRON] paid-ocs-no-invoice error:', e.message);
      paidOcs = { ok: false, error: e.message };
    }
    result.paidOcsNoInvoice = paidOcs;
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

```bash
cd siscon-backend && node test-paid-ocs-digest.js
```

Esperado: `16 pruebas OK, 0 fallas`.

- [ ] **Step 5: Verificar sintaxis y suite del backend**

```bash
cd siscon-backend && node --check server.js && echo "SINTAXIS OK" && for f in test-*.js; do echo "── $f"; node "$f" >/dev/null 2>&1 && echo "   OK" || echo "   FALLA"; done
```

Esperado: `SINTAXIS OK` y toda la suite del backend en verde.

- [ ] **Step 6: Commit**

```bash
git add server.js test-paid-ocs-digest.js
git commit -m "Fase 0: digest diario de OCs pagadas sin factura del proveedor"
```

> ⚠️ El commit del backend va en el repo `siscon-backend`, que es **otro repo git**. Crear ahí
> también una rama `feature/cadena-custodia-compra` antes de commitear; no commitear en `main`.

---

### Task 8: Documentación y guía de activación

**Files:**
- Modify: `PROJECT_CONTEXT.md` (raíz del proyecto y su copia en `siscon-web/`)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código.

- [ ] **Step 1: Agregar la entrada de sesión**

En `PROJECT_CONTEXT.md`, antes de `## 10. ⏳ Pendiente`, agregar:

```markdown
### Sesión 2026-09-08 (Fase 0 — candado del pago)
> Primera fase del diseño `docs/superpowers/specs/2026-09-08-cadena-custodia-compra-design.md`.
- [x] `ocIsComplete()`: la completitud de una OC se **deriva**, no se guarda — no colisiona con
  el `status` existente, que sigue reflejando el ciclo de QuickBooks.
- [x] Pantalla global **Listo para pagar**: solo aparecen OCs completas y sin pago. Lo que no
  está ahí, no se paga. El estado vacío explica el candado en vez de decir "sin datos".
- [x] Registro del pago con comprobante a R2, prellenado desde la convención de nombre
  `PROVEEDOR-MONTO-#OC-#PROFORMA-PROYECTO`. El comprobante se adjunta al proyecto **dueño de la
  OC**, no a `curProj` (trampa multiproyecto ya vista en la sesión 2026-08-07).
- [x] Alerta 🔔 al login y sección nueva en el digest diario para OCs pagadas sin factura del
  proveedor, con umbral configurable en `SYS.alertas.diasSinFactura` (default 10).
- [x] Pruebas: `siscon-web/test-oc-candado-pago.js` y `siscon-backend/test-paid-ocs-digest.js`.
```

- [ ] **Step 2: Documentar los 5 pasos manuales pendientes**

En la sección `## 10. ⏳ Pendiente`, agregar:

```markdown
### Activación del correo diario (pasos manuales — solo el usuario puede hacerlos)
El digest está escrito y desplegado desde 2026-08-12, y la Fase 0 le agregó la sección de OCs
pagadas sin factura. **No envía nada hasta completar estos 5 pasos:**
1. Reconectar Outlook desde Ajustes (el `refresh_token` actual no tiene el scope `Mail.Send`).
2. Generar el secreto: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Cargarlo como `INTERNAL_CRON_SECRET` en Render, servicio web `siscon-backend`.
4. Crear un Render Cron Job (~$1/mes), schedule `0 4 * * *` (UTC = 10pm CR, sin DST):
   `curl -X POST -H "x-internal-secret: $INTERNAL_CRON_SECRET" https://<backend>/internal/cron/pending-bills-digest`
5. En Ajustes → Correos, agregar destinatarios a **ambas** automatizaciones.
```

- [ ] **Step 3: Commit**

```bash
git add PROJECT_CONTEXT.md
git commit -m "DOC: registrar la Fase 0 del candado del pago y su guía de activación"
```

---

## Verificación final

- [ ] `cd siscon-web && node test-oc-candado-pago.js` → 53 pruebas OK
- [ ] `cd siscon-backend && node test-paid-ocs-digest.js` → 16 pruebas OK
- [ ] Suite completa del frontend en verde salvo el fallo preexistente de `test-login-concurrency.js`
- [ ] Suite completa del backend en verde
- [ ] `node --check` sobre el `<script>` de `index.html` y sobre `server.js`
- [ ] Verificación visual en el Browser pane con estado simulado (sin depender del backend real):
      abrir "Listo para pagar" con una OC completa y una incompleta, confirmar que solo aparece
      la completa; registrar un pago con un archivo cuyo nombre siga la convención y confirmar
      que el monto se prellena solo.
- [ ] **No hacer push ni merge a `main`.** El usuario decide cuándo desplegar.
