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
vm.runInContext(['ocIsComplete', 'parseComprobanteName', 'ocsListasParaPagar',
  'ocDiasSinFactura', 'ocsPagadasSinFactura'].map(extractFunction).join('\n'), sandbox);

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

// ============================================================
// Ronda de arreglo — bugs del brief original (no del agente anterior):
// 1) logAction() atribuía el pago a curProj (global, puede ser null u otro proyecto) en vez
//    de al proyecto dueño de la OC.
// 2) ocOpenPagoModal() no impedía registrar un segundo pago sobre la misma OC.
// ============================================================

console.log('\nlogAction — atribuye al proyecto dueño de la OC, no a curProj (fix):');
ok('ocConfirmPago le pasa el proyecto dueño (proj) a logAction, no depende de curProj implícito',
  /function ocConfirmPago[\s\S]{0,3000}logAction\([\s\S]{0,400},\s*proj\)\s*;/.test(html));

// Prueba de comportamiento real: se extrae logAction del archivo y se ejecuta en un sandbox
// aislado con curProj apuntando a un proyecto DISTINTO del dueño de la OC — reproduce
// exactamente el escenario del bug (modal de pago global abierto con otro proyecto activo).
const logSandbox = {
  activityLog: [],
  currentUser: { name: 'Tester' },
  curProj: { id: 999, name: 'Proyecto Global Abierto (no el dueño de la OC)' },
  saveData: () => {},
};
vm.createContext(logSandbox);
vm.runInContext(extractFunction('logAction'), logSandbox);

logSandbox.logAction('Pago registrado para "OC-1" (Transferencia)', 'log-create', 'OC', null,
  { num: 'OC-1' }, { id: 42, name: 'Proyecto Dueño de la OC' });
const entryConProjOverride = logSandbox.activityLog[0];
ok('con projOverride, la entrada de auditoría queda con el proyecto dueño de la OC (no curProj)',
  entryConProjOverride.projectId === 42 && entryConProjOverride.projectName === 'Proyecto Dueño de la OC',
  JSON.stringify({ projectId: entryConProjOverride.projectId, projectName: entryConProjOverride.projectName }));

logSandbox.logAction('Acción cualquiera sin override', 'log-edit', 'OC', null, { x: 1 });
const entrySinOverride = logSandbox.activityLog[0];
ok('sin projOverride, las ~80 llamadas existentes siguen usando curProj exactamente como antes (retrocompatible)',
  entrySinOverride.projectId === 999 && entrySinOverride.projectName === 'Proyecto Global Abierto (no el dueño de la OC)');

logSandbox.curProj = null;
logSandbox.logAction('Acción sin override y sin curProj', 'log-edit', 'OC', null, { x: 1 });
const entrySinCurProj = logSandbox.activityLog[0];
ok('sin projOverride y con curProj null, el comportamiento previo (huérfano) se mantiene intacto',
  entrySinCurProj.projectId === null && entrySinCurProj.projectName === null);

console.log('\nocOpenPagoModal — candado de pago duplicado (fix):');
ok('ocOpenPagoModal rechaza abrir el modal si la OC ya tiene un pago registrado',
  /function ocOpenPagoModal[\s\S]{0,900}if\(oc\.pago\)\{[\s\S]{0,250}alert\([\s\S]{0,250}return;\s*\}/.test(html));
ok('la guarda de pago duplicado corre ANTES de armar el contexto del modal (_ocPagoCtx=)',
  /function ocOpenPagoModal[\s\S]{0,900}if\(oc\.pago\)[\s\S]{0,250}return;[\s\S]{0,150}_ocPagoCtx=/.test(html));
ok('el mensaje de pago duplicado informa cuándo (fmtDate) y quién (registradoPor) lo registró',
  /if\(oc\.pago\)\{[\s\S]{0,250}fmtDate\(oc\.pago\.fecha\)[\s\S]{0,150}registradoPor/.test(html));
ok('la guarda de pago duplicado sigue después de la guarda existente de ocIsComplete (no la reemplaza)',
  /function ocOpenPagoModal[\s\S]{0,500}ocIsComplete\(oc\)[\s\S]{0,250}if\(oc\.pago\)/.test(html));

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

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
