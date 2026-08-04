# Tooltip, Click-a-Proyecto y Zoom en Gráficas — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar tooltip flotante (número exacto, sigue al cursor) a toda barra/segmento/punto
de cualquier gráfica SVG de la app, click-a-proyecto en las 4 gráficas del Dashboard donde cada
barra es un proyecto, filas clickeables en el detalle de "Recuperación de Dinero", y un slider
de zoom + scroll horizontal en la gráfica "Valor de Venta por Proyecto".

**Architecture:** Todo vive en un único archivo, `siscon-web/index.html` (frontend HTML+JS
vanilla, sin build step). Se agrega un componente de tooltip compartido (una `div` global + 3
funciones JS) y un helper `chartMarkAttrs(item)` que genera los atributos `data-*` y handlers
de hover/click de cualquier marca de gráfica; las funciones de dibujo (`svgBars`, `svgDonut`,
`svgLine`, `svgChart1`, `svgNetBars`) se modifican para usarlo. El click solo se activa cuando
el `item` trae un campo `id` (id de proyecto) — así una sola pieza de código cubre "tooltip en
todo" y "click solo donde aplica" sin flags nuevos.

**Tech Stack:** HTML/CSS/JS vanilla (sin frameworks, sin librerías de gráficas). Persistencia
existente `SYS.stats` vía `dstats()`/`statsSet()`/`saveData()`.

## Global Constraints

- No se cambia ninguna fórmula de datos (montos, %, filtros) — solo interacción.
- Cero cambio visual en zoom=1 (comportamiento por defecto) para la gráfica "Valor de Venta por
  Proyecto".
- Las gráficas internas de un proyecto (`infoCharts(p)`) ganan tooltip pero **no** click (sus
  items no llevan `id` de proyecto — no se les agrega).
- Seguir el patrón de escape existente: `esc()` para cualquier texto que vaya a un atributo
  HTML generado por template string.
- Sin backend/DB involucrados — todo el trabajo es en `siscon-web/index.html`.
- `siscon-backend` no se toca.

---

## Verificación (aplica a todas las tareas)

El frontend de producción exige login real contra Supabase Auth; no hay forma de levantar la
app completa sin credenciales. Pero **todas las funciones JS del archivo se definen a nivel
global apenas carga la página** — el bloque `<script>` se ejecuta entero sin lanzar excepción
aunque el usuario no haya iniciado sesión (confirmado: la única sentencia de nivel superior al
final del archivo es un `setTimeout` protegido por un chequeo de `getElementById`). Esto permite
probar cualquier función de gráfica desde la consola del navegador, sin login y sin tocar la
app real:

1. Abrir `index.html` directamente en el Browser pane (`file://.../siscon-web/index.html`).
2. Con `javascript_tool`, sembrar datos de prueba y pintar la gráfica en algún contenedor visible
   del DOM (por ejemplo, reemplazando temporalmente `#login-screen` o insertando un `div` nuevo
   en `body`), ej.:
   ```js
   const mockProjects=[
     {id:1,name:'Proyecto Alfa',salePrice:120000,budget:80000,houses:[],types:[],invClient:[],payments:[]},
     {id:2,name:'Proyecto Beta',salePrice:95000,budget:70000,houses:[],types:[],invClient:[],payments:[]},
     {id:3,name:'Proyecto Gamma Con Nombre Largo',salePrice:60000,budget:50000,houses:[],types:[],invClient:[],payments:[]}
   ];
   window.projects=mockProjects;
   window.SYS=window.SYS||{}; window.SYS.stats=undefined; // fuerza defaults de dstats()
   window.currentUser={id:1,name:'Test',role:'Administrador'};
   document.body.insertAdjacentHTML('beforeend','<div id="test-harness" style="padding:20px;max-width:900px"></div>');
   document.getElementById('test-harness').innerHTML = svgChart1(
     mockProjects.map(p=>({label:p.name,venta:p.salePrice,gastado:0,pendiente:0,id:p.id})),
     false,false
   );
   ```
3. Con `computer` (hover/click) y `read_page`/`get_page_text`/`javascript_tool`, confirmar el
   comportamiento visual y funcional descrito en cada tarea.
4. Al final de todas las tareas: `node --check` sobre el JS extraído del archivo (mismo método
   ya usado en la sesión de seguridad anterior) para confirmar que no quedó ninguna sintaxis
   rota.

No se crea ningún archivo de test nuevo en el repo — es el mismo método de verificación manual
en navegador que ya se usó en sesiones anteriores de este proyecto (no hay framework de tests
de frontend en este código).

---

### Task 1: Tooltip flotante compartido + wiring en todas las funciones de gráfica

**Files:**
- Modify: `index.html:640` (CSS, después de `.stats-menu input{width:auto;}`)
- Modify: `index.html:9417` (después de `function legend(...)`, antes del comentario `// ---- Cards de gráficos ----`)
- Modify: `index.html:9380-9393` (`svgBars`)
- Modify: `index.html:9395-9401` (`svgDonut`)
- Modify: `index.html:9403-9415` (`svgLine`)
- Modify: `index.html:11866-11879` (`svgNetBars`)
- Modify: `index.html:11881-11900` (`svgChart1`)

**Interfaces:**
- Produce: `chartTipShow(e)`, `chartTipMove(e)`, `chartTipHide()`, `chartMarkAttrs(item)` — funciones globales. `chartMarkAttrs(item)` recibe un objeto con `{label, value, id?}` y devuelve un string de atributos HTML (`data-label`, `data-value`, handlers de hover, y `onclick`+`cursor:pointer` solo si `item.id!=null`).
- Consume: `esc()` (línea 8247, ya existe), `fmt()` (línea 2811, ya existe).

- [ ] **Step 1: Agregar CSS del tooltip**

En `index.html`, después de la línea `.stats-menu input{width:auto;}` (línea 642), agregar:

```css
#chart-tip{position:fixed;display:none;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:8px 12px;box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:10050;pointer-events:none;white-space:nowrap;}
#chart-tip .ct-label{display:block;font-size:10px;font-weight:500;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px;}
#chart-tip .ct-val{display:block;font-size:16px;font-weight:700;color:var(--t1);}
```

- [ ] **Step 2: Agregar las funciones compartidas de tooltip + `chartMarkAttrs`**

En `index.html`, inmediatamente después de la línea:

```js
function legend(items){ return `<div class="chart-legend">${items.map(i=>`<span><span class="lg-dot" style="background:${i.color}"></span>${i.label}</span>`).join('')}</div>`; }
```

agregar:

```js
function chartTipEl(){
  let el=document.getElementById('chart-tip');
  if(!el){ el=document.createElement('div'); el.id='chart-tip'; el.innerHTML='<span class="ct-label"></span><span class="ct-val"></span>'; document.body.appendChild(el); }
  return el;
}
function chartTipShow(e){
  const t=e.currentTarget, label=t.dataset.label||'', value=+t.dataset.value||0;
  const el=chartTipEl();
  el.querySelector('.ct-label').textContent=label;
  el.querySelector('.ct-val').textContent=fmt(value);
  el.style.display='block';
  chartTipMove(e);
}
function chartTipMove(e){
  const el=document.getElementById('chart-tip'); if(!el||el.style.display==='none')return;
  const pad=14, r=el.getBoundingClientRect();
  let x=e.clientX+pad, y=e.clientY+pad;
  if(x+r.width>window.innerWidth-8) x=e.clientX-r.width-pad;
  if(y+r.height>window.innerHeight-8) y=e.clientY-r.height-pad;
  el.style.left=Math.max(4,x)+'px'; el.style.top=Math.max(4,y)+'px';
}
function chartTipHide(){ const el=document.getElementById('chart-tip'); if(el)el.style.display='none'; }
function chartMarkAttrs(it){
  const clk=it.id!=null?` onclick="openProj(${it.id})" style="cursor:pointer"`:'';
  return ` data-label="${esc(it.label)}" data-value="${it.value}" onmouseenter="chartTipShow(event)" onmousemove="chartTipMove(event)" onmouseleave="chartTipHide()"${clk}`;
}
```

- [ ] **Step 3: Wiring en `svgBars`**

Reemplazar la función completa (línea 9380-9393):

```js
function svgBars(items){
  if(!items.length) return '<div style="color:var(--t3);font-size:11px;padding:20px;text-align:center">Sin datos</div>';
  const H=190, pad=34, gap=90, max=Math.max(1,...items.map(i=>Math.abs(i.value)));
  const W=items.length*gap+20, bw=42;
  let bars='';
  items.forEach((it,idx)=>{
    const x=30+idx*gap;
    const h=(Math.abs(it.value)/max)*(H-pad-22);
    const y=H-pad-h;
    bars+=`<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(1,h)}" rx="7" fill="${it.color}"${chartMarkAttrs(it)}/>`;
    bars+=`<text x="${x+bw/2}" y="${y-7}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--t1)">${it.disp||fmtShort(it.value)}</text>`;
    bars+=`<text x="${x+bw/2}" y="${H-12}" text-anchor="middle" font-size="9" fill="var(--t2)">${it.label}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;height:auto">${chartGrid(W,H,pad)}<line x1="0" y1="${H-pad}" x2="${W}" y2="${H-pad}" stroke="var(--border2)"/>${bars}</svg>`;
}
```

(único cambio: se agregó `${chartMarkAttrs(it)}` dentro del `<rect>`.)

- [ ] **Step 4: Wiring en `svgDonut`**

Reemplazar la función completa (línea 9395-9401):

```js
function svgDonut(segs, centerLabel){
  const total=segs.reduce((s,x)=>s+Math.max(0,x.value),0)||1;
  const r=58,c=2*Math.PI*r,cx=78,cy=78; let off=0,arcs='';
  segs.forEach(s=>{ const len=Math.max(0,s.value)/total*c;
    arcs+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="18" stroke-linecap="round" stroke-dasharray="${Math.max(0,len-3)} ${c-len+3}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})"${chartMarkAttrs(s)}/>`;
    off+=len; });
  return `<svg viewBox="0 0 156 156" width="156" height="156"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="18"/>${arcs}<text x="78" y="74" text-anchor="middle" font-size="20" font-weight="700" fill="var(--t1)">${centerLabel||''}</text><text x="78" y="92" text-anchor="middle" font-size="9" fill="var(--t2)">consumido</text></svg>`;
}
```

- [ ] **Step 5: Wiring en `svgLine`**

Reemplazar la función completa (línea 9403-9415) — se agrega un segundo círculo transparente
más grande (`r="10"`) encima de cada punto real (`r="3"`) como área de hover, porque el punto
visible es muy chico para hacerle hover con precisión:

```js
function svgLine(pts){
  if(!pts.length) return '<div style="color:var(--t3);font-size:11px;padding:20px;text-align:center">Sin cronograma definido para proyectar flujo</div>';
  const H=190,pad=30,max=Math.max(1,...pts.map(p=>p.value));
  const W=Math.max(340,pts.length*46+40);
  const X=i=>40+i*((W-55)/Math.max(1,pts.length-1)), Y=v=>H-pad-(v/max)*(H-pad-22);
  let path='',dots='',labels=''; const step=Math.ceil(pts.length/7)||1;
  pts.forEach((p,i)=>{ const x=X(i),y=Y(p.value);
    path+=(i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)+' ';
    dots+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="var(--bg1)" stroke="#7c6fef" stroke-width="2"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" fill="transparent"${chartMarkAttrs(p)}/>`;
    if(i%step===0)labels+=`<text x="${x.toFixed(1)}" y="${H-9}" text-anchor="middle" font-size="8" fill="var(--t2)">${p.label}</text>`; });
  const area=path+`L ${X(pts.length-1).toFixed(1)} ${H-pad} L ${X(0).toFixed(1)} ${H-pad} Z`;
  const gid='lg'+(_gid++);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;height:auto"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7c6fef" stop-opacity=".28"/><stop offset="100%" stop-color="#7c6fef" stop-opacity="0"/></linearGradient></defs>${chartGrid(W,H,pad)}<line x1="0" y1="${H-pad}" x2="${W}" y2="${H-pad}" stroke="var(--border2)"/><path d="${area}" fill="url(#${gid})"/><path d="${path}" fill="none" stroke="#7c6fef" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}
```

(los puntos `p` de `svgLine` ya traen `.label`/`.value` — se le pasa `p` directo a `chartMarkAttrs`; no tienen `.id`, así que nunca ganan click, solo tooltip, tal como se decidió en el spec.)

- [ ] **Step 6: Wiring en `svgNetBars`**

Reemplazar la función completa (línea 11866-11879):

```js
function svgNetBars(items){
  if(!items.length)return '<div style="color:var(--t3);font-size:11px;padding:20px;text-align:center">Sin proyectos seleccionados</div>';
  const H=210,padTop=22,padBot=34,groupW=92,W=items.length*groupW+30;
  const maxAbs=Math.max(1,...items.map(i=>Math.abs(i.value)));
  const half=(H-padTop-padBot)/2, zeroY=padTop+half;
  let svg=chartGrid(W,H,padBot,padTop)+`<line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" stroke="var(--border2)"/>`;
  items.forEach((it,i)=>{
    const x=28+i*groupW, h=Math.abs(it.value)/maxAbs*half, pos=it.value>=0;
    const y=pos?zeroY-h:zeroY, color=pos?'var(--grn)':'var(--red)';
    svg+=`<rect x="${x}" y="${y.toFixed(1)}" width="44" height="${Math.max(1,h).toFixed(1)}" rx="6" fill="${color}"${chartMarkAttrs(it)}/>`;
    svg+=`<text x="${x+22}" y="${(pos?y-4:y+h+12).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--t1)">${fmtShort(it.value)}</text>`;
    svg+=`<text x="${x+22}" y="${H-10}" text-anchor="middle" font-size="9" fill="var(--t2)">${it.label.length>12?it.label.slice(0,11)+'…':it.label}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;height:auto">${svg}</svg>`;
}
```

- [ ] **Step 7: Wiring en `svgChart1`** (sin zoom todavía — eso es la Tarea 4)

Reemplazar la función completa (línea 11881-11900). Cada segmento (venta/gastado/pendiente) del
grupo de un proyecto gana su propio tooltip con etiqueta distinta, y hereda el `id` del item
(el click no se activa aún porque los items de `renderDashStats` todavía no traen `id` — eso es
la Tarea 2):

```js
function svgChart1(items,showG,showP){
  if(!items.length)return '<div style="color:var(--t3);font-size:11px;padding:20px;text-align:center">Sin proyectos para el filtro seleccionado</div>';
  const H=220,pad=42, dual=(showG||showP), groupW=dual?130:96, W=items.length*groupW+30;
  let max=1; items.forEach(it=>{ max=Math.max(max,it.venta,(showG?it.gastado:0)+(showG&&showP?it.pendiente:0),(showP&&!showG?it.pendiente:0)); });
  const bh=v=>(v/max)*(H-pad-26);
  let svg=chartGrid(W,H,pad)+`<line x1="0" y1="${H-pad}" x2="${W}" y2="${H-pad}" stroke="var(--border2)"/>`;
  items.forEach((it,i)=>{
    const x=25+i*groupW;
    const vh=bh(it.venta);
    svg+=`<rect x="${x}" y="${(H-pad-vh).toFixed(1)}" width="36" height="${Math.max(1,vh).toFixed(1)}" rx="6" fill="var(--acc)"${chartMarkAttrs({label:'Venta · '+it.label,value:it.venta,id:it.id})}/>`;
    svg+=`<text x="${x+18}" y="${(H-pad-vh-4).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--t1)">${fmtShort(it.venta)}</text>`;
    if(dual){
      const x2=x+42;
      if(showG){ const gh=bh(it.gastado); svg+=`<rect x="${x2}" y="${(H-pad-gh).toFixed(1)}" width="36" height="${Math.max(1,gh).toFixed(1)}" rx="6" fill="var(--org)"${chartMarkAttrs({label:'Gastado · '+it.label,value:it.gastado,id:it.id})}/>`;
        if(showP){ const ph=bh(it.pendiente); svg+=`<rect x="${x2}" y="${(H-pad-gh-ph).toFixed(1)}" width="36" height="${Math.max(1,ph).toFixed(1)}" rx="6" fill="var(--amb)"${chartMarkAttrs({label:'Pendiente · '+it.label,value:it.pendiente,id:it.id})}/>`; }
      } else if(showP){ const ph=bh(it.pendiente); svg+=`<rect x="${x2}" y="${(H-pad-ph).toFixed(1)}" width="36" height="${Math.max(1,ph).toFixed(1)}" rx="6" fill="var(--amb)"${chartMarkAttrs({label:'Pendiente · '+it.label,value:it.pendiente,id:it.id})}/>`; }
    }
    svg+=`<text x="${x+(dual?39:18)}" y="${H-pad+14}" text-anchor="middle" font-size="9" fill="var(--t2)">${it.label.length>13?it.label.slice(0,12)+'…':it.label}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;height:auto">${svg}</svg>`;
}
```

- [ ] **Step 8: Verificar en navegador**

Seguir el procedimiento de la sección "Verificación" de arriba: abrir `index.html`, sembrar
`mockProjects`, pintar `svgChart1(...)`, `svgBars(...)`, `svgNetBars(...)` en `#test-harness`.
Con `computer` mover el mouse sobre una barra: el tooltip debe aparecer junto al cursor con el
label y el valor exacto (formato `$12,345.67`, no abreviado), y debe seguir al cursor mientras
se mueve dentro de la barra. Al sacar el mouse, debe desaparecer. Como los items de prueba en
este paso no llevan `id` (excepto que se lo agregues manualmente para probar), no debe verse
cursor de manito ni disparar click todavía — eso se confirma en la Tarea 2.

- [ ] **Step 9: `node --check`**

```bash
cd siscon-web && python3 -c "
import re
html=open('index.html',encoding='utf-8').read()
scripts=re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', html, re.S)
open('/tmp/_check.js','w',encoding='utf-8').write('\n;\n'.join(s for s in scripts if 'function ' in s))
"
node --check /tmp/_check.js
```

Expected: sin salida (éxito).

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "feat: Tooltip flotante con número exacto en todas las gráficas SVG de la app"
```

---

### Task 2: Click-a-proyecto en las 4 gráficas del Dashboard

**Files:**
- Modify: `index.html:11915` (`items`, para `svgChart1`)
- Modify: `index.html:11918` (`cashRaw`, para `svgNetBars`)
- Modify: `index.html:11921` (`unbItems`, para `svgBars`)
- Modify: `index.html:11925` (`pendPayItems`, para `svgBars`)

**Interfaces:**
- Consume: `chartMarkAttrs` (Task 1) — ya implementado y esperando el campo `id` en cada item.
- No produce interfaces nuevas — solo agrega datos a estructuras existentes.

- [ ] **Step 1: Agregar `id:p.id` a los 4 arreglos de items en `renderDashStats`**

```js
// línea 11915 — antes:
  const items=list.map(p=>({label:p.name,venta:p.salePrice||0,gastado:projGastado(p),pendiente:projPendienteGasto(p)}));
// después:
  const items=list.map(p=>({label:p.name,venta:p.salePrice||0,gastado:projGastado(p),pendiente:projPendienteGasto(p),id:p.id}));
```

```js
// línea 11918 — antes:
  const cashRaw=projects.filter(p=>projActive(p)&&cashSel.includes(p.id)).map(p=>{const c=projCashflowNet(p,cw[0]);return {label:p.name,value:c.net,eg:c.egreso,ing:c.ingreso};});
// después:
  const cashRaw=projects.filter(p=>projActive(p)&&cashSel.includes(p.id)).map(p=>{const c=projCashflowNet(p,cw[0]);return {label:p.name,value:c.net,eg:c.egreso,ing:c.ingreso,id:p.id};});
```

```js
// línea 11921 — antes:
  const unbItems=projects.filter(p=>unbSel.includes(p.id)).map(p=>({label:p.name,value:projUnbilled(p),color:'#e24b4a'}));
// después:
  const unbItems=projects.filter(p=>unbSel.includes(p.id)).map(p=>({label:p.name,value:projUnbilled(p),color:'#e24b4a',id:p.id}));
```

```js
// línea 11925 — antes:
  const pendPayItems=projects.map(p=>({label:p.name,value:pendPay(p),color:'#d4941a'})).filter(x=>x.value>0.01);
// después:
  const pendPayItems=projects.map(p=>({label:p.name,value:pendPay(p),color:'#d4941a',id:p.id})).filter(x=>x.value>0.01);
```

- [ ] **Step 2: Verificar en navegador**

Con el mismo procedimiento de la Tarea 1, pero esta vez pintando `svgChart1` con
`mockProjects.map(p=>({label:p.name,venta:p.salePrice,gastado:0,pendiente:0,id:p.id}))` (ya con
`id`). Confirmar con `computer`:
- El cursor cambia a manito al pasar sobre cualquier barra.
- Al hacer click sobre una barra de "Proyecto Beta" (id:2), se llama `openProj(2)` — se puede
  confirmar reemplazando temporalmente `window.openProj=id=>console.log('openProj called with', id)`
  antes de pintar la gráfica, y leyendo la consola con `read_console_messages` después del
  click.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: Click en barras del Dashboard navega al proyecto correspondiente"
```

---

### Task 3: Recuperación de Dinero — filas de detalle clickeables

**Files:**
- Modify: `index.html:11800-11811` (tabla de detalle dentro de `globalRecoveryCardHtml`)

**Interfaces:**
- Consume: `openProj(id)` (línea 3705, ya existe).

- [ ] **Step 1: Agregar click + hover a cada `<tr>` del detalle**

```js
// antes (dentro de globalRecoveryCardHtml, dentro del bloque `${s.recOpen?...}`):
      <table class="rec-table" style="width:100%">
        <thead><tr><th>Proyecto</th><th class="r">Gastado</th><th class="r">Facturado</th><th class="r">Pendiente</th><th style="width:120px">Recuperado</th></tr></thead>
        <tbody>${det.length?det.map(({p,r})=>`<tr>
          <td style="color:var(--t1)">${esc(p.name)}</td>
          <td class="r">${fmt(r.spent)}</td>
          <td class="r" style="color:var(--grn)">${fmt(r.billed)}</td>
          <td class="r" style="color:${r.pend>0?'var(--amb)':'var(--grn)'}">${r.pend>0?fmt(r.pend):'—'}</td>
          <td><div style="display:flex;align-items:center;gap:6px"><div class="rec-bar-wrap" style="flex:1;height:6px;margin-top:0"><div class="rec-bar" style="width:${r.pct}%;background:${r.pctRaw!=null&&r.pctRaw>=100?'var(--grn)':'var(--amb)'}"></div></div><span style="font-size:10px;color:var(--t3);min-width:32px;text-align:right">${r.pctRaw==null?'—':r.pctRaw+'%'}</span></div></td>
        </tr>`).join(''):'<tr><td colspan="5" style="color:var(--t3);font-size:11px">Sin proyectos</td></tr>'}</tbody>
      </table>

// después:
      <table class="rec-table" style="width:100%">
        <thead><tr><th>Proyecto</th><th class="r">Gastado</th><th class="r">Facturado</th><th class="r">Pendiente</th><th style="width:120px">Recuperado</th></tr></thead>
        <tbody>${det.length?det.map(({p,r})=>`<tr style="cursor:pointer" onclick="openProj(${p.id})" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''" title="Ir a ${esc(p.name)}">
          <td style="color:var(--t1)">${esc(p.name)}</td>
          <td class="r">${fmt(r.spent)}</td>
          <td class="r" style="color:var(--grn)">${fmt(r.billed)}</td>
          <td class="r" style="color:${r.pend>0?'var(--amb)':'var(--grn)'}">${r.pend>0?fmt(r.pend):'—'}</td>
          <td><div style="display:flex;align-items:center;gap:6px"><div class="rec-bar-wrap" style="flex:1;height:6px;margin-top:0"><div class="rec-bar" style="width:${r.pct}%;background:${r.pctRaw!=null&&r.pctRaw>=100?'var(--grn)':'var(--amb)'}"></div></div><span style="font-size:10px;color:var(--t3);min-width:32px;text-align:right">${r.pctRaw==null?'—':r.pctRaw+'%'}</span></div></td>
        </tr>`).join(''):'<tr><td colspan="5" style="color:var(--t3);font-size:11px">Sin proyectos</td></tr>'}</tbody>
      </table>
```

- [ ] **Step 2: Verificar en navegador**

Sembrar `mockProjects`, llamar `globalRecoveryCardHtml(mockProjects)` con
`window.SYS.stats.recOpen=true` (para que el detalle esté expandido) e insertarlo en
`#test-harness`. Confirmar visualmente con `read_page`/`screenshot` que las filas muestran
`cursor:pointer` y, con `window.openProj=id=>console.log('openProj',id)`, que el click en una
fila dispara la llamada con el `id` correcto.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: Filas de detalle en Recuperación de Dinero navegan al proyecto"
```

---

### Task 4: Slider de zoom en "Valor de Venta por Proyecto"

**Files:**
- Modify: `index.html:11902` (`dstats`)
- Modify: `index.html:11881-11900` (`svgChart1` — ya modificado en Task 1, se modifica de nuevo para agregar el parámetro `zoom`)
- Modify: `index.html:11930-11944` (header + llamada de la tarjeta "Valor de Venta por Proyecto" dentro de `renderDashStats`)

**Interfaces:**
- Consume: `statsSet(k,v)` (línea 11904, ya existe — guarda + re-renderiza).
- Produce: `svgChart1(items,showG,showP,zoom)` — cuarto parámetro nuevo, opcional (default `1`).

- [ ] **Step 1: Agregar `zoomVenta` a `dstats()` con migración para instalaciones existentes**

```js
// antes:
function dstats(){ if(!SYS.stats)SYS.stats={open:true,scope:'todos',time:'todo',from:'',to:'',showGastado:false,showPendiente:false,cashWindow:'1m',cashProjects:null,unbilledProjects:null}; return SYS.stats; }
// después:
function dstats(){ if(!SYS.stats)SYS.stats={open:true,scope:'todos',time:'todo',from:'',to:'',showGastado:false,showPendiente:false,cashWindow:'1m',cashProjects:null,unbilledProjects:null,zoomVenta:1}; const s=SYS.stats; if(s.zoomVenta===undefined)s.zoomVenta=1; return s; }
```

(el chequeo `if(s.zoomVenta===undefined)` es necesario porque los usuarios que ya tienen
`SYS.stats` guardado en Supabase no van a pasar por la rama `if(!SYS.stats)` — mismo patrón de
migración de campo que ya usa el código en otros lados, ej. `SYS.googleMapsKey===undefined`.)

- [ ] **Step 2: `svgChart1` — agregar parámetro `zoom` y escalar tamaños**

Reemplazar la función completa (la versión de Task 1) por:

```js
function svgChart1(items,showG,showP,zoom){
  if(!items.length)return '<div style="color:var(--t3);font-size:11px;padding:20px;text-align:center">Sin proyectos para el filtro seleccionado</div>';
  zoom=+zoom||1;
  const H=220*zoom,pad=42*zoom, dual=(showG||showP), groupW=(dual?130:96)*zoom, W=items.length*groupW+30*zoom;
  const barW=36*zoom, gap2=42*zoom, fs=9*zoom;
  let max=1; items.forEach(it=>{ max=Math.max(max,it.venta,(showG?it.gastado:0)+(showG&&showP?it.pendiente:0),(showP&&!showG?it.pendiente:0)); });
  const bh=v=>(v/max)*(H-pad-26*zoom);
  let svg=chartGrid(W,H,pad,18*zoom)+`<line x1="0" y1="${H-pad}" x2="${W}" y2="${H-pad}" stroke="var(--border2)"/>`;
  items.forEach((it,i)=>{
    const x=25*zoom+i*groupW;
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

Con `zoom=1` (default), el resultado es matemáticamente idéntico al de la Task 1 (todo
`*1` no cambia ningún número) y usa la misma rama `width:100%` de siempre — cero cambio visual.
Con `zoom>1` todo crece proporcional (barras, texto, alto) y el SVG se renderiza a tamaño real
en píxeles dentro de un contenedor con scroll horizontal.

- [ ] **Step 3: Agregar el slider al header de la tarjeta + pasar `zoomVenta` a la llamada**

```js
// antes (dentro de renderDashStats, dentro del div de controles de la tarjeta "Valor de Venta"):
            <div style="position:relative"><button class="btn-sm" onclick="statsToggle('_menuInfo')">+ Agregar Información</button>
              ${s._menuInfo?`<div class="stats-menu"><label><input type="checkbox" ${s.showGastado?'checked':''} onchange="statsToggle('showGastado')"/> Dinero gastado por proyecto</label><label><input type="checkbox" ${s.showPendiente?'checked':''} onchange="statsToggle('showPendiente')"/> Dinero pendiente de gastar</label></div>`:''}
            </div>
          </div>
        </div>
        ${svgChart1(items,s.showGastado,s.showPendiente)}

// después:
            <div style="position:relative"><button class="btn-sm" onclick="statsToggle('_menuInfo')">+ Agregar Información</button>
              ${s._menuInfo?`<div class="stats-menu"><label><input type="checkbox" ${s.showGastado?'checked':''} onchange="statsToggle('showGastado')"/> Dinero gastado por proyecto</label><label><input type="checkbox" ${s.showPendiente?'checked':''} onchange="statsToggle('showPendiente')"/> Dinero pendiente de gastar</label></div>`:''}
            </div>
            <div style="display:flex;align-items:center;gap:6px" title="Zoom de la gráfica">
              <span style="font-size:11px;color:var(--t3)">🔍</span>
              <input type="range" min="1" max="2.5" step="0.25" value="${s.zoomVenta}" onchange="statsSet('zoomVenta',this.value)" style="width:90px"/>
            </div>
          </div>
        </div>
        ${svgChart1(items,s.showGastado,s.showPendiente,s.zoomVenta)}
```

(se usa `onchange` en vez de `oninput` a propósito: `statsSet` llama `updateStats()`, que
reemplaza el `innerHTML` de toda la sección — incluido el propio slider. Con `oninput`, cada
tick del arrastre destruiría y recrearía el control a medio arrastre. `onchange` solo dispara
al soltar, evitando ese problema, igual que el resto de los controles `<select>` de esta misma
sección.)

- [ ] **Step 4: Verificar en navegador**

Con el procedimiento estándar: sembrar 8-10 `mockProjects` (para forzar overflow de ancho),
pintar la tarjeta completa (header + `svgChart1`) en `#test-harness`, y con `computer`:
- Confirmar que en zoom=1 se ve igual que antes de esta tarea (sin scrollbar si los proyectos
  caben).
- Mover el slider a 2.5x (`form_input` sobre el `<input type="range">`, disparando `change`) y
  confirmar que la gráfica crece en altura/tamaño de letra y que aparece scroll horizontal
  dentro de la tarjeta cuando los proyectos no caben — probado con `read_page`/`screenshot` y
  revisando `scrollWidth`/`clientWidth` del contenedor vía `javascript_tool`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: Slider de zoom + scroll horizontal en gráfica Valor de Venta por Proyecto"
```

---

### Task 5: Verificación final, documentación y cierre

**Files:**
- Modify: `PROJECT_CONTEXT.md` (repo `siscon-web/` y copia maestra en iCloud)

- [ ] **Step 1: `node --check` sobre el archivo completo tras las 4 tareas**

```bash
cd siscon-web && python3 -c "
import re
html=open('index.html',encoding='utf-8').read()
scripts=re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', html, re.S)
open('/tmp/_check_final.js','w',encoding='utf-8').write('\n;\n'.join(s for s in scripts if 'function ' in s))
"
node --check /tmp/_check_final.js
```

Expected: sin salida (éxito).

- [ ] **Step 2: Recorrido visual completo en navegador**

Con `mockProjects` (8-10 proyectos, variando montos), pintar en `#test-harness` la sección
completa de `renderDashStats()` (con `SYS.stats.open=true`, `recOpen=true`) para ver las 5
piezas juntas en su contexto real (Valor de Venta con slider, Recuperación de Dinero con filas
clickeables, Flujo de Efectivo, Gastos No Facturados, Facturas Pendientes de Pago). Confirmar
con `computer`: hover con tooltip en cada una, click navega (mock `openProj`), zoom + scroll en
la primera tarjeta.

- [ ] **Step 3: Actualizar `PROJECT_CONTEXT.md`**

Agregar una entrada de sesión fechada 2026-08-03 en la Sección 9 (Completado) describiendo las
4 mejoras (tooltip en todas las gráficas, click-a-proyecto en las 4 gráficas del Dashboard,
filas de Recuperación de Dinero clickeables, slider de zoom en Valor de Venta), en el mismo
formato que las sesiones anteriores. Sincronizar la copia de `siscon-web/PROJECT_CONTEXT.md`
con la copia maestra en iCloud (`cp` en ambos sentidos, igual que en la sesión de seguridad
anterior).

- [ ] **Step 4: Commit de la documentación**

```bash
git add PROJECT_CONTEXT.md
git commit -m "docs: Registrar sesión de tooltip/click/zoom en gráficas en PROJECT_CONTEXT.md"
```

- [ ] **Step 5: Push (requiere confirmación explícita del usuario antes de ejecutar)**

```bash
git push origin main
```
