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

const project = { id: 'A', name: 'Condominio Roble', invClient: [], billVendor: [], payments: [] };
const sandbox = { projects: [project], SYS: { unclassified: [] }, tcGet: () => 500 };
vm.createContext(sandbox);
vm.runInContext([
  'qboProjectName', 'qboTransactionProjectRefs', 'qboResolveProject', 'qboBindProjectId', 'qboApplyProjectLink', 'qboMoveRecord',
  'qboIsAutoImportedTransaction', 'qboRemoveRecord', 'qboApplyImportPolicy',
  'qboSyncProjectCatalog',
  'qboTextKey', 'qboVendorKey', 'qboBillAmount', 'qboBillMatch', 'qboFindBestBillMatch', 'qboBillAsRecord',
  'qboAmountToUSD', 'qboApplyBillMatch', 'qboSyncVendorBills', 'qboPaymentAllocations', 'qboSyncPayments',
].map(extractFunction).join('\n'), sandbox);

let pass = 0, fail = 0;
function ok(name, condition) {
  if (condition) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name); }
}

const catalog = [{ id: 'P10', name: 'Condominio Roble' }];
console.log('Proyectos QBO:');
const projectCatalogFirst = sandbox.qboSyncProjectCatalog([
  {id:'P10',name:'Condominio Roble',status:'ACTIVE',customerId:'C1'},
  {id:'P20',name:'Proyecto Nuevo',status:'ACTIVE',customerId:'C2'},
], [{id:'C2',name:'Cliente Dos'}]);
ok('enlaza el proyecto existente e importa el proyecto QBO faltante',
  projectCatalogFirst.imported===1 && project.qboProjectId==='P10' && sandbox.projects.some(p=>p.qboProjectId==='P20'&&p.name==='Proyecto Nuevo'&&p.client==='Cliente Dos'));
const projectCatalogSecond = sandbox.qboSyncProjectCatalog([{id:'P20',name:'Proyecto Renombrado',status:'ACTIVE',customerId:'C2'}], []);
ok('repetir el catálogo no duplica y conserva el nombre exacto de QBO',
  projectCatalogSecond.imported===0 && sandbox.projects.filter(p=>p.qboProjectId==='P20').length===1 && sandbox.projects.find(p=>p.qboProjectId==='P20').name==='Proyecto Renombrado');

const qboBill = {
  id: 'B1', docNumber: 'G-100', txnDate: '2026-08-01', currency: 'USD', exchangeRate: 1,
  total: 100, subtotal: 100, totalTax: 0, balance: 100, paymentStatus: 'Pendiente de Pago',
  vendor: { id: 'V1', name: 'Proveedor Uno' },
  lines: [{ amount: 100, quantity: 2, unitPrice: 50, description: 'Material', customer: { id: 'P10', name: 'Condominio Roble' } }],
};

console.log('Sincronización idempotente de Bills:');
const first = sandbox.qboSyncVendorBills([qboBill], catalog, {initialImport:true});
ok('importa un Bill faltante al proyecto exacto', first.imported === 1 && project.billVendor.length === 1);
ok('el Bill importado queda enlazado y presente en el proyecto QBO',
  project.billVendor[0].qboId === 'B1' && project.billVendor[0].qboProjectPresence === 'present');
ok('el lote inicial queda tramitado sin exigir casa',
  project.billVendor[0].qboImportBatch === 'initial' && project.billVendor[0].qboInitialImportProcessed === true &&
  project.billVendor[0].houseAssignmentRequired === false && project.billVendor[0]._pending === false);
const second = sandbox.qboSyncVendorBills([qboBill], catalog);
ok('repetir sync no crea duplicados', second.imported === 0 && project.billVendor.length === 1);

const nonProjectBill={...qboBill,id:'B-NP',docNumber:'G-NP',project:null,projectRefs:[],lines:[{amount:20,quantity:1,unitPrice:20,description:'Sin proyecto'}]};
const skipped=sandbox.qboSyncVendorBills([nonProjectBill], catalog);
ok('un Bill sin proyecto se omite y nunca va a Sin clasificar',
  skipped.skippedNonProject===1 && !project.billVendor.some(b=>b.qboId==='B-NP') && sandbox.SYS.unclassified.length===0);
project.billVendor.push({id:'OLD-NP',qboId:'B-NP',createdBy:'QBO Import',invoiceNumber:'G-NP'});
const cleaned=sandbox.qboSyncVendorBills([nonProjectBill], catalog);
ok('la migración elimina solo la copia QBO automática que no pertenece a proyecto',
  cleaned.removed===1 && !project.billVendor.some(b=>b.qboId==='B-NP'));

const incrementalBill={...qboBill,id:'B2',docNumber:'G-200'};
sandbox.qboSyncVendorBills([incrementalBill], catalog, {initialImport:false});
const incremental=project.billVendor.find(b=>b.qboId==='B2');
ok('un Bill posterior queda pendiente de asignar por línea',
  incremental && incremental.qboImportBatch==='incremental' && incremental.houseAssignmentRequired===true && incremental._pending===true);

project.billVendor.push({ id: 'LOCAL1', num: 'FP-LOCAL', invoiceNumber: 'LOCAL-9', party: 'Otro', date: '2026-08-01', totalUSD: 25, currencyBill: 'USD' });
sandbox.qboSyncVendorBills([qboBill], catalog);
ok('una factura local ausente se conserva y queda marcada',
  project.billVendor.some(b=>b.id==='LOCAL1'&&b.qboProjectPresence==='missing'&&/QuickBooks/.test(b.qboPresenceMessage)));

console.log('\nCobros y pagos QBO:');
project.invClient.push({ id: 'INVLOCAL', qboId: 'I1', num: 'FAC-1', client: 'Cliente Uno' });
const paymentSnapshot = {
  payments: [{ id: 'P1', txnDate: '2026-08-01', currency: 'USD', exchangeRate: 1, customer: { name: 'Cliente Uno' }, linkedTransactions: [{ txnId: 'I1', txnType: 'Invoice', amount: 40 }] }],
  billPayments: [{ id: 'BP1', txnDate: '2026-08-01', currency: 'USD', exchangeRate: 1, vendor: { name: 'Proveedor Uno' }, linkedTransactions: [{ txnId: 'B1', txnType: 'Bill', amount: 100 }] }],
};
const paymentsFirst = sandbox.qboSyncPayments(paymentSnapshot);
ok('importa el cobro de cliente y el pago al proveedor', paymentsFirst.imported === 2 && project.payments.length === 2);
ok('cada pago queda ligado al documento local correspondiente',
  project.payments.some(p => p.refInvoiceId === 'INVLOCAL' && p.paymentDirection === 'received') &&
  project.payments.some(p => p.refBillId === 'qbo-bill-B1' && p.paymentDirection === 'paid'));
const paymentsSecond = sandbox.qboSyncPayments(paymentSnapshot);
ok('repetir sync de pagos tampoco duplica', paymentsSecond.imported === 0 && project.payments.length === 2);
project.payments.push({id:'OLD-PAY',createdBy:'QBO Import',qboPaymentId:'OLD',paymentDirection:'received',refInvoiceId:'REMOVED'});
const paymentsCleaned=sandbox.qboSyncPayments(paymentSnapshot);
ok('elimina solo pagos QBO cuyo documento ya no pertenece a un proyecto',
  paymentsCleaned.removed===1 && !project.payments.some(p=>p.id==='OLD-PAY'));

console.log('\nInterfaz y dirección de datos:');
ok('solo el botón global ejecuta la sincronización completa',
  (html.match(/onclick="qboFullSync\(this\)"/g)||[]).length===1 &&
  /id="qbo-sync-btn"[^>]*onclick="qboFullSync\(this\)"/.test(html) &&
  !/data-qbo-project-sync/.test(html) && !/>Sync (?:QBO|Proveedores|Clientes|Productos|Impuestos)</.test(html));
ok('el frontend consume Payment y BillPayment sin publicar a QBO',
  /qboRead\('\/api\/qbo\/payments'\)/.test(html) && /snapshot\.payments/.test(html) && /snapshot\.billPayments/.test(html) &&
  !/app\.post\('\/api\/qbo\/transactions'/.test(html));
ok('el botón global reemplaza todos los catálogos QBO y confirma sus cantidades',
  /SYS\.qbo\.vendorCache=nextVendors;SYS\.qbo\.customerCache=nextCustomers/.test(html) &&
  /SYS\.qbo\.itemCache=nextItems/.test(html) && /SYS\.qbo\.projectCache=qboProjects/.test(html) &&
  /nextItems\.length\} materiales/.test(html) && /nextCustomers\.length\} clientes/.test(html) &&
  /qboProjects\.length\} proyectos/.test(html) && /nextVendors\.length\} proveedores/.test(html) &&
  /qboSyncProjectCatalog\(qboProjects,nextCustomers\)/.test(html));
ok('el primer lote se marca por compañía y los posteriores exigen asignación de casa',
  /initialProjectTransactionImportCompletedAt/.test(html) && /initialProjectTransactionImportRealmId/.test(html) &&
  /qboImportBatch:initialImport\?'initial':'incremental'/.test(html) && /houseAssignmentRequired:!initialImport/.test(html));
ok('el sync central omite transacciones sin proyecto en vez de enviarlas a Sin clasificar',
  /if\(projectResolution\.status!=='matched'\)[\s\S]{0,280}skippedTransactions\+\+/.test(html) &&
  !/SYS\.unclassified\.push\(\{\.\.\.newInv,type:'Invoice'\}\)/.test(html));
ok('las líneas posteriores de facturas a clientes requieren una casa antes de tramitarse',
  /if\(ciState\.houseAssignmentRequired\)[\s\S]{0,420}Asigna cada línea de la factura a una casa/.test(html));

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
