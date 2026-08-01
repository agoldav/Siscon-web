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

const names = ['qboTextKey', 'qboVendorKey', 'qboBillAmount', 'qboBillMatch', 'qboFindBestBillMatch', 'qboBillAsRecord'];
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(names.map(extractFunction).join('\n'), sandbox);

let pass = 0, fail = 0;
function ok(name, condition) {
  if (condition) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name); }
}

const outlook = {
  party: 'Vidrios de Costa Rica, S.A.', invoiceNumber: '001-000045', date: '2026-07-31',
  currencyBill: 'CRC', totalCRC: 113000,
};
const qbo = sandbox.qboBillAsRecord({
  id: '81', docNumber: '001000045', txnDate: '2026-07-31', currency: 'CRC', total: 113000,
  vendor: { id: 'V9', name: 'Vidrios de Costa Rica SA' },
});

console.log('Coincidencia Outlook ↔ QuickBooks:');
const strong = sandbox.qboBillMatch(outlook, qbo);
ok('normaliza puntuación del número y razón social', strong.score >= 95 && strong.reasons.includes('numero') && strong.reasons.includes('proveedor'));
ok('monto se compara en la moneda del documento', strong.reasons.includes('monto') && strong.reasons.includes('moneda'));
ok('qboId exacto tiene prioridad absoluta', sandbox.qboBillMatch({ qboId: '81' }, { qboId: '81' }).score === 1000);
ok('mismo número con otro proveedor y otro monto no enlaza',
  sandbox.qboFindBestBillMatch(outlook, [{ bill: { party: 'Proveedor Diferente', invoiceNumber: '001000045', date: '2026-07-30', currencyBill: 'CRC', totalCRC: 99000 } }]).status === 'none');
ok('número distinto nunca enlaza aunque monto/proveedor coincidan',
  sandbox.qboBillMatch(outlook, { ...qbo, invoiceNumber: '001000046' }).score === 0);
ok('dos candidatos con la misma evidencia quedan ambiguos',
  sandbox.qboFindBestBillMatch(outlook, [{ id: 1, bill: qbo }, { id: 2, bill: { ...qbo, qboId: '82' } }]).status === 'ambiguous');
ok('un candidato fuerte único se enlaza',
  sandbox.qboFindBestBillMatch(outlook, [{ id: 1, bill: qbo }]).status === 'matched');

console.log('\nCableado sin duplicidad:');
ok('Outlook usa el matcher fuerte antes de crear la factura',
  /const localMatch=qboFindBestBillMatch\(outlookProbe/.test(html));
ok('Outlook adjunta el PDF al registro existente',
  /if\(localMatch\.status==='matched'\)[\s\S]{0,1400}msAttachPendingPdf\(existingProject,existing,bill\)/.test(html));
ok('Outlook busca duplicados en todos los proyectos, no solo en la carpeta destino',
  /projects\.forEach\(candidateProject=>\(candidateProject\.billVendor\|\|\[\]\)/.test(html));
ok('QBO enlaza sobre billVendor existente',
  /function qboSyncVendorBills[\s\S]{0,2600}qboApplyBillMatch\(result\.match\.bill/.test(html));
ok('la sincronización importa Bills nuevos solo después de descartar coincidencias',
  /function qboSyncVendorBills[\s\S]{0,6000}else \{[\s\S]{0,3000}billVendor\.push\(newBill\)/.test(html));
ok('la sincronización marca las facturas locales ausentes del proyecto QBO sin borrarlas',
  /qboProjectPresence=next/.test(html) && /No se encuentra en el proyecto/.test(html));
ok('la UI no ofrece acciones de envío o sincronización hacia QBO',
  !/Guardar y Sincronizar QBO|Enviar a QB|Guardar y Enviar/.test(html));
ok('los guardados de Siscon no llaman funciones de creación QBO',
  !/function saveClientInv\([^)]*\)[\s\S]{0,1400}qboCreateInvoice\(/.test(html) &&
  !/function saveVendorBill\([^)]*\)[\s\S]{0,1800}qboCreateGeneric\(/.test(html) &&
  !/function saveGenericTxn\([^)]*\)[\s\S]{0,1800}qboCreateGeneric\(/.test(html));

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
