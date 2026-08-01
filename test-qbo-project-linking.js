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

const proyectoA = { id: 'A', name: 'Condominio Roble', invClient: [], billVendor: [] };
const proyectoB = { id: 'B', name: 'Condominio Cedro', invClient: [], billVendor: [] };
const sandbox = { projects: [proyectoA, proyectoB], SYS: { unclassified: [] } };
vm.createContext(sandbox);
vm.runInContext([
  'qboProjectName', 'qboTransactionProjectRefs', 'qboResolveProject',
  'qboBindProjectId', 'qboApplyProjectLink', 'qboMoveRecord',
].map(extractFunction).join('\n'), sandbox);

let pass = 0, fail = 0;
function ok(name, condition) {
  if (condition) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name); }
}

console.log('Vínculo QuickBooks ProjectRef → proyecto Siscon:');
const invoice = { project: { id: 'P10' } };
const catalog = [{ id: 'P10', name: 'Condominio Roble' }];
const invoiceMatch = sandbox.qboResolveProject(invoice, catalog);
ok('Invoice ProjectRef se resuelve por el nombre exacto del catálogo', invoiceMatch.status === 'matched' && invoiceMatch.project === proyectoA);
ok('el nombre no se aproxima ni ignora mayúsculas',
  sandbox.qboResolveProject(invoice, [{ id: 'P10', name: 'condominio roble' }]).status === 'unresolved');

const oneProjectBill = { projectRefs: [{ id: 'P10' }, { id: 'P10' }] };
ok('varias líneas del mismo proyecto se consolidan',
  sandbox.qboResolveProject(oneProjectBill, catalog).status === 'matched');
ok('una factura repartida entre dos proyectos queda ambigua',
  sandbox.qboResolveProject({ projectRefs: [{ id: 'P10' }, { id: 'P20' }] }, catalog).status === 'ambiguous');
ok('CustomerRef se acepta cuando su ID es un Customer/Job del catálogo',
  sandbox.qboResolveProject({ customer: { id: 'P10', name: 'Cliente padre' } }, catalog).status === 'matched');
ok('CustomerRef de un cliente que no es proyecto no se usa',
  sandbox.qboResolveProject({ customer: { id: 'C1', name: 'Condominio Roble' } }, catalog).status === 'none');
ok('Invoice usa ProjectRef de línea aunque no exista ProjectRef en cabecera',
  sandbox.qboResolveProject({ lines: [{ project: { id: 'P10', name: 'Condominio Roble' } }] }, catalog).project === proyectoA);
ok('Invoice usa Customer/Job de línea y descarta el cliente padre de cabecera',
  sandbox.qboResolveProject({ customer: { id: 'C1', name: 'Cliente padre' }, lines: [{ customer: { id: 'P10', name: 'Condominio Roble' } }] }, catalog).project === proyectoA);
ok('ProjectRef sin nombre usa el Customer/Job verificable del mismo documento',
  sandbox.qboResolveProject({ project: { id: 'PX' }, customer: { id: 'P10', name: 'Condominio Roble' } }, catalog).project === proyectoA);
ok('ProjectRef sin nombre permite un único nombre exacto de proyecto en CustomerRef',
  sandbox.qboResolveProject({ project: { id: 'PX' }, customer: { id: 'C1', name: 'Condominio Roble' } }, []).project === proyectoA);
ok('sin ProjectRef no se infiere proyecto por un nombre de cliente',
  sandbox.qboResolveProject({ customer: { id: 'C1', name: 'Condominio Roble' } }, []).status === 'none');

proyectoB.qboProjectId = 'P10';
proyectoB.qboProjectName = 'Condominio Roble';
const staleResolution = sandbox.qboResolveProject({ project: { id: 'P10', name: 'Condominio Roble' } }, catalog);
ok('el nombre exacto gana sobre un qboProjectId obsoleto de otro proyecto',
  staleResolution.status === 'matched' && staleResolution.project === proyectoA && staleResolution.staleProjects[0] === proyectoB);

const record = { id: 'F1', qboId: 'Q1' };
proyectoB.invClient.push(record);
sandbox.qboApplyProjectLink(record, staleResolution);
ok('se guarda el ID estable del proyecto de QuickBooks', record.qboProjectId === 'P10' && proyectoA.qboProjectId === 'P10');
ok('al aplicar el vínculo se limpia el qboProjectId obsoleto', proyectoB.qboProjectId === '');
proyectoB.qboProjectId = 'P20';
ok('la asignación manual gratuita guarda el ProjectRef para sincronizaciones futuras',
  sandbox.qboBindProjectId(proyectoA, 'P20', 'Condominio Roble') && proyectoA.qboProjectId === 'P20' && proyectoB.qboProjectId === '');
ok('la misma factura se reubica sin crear otra copia',
  sandbox.qboMoveRecord(record, proyectoB, proyectoA, 'invClient') && proyectoB.invClient.length === 0 && proyectoA.invClient.length === 1);

console.log('\nCableado de sincronización:');
ok('facturas de proveedor reciben el catálogo y pueden moverse al proyecto QBO',
  /function qboSyncVendorBills\(qboBills,projectCatalog,options\)[\s\S]{0,7000}qboMoveRecord\([^)]*'billVendor'\)/.test(html));
ok('Bills multiproyecto se dividen por línea conservando una copia completa por proyecto',
  /function qboBillProjectSlices/.test(html) && /qboProjectActive:activeIndexes\.has\(index\)/.test(html) &&
  /Factura multiproyecto/.test(html));
ok('facturas a clientes usan referencias estables QBO y no aproximan por nombre de cliente',
  /const projectResolution=qboResolveProject\(qi,qboProjects\)/.test(html) &&
  !/const cln=clientName\.toLowerCase\(\)\.trim\(\)/.test(html));
ok('Outlook usa el proyecto resuelto desde QBO como destino preferente',
  /const destinationProject=qboProjectResolution&&qboProjectResolution\.status==='matched'\?qboProjectResolution\.project:proj/.test(html));
ok('la importación comparativa conserva el vínculo del proyecto',
  /if\(d\.projectResolution\)qboApplyProjectLink\(rec,d\.projectResolution\)/.test(html));
ok('la UI usa el catálogo gratuito Customer/Job y no recomienda permisos premium',
  /projectCatalogStatus==='customer-jobs'/.test(html) &&
  /acceso estándar gratuito y ProjectRef/.test(html) &&
  !html.includes('project-management.project'));

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
