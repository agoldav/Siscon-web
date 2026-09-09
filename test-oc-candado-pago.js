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
vm.runInContext(['ocIsComplete', 'parseComprobanteName'].map(extractFunction).join('\n'), sandbox);

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

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
