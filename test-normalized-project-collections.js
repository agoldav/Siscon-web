// VUL-044 Fase E — comportamiento real del sincronizador de colecciones de proyecto.
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
function ok(name, condition, detail) {
  if (condition) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name, detail || ''); }
}

function baseProject() {
  return {
    id: 501, name: 'Proyecto', houses: [], types: [], docs: [], uploads: [],
    ocs: [], invClient: [], billVendor: [], payments: [], creditNotes: [], requis: [],
    garantias: [], bitacora: [], tasks: [], subAdvances: [], bodega: [],
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
      json: async () => options.method === 'DELETE'
        ? { ok: true }
        : {
          ...(body || {}),
          id: body?.id,
          project_id: String(body?.projectId),
          sort_order: body?.sortOrder,
          updated_at: `v${version}`,
        },
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
      '_syncNormalizedProjectsHouses,_rememberProjectRow,_rememberProjectCollectionRow,' +
      'activate:()=>{' +
        '_normalizedProjectsLoaded=true;_normalizedProjectCollectionsLoaded=true;' +
        '_normalizedHouseTypesLoaded=false;_normalizedTransactionsLoaded=false;' +
        '_normalizedDocumentsLoaded=false' +
      '},' +
      'sizes:()=>({p:_projectSnapshots.size,i:_projectItemSnapshots.size})' +
    '};'
  );
  const api = factory(...Object.values(sandbox));
  api.activate();
  return { api, calls };
}

(async () => {
  console.log('Alta incremental:');
  const project = baseProject();
  project.garantias.push({ id: 7, num: 1, desc: 'Fisura', budget: 123 });
  const created = environment([project]);
  created.api._rememberProjectRow({ updated_at: 'p1' }, project);
  ok('sincronización termina OK', await created.api._syncNormalizedProjectsHouses());
  ok('crea solo la garantía en su tabla',
    created.calls.length === 1 &&
    created.calls[0].method === 'POST' &&
    created.calls[0].url === '/api/db/garantias');
  ok('payload conserva item/proyecto/orden exactos',
    created.calls[0].body.projectId === 501 &&
    created.calls[0].body.sortOrder === 0 &&
    created.calls[0].body.data.id === 7 &&
    created.calls[0].body.data.desc === 'Fisura');
  ok('projects no duplica las cinco colecciones',
    !('garantias' in created.calls[0].body) &&
    html.includes('PROJECT_COLLECTION_KEYS.forEach(key=>delete payload[key])'));

  console.log('\nActualización optimista:');
  const project2 = baseProject();
  const task = { id: 't1', title: 'Llamar', status: 'Pendiente' };
  project2.tasks.push(task);
  const updated = environment([project2]);
  updated.api._rememberProjectRow({ updated_at: 'p1' }, project2);
  updated.api._rememberProjectCollectionRow(
    { updated_at: 'i1' }, 'tasks', task, project2.id, 0
  );
  task.status = 'Completado';
  ok('actualización termina OK', await updated.api._syncNormalizedProjectsHouses());
  ok('emite PUT con versión y reemplazo explícito',
    updated.calls.length === 1 &&
    updated.calls[0].method === 'PUT' &&
    updated.calls[0].url === '/api/db/tasks/t1' &&
    updated.calls[0].body.expected_updated_at === 'i1' &&
    updated.calls[0].body.replace_data === true &&
    updated.calls[0].body.data.status === 'Completado');

  console.log('\nBorrado individual y cascada:');
  const project3 = baseProject();
  const stock = { id: 'bo1', name: 'Cemento', qty: 4 };
  project3.bodega.push(stock);
  const deleted = environment([project3]);
  deleted.api._rememberProjectRow({ updated_at: 'p1' }, project3);
  deleted.api._rememberProjectCollectionRow(
    { updated_at: 'i1' }, 'bodega', stock, project3.id, 0
  );
  project3.bodega = [];
  ok('borrado individual termina OK', await deleted.api._syncNormalizedProjectsHouses());
  ok('emite DELETE a la tabla correcta',
    deleted.calls.length === 1 &&
    deleted.calls[0].method === 'DELETE' &&
    deleted.calls[0].url === '/api/db/bodega/bo1');

  const project4 = baseProject();
  const log = { id: 'b1', desc: 'Revisar' };
  project4.bitacora.push(log);
  const projectArray = [project4];
  const cascade = environment(projectArray);
  cascade.api._rememberProjectRow({ updated_at: 'p1' }, project4);
  cascade.api._rememberProjectCollectionRow(
    { updated_at: 'i1' }, 'bitacora', log, project4.id, 0
  );
  projectArray.length = 0;
  ok('cascada termina OK', await cascade.api._syncNormalizedProjectsHouses());
  ok('solo elimina el proyecto; la RPC cubre las colecciones',
    cascade.calls.length === 1 &&
    cascade.calls[0].method === 'DELETE' &&
    cascade.calls[0].url === '/api/db/projects/501');
  ok('cascada limpia snapshot local', cascade.api.sizes().i === 0);

  console.log('\nLoader y fallback:');
  for (const table of ['garantias','bitacora','tasks','sub_advances','bodega']) {
    ok(`loader solicita ${table}`, html.includes(`fetch(\`\${BACKEND_URL}/api/db/${table}\``));
  }
  ok('solo activa Fase E con filas o fuente legacy ausente',
    html.includes('if(totalPhaseERows||!hasLegacyProjectCollections)'));
  ok('reconstruye cada colección por orden estable',
    html.includes('.sort((a,b)=>a.sortOrder-b.sortOrder||a.rowId.localeCompare(b.rowId))'));

  console.log(`\n${pass} pruebas OK, ${fail} fallas`);
  process.exit(fail ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
