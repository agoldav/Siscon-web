# Zoom en Tiempo Real + Slider en 3 Gráficas + Eje Y — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extender el slider de zoom (ya existente en "Valor de Venta por Proyecto") a las otras
3 gráficas del Dashboard, hacer el zoom en tiempo real mientras se arrastra el slider (no solo al
soltar), y agregar números de referencia a la izquierda de cada una de las 4 gráficas.

**Architecture:** Sigue viviendo todo en `siscon-web/index.html`. Se agrega un helper compartido
`chartYAxis` (líneas + etiquetas de referencia) usado por `svgChart1`/`svgNetBars` siempre y por
`svgBars` solo si se le pasa `showAxis:true`. Para el zoom en vivo, cada gráfica se envuelve en
un contenedor con id fijo y una función nueva `chartZoomLive(which,val)` reescribe solo ese
contenedor en cada tick del slider, usando datos cacheados en `_statsChartData` del último
render completo — sin tocar el resto del DOM ni guardar en cada tick.

**Tech Stack:** HTML/CSS/JS vanilla. Reutiliza `chartMarkAttrs`, `fmtShort`, `dstats()`,
`statsSet()` ya existentes de la sesión anterior.

## Global Constraints

- Cero cambio visual para cualquier llamada a `svgBars` que NO pase `zoom`/`showAxis` (todas las
  gráficas internas de un proyecto, vía `infoCharts(p)`) — se verifica byte a byte en la Tarea 1.
- No se cambia ninguna fórmula de datos — solo tamaño/interacción/presentación.
- El slider de zoom nunca debe destruirse ni perder el foco a medio arrastre.
- `siscon-backend` no se toca.

## Verificación (aplica a todas las tareas)

Mismo método de la sesión anterior: abrir `index.html` en el Browser pane sin login, y en la
consola reasignar la variable global suelta `projects` (NO `window.projects` — son bindings
distintos, confirmado la sesión pasada) con proyectos de prueba, luego llamar `renderDashStats()`
real e interactuar con `javascript_tool`/`computer`. Al final, `node --check` sobre el JS
extraído.

---

### Task 1: `chartYAxis` compartido + `svgBars` con `zoom`/`showAxis` retrocompatibles

**Files:**
- Modify: `index.html` (después de `chartGrid`, antes de `svgBars`)
- Modify: `index.html` (`svgBars`, función completa)

**Interfaces:**
- Produce: `chartYAxis(vals, padLeft, W, zoom)` — `vals` es un arreglo de `{y, val}` ya
  calculados por el llamador; dibuja línea+etiqueta por cada uno.
- Produce: `svgBars(items, zoom, showAxis)` — `zoom` y `showAxis` opcionales; sin pasarlos, el
  resultado es idéntico al de hoy.

- [ ] **Step 1: Agregar `chartYAxis`**

Justo después de la función `chartGrid` (antes de `svgBars`), agregar:

```js
function chartYAxis(vals, padLeft, W, zoom){
  zoom=+zoom||1;
  let out='';
  vals.forEach(v=>{
    out+=`<line x1="${padLeft.toFixed(1)}" y1="${v.y.toFixed(1)}" x2="${W}" y2="${v.y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`;
    out+=`<text x="${(padLeft-6*zoom).toFixed(1)}" y="${(v.y+3*zoom).toFixed(1)}" text-anchor="end" font-size="${(8*zoom).toFixed(1)}" fill="var(--t3)">${fmtShort(v.val)}</text>`;
  });
  return out;
}
```

- [ ] **Step 2: Reemplazar `svgBars`**

```js
function svgBars(items, zoom, showAxis){
  if(!items.length) return '<div style="color:var(--t3);font-size:11px;padding:20px;text-align:center">Sin datos</div>';
  zoom=+zoom||1;
  const H=190*zoom, pad=34*zoom, gap=90*zoom, max=Math.max(1,...items.map(i=>Math.abs(i.value)));
  const barTop=22*zoom, bw=42*zoom;
  const padLeft=showAxis?34*zoom:0;
  const leftOffset=showAxis?padLeft+10*zoom:30*zoom;
  const W=items.length*gap+20*zoom+padLeft;
  let bars='';
  items.forEach((it,idx)=>{
    const x=leftOffset+idx*gap;
    const h=(Math.abs(it.value)/max)*(H-pad-barTop);
    const y=H-pad-h;
    bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,h).toFixed(1)}" rx="7" fill="${it.color}"${chartMarkAttrs(it)}/>`;
    bars+=`<text x="${(x+bw/2).toFixed(1)}" y="${(y-7*zoom).toFixed(1)}" text-anchor="middle" font-size="${(10*zoom).toFixed(1)}" font-weight="600" fill="var(--t1)">${it.disp||fmtShort(it.value)}</text>`;
    bars+=`<text x="${(x+bw/2).toFixed(1)}" y="${(H-12*zoom).toFixed(1)}" text-anchor="middle" font-size="${(9*zoom).toFixed(1)}" fill="var(--t2)">${it.label}</text>`;
  });
  const axis = showAxis
    ? chartYAxis([0,max/3,max*2/3,max].map(v=>({val:v,y:H-pad-(v/max)*(H-pad-barTop)})), padLeft, W, zoom)
    : chartGrid(W,H,pad);
  const inner = axis+`<line x1="${padLeft}" y1="${H-pad}" x2="${W}" y2="${H-pad}" stroke="var(--border2)"/>${bars}`;
  const svgTag = zoom>1
    ? `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${inner}</svg>`
    : `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;height:auto">${inner}</svg>`;
  return zoom>1 ? `<div style="overflow-x:auto">${svgTag}</div>` : svgTag;
}
```

- [ ] **Step 3: Verificar retrocompatibilidad + comportamiento nuevo**

Abrir `index.html`, y en consola:

```js
// A) sin zoom/showAxis (como llaman hoy todas las gráficas internas de proyecto) debe dar
//    EXACTAMENTE el mismo string que antes de este cambio.
const items=[{label:'Materiales',value:5000,color:'#e8783a'},{label:'Mano de obra',value:3000,color:'#1db87a'}];
const out=svgBars(items);
// comparar contra una copia guardada del output pre-cambio, o inspeccionar visualmente que
// x arranca en 30, sin padLeft, con chartGrid (2 líneas sin números).

// B) con showAxis:true debe traer 4 líneas con número a la izquierda.
const out2=svgBars(items.map((it,i)=>({...it,id:i+1})), 1, true);
document.body.insertAdjacentHTML('beforeend','<div id="test-harness" style="padding:20px;background:#fff">'+out2+'</div>');
document.querySelectorAll('#test-harness text[text-anchor="end"]').length; // esperar 4
```

Confirmar con `read_page`/`screenshot` que los números de referencia aparecen a la izquierda,
alineados con las 4 líneas horizontales (incluida la línea base en 0).

- [ ] **Step 4: `node --check` + commit**

```bash
cd siscon-web && python3 -c "
import re
html=open('index.html',encoding='utf-8').read()
scripts=re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', html, re.S)
open('/tmp/_check.js','w',encoding='utf-8').write('\n;\n'.join(s for s in scripts if 'function ' in s))
"
node --check /tmp/_check.js
git add index.html
git commit -m "feat: svgBars gana zoom y eje Y opcionales (retrocompatible)"
```

---

### Task 2: `svgNetBars` con `zoom` + eje Y (diverge en cero)

**Files:**
- Modify: `index.html` (`svgNetBars`, función completa)

**Interfaces:**
- Produce: `svgNetBars(items, zoom)` — antes solo tomaba `items`; único llamador es el
  Dashboard, así que no hace falta compatibilidad con "sin zoom" más allá de `zoom` default `1`.

- [ ] **Step 1: Reemplazar `svgNetBars`**

```js
function svgNetBars(items, zoom){
  if(!items.length)return '<div style="color:var(--t3);font-size:11px;padding:20px;text-align:center">Sin proyectos seleccionados</div>';
  zoom=+zoom||1;
  const H=210*zoom,padTop=22*zoom,padBot=34*zoom,groupW=92*zoom,padLeft=34*zoom;
  const W=items.length*groupW+30*zoom+padLeft;
  const maxAbs=Math.max(1,...items.map(i=>Math.abs(i.value)));
  const half=(H-padTop-padBot)/2, zeroY=padTop+half;
  const axisVals=[maxAbs,maxAbs/2,0,-maxAbs/2,-maxAbs].map(v=>({val:v,y:zeroY-(v/maxAbs)*half}));
  let svg=chartYAxis(axisVals,padLeft,W,zoom)+`<line x1="${padLeft}" y1="${zeroY.toFixed(1)}" x2="${W}" y2="${zeroY.toFixed(1)}" stroke="var(--border2)"/>`;
  items.forEach((it,i)=>{
    const x=padLeft+10*zoom+i*groupW, h=Math.abs(it.value)/maxAbs*half, pos=it.value>=0;
    const y=pos?zeroY-h:zeroY, color=pos?'var(--grn)':'var(--red)';
    svg+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(44*zoom).toFixed(1)}" height="${Math.max(1,h).toFixed(1)}" rx="${(6*zoom).toFixed(1)}" fill="${color}"${chartMarkAttrs(it)}/>`;
    svg+=`<text x="${(x+22*zoom).toFixed(1)}" y="${(pos?y-4*zoom:y+h+12*zoom).toFixed(1)}" text-anchor="middle" font-size="${(9*zoom).toFixed(1)}" fill="var(--t1)">${fmtShort(it.value)}</text>`;
    svg+=`<text x="${(x+22*zoom).toFixed(1)}" y="${(H-10*zoom).toFixed(1)}" text-anchor="middle" font-size="${(9*zoom).toFixed(1)}" fill="var(--t2)">${it.label.length>12?it.label.slice(0,11)+'…':it.label}</text>`;
  });
  const svgTag = zoom>1
    ? `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${svg}</svg>`
    : `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;height:auto">${svg}</svg>`;
  return zoom>1 ? `<div style="overflow-x:auto">${svgTag}</div>` : svgTag;
}
```

- [ ] **Step 2: Verificar**

```js
const items=[{label:'Proyecto A',value:5000,id:1},{label:'Proyecto B',value:-2000,id:2}];
const out=svgNetBars(items,1);
document.body.insertAdjacentHTML('beforeend','<div id="test-harness" style="padding:20px;background:#fff">'+out+'</div>');
document.querySelectorAll('#test-harness text[text-anchor="end"]').length; // esperar 5 (incluye el 0)
```

Confirmar visualmente 5 referencias (positivas arriba, 0 al centro, negativas abajo).

- [ ] **Step 3: `node --check` + commit**

```bash
cd siscon-web && node --check /tmp/_check.js  # regenerar igual que en Task 1 antes de correr
git add index.html
git commit -m "feat: svgNetBars gana zoom y eje Y con referencias positivas/negativas"
```

---

### Task 3: `svgChart1` — agregar eje Y (mantiene el zoom que ya tenía)

**Files:**
- Modify: `index.html` (`svgChart1`, función completa)

- [ ] **Step 1: Reemplazar `svgChart1`**

```js
function svgChart1(items,showG,showP,zoom){
  if(!items.length)return '<div style="color:var(--t3);font-size:11px;padding:20px;text-align:center">Sin proyectos para el filtro seleccionado</div>';
  zoom=+zoom||1;
  const padLeft=34*zoom;
  const H=220*zoom,pad=42*zoom, dual=(showG||showP), groupW=(dual?130:96)*zoom, W=items.length*groupW+30*zoom+padLeft;
  const barW=36*zoom, gap2=42*zoom, fs=9*zoom, barTop=26*zoom;
  let max=1; items.forEach(it=>{ max=Math.max(max,it.venta,(showG?it.gastado:0)+(showG&&showP?it.pendiente:0),(showP&&!showG?it.pendiente:0)); });
  const bh=v=>(v/max)*(H-pad-barTop);
  const axis=chartYAxis([0,max/3,max*2/3,max].map(v=>({val:v,y:H-pad-(v/max)*(H-pad-barTop)})),padLeft,W,zoom);
  let svg=axis+`<line x1="${padLeft}" y1="${H-pad}" x2="${W}" y2="${H-pad}" stroke="var(--border2)"/>`;
  items.forEach((it,i)=>{
    const x=padLeft+10*zoom+i*groupW;
    const vh=bh(it.venta);
    svg+=`<rect x="${x.toFixed(1)}" y="${(H-pad-vh).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1,vh).toFixed(1)}" rx="${(6*zoom).toFixed(1)}" fill="var(--acc)"${chartMarkAttrs({label:'Venta · '+it.label,value:it.venta,id:it.id})}/>`;
    svg+=`<text x="${(x+barW/2).toFixed(1)}" y="${(H-pad-vh-4*zoom).toFixed(1)}" text-anchor="middle" font-size="${fs.toFixed(1)}" fill="var(--t1)">${fmtShort(it.venta)}</text>`;
    if(dual){
      const x2=x+gap2;
      if(showG){ const gh=bh(it.gastado); svg+=`<rect x="${x2.toFixed(1)}" y="${(H-pad-gh).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1,gh).toFixed(1)}" rx="${(6*zoom).toFixed(1)}" fill="var(--org)"${chartMarkAttrs({label:'Gastado · '+it.label,value:it.gastado,id:it.id})}/>`;
        if(showP){ const ph=bh(it.pendiente); svg+=`<rect x="${x2.toFixed(1)}" y="${(H-pad-gh-ph).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1,ph).toFixed(1)}" rx="${(6*zoom).toFixed(1)}" fill="var(--amb)"${chartMarkAttrs({label:'Pendiente · '+it.label,value:it.pendiente,id:it.id})}/>`; }
      } else if(showP){ const ph=bh(it.pendiente); svg+=`<rect x="${x2.toFixed(1)}" y="${(H-pad-ph).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1,ph).toFixed(1)}" rx="${(6*zoom).toFixed(1)}" fill="var(--amb)"${chartMarkAttrs({label:'Pendiente · '+it.label,value:it.pendiente,id:it.id})}/>`; }
    }
    const lblX=x+(dual?(barW/2+gap2+barW/2)/2:barW/2);
    svg+=`<text x="${lblX.toFixed(1)}" y="${(H-pad+14*zoom).toFixed(1)}" text-anchor="middle" font-size="${fs.toFixed(1)}" fill="var(--t2)">${it.label.length>13?it.label.slice(0,12)+'…':it.label}</text>`;
  });
  const svgTag = zoom>1
    ? `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${svg}</svg>`
    : `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;height:auto">${svg}</svg>`;
  return zoom>1 ? `<div style="overflow-x:auto">${svgTag}</div>` : svgTag;
}
```

- [ ] **Step 2: Verificar** — mismo patrón que las tareas anteriores: pintar con 2-3 items de
prueba, confirmar 4 `text[text-anchor="end"]` (referencias) alineadas con las líneas, y que el
click/tooltip por barra (heredado de la sesión pasada) sigue funcionando.

- [ ] **Step 3: `node --check` + commit**

```bash
git add index.html
git commit -m "feat: svgChart1 (Valor de Venta) agrega eje Y con números de referencia"
```

---

### Task 4: Zoom en vivo + sliders en las 3 gráficas restantes (`renderDashStats`)

**Files:**
- Modify: `index.html` (`dstats`)
- Modify: `index.html` (agregar `_statsChartData` + `chartZoomLive`, junto a `dstats`/`statsSet`)
- Modify: `index.html` (`renderDashStats` — las 4 tarjetas de gráfica)

**Interfaces:**
- Produce: `chartZoomLive(which, val)` — `which` ∈ `'venta'|'cash'|'unb'|'pend'`.
- Consume: `svgBars(items,zoom,showAxis)`, `svgNetBars(items,zoom)`, `svgChart1(...)` (Tasks 1-3).

- [ ] **Step 1: `dstats()` — agregar `zoomCash`/`zoomUnb`/`zoomPend`**

```js
// antes:
function dstats(){ if(!SYS.stats)SYS.stats={open:true,scope:'todos',time:'todo',from:'',to:'',showGastado:false,showPendiente:false,cashWindow:'1m',cashProjects:null,unbilledProjects:null,zoomVenta:1}; const s=SYS.stats; if(s.zoomVenta===undefined)s.zoomVenta=1; return s; }
// después:
function dstats(){ if(!SYS.stats)SYS.stats={open:true,scope:'todos',time:'todo',from:'',to:'',showGastado:false,showPendiente:false,cashWindow:'1m',cashProjects:null,unbilledProjects:null,zoomVenta:1,zoomCash:1,zoomUnb:1,zoomPend:1}; const s=SYS.stats; if(s.zoomVenta===undefined)s.zoomVenta=1; if(s.zoomCash===undefined)s.zoomCash=1; if(s.zoomUnb===undefined)s.zoomUnb=1; if(s.zoomPend===undefined)s.zoomPend=1; return s; }
```

- [ ] **Step 2: Agregar `_statsChartData` + `chartZoomLive`**

Inmediatamente después de la línea de `dstats()` de arriba, agregar:

```js
let _statsChartData=null;
function chartZoomLive(which, val){
  const d=_statsChartData; if(!d) return;
  const el=document.getElementById('chart-body-'+which); if(!el) return;
  if(which==='venta'){ dstats().zoomVenta=val; el.innerHTML=svgChart1(d.items,d.showG,d.showP,val); }
  else if(which==='cash'){ dstats().zoomCash=val; el.innerHTML=svgNetBars(d.cashRaw,val); }
  else if(which==='unb'){ dstats().zoomUnb=val; el.innerHTML=svgBars(d.unbItems,val,true); }
  else if(which==='pend'){ dstats().zoomPend=val; el.innerHTML=svgBars(d.pendPayItems,val,true); }
}
```

- [ ] **Step 3: `renderDashStats` — cachear datos, envolver gráficas, agregar sliders**

Justo antes del `return` (después de la línea `const pendPayTot=...`), agregar:

```js
  _statsChartData={items,showG:s.showGastado,showP:s.showPendiente,cashRaw,unbItems,pendPayItems};
```

Envolver la llamada a `svgChart1` en un contenedor con id, y hacer el slider existente también
"en vivo" (`oninput` además del `onchange` que ya tenía):

```js
// antes:
            <div style="display:flex;align-items:center;gap:6px" title="Zoom de la gráfica">
              <span style="font-size:11px;color:var(--t3)">🔍</span>
              <input type="range" min="1" max="2.5" step="0.25" value="${s.zoomVenta}" onchange="statsSet('zoomVenta',this.value)" style="width:90px"/>
            </div>
          </div>
        </div>
        ${svgChart1(items,s.showGastado,s.showPendiente,s.zoomVenta)}

// después:
            <div style="display:flex;align-items:center;gap:6px" title="Zoom de la gráfica">
              <span style="font-size:11px;color:var(--t3)">🔍</span>
              <input type="range" min="1" max="2.5" step="0.25" value="${s.zoomVenta}" oninput="chartZoomLive('venta',this.value)" onchange="statsSet('zoomVenta',this.value)" style="width:90px"/>
            </div>
          </div>
        </div>
        <div id="chart-body-venta">${svgChart1(items,s.showGastado,s.showPendiente,s.zoomVenta)}</div>
```

En la tarjeta "Proyección de Flujo de Efectivo", agregar el slider al bloque de controles y
envolver la gráfica:

```js
// antes:
            <div style="display:flex;gap:6px;align-items:center">
              <select onchange="statsSet('cashWindow',this.value)">${Object.keys(CASH_WINDOWS).map(k=>`<option value="${k}"${s.cashWindow===k?' selected':''}>${CASH_WINDOWS[k][1]}</option>`).join('')}</select>
              <div style="position:relative"><button class="btn-sm" onclick="statsToggle('_menuCash')">Proyectos</button>
                ${s._menuCash?`<div class="stats-menu">${projects.filter(projActive).map(p=>`<label><input type="checkbox" ${cashSel.includes(p.id)?'checked':''} onchange="statsToggleCash(${p.id})"/> ${esc(p.name)}</label>`).join('')||'<div style="font-size:11px;color:var(--t3)">Sin proyectos activos</div>'}</div>`:''}
              </div>
            </div>
          </div>
          ${svgNetBars(cashRaw)}
        </div>

// después:
            <div style="display:flex;gap:6px;align-items:center">
              <select onchange="statsSet('cashWindow',this.value)">${Object.keys(CASH_WINDOWS).map(k=>`<option value="${k}"${s.cashWindow===k?' selected':''}>${CASH_WINDOWS[k][1]}</option>`).join('')}</select>
              <div style="position:relative"><button class="btn-sm" onclick="statsToggle('_menuCash')">Proyectos</button>
                ${s._menuCash?`<div class="stats-menu">${projects.filter(projActive).map(p=>`<label><input type="checkbox" ${cashSel.includes(p.id)?'checked':''} onchange="statsToggleCash(${p.id})"/> ${esc(p.name)}</label>`).join('')||'<div style="font-size:11px;color:var(--t3)">Sin proyectos activos</div>'}</div>`:''}
              </div>
              <div style="display:flex;align-items:center;gap:6px" title="Zoom de la gráfica">
                <span style="font-size:11px;color:var(--t3)">🔍</span>
                <input type="range" min="1" max="2.5" step="0.25" value="${s.zoomCash}" oninput="chartZoomLive('cash',this.value)" onchange="statsSet('zoomCash',this.value)" style="width:90px"/>
              </div>
            </div>
          </div>
          <div id="chart-body-cash">${svgNetBars(cashRaw,s.zoomCash)}</div>
        </div>
```

En "Gastos No Facturados":

```js
// antes:
            <div style="position:relative"><button class="btn-sm" onclick="statsToggle('_menuUnbilled')">Proyectos</button>
              ${s._menuUnbilled?`<div class="stats-menu">${projects.map(p=>`<label><input type="checkbox" ${unbSel.includes(p.id)?'checked':''} onchange="statsToggleUnb(${p.id})"/> ${esc(p.name)}</label>`).join('')}</div>`:''}
            </div>
          </div>
          ${svgBars(unbItems)}
        </div>

// después:
            <div style="display:flex;gap:6px;align-items:center">
              <div style="position:relative"><button class="btn-sm" onclick="statsToggle('_menuUnbilled')">Proyectos</button>
                ${s._menuUnbilled?`<div class="stats-menu">${projects.map(p=>`<label><input type="checkbox" ${unbSel.includes(p.id)?'checked':''} onchange="statsToggleUnb(${p.id})"/> ${esc(p.name)}</label>`).join('')}</div>`:''}
              </div>
              <div style="display:flex;align-items:center;gap:6px" title="Zoom de la gráfica">
                <span style="font-size:11px;color:var(--t3)">🔍</span>
                <input type="range" min="1" max="2.5" step="0.25" value="${s.zoomUnb}" oninput="chartZoomLive('unb',this.value)" onchange="statsSet('zoomUnb',this.value)" style="width:90px"/>
              </div>
            </div>
          </div>
          <div id="chart-body-unb">${svgBars(unbItems,s.zoomUnb,true)}</div>
        </div>
```

En "Facturas Pendientes de Pago" (hoy sin ningún control en el header, solo el título):

```js
// antes:
        <div class="chart-card">
          <div style="margin-bottom:6px"><h4>Facturas Pendientes de Pago · <span style="color:var(--amb)">${fmt(pendPayTot)}</span></h4><div class="csub">Saldo por cobrar a clientes, por proyecto</div></div>
          ${svgBars(pendPayItems)}
        </div>

// después:
        <div class="chart-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:6px">
            <div><h4>Facturas Pendientes de Pago · <span style="color:var(--amb)">${fmt(pendPayTot)}</span></h4><div class="csub">Saldo por cobrar a clientes, por proyecto</div></div>
            <div style="display:flex;align-items:center;gap:6px" title="Zoom de la gráfica">
              <span style="font-size:11px;color:var(--t3)">🔍</span>
              <input type="range" min="1" max="2.5" step="0.25" value="${s.zoomPend}" oninput="chartZoomLive('pend',this.value)" onchange="statsSet('zoomPend',this.value)" style="width:90px"/>
            </div>
          </div>
          <div id="chart-body-pend">${svgBars(pendPayItems,s.zoomPend,true)}</div>
        </div>
```

- [ ] **Step 4: Verificar zoom en vivo sin destruir el slider**

```js
// (con projects/renderDashStats ya sembrados como en sesiones anteriores)
document.getElementById('test-harness').innerHTML = renderDashStats();
const slider = document.querySelector('#chart-body-unb').previousElementSibling.querySelector('input[type=range]');
const before = document.querySelector('#chart-body-unb svg').getAttribute('height');
slider.value='2';
slider.dispatchEvent(new Event('input',{bubbles:true}));
const afterLive = document.querySelector('#chart-body-unb svg').getAttribute('height');
const sliderStillThere = document.body.contains(slider); // debe seguir true — no se destruyó
```

Confirmar `afterLive` > `before` (creció) y que `sliderStillThere` es `true` (el slider no se
recreó — prueba de que `oninput` no disparó un re-render completo). Luego disparar `change` y
confirmar que `dstats().zoomUnb` quedó persistido con el valor final.

- [ ] **Step 5: `node --check` + commit**

```bash
git add index.html
git commit -m "feat: Zoom en tiempo real + slider en Flujo de Efectivo, Gastos No Facturados y Facturas Pendientes"
```

---

### Task 5: Verificación final, docs y cierre

- [ ] **Step 1: `node --check` sobre el archivo completo**
- [ ] **Step 2: Recorrido visual completo** — las 4 gráficas con sus sliders, arrastrar cada uno
  y confirmar que crecen en vivo, con eje Y visible y tooltip/click (de la sesión anterior)
  intactos.
- [ ] **Step 3: Actualizar `PROJECT_CONTEXT.md`** (ambas copias, repo + iCloud) con una entrada
  de sesión fechada describiendo las 3 mejoras.
- [ ] **Step 4: Commit de la documentación.**
- [ ] **Step 5: Push — requiere confirmación explícita del usuario antes de ejecutar.**
