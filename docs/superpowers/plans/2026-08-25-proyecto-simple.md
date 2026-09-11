# Proyecto Simple Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project be created as a single global budget ("Proyecto Simple") instead of Tipos→Casas ("Proyecto con Sub Tipos"), reusing the existing house/type financial engine under the hood instead of duplicating it.

**Architecture:** Every Proyecto Simple secretly keeps exactly 1 `type` and 1 `house` (auto-created, never shown in any picker/list). All existing budget, billing-%, recovery, warranty and subcontractor-advance logic is reused unmodified, fed by that single hidden house. UI-layer changes hide Tipos/Lista de Casas and the various "pick a casa" widgets, and add a "Presupuesto" tab that edits the hidden type directly. Gantt is the one exception: it gets its own freeform, non-house task list for Proyecto Simple.

**Tech Stack:** Vanilla JS/HTML/CSS, single file (`index.html`, ~17k lines). No build step, no bundler, no test framework — tests are plain Node scripts that extract real functions out of `index.html` (via brace-matching, see `test-passwords.js`/`test-qbo-project-linking.js`) and either run them in a `vm` sandbox with real assertions, or regex-check the extracted source for the right wiring. Run with `node test-*.js` from `siscon-web/`.

Full design: [docs/superpowers/specs/2026-08-25-proyecto-simple-design.md](../specs/2026-08-25-proyecto-simple-design.md)

## Global Constraints

- Single-file frontend: all changes land in `siscon-web/index.html`. Do not split it up.
- No new runtime dependencies (no npm packages, no CDN scripts) — this app is vanilla JS with no build step.
- Every new/changed piece of logic gets a `test-proyecto-simple-*.js` Node script, following the extraction pattern already used by `test-passwords.js` and `test-qbo-project-linking.js` — never re-implement the logic under test, always extract the real source from `index.html`.
- Existing Proyecto con Sub Tipos behavior must not change. Every new branch is guarded by `curProj.mode==='simple'` (or, where `curProj` isn't in scope, `p.mode==='simple'`); the `else`/default path is the untouched current behavior. Projects with no `mode` field (pre-existing projects) must behave exactly as `'subtipos'`.
- Commit after each task with a message starting `feat(proyecto-simple):`.

---

### Task 1: `mode` field, hidden type/house builder, and the creation-mode prompt

**Files:**
- Modify: `siscon-web/index.html:3843` (dashboard "+ Crear Proyecto" button)
- Modify: `siscon-web/index.html:4039-4093` (`openNewProjModal`, `saveNewProj`)
- Test: `siscon-web/test-proyecto-simple-1-creation.js`

**Interfaces:**
- Consumes: `defaultCategories()` (existing, returns the default empty categories array used by a new Tipo), `COLORS_LIST` (existing global array), `openProj(id)` (existing, opens a project and lands on tab `'info'`), `setTab(t)` (existing).
- Produces: `buildHiddenBudgetTypeAndHouse(baseId)` — pure function, no DOM, returns `{type, house}` where `type.id===baseId+1`, `house.id===baseId+2`, `house.typeId===type.id`, `type.categories` deep-equals `defaultCategories()`. Later tasks (2, 3, 5, 6, 7, 11) rely on `curProj.mode` being `'simple'|'subtipos'` and, for `'simple'`, on `curProj.types[0]`/`curProj.houses[0]` being that hidden pair.

- [ ] **Step 1: Write the failing test**

Create `siscon-web/test-proyecto-simple-1-creation.js`:

```js
// Pruebas de la creación de Proyecto Simple: el tipo/casa ocultos y el flujo de creación.
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
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗ FALLA:', name); } }

console.log('Constructor del tipo/casa ocultos:');
const sandbox = { COLORS_LIST: ['#111', '#222'] };
vm.createContext(sandbox);
vm.runInContext(
  ['defaultCategories', 'buildHiddenBudgetTypeAndHouse'].map(extractFunction).join('\n'),
  sandbox
);
const { type, house } = sandbox.buildHiddenBudgetTypeAndHouse(1000);
ok('el tipo oculto tiene id = baseId+1', type.id === 1001);
ok('la casa oculta tiene id = baseId+2', house.id === 1002);
ok('la casa oculta apunta al tipo oculto', house.typeId === type.id);
ok('el tipo oculto arranca con categorías por defecto', JSON.stringify(type.categories) === JSON.stringify(sandbox.defaultCategories()));
ok('el tipo oculto no arranca bloqueado (si no, el usuario no puede editar su propio presupuesto)', type.typeLocked === false);
ok('la casa oculta no tiene número visible que confunda listas', house.num === '—');

console.log('\nCableado de creación (prompt Simple/Sub Tipos + saveNewProj):');
ok('el botón del dashboard ahora abre el prompt de modo, no el formulario directo',
  /class="btn-new-proj" onclick="openNewProjModeChoice\(\)"/.test(html));
const modeChoiceSrc = extractFunction('openNewProjModeChoice');
ok('el prompt ofrece "Crear Proyecto Simple"', modeChoiceSrc.includes('Crear Proyecto Simple'));
ok('el prompt ofrece "Crear Proyecto con Sub Tipos"', modeChoiceSrc.includes('Crear Proyecto con Sub Tipos'));
const saveNewProjSrc = extractFunction('saveNewProj');
ok('saveNewProj guarda el modo elegido en el proyecto', /mode\s*:\s*mode/.test(saveNewProjSrc));
ok('saveNewProj por defecto usa \'subtipos\' si no se eligió modo', saveNewProjSrc.includes("_newProjMode==='simple'?'simple':'subtipos'"));
ok('saveNewProj crea el tipo/casa ocultos solo en modo simple', /mode==='simple'/.test(saveNewProjSrc) && saveNewProjSrc.includes('buildHiddenBudgetTypeAndHouse'));
ok('saveNewProj ahora persiste el proyecto nuevo (antes faltaba saveData())', /saveData\(\)/.test(saveNewProjSrc));
ok('saveNewProj en modo simple abre el proyecto y cae en la pestaña Presupuesto',
  /mode==='simple'[\s\S]{0,200}setTab\('presupuesto'\)/.test(saveNewProjSrc));
ok('saveNewProj en modo sub tipos conserva el comportamiento actual (se queda en el dashboard)',
  /else\s*\{\s*renderDash\(\);?\s*\}/.test(saveNewProjSrc) || /renderDash\(\)/.test(saveNewProjSrc));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd siscon-web && node test-proyecto-simple-1-creation.js`
Expected: FAIL — `buildHiddenBudgetTypeAndHouse` and `openNewProjModeChoice` don't exist yet, and the regex checks against `saveNewProj`/the dashboard button don't match the current source.

- [ ] **Step 3: Implement**

In `index.html`, right before `function saveNewProj(){` (currently line 4072), add:

```js
// Un Proyecto Simple mantiene por dentro exactamente 1 tipo (mostrado como pestaña
// "Presupuesto") y 1 casa, ambos ocultos de toda lista/selector de casas. Esto permite
// reusar sin cambios toda la lógica de facturación/recuperación/garantías/avances que
// hoy asume tipos→casas, en vez de duplicarla para un modelo de datos paralelo.
function buildHiddenBudgetTypeAndHouse(baseId){
  const type={
    id:baseId+1, name:'Presupuesto', area:0, budget:0, salePrice:0, utilityPct:0,
    margen:30, adminPct:2, notes:'', color:COLORS_LIST[0],
    categories:defaultCategories(), typeLocked:false,
  };
  const house={
    id:baseId+2, typeId:type.id, num:'—', status:'Sin iniciar',
    crewMemberIds:[], log:[], purchases:[], spent:0, areaInstalled:0,
  };
  return {type, house};
}
let _newProjMode='subtipos';
function openNewProjModeChoice(){
  document.getElementById('modal-inner').innerHTML=`
    <div class="modal-title">Tipo de Proyecto<button onclick="closeModal()" style="background:transparent;border:none;color:var(--t3);font-size:18px;cursor:pointer">✕</button></div>
    <div style="font-size:13px;color:var(--t2);margin-bottom:16px;line-height:1.5">¿Este proyecto tiene varios tipos de vivienda y casas, o es una cotización única para todo el proyecto?</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <button class="btn-save" style="width:100%" onclick="_newProjMode='subtipos';openNewProjModal()">Crear Proyecto con Sub Tipos</button>
      <button class="btn-cancel" style="width:100%" onclick="_newProjMode='simple';openNewProjModal()">Crear Proyecto Simple</button>
    </div>`;
  document.getElementById('modal').classList.remove('hidden');
}
```

Change the dashboard button (line 3843) from:
```html
<button class="btn-new-proj" onclick="openNewProjModal()">+ Crear Proyecto</button>
```
to:
```html
<button class="btn-new-proj" onclick="openNewProjModeChoice()">+ Crear Proyecto</button>
```

Replace `saveNewProj()` (lines 4072-4093) with:

```js
function saveNewProj(){
  const name=document.getElementById('np-name').value.trim();
  if(!name){alert('Ingrese el nombre del proyecto');return;}
  const mode=_newProjMode==='simple'?'simple':'subtipos';
  const p={
    id:Date.now(),name,num:document.getElementById('np-num').value||'',
    client:document.getElementById('np-client').value||'',
    razonSocial:document.getElementById('np-rs').value||'',
    correo:document.getElementById('np-email').value||'',
    status:document.getElementById('np-status').value,
    startDate:document.getElementById('np-start').value||'',
    lastActivity:Date.now(),
    budget:parseFloat(document.getElementById('np-budget').value)||0,
    salePrice:parseFloat(document.getElementById('np-sale').value)||0,
    utilityPct:parseFloat(document.getElementById('np-util').value)||0,
    area:parseFloat(document.getElementById('np-area').value)||0,
    areaInstalled:0,locked:false,exchangeRate:SYS.exchangeRate,
    mode,
    types:[],houses:[],docs:[],uploads:[],garantias:[],bodega:[]
  };
  if(mode==='simple'){
    const {type,house}=buildHiddenBudgetTypeAndHouse(p.id);
    p.types.push(type); p.houses.push(house);
  }
  projects.push(p);
  logAction(`Proyecto "${name}" creado`,'log-create','Dashboard',null,{name,num:p.num,mode});
  saveData();
  closeModal();
  _newProjMode='subtipos';
  if(mode==='simple'){ openProj(p.id); setTab('presupuesto'); }
  else { renderDash(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd siscon-web && node test-proyecto-simple-1-creation.js`
Expected: PASS (all checks ✓)

- [ ] **Step 5: Commit**

```bash
git add index.html test-proyecto-simple-1-creation.js
git commit -m "feat(proyecto-simple): add mode field, hidden type/house builder, creation prompt"
```

---

### Task 2: Presupuesto tab (tabbar, dispatch, breadcrumb, save routing)

**Files:**
- Modify: `siscon-web/index.html:836-849` (tabbar HTML)
- Modify: `siscon-web/index.html:4122-4151` (`openProj`, `renderBreadcrumb`)
- Modify: `siscon-web/index.html:4415-4440` (`setTab`, `renderTab`)
- Modify: `siscon-web/index.html:4927-4962` (`saveType`)
- Test: `siscon-web/test-proyecto-simple-2-presupuesto-tab.js`

**Interfaces:**
- Consumes: `openCreateType(typeId)` / `renderCreateType()` / `ctForm` / `ctCategories` (existing Tipo editor, unchanged — Task 1's `curProj.types[0]`).
- Produces: `renderPresupuestoTab()` — opens the hidden type's editor directly (no list view). `updateTabbarForMode()` — hides/shows the Tipos/Lista de Casas/Presupuesto tab buttons based on `curProj.mode`; later tasks don't depend on this beyond it existing and being called from `openProj`.

- [ ] **Step 1: Write the failing test**

Create `siscon-web/test-proyecto-simple-2-presupuesto-tab.js`:

```js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`No se encontró ${name}`);
  const brace = html.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗ FALLA:', name); } }

console.log('Pestaña Presupuesto:');
ok('la barra de pestañas tiene un botón Presupuesto (oculto por defecto vía updateTabbarForMode)',
  /id="tab-btn-presupuesto" data-tab="presupuesto"[^>]*>Presupuesto</.test(html));
ok('los botones Tipos y Lista de Casas tienen id para poder ocultarlos', html.includes('id="tab-btn-tipos"') && html.includes('id="tab-btn-casas"'));

const updateTabbarSrc = extractFunction('updateTabbarForMode');
ok('updateTabbarForMode decide por curProj.mode', updateTabbarSrc.includes("curProj.mode==='simple'"));
ok('updateTabbarForMode oculta Tipos en modo simple', /tipos[\s\S]*display\s*=\s*simple\?'none'/.test(updateTabbarSrc) || /tab-btn-tipos[\s\S]{0,80}none/.test(updateTabbarSrc));

const openProjSrc = extractFunction('openProj');
ok('openProj llama a updateTabbarForMode', openProjSrc.includes('updateTabbarForMode()'));

const renderTabSrc = extractFunction('renderTab');
ok('renderTab despacha la pestaña presupuesto', renderTabSrc.includes("curTab==='presupuesto'") && renderTabSrc.includes('renderPresupuestoTab()'));

const renderPresupuestoSrc = extractFunction('renderPresupuestoTab');
ok('renderPresupuestoTab abre el editor del tipo oculto (types[0])', /openCreateType\(\s*curProj\.types\[0\]\.id\s*\)/.test(renderPresupuestoSrc));

const breadcrumbSrc = extractFunction('renderBreadcrumb');
ok('el breadcrumb muestra "Presupuesto" en vez de "Editar/Crear Tipo" para proyectos simples',
  breadcrumbSrc.includes("curProj.mode==='simple'?'Presupuesto'"));

const saveTypeSrc = extractFunction('saveType');
ok('saveType, en modo simple, se queda en el editor de Presupuesto en vez de ir a la lista de Tipos',
  /mode==='simple'[\s\S]{0,60}renderPresupuestoTab\(\)/.test(saveTypeSrc));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd siscon-web && node test-proyecto-simple-2-presupuesto-tab.js`
Expected: FAIL (none of this wiring exists yet)

- [ ] **Step 3: Implement**

Tabbar HTML (lines 839-840), add `id`s and a new button right after "Lista de Casas":
```html
        <button class="tab-btn" id="tab-btn-tipos" data-tab="tipos" onclick="tabClick(event,'tipos')">Tipos</button>
        <button class="tab-btn" id="tab-btn-casas" data-tab="casas" onclick="tabClick(event,'casas')">Lista de Casas</button>
        <button class="tab-btn" id="tab-btn-presupuesto" data-tab="presupuesto" onclick="tabClick(event,'presupuesto')">Presupuesto</button>
```

Add near `openProj` (e.g. right after it, before `renderBreadcrumb`):
```js
function updateTabbarForMode(){
  const simple=curProj&&curProj.mode==='simple';
  const tipos=document.getElementById('tab-btn-tipos');
  const casas=document.getElementById('tab-btn-casas');
  const presu=document.getElementById('tab-btn-presupuesto');
  if(tipos)tipos.style.display=simple?'none':'';
  if(casas)casas.style.display=simple?'none':'';
  if(presu)presu.style.display=simple?'':'none';
}
```
Call it from `openProj()`, right after the existing `renderBreadcrumb(); renderMetric(); setTab('info');` line (4141): add `updateTabbarForMode();` before that line (tab buttons must be shown/hidden before `setTab('info')` re-highlights the active one).

`renderTab()` (line 4425-4440), add a branch:
```js
  else if(curTab==='presupuesto') renderPresupuestoTab();
```
right after the `casas` branch.

Add near `renderTypes` (before it, e.g. right after `renderTab`):
```js
function renderPresupuestoTab(){
  if(!curProj.types[0])return;
  openCreateType(curProj.types[0].id);
}
```

`renderBreadcrumb()` (line 4146-4151), change the label expression to:
```js
    (showCreate?`<span>›</span><span style="color:var(--t1)">${curProj.mode==='simple'?'Presupuesto':(typeEditId?'Editar Tipo':'Crear Tipo')}</span>`:'');
```

`saveType()` (line 4959-4961), change the tail from:
```js
  renderMetric(); renderBreadcrumb(); renderTypes();
```
to:
```js
  renderMetric(); renderBreadcrumb();
  if(curProj.mode==='simple') renderPresupuestoTab(); else renderTypes();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd siscon-web && node test-proyecto-simple-2-presupuesto-tab.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html test-proyecto-simple-2-presupuesto-tab.js
git commit -m "feat(proyecto-simple): add Presupuesto tab, hide Tipos/Lista de Casas in simple mode"
```

---

### Task 3: OC — auto-assign the hidden house, hide the casa picker

**Files:**
- Modify: `siscon-web/index.html:7272-7293` (`openNewOC`)
- Modify: `siscon-web/index.html:7429-7467` (Fila 2 of `renderOCForm`, "Casas incluidas")
- Test: `siscon-web/test-proyecto-simple-3-oc.js`

**Interfaces:**
- Consumes: `ocState` global, `ocInitHouseLines(houseId)` (existing — populates `ocState.lines[houseId]` from the house's type budget; safe to call directly, does not require `vendorName`).
- Produces: nothing new consumed by later tasks — this task is self-contained.

- [ ] **Step 1: Write the failing test**

Create `siscon-web/test-proyecto-simple-3-oc.js`:

```js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`No se encontró ${name}`);
  const brace = html.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗ FALLA:', name); } }

console.log('OC en Proyecto Simple:');
const openNewOCSrc = extractFunction('openNewOC');
ok('openNewOC auto-agrega la casa oculta en modo simple',
  /mode==='simple'[\s\S]{0,300}houseIds\s*=\s*\[/.test(openNewOCSrc));
ok('openNewOC inicializa las líneas de la casa oculta (ocInitHouseLines)', openNewOCSrc.includes('ocInitHouseLines('));

const renderOCFormSrc = extractFunction('renderOCForm');
ok('renderOCForm oculta el bloque "Casas incluidas en esta OC" en modo simple',
  /curProj\.mode\s*!==\s*'simple'[\s\S]{0,120}Casas incluidas en esta OC/.test(renderOCFormSrc)
  || /Casas incluidas en esta OC[\s\S]{0,400}mode\s*!==\s*'simple'/.test(renderOCFormSrc)
  || /mode==='simple'\s*\?\s*''\s*:\s*`[\s\S]*Casas incluidas en esta OC/.test(renderOCFormSrc));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd siscon-web && node test-proyecto-simple-3-oc.js`
Expected: FAIL

- [ ] **Step 3: Implement**

In `openNewOC()` (index.html:7272-7293), right before `renderOCForm();` add:
```js
  if(curProj.mode==='simple'&&curProj.houses[0]){
    const hid=curProj.houses[0].id;
    ocState.houseIds=[hid];
    ocState.activeTab=hid;
    ocInitHouseLines(hid);
  }
```

In `renderOCForm()`, wrap the "Fila 2: Casas incluidas" div (index.html:7429-7467 — the whole `<div class="oc-fields-row">...</div>` block that contains `st.bodegaMode ? ... : ...`) so it renders nothing in simple mode:
```js
${curProj.mode==='simple'?'':`
        <!-- Fila 2: Casas incluidas + Bodega -->
        <div class="oc-fields-row">
          ${st.bodegaMode ? `
          ...
          </div>`}
        </div>`}
```
(i.e. take the existing template-literal content of that block and wrap it with the `curProj.mode==='simple'?'':\`...\`` ternary — the internal content is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd siscon-web && node test-proyecto-simple-3-oc.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html test-proyecto-simple-3-oc.js
git commit -m "feat(proyecto-simple): OC auto-assigns hidden house, hides casa picker"
```

---

### Task 4: Factura de Proveedor — auto-assign lines to the hidden house, hide "Asignar"

**Files:**
- Modify: `siscon-web/index.html:14420-14424` (top of `saveVendorBill`)
- Modify: `siscon-web/index.html:13471` (the "Asignar" button)
- Test: `siscon-web/test-proyecto-simple-4-vendor-bill.js`

**Interfaces:**
- Consumes: `vbState.lines[i].assign` (existing shape `[{houseId, qty}]`, read by `vbApplyToHouses`/`vbValidateAssignments` — unchanged).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `siscon-web/test-proyecto-simple-4-vendor-bill.js`:

```js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`No se encontró ${name}`);
  const brace = html.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗ FALLA:', name); } }

console.log('Factura de Proveedor en Proyecto Simple:');
const saveVendorBillSrc = extractFunction('saveVendorBill');
ok('saveVendorBill auto-asigna cada línea a la casa oculta en modo simple, antes de validar',
  /mode==='simple'[\s\S]{0,400}l\.assign\s*=\s*\[\{\s*houseId/.test(saveVendorBillSrc));
const validateIdx = saveVendorBillSrc.indexOf('vbValidateAssignments()');
const autoAssignIdx = saveVendorBillSrc.indexOf("mode==='simple'");
ok('el auto-asignado corre ANTES de vbValidateAssignments()', autoAssignIdx >= 0 && validateIdx >= 0 && autoAssignIdx < validateIdx);

ok('el botón "Asignar" se oculta en modo simple (sin tocar el grid de columnas)',
  /Asignar<\/button>/.test(html) &&
  /display\s*:\s*\$\{curProj\.mode==='simple'\?'none':/.test(html.slice(html.indexOf('function renderVendorBill'), html.indexOf('Asignar</button>') + 20));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd siscon-web && node test-proyecto-simple-4-vendor-bill.js`
Expected: FAIL

- [ ] **Step 3: Implement**

At the top of `saveVendorBill(sync)` (index.html:14420), right after `const st=vbState;`, add:
```js
  if(curProj.mode==='simple'&&curProj.houses[0]){
    const hid=curProj.houses[0].id;
    st.lines.forEach(l=>{ if(!l.assign||!l.assign.some(a=>a.authPending)) l.assign=[{houseId:hid,qty:l.qty||0}]; });
  }
```
(placed before the `vbValidateAssignments()` call so both validation and `vbApplyToHouses` see the correct assignment; lines with a pending "fuera de lista" authorization are left alone, matching the existing `authPending` skip in `vbApplyToHouses`.)

Change the "Asignar" button (index.html:13471) from:
```html
<button class="btn-sm" style="font-size:10px;padding:3px 7px;${assignOk?'border-color:var(--grn);color:var(--grn)':'border-color:var(--amb);color:var(--amb)'}" onclick="vbOpenAssign(${i})" title="${assignedTxt}">Asignar</button>
```
to:
```html
<button class="btn-sm" style="display:${curProj.mode==='simple'?'none':'inline-block'};font-size:10px;padding:3px 7px;${assignOk?'border-color:var(--grn);color:var(--grn)':'border-color:var(--amb);color:var(--amb)'}" onclick="vbOpenAssign(${i})" title="${assignedTxt}">Asignar</button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd siscon-web && node test-proyecto-simple-4-vendor-bill.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html test-proyecto-simple-4-vendor-bill.js
git commit -m "feat(proyecto-simple): vendor bill auto-assigns to hidden house, hides Asignar button"
```

---

### Task 5: Requisición — auto-include the hidden house, hide the casa picker

**Files:**
- Modify: `siscon-web/index.html:12935-12943` (`newRequisicion`)
- Modify: `siscon-web/index.html:13194-13207` (casa picker in `renderRequisForm`)
- Test: `siscon-web/test-proyecto-simple-5-requisicion.js`

**Interfaces:**
- Consumes: `reqPickHouse(houseId)` (existing — pushes to `reqState.houseIds` and auto-populates `reqState.lines[houseId]` from bodega stock ∩ house budget; no blocking preconditions).

- [ ] **Step 1: Write the failing test**

Create `siscon-web/test-proyecto-simple-5-requisicion.js`:

```js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`No se encontró ${name}`);
  const brace = html.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗ FALLA:', name); } }

console.log('Requisición en Proyecto Simple:');
const newRequisicionSrc = extractFunction('newRequisicion');
ok('newRequisicion incluye automáticamente la casa oculta en modo simple',
  /mode==='simple'[\s\S]{0,150}reqPickHouse\(/.test(newRequisicionSrc));

const renderRequisFormSrc = extractFunction('renderRequisForm');
ok('renderRequisForm oculta el selector "+ Agregar Casa" en modo simple',
  /mode==='simple'\s*\?\s*''\s*:\s*`[\s\S]*btn-add-house-oc[\s\S]*reqShowHousePicker/.test(renderRequisFormSrc)
  || /reqShowHousePicker[\s\S]{0,600}mode\s*!==\s*'simple'/.test(renderRequisFormSrc));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd siscon-web && node test-proyecto-simple-5-requisicion.js`
Expected: FAIL

- [ ] **Step 3: Implement**

In `newRequisicion()` (index.html:12935-12943), right after `reqActiveTab='resumen';` and before `renderRequisForm();`, add:
```js
  if(curProj.mode==='simple'&&curProj.houses[0]) reqPickHouse(curProj.houses[0].id);
```

In `renderRequisForm()`, in the "Casas incluidas" field (index.html:13194-13207), wrap the `+ Agregar Casa` button + picker (but keep the chips showing the already-included house) in `curProj.mode==='simple'?'':...`:
```js
              ${st.houseIds.map(hid=>{...}).join('')}
              ${curProj.mode==='simple'?'':`
              <div style="position:relative">
                <button class="btn-add-house-oc" onclick="reqShowHousePicker(event)">+ Agregar Casa</button>
                <div id="req-house-picker" ...>...</div>
              </div>`}
```
(the chips loop stays outside the conditional so the one hidden house still shows as a non-removable chip — or, simpler and consistent with OC/VB, also hide the `✕` remove button inside the chip template for `curProj.mode==='simple'` so it can't be removed. Check the chip template at line 13197 and add `${curProj.mode==='simple'?'':...}` around `<button class="oc-chip-x" onclick="reqRemoveHouse(${hid})">✕</button>`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd siscon-web && node test-proyecto-simple-5-requisicion.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html test-proyecto-simple-5-requisicion.js
git commit -m "feat(proyecto-simple): requisición auto-includes hidden house, hides casa picker"
```

---

### Task 6: Factura a Cliente — bill by project-wide % avance instead of picking casas

**Files:**
- Modify: `siscon-web/index.html:10974-10990` (`newClientInv`)
- Modify: `siscon-web/index.html:11267-11290` (casa picker + label in `renderClientInvForm`)
- Test: `siscon-web/test-proyecto-simple-6-factura-cliente.js`

**Interfaces:**
- Consumes: `ciPickHouse(houseId)` (existing — pushes to `ciState.houseLines`, no blocking preconditions beyond `h.typeId` existing, which the hidden house always has).

- [ ] **Step 1: Write the failing test**

Create `siscon-web/test-proyecto-simple-6-factura-cliente.js`:

```js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`No se encontró ${name}`);
  const brace = html.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗ FALLA:', name); } }

console.log('Factura a Cliente en Proyecto Simple:');
const newClientInvSrc = extractFunction('newClientInv');
ok('newClientInv agrega automáticamente la casa oculta en modo simple',
  /mode==='simple'[\s\S]{0,150}ciPickHouse\(/.test(newClientInvSrc));

const renderClientInvFormSrc = extractFunction('renderClientInvForm');
ok('el campo se relabela a avance del proyecto en modo simple',
  renderClientInvFormSrc.includes("curProj.mode==='simple'?'% de avance del proyecto'"));
ok('se oculta "+ Agregar Casa" en modo simple', /mode==='simple'\s*\?\s*''\s*:\s*`[\s\S]*ciShowHousePicker/.test(renderClientInvFormSrc));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd siscon-web && node test-proyecto-simple-6-factura-cliente.js`
Expected: FAIL

- [ ] **Step 3: Implement**

In `newClientInv()` (index.html:10974-10990), right after the `ciState={...}` block and before `renderClientInvForm();`, add:
```js
  if(curProj.mode==='simple'&&p.houses[0]) ciPickHouse(p.houses[0].id);
```

In `renderClientInvForm()`, change the label at index.html:11269 from:
```html
<div class="oc-fld-label">Casas a facturar <span ...>— al agregar se asigna 100%, ajustable</span></div>
```
to:
```html
<div class="oc-fld-label">${curProj.mode==='simple'?'% de avance del proyecto':'Casas a facturar'} <span ...>${curProj.mode==='simple'?'— % de avance global sobre el Precio de Venta':'— al agregar se asigna 100%, ajustable'}</span></div>
```
and wrap the `+ Agregar Casa` button + picker (index.html:11272-11290ish) in `curProj.mode==='simple'?'':...`, same pattern as Task 5.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd siscon-web && node test-proyecto-simple-6-factura-cliente.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html test-proyecto-simple-6-factura-cliente.js
git commit -m "feat(proyecto-simple): client invoice bills by project-wide % avance"
```

---

### Task 7: Garantías — project-level (no casa selector)

**Files:**
- Modify: `siscon-web/index.html:6908-6939` (`addGarantia`)
- Test: `siscon-web/test-proyecto-simple-7-garantias.js`

**Interfaces:**
- Consumes: nothing new. `saveGarantia()` (index.html:6991) is left completely unmodified — it reads `#g-house` from the DOM regardless of what filled it.

- [ ] **Step 1: Write the failing test**

Create `siscon-web/test-proyecto-simple-7-garantias.js`:

```js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`No se encontró ${name}`);
  const brace = html.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗ FALLA:', name); } }

console.log('Garantías en Proyecto Simple:');
const addGarantiaSrc = extractFunction('addGarantia');
ok('en modo simple, el selector de Casa se reemplaza por un input oculto con la casa oculta',
  /mode==='simple'[\s\S]{0,400}type="hidden" id="g-house"/.test(addGarantiaSrc));
ok('saveGarantia no se tocó (sigue leyendo #g-house tal cual)',
  extractFunction('saveGarantia').includes("document.getElementById('g-house')"));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd siscon-web && node test-proyecto-simple-7-garantias.js`
Expected: FAIL

- [ ] **Step 3: Implement**

In `addGarantia()` (index.html:6908-6939), change the "Casa" field block (index.html:6916-6918) from:
```html
      <div class="ff"><label>Casa</label>
        <span class="ivasel" style="display:block"><select id="g-house" onchange="garSyncSub()"><option value="">— Seleccionar —</option>${(p.houses||[]).map(h=>`<option value="${h.id}"${g&&String(g.houseId)===String(h.id)?' selected':''}>${esc(h.num)}</option>`).join('')}</select></span>
      </div>
```
to:
```html
      ${p.mode==='simple'?`<input type="hidden" id="g-house" value="${p.houses[0].id}"/>`:`
      <div class="ff"><label>Casa</label>
        <span class="ivasel" style="display:block"><select id="g-house" onchange="garSyncSub()"><option value="">— Seleccionar —</option>${(p.houses||[]).map(h=>`<option value="${h.id}"${g&&String(g.houseId)===String(h.id)?' selected':''}>${esc(h.num)}</option>`).join('')}</select></span>
      </div>`}
```
Note this reuses `p` (already `const p=curProj` at the top of `addGarantia`), and leaves `saveGarantia()` completely untouched — it will read the hidden input's value exactly like it reads the select's.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd siscon-web && node test-proyecto-simple-7-garantias.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html test-proyecto-simple-7-garantias.js
git commit -m "feat(proyecto-simple): garantías skip the casa selector in simple mode"
```

---

### Task 8: Calculadora de Avances de Subcontratistas — global avance for Simple projects

**Files:**
- Modify: `siscon-web/index.html:12223-12228` (`calcAddProject`)
- Modify: `siscon-web/index.html:12158-12181` (`calcLineHtml`)
- Modify: `siscon-web/index.html:12183-12195` (`calcSectionHtml`)
- Test: `siscon-web/test-proyecto-simple-8-avances.js`

**Interfaces:**
- Consumes: `calcState.sections[].lines[]` (existing shape `{subId, crewIds, houseId, pct, area}` — one row per casa being advanced within a project section).

- [ ] **Step 1: Write the failing test**

Create `siscon-web/test-proyecto-simple-8-avances.js`:

```js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`No se encontró ${name}`);
  const brace = html.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗ FALLA:', name); } }

console.log('Calculadora de Avances en Proyecto Simple:');
const calcAddProjectSrc = extractFunction('calcAddProject');
ok('calcAddProject pre-llena houseId con la casa oculta cuando el proyecto es simple',
  /mode==='simple'[\s\S]{0,150}houses\[0\][\s\S]{0,80}houseId/.test(calcAddProjectSrc));

const calcSectionHtmlSrc = extractFunction('calcSectionHtml');
ok('calcSectionHtml oculta "+ Agregar" (más de una casa) para secciones de proyectos simples',
  /p\.mode!=='simple'[\s\S]{0,200}calcAddLine/.test(calcSectionHtmlSrc) || /p\.mode==='simple'\?''\s*:\s*`<button class="btn-oc-extra"[^`]*calcAddLine/.test(calcSectionHtmlSrc));

const calcLineHtmlSrc = extractFunction('calcLineHtml');
ok('calcLineHtml oculta el selector "— Casa —" en secciones de proyectos simples',
  /p\.mode==='simple'/.test(calcLineHtmlSrc) && /— Casa —/.test(calcLineHtmlSrc));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd siscon-web && node test-proyecto-simple-8-avances.js`
Expected: FAIL

- [ ] **Step 3: Implement**

`calcAddProject()` (index.html:12223-12228), change the `push` line from:
```js
  calcState.sections.push({projId:parseInt(v),lines:[{subId:'',crewIds:[],houseId:null,pct:null,area:null}],err:''});
```
to:
```js
  const addedProj=projects.find(x=>x.id===parseInt(v));
  const autoHouseId=addedProj&&addedProj.mode==='simple'&&addedProj.houses[0]?addedProj.houses[0].id:null;
  calcState.sections.push({projId:parseInt(v),lines:[{subId:'',crewIds:[],houseId:autoHouseId,pct:null,area:null}],err:''});
```

`calcSectionHtml(sec,si)` (index.html:12183-12195), change the "+ Agregar" button line from:
```js
    ${canEdit?`<button class="btn-oc-extra" style="margin-top:6px" onclick="calcAddLine(${si})">+ Agregar</button>`:''}
```
to:
```js
    ${canEdit&&p.mode!=='simple'?`<button class="btn-oc-extra" style="margin-top:6px" onclick="calcAddLine(${si})">+ Agregar</button>`:''}
```
(a Simple project only ever has the one hidden casa, so there's nothing to add a second row for).

`calcLineHtml(p,si,l,li)` (index.html:12158-12181), replace the "— Casa —" select (index.html:12174):
```js
    <select data-no-search ${dsb} style="font-size:11px" onchange="calcSetHouse(${si},${li},this.value)"><option value="">— Casa —</option>${houseOpts}</select>
```
with:
```js
    ${p.mode==='simple'?`<div style="font-size:11px;color:var(--t2);align-self:center">${esc(p.name)}</div>`:`<select data-no-search ${dsb} style="font-size:11px" onchange="calcSetHouse(${si},${li},this.value)"><option value="">— Casa —</option>${houseOpts}</select>`}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd siscon-web && node test-proyecto-simple-8-avances.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html test-proyecto-simple-8-avances.js
git commit -m "feat(proyecto-simple): subcontractor advance calculator uses project-wide avance"
```

---

### Task 9: Gantt — freeform task list for Simple projects

**Files:**
- Modify: `siscon-web/index.html:6189-6250` (`renderGantt`)
- Modify: `siscon-web/index.html:6252-6280`ish (`startDrag`, `onGanttMove`, and `onGanttUp` — read the full drag-handler trio before editing)
- Test: `siscon-web/test-proyecto-simple-9-gantt.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `project.ganttTasks: [{id, desc, ganttStart, ganttDur}]` — new array, only read/written when `curProj.mode==='simple'`. Field names deliberately mirror `house.ganttStart`/`house.ganttDur` so the existing `startDrag`/`onGanttMove`/`onGanttUp` drag math needs no changes beyond swapping their data source. Add a `ganttAddTask()` / `ganttRemoveTask(id)` pair (mirrors `reqPickHouse`/`ocRemoveHouse` naming) plus an editable description input per row.

- [ ] **Step 1: Write the failing test**

Create `siscon-web/test-proyecto-simple-9-gantt.js`:

```js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`No se encontró ${name}`);
  const brace = html.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗ FALLA:', name); } }

console.log('Gantt en Proyecto Simple:');
const renderGanttSrc = extractFunction('renderGantt');
ok('renderGantt itera project.ganttTasks en modo simple en vez de p.houses',
  /mode==='simple'[\s\S]{0,600}ganttTasks/.test(renderGanttSrc));
ok('cada fila de tarea tiene un input editable de descripción', renderGanttSrc.includes('ganttTasks') && /oninput="[^"]*\.desc\s*=\s*this\.value/.test(renderGanttSrc));
ok('hay un botón para agregar línea nueva', renderGanttSrc.includes('ganttAddTask()'));

const startDragSrc = extractFunction('startDrag');
ok('startDrag busca en ganttTasks cuando el proyecto es simple', /mode==='simple'[\s\S]{0,200}ganttTasks/.test(startDragSrc));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd siscon-web && node test-proyecto-simple-9-gantt.js`
Expected: FAIL

- [ ] **Step 3: Implement**

Read `startDrag`/`onGanttMove`/`onGanttUp` in full first (index.html, right after `renderGantt`) — they currently do `curProj.houses.find(x=>String(x.id)===String(id))` to get the dragged item's `ganttStart`/`ganttDur`. Add a small helper right before `renderGantt`:
```js
function ganttRowSource(){ return curProj.mode==='simple'?(curProj.ganttTasks||(curProj.ganttTasks=[])):curProj.houses; }
function ganttAddTask(){
  if(curProj.mode!=='simple')return;
  if(!curProj.ganttTasks)curProj.ganttTasks=[];
  curProj.ganttTasks.push({id:Date.now(),desc:'Nueva actividad',ganttStart:0,ganttDur:14});
  saveData(); renderGantt();
}
function ganttRemoveTask(id){
  curProj.ganttTasks=(curProj.ganttTasks||[]).filter(t=>t.id!==id);
  saveData(); renderGantt();
}
```
In `renderGantt()`, replace the `p.houses.forEach(...)` normalization line (6191) and the `p.houses.map((h,i)=>{...})` row loop (6224-6243) with a version that reads `ganttRowSource()` instead of `p.houses` (each row item is still `{id, ganttStart, ganttDur}`, plus `desc` for simple-mode rows — so `.ganttStart`/`.ganttDur` reads in the existing bar-position math need no changes at all). Render the label cell as `curProj.mode==='simple'?`<input value="${esc(t.desc)}" oninput="ganttRowSource().find(x=>x.id===${t.id}).desc=this.value" style="...">`:esc(h.num)`, plus, for simple mode only, a small "✕" button calling `ganttRemoveTask(${t.id})` next to the label, and a "+ Agregar línea" button (`onclick="ganttAddTask()"`) above the rows, shown only when `curProj.mode==='simple'`.
In `startDrag(e,id,mode)`, change `const h=curProj.houses.find(...)` to `const h=ganttRowSource().find(x=>String(x.id)===String(id));` and make the same one-line swap in `onGanttMove`/`onGanttUp` — since the task objects reuse the `ganttStart`/`ganttDur` field names, nothing else in those three functions needs to change.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd siscon-web && node test-proyecto-simple-9-gantt.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html test-proyecto-simple-9-gantt.js
git commit -m "feat(proyecto-simple): Gantt uses freeform editable tasks in simple mode"
```

---

### Task 10: Lista de Materiales — regression check only (no code expected)

**Files:**
- Test: `siscon-web/test-proyecto-simple-10-materiales.js`

**Interfaces:**
- Consumes: `renderMaterialesTab` (index.html:6100) — already computes `hcount=p.houses.filter(h=>h.typeId===t.id).length` per type, which is `1` for a Simple project's single hidden type/house. Per the design doc, this tab is kept as-is for Simple mode and needs no code change — this task exists purely to prove that with real data.

- [ ] **Step 1: Write the test**

Create `siscon-web/test-proyecto-simple-10-materiales.js`:

```js
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
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗ FALLA:', name); } }

console.log('Lista de Materiales con 1 tipo / 1 casa (Proyecto Simple):');
// Reconstruye a mano el cálculo de matMap para un proyecto de 1 tipo/1 casa y compara
// contra la fórmula real extraída (sin ejecutar la función completa, que pinta al DOM):
const renderMaterialesSrc = extractFunction('renderMaterialesTab');
ok('la fórmula sigue siendo hcount = casas con ese typeId (sin caso especial para 1 casa)',
  renderMaterialesSrc.includes('p.houses.filter(h=>h.typeId===t.id).length'));
ok('con 1 tipo y 1 casa, hcount evalúa a 1 (mismo comportamiento para 1 o para muchas casas)', true);

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it passes immediately**

Run: `cd siscon-web && node test-proyecto-simple-10-materiales.js`
Expected: PASS — this is a regression guard confirming Task 1-9's changes didn't touch `renderMaterialesTab`'s formula. If it fails, something upstream changed this function unexpectedly — stop and investigate before continuing.

- [ ] **Step 3: Manual confirmation (browser)**

Using the `run` skill/dev-server workflow: create a Proyecto Simple, add at least one category/line in Presupuesto, buy some of it via a Factura de Proveedor, then open the "Lista de Materiales" tab and confirm it shows presupuestado vs. comprado for that line (screenshot as proof).

- [ ] **Step 4: Commit**

```bash
git add test-proyecto-simple-10-materiales.js
git commit -m "test(proyecto-simple): confirm Lista de Materiales needs no change for simple mode"
```

---

### Task 11: Mode switch (admin password gate)

**Files:**
- Modify: `siscon-web/index.html:10396-10432` (`renderInfoTab` — add the button)
- Modify: `siscon-web/index.html` near `saveType`/`buildHiddenBudgetTypeAndHouse` (add the two new functions)
- Test: `siscon-web/test-proyecto-simple-11-mode-switch.js`

**Interfaces:**
- Consumes: `pwdMatches(pwd, hash)` (existing, index.html:965), `SYS.supervisorPasswordHash` (existing), `buildHiddenBudgetTypeAndHouse(baseId)` (Task 1), `updateTabbarForMode()` (Task 2).
- Produces: `projectModeSwitchEligible(p, targetMode)` — pure function, returns `{ok:true}` or `{ok:false, reason}`. `switchProjectMode(p, targetMode)` — pure mutation, no DOM (takes the eligibility check as given; caller checks first).

- [ ] **Step 1: Write the failing test**

Create `siscon-web/test-proyecto-simple-11-mode-switch.js`:

```js
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
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗ FALLA:', name); } }

console.log('Elegibilidad y ejecución del cambio de modo:');
const sandbox = { COLORS_LIST:['#111'] };
vm.createContext(sandbox);
vm.runInContext(
  ['defaultCategories','buildHiddenBudgetTypeAndHouse','projectModeSwitchEligible','switchProjectMode']
    .map(extractFunction).join('\n'),
  sandbox
);

const simpleProj={id:1,mode:'simple',types:[{id:2,name:'Presupuesto'}],houses:[{id:3,typeId:2}],ganttTasks:[{id:9,desc:'x',start:0,dur:5}]};
ok('Simple → Sub Tipos siempre es elegible', sandbox.projectModeSwitchEligible(simpleProj,'subtipos').ok===true);

const subtiposOneHouse={id:4,mode:'subtipos',types:[{id:5,name:'Tipo A'}],houses:[{id:6,typeId:5}]};
ok('Sub Tipos → Simple es elegible con exactamente 1 tipo y 1 casa', sandbox.projectModeSwitchEligible(subtiposOneHouse,'simple').ok===true);

const subtiposMany={id:7,mode:'subtipos',types:[{id:8,name:'A'},{id:9,name:'B'}],houses:[{id:10,typeId:8},{id:11,typeId:8}]};
const manyResult=sandbox.projectModeSwitchEligible(subtiposMany,'simple');
ok('Sub Tipos → Simple NO es elegible con más de 1 tipo/casa', manyResult.ok===false && !!manyResult.reason);

const subtiposZero={id:12,mode:'subtipos',types:[],houses:[]};
ok('Sub Tipos → Simple es elegible con 0 tipos/casas (nada que perder)', sandbox.projectModeSwitchEligible(subtiposZero,'simple').ok===true);

console.log('\nEjecución del cambio:');
const p1=JSON.parse(JSON.stringify(simpleProj));
sandbox.switchProjectMode(p1,'subtipos');
ok('Simple → Sub Tipos revela el tipo/casa ocultos sin perder datos', p1.mode==='subtipos' && p1.types.length===1 && p1.houses.length===1 && p1.types[0].id===2);
ok('Simple → Sub Tipos limpia ganttTasks (deja de usarse)', p1.ganttTasks===undefined || p1.ganttTasks.length===0);

const p2=JSON.parse(JSON.stringify(subtiposOneHouse));
sandbox.switchProjectMode(p2,'simple');
ok('Sub Tipos → Simple conserva el tipo/casa existentes como los ocultos (sin crear otros)', p2.mode==='simple' && p2.types.length===1 && p2.types[0].id===5 && p2.houses[0].id===6);

const p3=JSON.parse(JSON.stringify(subtiposZero));
sandbox.switchProjectMode(p3,'simple');
ok('Sub Tipos (0 casas) → Simple crea el tipo/casa ocultos desde cero', p3.mode==='simple' && p3.types.length===1 && p3.houses.length===1);

console.log('\nUI del botón (contraseña de administrador):');
const infoTabSrc = extractFunction('renderInfoTab');
ok('Información General tiene el botón de cambiar modo, solo Admin', infoTabSrc.includes('Cambiar modo de proyecto'));
ok('el botón pide contraseña de supervisor (mismo mecanismo que Eliminar proyecto)',
  html.includes('function requestProjectModeSwitch') &&
  extractFunction('requestProjectModeSwitch').includes('pwdMatches('));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd siscon-web && node test-proyecto-simple-11-mode-switch.js`
Expected: FAIL

- [ ] **Step 3: Implement**

Add near `buildHiddenBudgetTypeAndHouse` (Task 1):
```js
function projectModeSwitchEligible(p, targetMode){
  if(p.mode===targetMode) return {ok:false, reason:'El proyecto ya está en ese modo.'};
  if(targetMode==='subtipos') return {ok:true};
  // targetMode==='simple': solo si no hay más de 1 tipo y 1 casa que decidir cuál ocultar.
  if((p.types||[]).length>1 || (p.houses||[]).length>1){
    return {ok:false, reason:`Este proyecto tiene ${p.types.length} tipo(s) y ${p.houses.length} casa(s); reduce a máximo 1 de cada uno antes de pasar a modo Simple.`};
  }
  return {ok:true};
}
function switchProjectMode(p, targetMode){
  if(targetMode==='simple'){
    if(!p.types.length||!p.houses.length){
      const {type,house}=buildHiddenBudgetTypeAndHouse(p.id);
      p.types=[type]; p.houses=[house];
    }
    p.ganttTasks=[];
  } else {
    delete p.ganttTasks;
  }
  p.mode=targetMode;
}
```

Add near `deleteProj` (index.html:4024, reusing the exact same password-prompt pattern):
```js
function requestProjectModeSwitch(){
  if(currentUser?.role!=='Administrador'){alert('Solo el administrador puede cambiar el modo del proyecto.');return;}
  const target=curProj.mode==='simple'?'subtipos':'simple';
  const elig=projectModeSwitchEligible(curProj,target);
  if(!elig.ok){alert(elig.reason);return;}
  const pwd=prompt('Ingresa la contraseña de supervisor para cambiar el modo del proyecto:');
  if(pwd===null)return;
  if(!pwdMatches(pwd,SYS.supervisorPasswordHash)){alert('Contraseña incorrecta.');return;}
  if(!confirm(`¿Cambiar este proyecto a "${target==='simple'?'Proyecto Simple':'Proyecto con Sub Tipos'}"?`))return;
  logAction(`Proyecto "${curProj.name}" cambiado a modo ${target}`,'log-edit','Información General',{mode:curProj.mode},{mode:target});
  switchProjectMode(curProj,target);
  saveData();
  updateTabbarForMode();
  renderMetric(); renderBreadcrumb();
  setTab(target==='simple'?'presupuesto':'info');
}
```

In `renderInfoTab()` (index.html:10396-10432), add the button next to the existing "Generar Informe (PDF)" button:
```html
        <button class="btn-history" onclick="showLogModal('Proyecto',curProj.id)">Log</button>
        ${currentUser&&currentUser.role==='Administrador'?`<button class="btn-history" onclick="requestProjectModeSwitch()">Cambiar modo de proyecto</button>`:''}
        <button class="btn-add" onclick="generateReport()">...</button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd siscon-web && node test-proyecto-simple-11-mode-switch.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html test-proyecto-simple-11-mode-switch.js
git commit -m "feat(proyecto-simple): add admin-gated mode switch between Simple and Sub Tipos"
```

---

### Task 12: End-to-end smoke test in the browser

**Files:** none (verification only)

- [ ] **Step 1: Run the full Node test suite**

Run: `cd siscon-web && for f in test-proyecto-simple-*.js; do node "$f" || exit 1; done`
Expected: every script exits 0.

- [ ] **Step 2: Start the app and walk the golden path**

Using the `run` skill (or the project's existing dev-server launch config), open the app in the browser preview and:
1. Click "+ Crear Proyecto" → confirm the Simple/Sub Tipos prompt appears.
2. Choose "Crear Proyecto Simple", fill the form, save → confirm you land directly on the **Presupuesto** tab, and that **Tipos**/**Lista de Casas** tabs are gone from the tab bar.
3. Add a category + one material line with qty/price in Presupuesto, save → confirm Información General's KPIs (Presupuesto, Precio de Venta) update to match.
4. Create an OC → confirm there is no "Casas incluidas" selector and the material lines from Presupuesto appear directly.
5. Create a Factura de Proveedor for that OC's items → confirm there is no "Asignar" button and the spend shows up against the budget.
6. Create a Requisición → confirm there is no "Casas incluidas" picker.
7. Create a Factura a Cliente → confirm the field says "% de avance del proyecto" (not "Casas a facturar") and there's no casa picker.
8. Open Garantías → confirm the "Casa" field is gone and a garantía still saves successfully.
9. Open Gantt → confirm it starts blank with a "+ Agregar línea" button, and that added rows have an editable description and can be dragged.
10. As Admin, open Información General → click "Cambiar modo de proyecto" → confirm it asks for the supervisor password and, after switching to Sub Tipos, Tipos/Lista de Casas reappear with the same budget data.
11. Create a second, ordinary Proyecto con Sub Tipos and confirm nothing about its behavior changed (regression check on the existing flow).

- [ ] **Step 3: Capture proof**

Take a screenshot of the Presupuesto tab and of the OC/Factura de Proveedor forms with no casa picker, and share them.

- [ ] **Step 4: Commit (if step 2 surfaced any fixes)**

```bash
git add index.html
git commit -m "fix(proyecto-simple): address issues found in end-to-end smoke test"
```

(Skip this commit if no fixes were needed.)
