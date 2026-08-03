# Importar cotización (PDF/Excel) para crear un Tipo de Vivienda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dentro de la pantalla "Crear Tipo" de Siscon, agregar un botón "Importar" que acepte
un PDF (cotización) o un Excel/CSV, extraiga las líneas de material (descripción, cantidad,
costo), intente reconocerlas contra el catálogo de materiales existente, y precargue el
formulario normal de Crear Tipo (editable) para revisión antes de guardar.

**Architecture:** Todo el cambio vive en un único archivo (`siscon-web/index.html`, app de una
sola página, sin build step). Dos rutas de lectura (PDF/imagen vía OCR de Claude; Excel/CSV vía
SheetJS) convergen en una función compartida que arma `ctCategories`/`ctForm` — el mismo estado
global que ya usa el editor manual de Crear Tipo — y llama a `renderCreateType()`. No se crea
ninguna pantalla de revisión nueva: la revisión/edición es el formulario existente, ya
pre-llenado.

**Tech Stack:** JavaScript vanilla (sin frameworks), SheetJS (`XLSX`, cargado dinámicamente,
igual que hoy), API de Anthropic vía el proxy existente `claudeCall()` → `/api/claude`.

## Global Constraints

- No se escribe nunca a QuickBooks ni a ningún catálogo global de materiales (QB es de solo
  lectura, regla dura de seguridad del proyecto). Un producto sin match se agrega solo dentro
  del Tipo que se está creando.
- El precio de cada línea siempre viene del documento importado, nunca del catálogo, aunque
  haya match por nombre.
- Las líneas de Tipo nunca guardan un `matId` de catálogo persistente — siguen el patrón ya
  establecido en `selectMatFromCatalog` (línea ~4301 al momento de escribir este plan):
  `matId:0, manualName:<nombre>`. Un match solo cambia qué texto queda en `manualName`
  (nombre canónico del catálogo en vez del texto crudo del documento).
- El importador solo aplica al crear un Tipo nuevo (`!typeEditId`), no al editar uno existente
  ni al presupuesto de una Garantía (`!isGar`).
- Después de cada tarea: verificar sintaxis de todo el archivo con el comando de Node de la
  Tarea 6 antes de dar la tarea por buena (no solo al final).
- Commits en `siscon-web/` (repo `agoldav/Siscon-web`). No hacer `git push` hasta la Tarea 6
  (verificación final), salvo que el usuario pida lo contrario.

---

### Task 1: `ctMatchCatalog()` — buscar un material existente por descripción

**Files:**
- Modify: `siscon-web/index.html` — agregar función nueva inmediatamente después de
  `matsCatalogFind` (al momento de escribir este plan, esa función termina en la línea 2844,
  justo antes de `const DOC_TYPES=...` en la línea 2845).

**Interfaces:**
- Produces: `function ctMatchCatalog(desc)` → devuelve el objeto `{id,name,price,unit,...}` del
  catálogo (`matsCatalog()`) que mejor coincide con `desc`, o `null` si no hay ninguno.
  Usado por la Tarea 2.

- [ ] **Step 1: Agregar la función**

Con la herramienta Edit, en `siscon-web/index.html`, busca este texto (línea ~2836-2844):

```
function matsCatalogFind(matId){
  // Look in both QB catalog and MATS for backward compat
  if(typeof matId==='string'&&matId.startsWith('qbo:')){
    const qboId=matId.slice(4);
    const it=(SYS.qbo&&SYS.qbo.itemCache||[]).find(x=>String(x.id)===qboId);
    return it?{id:matId,name:it.name,price:it.price||0,unit:it.unit||'unid'}:null;
  }
  return MATS.find(x=>x.id===matId)||null;
}
```

y reemplázalo por:

```
function matsCatalogFind(matId){
  // Look in both QB catalog and MATS for backward compat
  if(typeof matId==='string'&&matId.startsWith('qbo:')){
    const qboId=matId.slice(4);
    const it=(SYS.qbo&&SYS.qbo.itemCache||[]).find(x=>String(x.id)===qboId);
    return it?{id:matId,name:it.name,price:it.price||0,unit:it.unit||'unid'}:null;
  }
  return MATS.find(x=>x.id===matId)||null;
}
// Busca por descripción (normalizada) en el catálogo activo (QB o MATS). Exacto primero,
// si no hay, coincidencia parcial en cualquier dirección. No crea nada, solo busca.
function ctMatchCatalog(desc){
  const norm=s=>String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
  const target=norm(desc);
  if(!target) return null;
  const catalog=matsCatalog();
  let hit=catalog.find(m=>norm(m.name)===target);
  if(hit) return hit;
  hit=catalog.find(m=>{ const n=norm(m.name); return n && (n.includes(target)||target.includes(n)); });
  return hit||null;
}
```

- [ ] **Step 2: Verificar sintaxis del archivo**

Run:
```bash
cd "siscon-web" && node -e "
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const m=html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
try{ new Function(m[1]); console.log('OK syntax'); }catch(e){ console.log('SYNTAX ERROR:', e.message); }
"
```
Expected: `OK syntax`

- [ ] **Step 3: Probar la función aislada con datos sintéticos**

Run:
```bash
node -e "
function matsCatalog(){ return [
  {id:1,name:'Glanze 2.95m - Color - Humo',unit:'unid',price:43.50},
  {id:2,name:'Tornillo Autorroscante 1 pulg',unit:'unid',price:0.05},
]; }
function ctMatchCatalog(desc){
  const norm=s=>String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
  const target=norm(desc);
  if(!target) return null;
  const catalog=matsCatalog();
  let hit=catalog.find(m=>norm(m.name)===target);
  if(hit) return hit;
  hit=catalog.find(m=>{ const n=norm(m.name); return n && (n.includes(target)||target.includes(n)); });
  return hit||null;
}
console.log('Exacto:', ctMatchCatalog('glanze 2.95m - color - humo'));
console.log('Parcial (documento más corto):', ctMatchCatalog('Glanze 2.95m'));
console.log('Sin match:', ctMatchCatalog('Producto que no existe'));
console.log('Vacío:', ctMatchCatalog(''));
"
```
Expected: primeras dos líneas devuelven el objeto `{id:1,...}` de Glanze; la tercera y cuarta
devuelven `null`.

- [ ] **Step 4: Commit**

```bash
cd "siscon-web" && git add index.html && git commit -m "$(cat <<'EOF'
Add ctMatchCatalog() — busca material existente por descripción para el importador de Tipos

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `ctApplyImportedCatMap()` — arma el Tipo y precarga el formulario

**Files:**
- Modify: `siscon-web/index.html` — agregar función nueva. Se añadirá justo antes de
  `function ctImportExcelPicker()` (línea ~4507 al momento de escribir este plan), para
  mantener juntas las funciones de importación.

**Interfaces:**
- Consumes: `ctMatchCatalog(desc)` (Task 1); globals `curProj`, `ctForm`, `ctCategories`,
  `showCreate`, `typeEditId`, `ctIVA`, `SYS`, `COLORS_LIST`; funciones existentes
  `renderBreadcrumb()`, `renderCreateType()`, `showToast(msg)`, `tcGet()`.
- Produces: `function ctApplyImportedCatMap(catMap, meta)` donde `catMap` es
  `{ [nombreCategoria]: [{name, qty, price, unit}, ...] }` y `meta` es
  `{typeName, area, margen, xr, fileName}`. Deja `ctCategories`/`ctForm` listos y muestra el
  formulario de Crear Tipo. Usado por la Tarea 3 (Excel) y la Tarea 4 (PDF/OCR).

- [ ] **Step 1: Agregar la función**

Con Edit, busca (línea ~4506-4510):

```
// ========== IMPORTAR TIPO DESDE EXCEL ==========
function ctImportExcelPicker(){
```

y reemplázalo por:

```
// ========== IMPORTAR TIPO (cotización PDF/Excel) ==========
// Arma ctCategories/ctForm a partir de un catMap ya parseado (de Excel o de OCR) y abre
// el formulario normal de Crear Tipo, pre-llenado, para revisión/edición antes de guardar.
// No escribe a ningún catálogo global: si una línea matchea, solo cambia manualName al
// nombre canónico del catálogo; el precio siempre es el del documento.
function ctApplyImportedCatMap(catMap, meta){
  const catNames=Object.keys(catMap);
  const totalLines=catNames.reduce((s,k)=>s+catMap[k].length,0);
  if(!totalLines){ alert('No se encontraron materiales en el archivo. Verifica que el formato tenga columnas de Descripción/Material, Cantidad y Precio o Total.'); return; }
  let matchedCount=0;
  const p=curProj;
  const newId=Date.now();
  const categories=catNames.map((catName,ci)=>({
    id:'c-'+newId+'-'+ci,
    name:catName,
    lines:catMap[catName].map((l,li)=>{
      const hit=ctMatchCatalog(l.name);
      if(hit) matchedCount++;
      return {
        id:'l-'+newId+'-'+ci+'-'+li,
        matId:0,
        manualName: hit ? hit.name : l.name,
        qty:l.qty,
        price:l.price,
        unit:l.unit||'unid',
        currency:'USD'
      };
    })
  }));
  showCreate=true; typeEditId=null; ctIVA=false;
  ctForm={name:meta.typeName||'Tipo Importado',area:meta.area||0,budget:0,salePrice:0,utilityPct:0,
    margen:meta.margen||30,adminPct:2,notes:'',color:COLORS_LIST[(p?p.types.length:0)%COLORS_LIST.length],
    utilidad:'',exchangeRate:meta.xr||SYS.exchangeRate||tcGet()};
  ctCategories=categories;
  renderBreadcrumb(); renderCreateType();
  showToast(`✓ ${totalLines} línea(s) importada(s) desde "${meta.fileName||'archivo'}". ${matchedCount} coincidieron con el catálogo.`);
}
function ctImportExcelPicker(){
```

- [ ] **Step 2: Verificar sintaxis del archivo**

Run el mismo comando del Task 1 Step 2. Expected: `OK syntax`

- [ ] **Step 3: Probar la función aislada con datos sintéticos**

Run:
```bash
node -e "
// Stubs de las dependencias globales, igual de simples que las del app real
function matsCatalog(){ return [{id:1,name:'Glanze 2.95m - Color - Humo',unit:'unid',price:43.50}]; }
function ctMatchCatalog(desc){
  const norm=s=>String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
  const target=norm(desc); if(!target) return null;
  const catalog=matsCatalog();
  let hit=catalog.find(m=>norm(m.name)===target); if(hit) return hit;
  hit=catalog.find(m=>{ const n=norm(m.name); return n && (n.includes(target)||target.includes(n)); });
  return hit||null;
}
let showCreate,typeEditId,ctIVA,ctForm,ctCategories;
const curProj={types:[]};
const SYS={exchangeRate:520};
const COLORS_LIST=['#111','#222'];
function tcGet(){return 520;}
let breadcrumbCalled=false, renderCalled=false, toastMsg='';
function renderBreadcrumb(){breadcrumbCalled=true;}
function renderCreateType(){renderCalled=true;}
function showToast(m){toastMsg=m;}

$(cat 2>/dev/null || true)
"
```

  (El bloque anterior de `matsCatalog`/`ctMatchCatalog` se repite intencionalmente igual que en
  la Tarea 1 — es un script aislado, no importa el archivo real.) Ahora, en el mismo `node -e`,
  pega la función real copiada tal cual del archivo (la del Step 1) después de los stubs, y
  agrega al final:

```js
ctApplyImportedCatMap(
  {Importado:[{name:'Glanze 2.95m',qty:2,price:40,unit:'unid'},{name:'Producto nuevo',qty:1,price:15,unit:'unid'}]},
  {typeName:'Cotización Casa X',area:80,margen:25,xr:520,fileName:'cotizacion.pdf'}
);
console.log('ctForm.name:', ctForm.name);
console.log('ctForm.margen:', ctForm.margen);
console.log('categorías:', ctCategories.length, 'líneas:', ctCategories[0].lines.length);
console.log('línea 1 (match):', ctCategories[0].lines[0].manualName, ctCategories[0].lines[0].price);
console.log('línea 2 (sin match):', ctCategories[0].lines[1].manualName, ctCategories[0].lines[1].price);
console.log('breadcrumb/render llamados:', breadcrumbCalled, renderCalled);
console.log('toast:', toastMsg);
```

Expected:
- `ctForm.name: Cotización Casa X`, `ctForm.margen: 25`
- `categorías: 1 líneas: 2`
- línea 1: `manualName` = `'Glanze 2.95m - Color - Humo'` (nombre canónico del catálogo, **no**
  "Glanze 2.95m"), `price` = `40` (precio del documento, no el 43.50 del catálogo)
- línea 2: `manualName` = `'Producto nuevo'`, `price` = `15`
- `breadcrumb/render llamados: true true`
- `toast:` contiene `2 línea(s) importada(s)` y `1 coincidieron con el catálogo`

- [ ] **Step 4: Commit**

```bash
cd "siscon-web" && git add index.html && git commit -m "$(cat <<'EOF'
Add ctApplyImportedCatMap() — arma el Tipo importado y precarga el formulario de Crear Tipo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Reemplazar el importador de Excel viejo por el flujo compartido

**Files:**
- Modify: `siscon-web/index.html`:
  - `renderTypes()` (línea ~4002-4014 al momento de escribir): quitar el botón
    "📥 Importar desde Excel" y el `<input id="ct-excel-input">`.
  - `ctImportExcelPicker` / `ctImportExcelFile` / `ctParseExcelRows` / `ctImportConfirm`
    (línea ~4507-4670 al momento de escribir): quitar `ctImportExcelPicker` y
    `ctImportConfirm` (quedan huérfanas); cambiar la firma de `ctImportExcelFile` para recibir
    un `File` en vez de un `<input>`; extender `ctParseExcelRows` con detección de columna
    Total y cambiar su final para llamar a `ctApplyImportedCatMap` en vez de abrir el modal de
    vista previa.

**Interfaces:**
- Consumes: `ctApplyImportedCatMap(catMap, meta)` (Task 2).
- Produces: `async function ctImportExcelFile(file)` — toma un objeto `File` (Excel/CSV), lo
  parsea y termina en `ctApplyImportedCatMap`. Usado por la Tarea 5 (el dispatcher del botón
  nuevo).

- [ ] **Step 1: Quitar el botón viejo de la lista de Tipos**

Con Edit, en `renderTypes()`, busca:

```
        <button class="btn-history" onclick="showLogModal('Tipos',curProj.id)">Log</button>
        <button class="btn-add" style="background:transparent;border:1px solid var(--grn);color:var(--grn)" onclick="ctImportExcelPicker()" title="Importar tipo desde archivo Excel"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:2px"><path d="M12 3v10"/><path d="M8 9l4 4 4-4"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg> Importar desde Excel</button>
        <input type="file" id="ct-excel-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="ctImportExcelFile(this)"/>
        <button class="btn-add" onclick="openCreateType(null)">+ Crear Tipo</button>
```

y reemplázalo por:

```
        <button class="btn-history" onclick="showLogModal('Tipos',curProj.id)">Log</button>
        <button class="btn-add" onclick="openCreateType(null)">+ Crear Tipo</button>
```

- [ ] **Step 2: Quitar `ctImportExcelPicker`, cambiar la firma de `ctImportExcelFile`**

Con Edit, busca:

```
function ctImportExcelPicker(){
  const inp=document.getElementById('ct-excel-input');
  if(inp){ inp.value=''; inp.click(); }
}
async function ctImportExcelFile(inp){
  const file=inp.files&&inp.files[0]; if(!file) return;
  showToast('Leyendo archivo…');
```

y reemplázalo por:

```
async function ctImportExcelFile(file){
  if(!file) return;
  showToast('Leyendo archivo…');
```

- [ ] **Step 3: Agregar detección de columna Total**

Con Edit, busca (dentro de `ctParseExcelRows`, bloque de detección de encabezados):

```
      const priceIdx=row.findIndex(c=>/precio|price|costo|unit/.test(c));
      const unitIdx=row.findIndex(c=>/unidad|unit\b|ud\b|und\b/.test(c));
      const curIdx=row.findIndex(c=>/moneda|currency|divisa/.test(c));
      if(matIdx>=0||catIdx>=0){
        headerRow=r;
        headers={cat:catIdx,mat:matIdx>=0?matIdx:catIdx,qty:qtyIdx,price:priceIdx,unit:unitIdx,cur:curIdx};
        break;
      }
    }
  }
  // Si no encontró encabezados, asumir formato simple: col0=categoría col1=material col2=unidad col3=cantidad col4=precio col5=moneda
  if(headerRow<0){
    headerRow=0;
    headers={cat:0,mat:1,qty:3,price:4,unit:2,cur:5};
    // Si col1 vacía y col0 tiene datos, asumir col0=material
    const firstDataRow=rows.find(r=>r.some(c=>c!==''));
    if(firstDataRow&&String(firstDataRow[1]||'').trim()==='') headers={cat:-1,mat:0,qty:2,price:3,unit:1,cur:4};
  }
```

y reemplázalo por:

```
      const priceIdx=row.findIndex(c=>/precio|price|costo|unit/.test(c));
      const totalIdx=row.findIndex(c=>/total|importe/.test(c));
      const unitIdx=row.findIndex(c=>/unidad|unit\b|ud\b|und\b/.test(c));
      const curIdx=row.findIndex(c=>/moneda|currency|divisa/.test(c));
      if(matIdx>=0||catIdx>=0){
        headerRow=r;
        headers={cat:catIdx,mat:matIdx>=0?matIdx:catIdx,qty:qtyIdx,price:priceIdx,total:totalIdx,unit:unitIdx,cur:curIdx};
        break;
      }
    }
  }
  // Si no encontró encabezados, asumir formato simple: col0=categoría col1=material col2=unidad col3=cantidad col4=precio col5=moneda
  if(headerRow<0){
    headerRow=0;
    headers={cat:0,mat:1,qty:3,price:4,total:-1,unit:2,cur:5};
    // Si col1 vacía y col0 tiene datos, asumir col0=material
    const firstDataRow=rows.find(r=>r.some(c=>c!==''));
    if(firstDataRow&&String(firstDataRow[1]||'').trim()==='') headers={cat:-1,mat:0,qty:2,price:3,total:-1,unit:1,cur:4};
  }
```

- [ ] **Step 4: Usar Total cuando no hay columna de Precio unitario**

Con Edit, busca:

```
    const qty=parseFloat(String(row[headers.qty>=0?headers.qty:3]||'0').replace(/[^0-9.,]/g,'').replace(',','.'))||1;
    const priceRaw=parseFloat(String(row[headers.price>=0?headers.price:4]||'0').replace(/[^0-9.,]/g,'').replace(',','.'))||0;
    const unit=String(headers.unit>=0?row[headers.unit]||'':'unid').trim()||'unid';
```

y reemplázalo por:

```
    const qty=parseFloat(String(row[headers.qty>=0?headers.qty:3]||'0').replace(/[^0-9.,]/g,'').replace(',','.'))||1;
    let priceRaw;
    if(headers.price>=0){
      priceRaw=parseFloat(String(row[headers.price]||'0').replace(/[^0-9.,]/g,'').replace(',','.'))||0;
    } else if(headers.total>=0){
      const totalRaw=parseFloat(String(row[headers.total]||'0').replace(/[^0-9.,]/g,'').replace(',','.'))||0;
      priceRaw=qty>0?totalRaw/qty:0;
    } else {
      priceRaw=parseFloat(String(row[4]||'0').replace(/[^0-9.,]/g,'').replace(',','.'))||0;
    }
    const unit=String(headers.unit>=0?row[headers.unit]||'':'unid').trim()||'unid';
```

- [ ] **Step 5: Cambiar el final de `ctParseExcelRows` para usar el flujo compartido**

Con Edit, busca desde `const catNames=Object.keys(catMap);` hasta el cierre de
`ctImportConfirm` (el bloque completo que arma el modal de vista previa y la función
`ctImportConfirm`):

```
  const catNames=Object.keys(catMap);
  if(catNames.length===0){ alert('No se encontraron materiales en el archivo. Verifica que el formato tenga columnas de Categoría, Material, Cantidad y Precio.'); return; }

  // --- Mostrar modal de vista previa
  const totalLines=catNames.reduce((s,k)=>s+catMap[k].length,0);
  const totalCost=catNames.reduce((s,k)=>s+catMap[k].reduce((ss,l)=>ss+l.qty*l.price,0),0);
  document.getElementById('modal-inner').innerHTML=`
```

Reemplaza solo este fragmento inicial por:

```
  ctApplyImportedCatMap(catMap,{typeName,area,margen:utilidad,xr:xrMeta,fileName});
}
function ctImportExcelFile_unused_marker(){
  document.getElementById('modal-inner').innerHTML=`
```

Ahora, más abajo en el mismo archivo, busca el cierre de esa vista previa junto con toda la
función `ctImportConfirm` (el bloque que sigue inmediatamente):

```
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
        <button class="btn-add" onclick="ctImportConfirm(${JSON.stringify(catMap).split('"').join('&q;')})">✓ Crear Tipo</button>
      </div>
    </div>`;
  // Guardar catMap en variable global para evitar problemas de escape en onclick
  window._ctImportCatMap=catMap;
  document.getElementById('modal-inner').querySelector('.btn-add').onclick=()=>ctImportConfirm();
  document.getElementById('modal').classList.remove('hidden');
}
function ctImportConfirm(){
  const catMap=window._ctImportCatMap; if(!catMap) return;
  const name=(document.getElementById('ct-imp-name')?.value||'').trim()||'Tipo Importado';
  const area=parseFloat(document.getElementById('ct-imp-area')?.value)||0;
  const utilidad=parseFloat(document.getElementById('ct-imp-util')?.value)||0;
  const xr=parseFloat(document.getElementById('ct-imp-xr')?.value)||SYS.exchangeRate||tcGet();
  const p=curProj;
  const newId=Date.now();
  const categories=Object.entries(catMap).map(([catName,lines],ci)=>({
    id:'c-'+newId+'-'+ci,
    name:catName,
    lines:lines.map((l,li)=>({
      id:'l-'+newId+'-'+ci+'-'+li,
      matId:0,
      manualName:l.name,
      qty:l.qty,
      price:l.price,
      unit:l.unit||'unid',
      currency:'USD'
    }))
  }));
```

Reemplaza TODO ese bloque (desde `<div style="display:flex;gap:8px;justify-content:flex-end">`
hasta la línea `}));` que cierra el `.map` de categories, inclusive) por nada (bórralo). El
resto de `ctImportConfirm` que queda después (el cálculo de `matCost`/`salePrice`/`newType` y
el `curProj.types.push(...)`) también se borra — vuelve a leer el archivo con Read después de
este Step para confirmar dónde termina exactamente `ctImportConfirm` (el cierre `}` antes de la
siguiente función) y bórralo completo, junto con el marcador temporal
`function ctImportExcelFile_unused_marker(){` que quedó del reemplazo anterior (bórralo también
— era solo un ancla para no dejar el archivo con `<div style="display:flex..."` colgando entre
dos ediciones; al final NO debe quedar ninguna función con ese nombre en el archivo).

- [ ] **Step 6: Verificar sintaxis del archivo**

Run el comando del Task 1 Step 2. Expected: `OK syntax`. Si falla, es casi seguro que quedó
código huérfano del modal de vista previa o de `ctImportConfirm` sin borrar del todo — vuelve a
leer la zona de `ctParseExcelRows` completa con Read y compárala contra el Step 5 hasta que
`ctParseExcelRows` termine exactamente en
`ctApplyImportedCatMap(catMap,{typeName,area,margen:utilidad,xr:xrMeta,fileName});\n}` y no
existan `ctImportExcelPicker`, `ctImportConfirm` ni `ctImportExcelFile_unused_marker` en todo
el archivo (`grep -n` esos tres nombres debe devolver 0 resultados).

- [ ] **Step 7: Probar el parseo de Excel con datos sintéticos (formato cotización simple, solo Total)**

Run:
```bash
node -e "
function tcGet(){return 520;}
const SYS={exchangeRate:520};
let appliedCatMap=null, appliedMeta=null;
function ctApplyImportedCatMap(catMap,meta){ appliedCatMap=catMap; appliedMeta=meta; }

$(sed -n '/^function ctParseExcelRows/,/^}/p' "siscon-web/index.html")

const rows=[
  ['Descripción','Cantidad','Total'],
  ['Glanze 2.95m','2','86.00'],
  ['Producto nuevo','1','15.00'],
];
ctParseExcelRows(rows,'cotizacion_casaX.xlsx');
console.log('categorías detectadas:', Object.keys(appliedCatMap));
console.log('línea 1:', appliedCatMap['Materiales'][0]);
console.log('meta.typeName:', appliedMeta.typeName);
"
```
Expected: una sola categoría (el fallback `lastCat='Materiales'`, ya que el Excel no trae
columna de Categoría), línea 1 con `price: 43` (86.00 total / 2 = precio unitario 43),
`meta.typeName: cotizacion casaX` (nombre derivado del archivo, sin extensión).

(Nota: `sed -n '/^function ctParseExcelRows/,/^}/p'` extrae la función tal cual quedó en el
archivo real — así la prueba corre el código real, no una copia que se puede desincronizar. Si
`ctParseExcelRows` ya no empieza exactamente con `function ctParseExcelRows` en su propia línea,
ajusta el patrón del `sed` antes de correr esto.)

- [ ] **Step 8: Commit**

```bash
cd "siscon-web" && git add index.html && git commit -m "$(cat <<'EOF'
Replace standalone Excel type-importer with the shared import pipeline

El botón "Importar desde Excel" de la lista de Tipos y su flujo directo
(ctImportExcelPicker/ctImportConfirm, sin revisión) se eliminan. ctParseExcelRows
ahora detecta también columna Total (para cotizaciones sin precio unitario) y
termina en ctApplyImportedCatMap, que precarga el formulario editable de Crear
Tipo en vez de crear el Tipo directo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Importar cotización en PDF/imagen vía OCR de Claude

**Files:**
- Modify: `siscon-web/index.html` — agregar `ctImportOcr` y `ctImportOcrRun` justo después de
  `ctImportExcelFile` (queda junto al resto de funciones de importación de Tipos).

**Interfaces:**
- Consumes: `claudeCall(body)` (proxy existente a `/api/claude`), `ocrShowProgress()`,
  `closeModal()`, `tcGet()`, `ctApplyImportedCatMap` (Task 2).
- Produces: `function ctImportOcr(file)` — toma un `File` (PDF o imagen), lo lee y dispara el
  OCR. Usado por la Tarea 5 (dispatcher del botón).

- [ ] **Step 1: Agregar las funciones**

Con Edit, busca el final de `ctImportExcelFile` tal como quedó tras la Tarea 3 (el `reader.readAsArrayBuffer(file);\n}` que cierra esa función) y agrega inmediatamente después:

```
async function ctImportOcr(file){
  const reader=new FileReader();
  reader.onload=()=>{ const b64=(reader.result+'').split(',')[1]; ctImportOcrRun(b64,file.type,file.name); };
  reader.onerror=()=>{ alert('No se pudo leer el archivo.'); };
  reader.readAsDataURL(file);
}
async function ctImportOcrRun(b64,mime,fileName){
  const _progIv=ocrShowProgress();
  const isPdf=/pdf/i.test(mime||'');
  const block=isPdf?{type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}}
                   :{type:'image',source:{type:'base64',media_type:mime||'image/jpeg',data:b64}};
  const prompt='Eres un extractor de datos de cotizaciones de materiales de construcción costarricenses. Devuelve SOLO un JSON válido (sin texto adicional, sin markdown) con esta forma exacta: {"currency":"CRC o USD","lines":[{"desc":"descripción del producto","qty":numero,"total":monto_total_de_la_línea}]}. El campo total es el monto final de esa línea (cantidad × precio unitario, ya con cualquier descuento de esa línea aplicado). Usa punto como separador decimal. Ignora líneas de subtotal, IVA o total general.';
  try{
    const d=await claudeCall({model:'claude-sonnet-4-5',max_tokens:1800,messages:[{role:'user',content:[block,{type:'text',text:prompt}]}]});
    let txt=(d.content&&d.content.find(c=>c.type==='text')&&d.content.find(c=>c.type==='text').text)||'';
    txt=txt.replace(/```json/gi,'').replace(/```/g,'').trim();
    const m=txt.match(/\{[\s\S]*\}/); if(m)txt=m[0];
    const data=JSON.parse(txt);
    clearInterval(_progIv); closeModal();
    if(!Array.isArray(data.lines)||!data.lines.length){ alert('No se encontraron líneas de productos en el documento.'); return; }
    const xr=SYS.exchangeRate||tcGet();
    const isCRC=(data.currency||'').toUpperCase()==='CRC';
    const lines=data.lines.map(l=>{
      const qty=parseFloat(l.qty)||1;
      const totalRaw=parseFloat(l.total)||0;
      const totalUSD=isCRC?totalRaw/xr:totalRaw;
      return {name:String(l.desc||'').trim(),qty,price:qty>0?totalUSD/qty:0,unit:'unid'};
    }).filter(l=>l.name);
    if(!lines.length){ alert('No se encontraron líneas de productos en el documento.'); return; }
    const typeName=fileName.replace(/\.(pdf|jpe?g|png)$/i,'').replace(/[_-]/g,' ').trim()||'Tipo Importado';
    ctApplyImportedCatMap({Importado:lines},{typeName,area:0,margen:30,xr,fileName});
  }catch(e){
    clearInterval(_progIv); closeModal();
    alert('No se pudo leer el documento automáticamente (revisa conexión a la API de Claude). Puedes ingresar los materiales manualmente.');
  }
}
```

- [ ] **Step 2: Verificar sintaxis del archivo**

Run el comando del Task 1 Step 2. Expected: `OK syntax`

- [ ] **Step 3: Probar la conversión de moneda y cálculo de precio unitario con un `claudeCall` simulado**

Run:
```bash
node -e "
let appliedCatMap=null, appliedMeta=null;
function ctApplyImportedCatMap(catMap,meta){ appliedCatMap=catMap; appliedMeta=meta; }
function ocrShowProgress(){ return setInterval(()=>{},999999); }
function closeModal(){}
function tcGet(){return 520;}
const SYS={exchangeRate:520};
async function claudeCall(body){
  return {content:[{type:'text',text:JSON.stringify({currency:'CRC',lines:[
    {desc:'Glanze 2.95m - Color - Humo',qty:2,total:44720},
    {desc:'Producto nuevo',qty:1,total:7800}
  ]})}]};
}

$(sed -n '/^async function ctImportOcrRun/,/^}/p' "siscon-web/index.html")

(async()=>{
  await ctImportOcrRun('base64fake','application/pdf','cotizacion_casaY.pdf');
  console.log('meta:', appliedMeta);
  console.log('línea 1 (CRC 44720/2/520):', appliedCatMap.Importado[0]);
  console.log('línea 2 (CRC 7800/1/520):', appliedCatMap.Importado[1]);
})();
"
```
Expected: línea 1 con `price` ≈ `43` (44720 ₡ ÷ 2 ÷ 520 = 43.00 USD/unid), línea 2 con `price`
≈ `15` (7800 ₡ ÷ 1 ÷ 520 = 15.00 USD/unid), `meta.typeName: 'cotizacion casaY'`.

(Igual que en la Tarea 3, el `sed` extrae `ctImportOcrRun` tal cual quedó en el archivo real
para probar el código real, no una copia.)

- [ ] **Step 4: Commit**

```bash
cd "siscon-web" && git add index.html && git commit -m "$(cat <<'EOF'
Add ctImportOcr/ctImportOcrRun — importar cotización en PDF/imagen vía OCR de Claude

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Botón "Importar" dentro de Crear Tipo

**Files:**
- Modify: `siscon-web/index.html` — `renderCreateType()` (el bloque de encabezado, línea
  ~4120-4125 al momento de escribir este plan). Agregar dos funciones dispatcher nuevas junto
  a `ctImportOcr`/`ctImportOcrRun` (final de la Tarea 4).

**Interfaces:**
- Consumes: `ctImportOcr(file)` (Task 4), `ctImportExcelFile(file)` (Task 3).
- Produces: `function ctImportFilePicker()` (onclick del botón), `function
  ctImportFilePicked(inp)` (onchange del input, decide la ruta por tipo de archivo). Es el
  punto de entrada final visible al usuario.

- [ ] **Step 1: Agregar el botón y el input oculto en el encabezado de Crear Tipo**

Con Edit, busca (dentro de `renderCreateType()`):

```
      <div class="th-title">${isGar?('Presupuesto · Garantía '+(gw?gw.num:'')+(gw&&gw.house?' · '+gw.house:'')):(typeEditId?'Editar Tipo':'Crear Nuevo Tipo')}${(typeEditId && (curProj.types.find(t=>t.id===typeEditId)||{}).typeLocked)?` <span title="Tipo bloqueado — solicita desbloqueo al administrador" style="font-size:12px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span>`:''}</div>
      ${!isGar?`<button class="btn-history" onclick="showLogModal('Tipos',curProj.id)" style="margin-left:auto">Log</button>`:''}
    </div>
```

y reemplázalo por:

```
      <div class="th-title">${isGar?('Presupuesto · Garantía '+(gw?gw.num:'')+(gw&&gw.house?' · '+gw.house:'')):(typeEditId?'Editar Tipo':'Crear Nuevo Tipo')}${(typeEditId && (curProj.types.find(t=>t.id===typeEditId)||{}).typeLocked)?` <span title="Tipo bloqueado — solicita desbloqueo al administrador" style="font-size:12px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span>`:''}</div>
      ${(!isGar&&!typeEditId)?`<button class="btn-add" style="margin-left:auto;background:transparent;border:1px solid var(--grn);color:var(--grn)" onclick="ctImportFilePicker()" title="Importar cotización (PDF o Excel)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:2px"><path d="M12 3v10"/><path d="M8 9l4 4 4-4"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg> Importar</button><input type="file" id="ct-import-input" accept=".xlsx,.xls,.csv,.pdf,image/*" style="display:none" onchange="ctImportFilePicked(this)"/>`:''}
      ${!isGar?`<button class="btn-history" onclick="showLogModal('Tipos',curProj.id)" style="${(!isGar&&!typeEditId)?'':'margin-left:auto'}">Log</button>`:''}
    </div>
```

- [ ] **Step 2: Agregar las funciones dispatcher**

Con Edit, busca el final de `ctImportOcrRun` tal como quedó tras la Tarea 4 (el `}` que cierra
esa función) y agrega inmediatamente después:

```
function ctImportFilePicker(){
  const inp=document.getElementById('ct-import-input');
  if(inp){ inp.value=''; inp.click(); }
}
function ctImportFilePicked(inp){
  const file=inp.files&&inp.files[0]; if(!file) return;
  if(/pdf|image/i.test(file.type||'')||/\.pdf$/i.test(file.name||'')){
    ctImportOcr(file);
  } else {
    ctImportExcelFile(file);
  }
}
```

- [ ] **Step 3: Verificar sintaxis del archivo**

Run el comando del Task 1 Step 2. Expected: `OK syntax`

- [ ] **Step 4: Verificar que el botón aparece/desaparece según el caso**

Run:
```bash
node -e "
const fs=require('fs');
const html=fs.readFileSync('siscon-web/index.html','utf8');
const start=html.indexOf('function renderCreateType(){');
const chunk=html.slice(start,start+3200);
const hasImportBtn=/ctImportFilePicker\(\)/.test(chunk);
const hasImportInput=/id=\"ct-import-input\"/.test(chunk);
console.log('Botón Importar presente en renderCreateType:', hasImportBtn);
console.log('Input de importación presente:', hasImportInput);
console.log('Condición usa !isGar&&!typeEditId:', /\(!isGar&&!typeEditId\)\?\`<button class=\"btn-add\"/.test(chunk));
"
```
Expected: las tres líneas en `true`. (Esta prueba solo confirma que el string está en el lugar
correcto con la condición correcta; la verificación visual real de que el botón se oculta al
editar un Tipo o en Garantías se hace en la Tarea 6 al probar en el navegador de producción.)

- [ ] **Step 5: Commit**

```bash
cd "siscon-web" && git add index.html && git commit -m "$(cat <<'EOF'
Add "Importar" button inside Crear Tipo — entry point for the quote importer

Botón visible solo al crear un Tipo nuevo (no al editar, no en Garantías).
Despacha a ctImportOcr (PDF/imagen) o ctImportExcelFile (Excel/CSV) según el
tipo de archivo elegido.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Verificación final, documentación y publicación

**Files:**
- Modify: `PROJECT_CONTEXT.md` (iCloud, la copia maestra) y `siscon-web/PROJECT_CONTEXT.md`
  (deben quedar idénticos — agregar entrada de sesión en la Sección 9 ✅ Completado).

**Interfaces:** Ninguna — tarea de cierre, sin código nuevo.

- [ ] **Step 1: Verificación de sintaxis completa (whole-file, no solo el bloque `<script>`)**

Run:
```bash
cd "siscon-web" && node -e "
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const re=/<script[^>]*>([\s\S]*?)<\/script>/g;
let m, i=0, allOk=true;
while((m=re.exec(html))){
  i++;
  if(!m[1].trim()) continue;
  try{ new Function(m[1]); console.log('Block',i,'OK'); }
  catch(e){ allOk=false; console.log('Block',i,'SYNTAX ERROR:', e.message); }
}
console.log(allOk?'TODO OK':'HAY ERRORES');
"
```
Expected: `Block 1 OK` y `TODO OK`.

- [ ] **Step 2: Confirmar que no queda código muerto de la implementación vieja**

Run:
```bash
cd "siscon-web" && grep -n "ctImportExcelPicker\|ctImportConfirm\|ct-excel-input\|ctImportExcelFile_unused_marker\|_ctImportCatMap" index.html
```
Expected: sin resultados (grep no imprime nada, exit code 1).

- [ ] **Step 3: Actualizar `PROJECT_CONTEXT.md` (ambas copias)**

Con Edit, en la copia iCloud (`/Users/abraham/Library/Mobile Documents/com~apple~CloudDocs/1-AI/1. App Administración de Proyectos - Claude/PROJECT_CONTEXT.md`), agrega una nueva entrada de sesión fechada hoy en la Sección 9 (✅ Completado), justo antes de `## 10. ⏳ Pendiente`, describiendo brevemente lo implementado (botón Importar en Crear Tipo, OCR de cotizaciones PDF, extensión de Excel con columna Total, match contra catálogo sin escribir a QB/MATS, eliminación del importador viejo). Luego copia el archivo completo a `siscon-web/PROJECT_CONTEXT.md`:

```bash
cp "/Users/abraham/Library/Mobile Documents/com~apple~CloudDocs/1-AI/1. App Administración de Proyectos - Claude/PROJECT_CONTEXT.md" "/Users/abraham/Library/Mobile Documents/com~apple~CloudDocs/1-AI/1. App Administración de Proyectos - Claude/siscon-web/PROJECT_CONTEXT.md"
```

- [ ] **Step 4: Commit y push**

```bash
cd "siscon-web" && git add index.html PROJECT_CONTEXT.md && git commit -m "$(cat <<'EOF'
Feature: importar cotización (PDF/Excel) para crear Tipo de Vivienda

Botón "Importar" dentro de Crear Tipo acepta PDF/imagen (OCR vía Claude) o
Excel/CSV (con detección de columna Total, además del formato Categoría/
Material/Precio ya existente). Cada línea se intenta matchear por descripción
contra el catálogo de materiales activo (QB o MATS); el match solo ajusta el
nombre mostrado, el precio siempre es el del documento y no se escribe nada a
ningún catálogo global. Las líneas quedan precargadas en el formulario normal
de Crear Tipo para revisión/edición antes de guardar. Reemplaza el importador
de Excel standalone de la lista de Tipos (sin paso de revisión).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)" && git push origin main
```

- [ ] **Step 5: Verificación manual en producción (a cargo del usuario)**

Esto no se puede automatizar porque `app.sisconcr.com` exige login real con Supabase Auth vía
Cloudflare Access — el agente no tiene esas credenciales y no debe pedirlas. Pide al usuario
que, una vez Vercel despliegue, confirme en el navegador:
1. Abrir un proyecto → pestaña Tipos → el botón viejo "📥 Importar desde Excel" ya no está.
2. "+ Crear Tipo" → aparece el botón "Importar" (no aparece si luego abre "Editar Tipo" sobre
   uno existente).
3. Subir un Excel de cotización simple (Descripción/Cantidad/Total, sin columna Categoría) →
   las líneas aparecen en una categoría "Importado", editable.
4. Subir un PDF de cotización real → toast de confirmación con el conteo de líneas y de
   coincidencias con el catálogo; los nombres que matchean con QB/MATS se ven correctos.
5. Editar una línea manualmente (cambiar cantidad/precio/nombre) y guardar el Tipo → se guarda
   sin errores y los montos del Tipo son correctos.

## Self-review

- **Cobertura del spec:** punto de entrada (Task 5), lectura PDF (Task 4), lectura Excel con
  columna Total (Task 3), match contra catálogo sin tocar catálogos globales (Task 1+2),
  precio siempre del documento (Task 2, verificado explícitamente en el test), revisión/edición
  reutilizando el formulario existente (Task 2, vía `ctForm`/`ctCategories`/`renderCreateType`),
  reemplazo del importador viejo (Task 3), manejo de errores (Task 3 Step 6 alert, Task 4 catch
  con alert) — todo cubierto.
- **Placeholders:** ninguno; cada step tiene código completo y comandos ejecutables reales.
- **Consistencia de tipos/nombres:** `ctApplyImportedCatMap(catMap, meta)` se usa con la misma
  forma en Task 3 (`{typeName,area,margen,xr,fileName}`) y Task 4 (mismo shape). `catMap` es
  siempre `{ [categoria]: [{name,qty,price,unit}] }` en ambos caminos. Revisado sin
  contradicciones.
