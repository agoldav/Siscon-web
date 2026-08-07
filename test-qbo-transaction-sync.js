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
  'qboSyncProjectCatalog', 'qboApplyProjectFinancials',
  'qboTextKey', 'qboVendorKey', 'qboBillAmount', 'qboBillMatch', 'qboFindBestBillMatch', 'qboBillAsRecord',
  'qboAppExchangeRate', 'qboAmountToUSD', 'qboLineSourceAmount', 'qboTaxCodePct', 'qboBillLineTaxAmounts',
  'qboResolveBillLineProject', 'qboBillProjectSlices', 'qboBillLinesForSlice',
  'qboApplyBillMatch', 'qboApplyBillSlice', 'qboSyncVendorBills',
  'qboSalesReceiptProjectSlices', 'qboSalesReceiptLinesForSlice', 'qboApplySalesReceiptSlice', 'qboSyncSalesReceipts',
  'qboPaymentAllocations', 'qboSyncPayments', 'projSpent', 'projSpentBreakdown',
  'projInvoiceRevenueUSD', 'projBilled',
].map(extractFunction).join('\n'), sandbox);

let pass = 0, fail = 0;
function ok(name, condition) {
  if (condition) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name); }
}

const catalog = [{ id: 'P10', name: 'Condominio Roble' }];
ok('normaliza ExchangeRate QBO USD/CRC a CRC/USD',
  Math.abs(sandbox.qboAppExchangeRate('CRC',0.002197802)-455)<0.01 && Math.abs(sandbox.qboAmountToUSD(56500,'CRC',0.002197802)-124.18)<0.02);
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
const financialSync=sandbox.qboApplyProjectFinancials([
  {id:'P10',name:'Condominio Roble',income:30578.44,cost:16699.32},
  {id:'P20',name:'Proyecto Renombrado',income:2500,cost:883.11},
],2,[
  {id:'P10',name:'Condominio Roble',cost:16699.32,receiptCosts:[{qboId:'SR1',docNumber:'RV-1',txnDate:'2026-08-01',cost:90}]},
  {id:'P20',name:'Proyecto Renombrado',cost:883.11,receiptCosts:[]},
]);
ok('aplica los totales contables autoritativos de QBO al proyecto exacto',
  financialSync.applied===2 && financialSync.costApplied===2 && project.qboIncomeAuthoritative===true && project.qboCostAuthoritative===true &&
  project.qboReportedIncomeUSD===30578.44 && project.qboReportedCostUSD===16699.32 &&
  sandbox.projBilled(project)===30578.44 && sandbox.projSpent(project)===16699.32);
project.qboCostAuthoritative=false;

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

const outlookLocal={id:'OUTLOOK-1',num:'FP-OUTLOOK',invoiceNumber:'OUT-50',party:'Proveedor Outlook',date:'2026-08-01',
  currencyBill:'USD',totalUSD:50,createdBy:'Outlook',lines:[{desc:'Detalle OCR',qty:1,price:50,assign:[{houseId:'H1',qty:1}]}]};
project.billVendor.push(outlookLocal);
const outlookQbo={...qboBill,id:'B-OUT',docNumber:'OUT-50',total:50,subtotal:50,vendor:{id:'V-OUT',name:'Proveedor Outlook'},
  lines:[{id:'L-OUT',amount:50,quantity:1,unitPrice:50,description:'Detalle QBO',customer:{id:'P10',name:'Condominio Roble'}}]};
sandbox.qboSyncVendorBills([outlookQbo],catalog);
ok('un match simple de Outlook conserva sus líneas y asignaciones locales',
  outlookLocal.qboId==='B-OUT' && outlookLocal.lines[0].desc==='Detalle OCR' && outlookLocal.lines[0].assign[0].houseId==='H1');

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

const secondProject=sandbox.projects.find(p=>p.qboProjectId==='P20');
sandbox.SYS.qbo={taxCodeCache:[{id:'T13',rate:13}]};
const multiProjectBill={
  id:'BM',docNumber:'MULTI-1',txnDate:'2026-08-01',currency:'USD',exchangeRate:1,total:339,subtotal:300,totalTax:39,balance:339,
  paymentStatus:'Pendiente de Pago',vendor:{id:'V2',name:'Proveedor Multi'},projectRefs:[{id:'P10'},{id:'P20'}],
  lines:[
    {id:'L1',amount:100,quantity:1,unitPrice:100,description:'Línea Roble',customer:{id:'P10',name:'Condominio Roble'},project:{id:'P10'},taxCode:{id:'T13'}},
    {id:'L2',amount:200,quantity:1,unitPrice:200,description:'Línea P20',customer:{id:'P20',name:'Proyecto Renombrado'},project:{id:'P20'},taxCode:{id:'T13'}},
  ],
};
const multiSync=sandbox.qboSyncVendorBills([multiProjectBill],[...catalog,{id:'P20',name:'Proyecto Renombrado'}],{initialImport:true});
const multiA=project.billVendor.find(b=>b.qboId==='BM'),multiB=secondProject.billVendor.find(b=>b.qboId==='BM');
ok('un Bill multiproyecto se replica una vez en cada proyecto involucrado',
  multiSync.imported===2 && multiA && multiB && multiA.id!==multiB.id);
ok('cada copia conserva la factura completa y activa solo las líneas de su proyecto',
  multiA.lines.length===2 && multiB.lines.length===2 && multiA.lines.filter(l=>l.qboProjectActive).length===1 && multiB.lines.filter(l=>l.qboProjectActive).length===1);
ok('el costo por proyecto conserva neto e IVA separados sin duplicar el total documental',
  Math.abs(multiA.qboProjectSubtotalUSD-100)<0.001 && Math.abs(multiB.qboProjectSubtotalUSD-200)<0.001 &&
  Math.abs(multiA.qboProjectTotalUSD-113)<0.001 && Math.abs(multiB.qboProjectTotalUSD-226)<0.001 &&
  Math.abs(multiA.qboProjectTotalUSD+multiB.qboProjectTotalUSD-339)<0.001 &&
  Math.abs(multiA.qboDocumentSubtotalUSD-300)<0.001 && Math.abs(multiA.qboDocumentTotalUSD-339)<0.001);
ok('Costo Real usa el neto sin IVA de cada slice QBO',
  Math.abs(sandbox.projSpent({billVendor:[multiA,multiB]})-300)<0.001);
ok('los indicadores de ingreso suman facturas QBO sin casas y excluyen IVA',
  Math.abs(sandbox.projBilled({invClient:[
    {qboId:'IQ1',subtotalUSD:30578.44,ivaUSD:3975.20,totalUSD:34553.64,status:'Emitida',houseLines:[]},
    {qboId:'IQ2',subtotalUSD:50,ivaUSD:6.5,totalUSD:56.5,status:'Anulada',houseLines:[]},
  ]})-30578.44)<0.001);

console.log('\nRecibos de venta y COGS FIFO:');
const receipt={id:'SR1',docNumber:'RV-1',txnDate:'2026-08-01',currency:'USD',exchangeRate:1,total:0,cogsTotal:90,
  cogsSource:'GeneralLedgerDetail',customer:{id:'P10',name:'Condominio Roble'},project:{id:'P10',name:'Condominio Roble'},
  lines:[{id:'SRL1',item:{id:'I1',name:'Vidrio'},description:'Vidrio',quantity:2,fifoCost:60},
    {id:'SRL2',item:{id:'I2',name:'Marco'},description:'Marco',quantity:1,fifoCost:30}]};
const receiptFirst=sandbox.qboSyncSalesReceipts([receipt],catalog,{initialImport:true});
const receiptLocal=project.billVendor.find(b=>b.qboEntity==='SalesReceipt'&&b.qboId==='SR1');
ok('un SalesReceipt de valor cero se importa como gasto por su COGS exacto',
  receiptFirst.imported===1 && receiptLocal && receiptLocal.qboSalesAmountUSD===0 && receiptLocal.qboProjectSubtotalUSD===90 && receiptLocal.ivaUSD===0);
ok('el recibo queda en el proyecto, tramitado y con sus costos FIFO por línea',
  receiptLocal.qboProjectId==='P10' && receiptLocal.qboInitialImportProcessed===true && receiptLocal.houseAssignmentRequired===false &&
  Math.abs(receiptLocal.lines.reduce((sum,line)=>sum+line.qboCostUSD,0)-90)<0.001);
const receiptSecond=sandbox.qboSyncSalesReceipts([receipt],catalog,{initialImport:true});
ok('repetir el sync de recibos no duplica el gasto',
  receiptSecond.imported===0 && project.billVendor.filter(b=>b.qboEntity==='SalesReceipt'&&b.qboId==='SR1').length===1);
const verifiedReceiptCosts=project.qboReceiptCosts;project.qboReceiptCosts=[];
const receiptWithoutReport=sandbox.qboSyncSalesReceipts([{...receipt,cogsTotal:0,cogsSource:'unavailable'}],catalog,{initialImport:true});
ok('un fallo temporal del reporte no borra un COGS previamente verificado',
  receiptWithoutReport.unresolvedCost===1 && project.billVendor.includes(receiptLocal) &&
  receiptLocal.qboProjectSubtotalUSD===90 && receiptLocal.qboCostReadError===true);
project.qboReceiptCosts=verifiedReceiptCosts;
const unresolvedReceipt={...receipt,id:'SR2',docNumber:'RV-2',cogsTotal:0,cogsSource:'unavailable',
  lines:receipt.lines.map(line=>({...line,fifoCost:0}))};
const unresolvedFirst=sandbox.qboSyncSalesReceipts([receipt,unresolvedReceipt],catalog,{initialImport:true});
const unresolvedLocal=project.billVendor.find(b=>b.qboEntity==='SalesReceipt'&&b.qboId==='SR2');
ok('un recibo nuevo queda visible aunque QBO no entregue todavía su COGS',
  unresolvedFirst.imported===1 && unresolvedLocal && unresolvedLocal.qboCostPending===true && unresolvedLocal.qboProjectSubtotalUSD===0);

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
  project.payments.some(p => p.refBillId === 'qbo-bill-B1-P10' && p.paymentDirection === 'paid'));
const paymentsSecond = sandbox.qboSyncPayments(paymentSnapshot);
ok('repetir sync de pagos tampoco duplica', paymentsSecond.imported === 0 && project.payments.length === 2);
project.payments.push({id:'OLD-PAY',createdBy:'QBO Import',qboPaymentId:'OLD',paymentDirection:'received',refInvoiceId:'REMOVED'});
const paymentsCleaned=sandbox.qboSyncPayments(paymentSnapshot);
ok('elimina solo pagos QBO cuyo documento ya no pertenece a un proyecto',
  paymentsCleaned.removed===1 && !project.payments.some(p=>p.id==='OLD-PAY'));
const multiPayments=sandbox.qboSyncPayments({payments:[],billPayments:[{id:'BPM',txnDate:'2026-08-01',currency:'USD',exchangeRate:1,vendor:{name:'Proveedor Multi'},linkedTransactions:[{txnId:'BM',txnType:'Bill',amount:339}]}]});
ok('el pago de un Bill multiproyecto se liga proporcionalmente a cada copia',
  multiPayments.imported===2 && project.payments.some(p=>p.refBillId===multiA.id&&Math.abs(p.totalUSD-113)<0.001) &&
  secondProject.payments.some(p=>p.refBillId===multiB.id&&Math.abs(p.totalUSD-226)<0.001));

console.log('\nInterfaz y dirección de datos:');
ok('solo el botón global ejecuta la sincronización completa',
  (html.match(/onclick="qboFullSync\(this\)"/g)||[]).length===1 &&
  /id="qbo-sync-btn"[^>]*onclick="qboFullSync\(this\)"/.test(html) &&
  !/data-qbo-project-sync/.test(html) && !/>Sync (?:QBO|Proveedores|Clientes|Productos|Impuestos)</.test(html));
ok('el frontend consume Payment y BillPayment sin publicar a QBO',
  /qboRead\('\/api\/qbo\/payments'\)/.test(html) && /snapshot\.payments/.test(html) && /snapshot\.billPayments/.test(html) &&
  !/app\.post\('\/api\/qbo\/transactions'/.test(html));
ok('los errores QBO conservan el diagnóstico acotado que entrega el backend',
  /\[data\.error\|\|\('QuickBooks HTTP '\+r\.status\),data\.detail\]\.filter\(Boolean\)\.join/.test(html));
ok('el frontend consume SalesReceipt y COGS solo por GET',
  /qboRead\('\/api\/qbo\/inventory-costs'\)/.test(html) && /snapshot\.salesReceipts/.test(html) &&
  /qboSyncSalesReceipts\(snapshot\.salesReceipts/.test(html) && !/fetch\([^)]*inventory-costs[^)]*POST/.test(html));
ok('el botón global reemplaza todos los catálogos QBO y confirma sus cantidades',
  /SYS\.qbo\.vendorCache=nextVendors;SYS\.qbo\.customerCache=nextCustomers/.test(html) &&
  /SYS\.qbo\.itemCache=nextItems/.test(html) && /SYS\.qbo\.projectCache=qboProjects/.test(html) &&
  /nextItems\.length\} materiales/.test(html) && /nextCustomers\.length\} clientes/.test(html) &&
  /qboProjects\.length\} proyectos/.test(html) && /nextVendors\.length\} proveedores/.test(html) &&
  /qboSyncProjectCatalog\(qboProjects,nextCustomers\)/.test(html) &&
  /code\.purchaseTaxRates/.test(html));
ok('el primer lote se marca por compañía y los posteriores exigen asignación de casa',
  /initialProjectTransactionImportCompletedAt/.test(html) && /initialProjectTransactionImportRealmId/.test(html) &&
  /qboImportBatch:initialImport\?'initial':'incremental'/.test(html) && /houseAssignmentRequired:!initialImport/.test(html));
ok('la política de costo v4 usa facturas sin IVA y COGS auditado por proyecto',
  /projectBillAllocationPolicyVersion\|\|0\)<4/.test(html) && /projectBillAllocationPolicyVersion=4/.test(html) &&
  /qboProjectSubtotalUSD\?\?b\.subtotalUSD/.test(html) && /Facturas sin IVA/.test(html) && /recibo\(s\) QBO FIFO/.test(html));
ok('los indicadores financieros usan el subtotal de invClient aunque la factura QBO no tenga casas',
  /function projInvoiceRevenueUSD\(invoice\)/.test(html) && /function projBilled\(p\)\{/.test(html) &&
  /const facturado=projBilled\(p\)/.test(html));
ok('el resumen financiero QBO aplica ingresos y costo contable por ID o nombre exacto',
  /function qboApplyProjectFinancials\(rows,reportCount,projectCostRows\)/.test(html) &&
  /qboIncomeAuthoritative&&Number\.isFinite\(Number\(p\.qboReportedIncomeUSD\)\)/.test(html) &&
  /qboCostAuthoritative&&Number\.isFinite\(Number\(p\.qboReportedCostUSD\)\)/.test(html) &&
  /otros costos\/ajustes QBO/.test(html));
ok('el frontend consulta el General Ledger filtrado por proyecto y aplica su COGS exacto al recibo',
  /qboRead\('\/api\/qbo\/project-costs'\)/.test(html) &&
  /group\.costSource='GeneralLedgerProject'/.test(html) && /slice\.documentCostUSD\?\?receipt\.cogsTotal/.test(html));
ok('al terminar QB actualiza inmediatamente el dashboard o proyecto visible',
  /if\(curProj\)\{renderMetric\(\);renderTab\(\);\}\s*else renderDash\(\)/.test(html));
ok('Requisición de Materiales muestra y contabiliza explícitamente los Recibos de venta QBO',
  /Recibos de venta QBO: \$\{receipts\.length\}/.test(html) && /qboCostPending/.test(html) &&
  /type==='requis'\?renderInventoryReceiptsSection\(\)/.test(html) &&
  /El documento debe ser visible aunque el reporte de COGS falle/.test(html));
ok('las líneas de Recibo QBO defaultan IVA de proyecto al 13%',
  /ivaRate:0\.13/.test(html) && /qboEntity==='SalesReceipt'/.test(html) &&
  /Number\(l\.qboTaxUSD\)>0/.test(html));
ok('la lista explica el monto aplicado frente al documento completo',
  /Total \$\{fmt\(qboProjectCost\)\} de \$\{fmt\(qboDocumentCost\)\}/.test(html) &&
  /Proyecto: "\$\{esc\(l\.qboLineProjectName/.test(html) && /esta línea no suma/.test(html));
ok('el sync central omite transacciones sin proyecto en vez de enviarlas a Sin clasificar',
  /if\(projectResolution\.status!=='matched'\)[\s\S]{0,280}skippedTransactions\+\+/.test(html) &&
  !/SYS\.unclassified\.push\(\{\.\.\.newInv,type:'Invoice'\}\)/.test(html));
ok('las líneas posteriores de facturas a clientes requieren una casa antes de tramitarse',
  /if\(ciState\.houseAssignmentRequired\)[\s\S]{0,420}Asigna cada línea de la factura a una casa/.test(html));

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
