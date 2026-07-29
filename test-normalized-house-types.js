// VUL-044 Fase C — comportamiento real del sincronizador de house_types.
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

function makeProject() {
  const houseType = {
    id: 501, name: 'Tipo A', area: 123.456789, budget: 9000.123456,
    salePrice: 14000.987654, utilityPct: 35.5, margen: 30,
    adminPct: 2, notes: '', categories: [{ id: 'c1', lines: [] }],
    exchangeRate: 530.25, typeLocked: true,
  };
  const house = {
    id: 601, num: 'Casa 1', typeId: 501, status: 'Sin iniciar',
    crewMemberIds: [], log: [], purchases: [],
  };
  const project = {
    id: 401, name: 'Proyecto', houses: [house], types: [houseType], uploads: [],
    ocs: [], invClient: [], billVendor: [], payments: [], creditNotes: [], requis: [],
  };
  return { project, house, houseType };
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
        : { ...(body || {}), id: body?.id, updated_at: `v${version}` },
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
      '_syncNormalizedProjectsHouses,_rememberProjectRow,_rememberHouseRow,_rememberHouseTypeRow,' +
      'activate:()=>{_normalizedProjectsLoaded=true;_normalizedHouseTypesLoaded=true;_normalizedTransactionsLoaded=false},' +
      'sizes:()=>({p:_projectSnapshots.size,h:_houseSnapshots.size,t:_houseTypeSnapshots.size})' +
    '};'
  );
  const api = factory(...Object.values(sandbox));
  api.activate();
  return { api, calls };
}

(async () => {
  console.log('Alta en orden de claves foráneas:');
  const createdData = makeProject();
  const created = environment([createdData.project]);
  ok('sincronización de alta termina OK', await created.api._syncNormalizedProjectsHouses());
  ok('crea proyecto → tipo → casa',
    created.calls.length === 3 &&
    created.calls[0].url === '/api/db/projects' &&
    created.calls[1].url === '/api/db/house_types' &&
    created.calls[2].url === '/api/db/houses');
  ok('project payload deja de duplicar types',
    !Object.prototype.hasOwnProperty.call(created.calls[0].body, 'types'));
  ok('tipo lleva projectId y precisión intacta',
    created.calls[1].body.projectId === 401 &&
    created.calls[1].body.budget === 9000.123456 &&
    created.calls[1].body.sortOrder === 0);
  ok('casa conserva typeId para que backend lo promueva',
    created.calls[2].body.typeId === 501);

  console.log('\nActualización optimista del tipo:');
  const updatedData = makeProject();
  const updated = environment([updatedData.project]);
  updated.api._rememberProjectRow({ updated_at: 'p1' }, updatedData.project);
  updated.api._rememberHouseTypeRow({ updated_at: 't1' }, updatedData.houseType, updatedData.project.id);
  updated.api._rememberHouseRow({ updated_at: 'h1' }, updatedData.house, updatedData.project.id);
  updatedData.houseType.budget = 9100.654321;
  ok('actualización termina OK', await updated.api._syncNormalizedProjectsHouses());
  ok('solo emite PUT del tipo',
    updated.calls.length === 1 &&
    updated.calls[0].method === 'PUT' &&
    updated.calls[0].url === '/api/db/house_types/501');
  ok('PUT usa versión y reemplazo completo',
    updated.calls[0].body.expected_updated_at === 't1' &&
    updated.calls[0].body.replace_data === true);

  console.log('\nBorrado seguro respecto a FK:');
  const deletedData = makeProject();
  const deleted = environment([deletedData.project]);
  deleted.api._rememberProjectRow({ updated_at: 'p1' }, deletedData.project);
  deleted.api._rememberHouseTypeRow({ updated_at: 't1' }, deletedData.houseType, deletedData.project.id);
  deleted.api._rememberHouseRow({ updated_at: 'h1' }, deletedData.house, deletedData.project.id);
  deletedData.project.types = [];
  deletedData.house.typeId = null;
  ok('borrado termina OK', await deleted.api._syncNormalizedProjectsHouses());
  ok('limpia primero la casa y luego elimina el tipo',
    deleted.calls.length === 2 &&
    deleted.calls[0].method === 'PUT' &&
    deleted.calls[0].url === '/api/db/houses/601' &&
    deleted.calls[0].body.typeId === null &&
    deleted.calls[1].method === 'DELETE' &&
    deleted.calls[1].url === '/api/db/house_types/501');

  console.log('\nCascada de proyecto y validaciones:');
  const cascadeData = makeProject();
  const cascadeProjects = [cascadeData.project];
  const cascade = environment(cascadeProjects);
  cascade.api._rememberProjectRow({ updated_at: 'p1' }, cascadeData.project);
  cascade.api._rememberHouseTypeRow({ updated_at: 't1' }, cascadeData.houseType, cascadeData.project.id);
  cascade.api._rememberHouseRow({ updated_at: 'h1' }, cascadeData.house, cascadeData.project.id);
  cascadeProjects.length = 0;
  ok('borrado de proyecto termina OK', await cascade.api._syncNormalizedProjectsHouses());
  ok('solo llama DELETE project; RPC cubre tipo y casa',
    cascade.calls.length === 1 &&
    cascade.calls[0].url === '/api/db/projects/401' &&
    cascade.calls[0].method === 'DELETE');
  ok('limpia snapshots de proyecto/casa/tipo',
    JSON.stringify(cascade.api.sizes()) === JSON.stringify({ p: 0, h: 0, t: 0 }));

  const duplicateA = makeProject();
  const duplicateB = makeProject();
  duplicateB.project.id = 402;
  duplicateB.house.id = 602;
  duplicateB.houseType.id = duplicateA.houseType.id;
  duplicateB.house.typeId = duplicateB.houseType.id;
  const duplicate = environment([duplicateA.project, duplicateB.project]);
  ok('ids de tipo duplicados abortan', !(await duplicate.api._syncNormalizedProjectsHouses()));
  ok('un duplicado no escribe parcialmente', duplicate.calls.length === 0);

  console.log('\nLoader, fallback y acciones de UI:');
  ok('loader solicita house_types junto con proyectos/casas/transacciones',
    html.includes('fetch(`${BACKEND_URL}/api/db/house_types`'));
  ok('solo activa Fase C con filas o fuente legacy ausente',
    html.includes('if(houseTypeRows.length||!hasLegacyTypes)'));
  ok('reconstruye project.types y valida typeId de cada casa',
    html.includes('project.types.push(houseType)') &&
    html.includes('Casa ${house.id} referencia tipo inexistente'));
  ok('proyecto normalizado deja de duplicar types',
    html.includes('if(_normalizedHouseTypesLoaded)delete payload.types'));
  const saveTypeBlock = html.slice(html.indexOf('function saveType()'), html.indexOf('// ========== IMPORTAR TIPO'));
  const deleteTypeBlock = html.slice(html.indexOf('function deleteType(id)'), html.indexOf('// ========== CASAS'));
  ok('guardar tipo dispara persistencia inmediata', saveTypeBlock.includes('saveData()'));
  ok('eliminar tipo limpia casas y luego persiste',
    deleteTypeBlock.includes('h.typeId===id)h.typeId=null') &&
    deleteTypeBlock.indexOf('saveData()') > deleteTypeBlock.indexOf('h.typeId=null'));

  console.log(`\n${pass} pruebas OK, ${fail} fallas`);
  process.exit(fail ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
