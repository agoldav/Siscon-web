// VUL-044 Fase B — comportamiento real del sincronizador de transacciones.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const start = html.indexOf('const _projectVersions=new Map();');
const end = html.indexOf('// VUL-033: control de concurrencia optimista', start);
const source = html.slice(start, end);
if (start < 0 || end < 0) {
  console.error('No se pudo extraer el sincronizador normalizado');
  process.exit(1);
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name, detail || ''); }
}

function projectWithTransactions(transaction) {
  return {
    id: 101, name: 'Proyecto', houses: [], uploads: [],
    ocs: transaction ? [transaction] : [], invClient: [], billVendor: [],
    payments: [], creditNotes: [], requis: [],
  };
}

function environment(initialProjects) {
  const calls = [];
  let version = 1;
  async function fetchMock(url, options = {}) {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method: options.method, body });
    version++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ ...(body || {}), id: body?.id, updated_at: `v${version}` }),
    };
  }
  const sandbox = {
    projects: initialProjects,
    fetch: fetchMock,
    _sbToken: 'token',
    BACKEND_URL: '',
    confirm: () => { throw new Error('No se esperaba diálogo de conflicto'); },
    alert: () => {},
    loadDataFromAPI: async () => true,
    showToast: () => {},
    curOCId: null,
    renderOCList: () => {},
    _lastOwnApprovalAt: 0,
    console,
  };
  const factory = new Function(
    ...Object.keys(sandbox),
    source + '\nreturn {' +
      '_syncNormalizedProjectsHouses,_rememberProjectRow,_rememberTransactionRow,' +
      'activate:()=>{_normalizedProjectsLoaded=true;_normalizedTransactionsLoaded=true},' +
      'sizes:()=>({p:_projectSnapshots.size,t:_transactionSnapshots.size})' +
    '};'
  );
  const api = factory(...Object.values(sandbox));
  api.activate();
  return { api, calls };
}

(async () => {
  console.log('Alta y mapeo:');
  const oc = {
    id: 'oc-1', num: 'OC-1', currency: 'USD', exchangeRate: 0, totalUSD: 0,
    lines: { 7: [{ id: 'linea', selected: false }] },
  };
  const project = projectWithTransactions(oc);
  const created = environment([project]);
  created.api._rememberProjectRow({ updated_at: 'p1' }, project);
  ok('sincronización termina OK', await created.api._syncNormalizedProjectsHouses());
  ok('crea únicamente la fila transaccional nueva',
    created.calls.length === 1 &&
    created.calls[0].method === 'POST' &&
    created.calls[0].url === '/api/db/transactions',
    created.calls);
  ok('payload fija projectId/kind',
    created.calls[0].body.projectId === 101 && created.calls[0].body.kind === 'oc');
  ok('objeto lines de OC viaja sin pérdida por ocLines',
    !('lines' in created.calls[0].body) &&
    created.calls[0].body.ocLines['7'][0].selected === false);

  console.log('\nActualización optimista:');
  const tx2 = { id: 'fac-1', num: 'F-1', totalUSD: 100, lines: [] };
  const project2 = projectWithTransactions();
  project2.invClient.push(tx2);
  const updated = environment([project2]);
  updated.api._rememberProjectRow({ updated_at: 'p1' }, project2);
  updated.api._rememberTransactionRow({ updated_at: 't1' }, tx2, project2.id, 'factura_cliente');
  tx2.totalUSD = 125;
  ok('actualización termina OK', await updated.api._syncNormalizedProjectsHouses());
  const put = updated.calls.find(call => call.method === 'PUT');
  ok('PUT manda versión y reemplazo completo',
    put && put.url === '/api/db/transactions/fac-1' &&
    put.body.expected_updated_at === 't1' && put.body.replace_data === true,
    updated.calls);

  console.log('\nBorrado individual:');
  const tx3 = { id: 'pago-1', totalUSD: 20, lines: [] };
  const project3 = projectWithTransactions();
  project3.payments.push(tx3);
  const deleted = environment([project3]);
  deleted.api._rememberProjectRow({ updated_at: 'p1' }, project3);
  deleted.api._rememberTransactionRow({ updated_at: 't1' }, tx3, project3.id, 'pago');
  project3.payments.length = 0;
  ok('borrado termina OK', await deleted.api._syncNormalizedProjectsHouses());
  ok('emite DELETE de la transacción',
    deleted.calls.length === 1 &&
    deleted.calls[0].method === 'DELETE' &&
    deleted.calls[0].url === '/api/db/transactions/pago-1',
    deleted.calls);

  console.log('\nBorrado de proyecto con cascada:');
  const tx4 = { id: 'req-1', lines: [] };
  const project4 = projectWithTransactions();
  project4.requis.push(tx4);
  const list = [project4];
  const cascade = environment(list);
  cascade.api._rememberProjectRow({ updated_at: 'p1' }, project4);
  cascade.api._rememberTransactionRow({ updated_at: 't1' }, tx4, project4.id, 'requisicion');
  list.length = 0;
  ok('cascada termina OK', await cascade.api._syncNormalizedProjectsHouses());
  ok('solo elimina el proyecto; la RPC elimina su transacción',
    cascade.calls.length === 1 &&
    cascade.calls[0].method === 'DELETE' &&
    cascade.calls[0].url === '/api/db/projects/101',
    cascade.calls);
  ok('limpia los snapshots locales de la transacción', cascade.api.sizes().t === 0);

  console.log('\nCarga normalizada y fallback:');
  ok('loader solicita transactions junto con projects/houses',
    /Promise\.all\(\[[\s\S]{0,700}\/api\/db\/transactions/.test(html));
  ok('solo activa el corte si hay filas o ya no existen colecciones legacy',
    /if\(transactionRows\.length\|\|!hasLegacyCollections\)/.test(html));
  ok('reconstruye la colección histórica según kind',
    /const collection=TXN_KIND_TO_COLLECTION\[kind\][\s\S]{0,500}project\[collection\]\.push\(transaction\)/.test(html));
  ok('proyecto normalizado deja de duplicar las seis colecciones',
    /if\(_normalizedTransactionsLoaded\)TXN_COLLECTION_KEYS\.forEach\(key=>delete payload\[key\]\)/.test(html));

  console.log(`\n${pass} pruebas OK, ${fail} fallas`);
  process.exit(fail ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
