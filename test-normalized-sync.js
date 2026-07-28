// VUL-044 Fase A — comportamiento real del sincronizador incremental.
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
      json: async () => ({ id: body?.id, updated_at: `v${version}` }),
    };
  }
  const sandbox = {
    projects: initialProjects,
    fetch: fetchMock,
    _sbToken: 'token',
    BACKEND_URL: '',
    confirm: () => { throw new Error('No se esperaba un conflicto'); },
    loadDataFromAPI: async () => true,
    console,
  };
  const factory = new Function(
    ...Object.keys(sandbox),
    source + '\nreturn {' +
      '_syncNormalizedProjectsHouses,_rememberProjectRow,_rememberHouseRow,' +
      'activate:()=>{_normalizedProjectsLoaded=true},' +
      'sizes:()=>({p:_projectSnapshots.size,h:_houseSnapshots.size})' +
    '};'
  );
  return { api: factory(...Object.values(sandbox)), calls };
}

(async () => {
  console.log('Creación en orden FK:');
  const newHouse = { id: 102, num: 'Casa 1', status: 'Sin iniciar', typeId: null };
  const newProject = { id: 101, name: 'Nuevo', num: 'P-1', houses: [newHouse], types: [], uploads: [] };
  const created = environment([newProject]);
  created.api.activate();
  ok('sincronización de alta termina OK', await created.api._syncNormalizedProjectsHouses());
  ok('crea primero project y luego house',
    created.calls.length === 2 &&
    created.calls[0].method === 'POST' && created.calls[0].url === '/api/db/projects' &&
    created.calls[1].method === 'POST' && created.calls[1].url === '/api/db/houses',
    created.calls);
  ok('project payload no contiene houses', !('houses' in created.calls[0].body));
  ok('house payload contiene projectId', created.calls[1].body.projectId === 101);

  console.log('\nActualización incremental:');
  const house = { id: 202, num: 'Casa 2', status: 'Sin iniciar', purchases: [] };
  const project = { id: 201, name: 'Original', num: 'P-2', houses: [house], types: [], uploads: [] };
  const updated = environment([project]);
  updated.api._rememberProjectRow({ updated_at: 'p1' }, project);
  updated.api._rememberHouseRow({ updated_at: 'h1' }, house, project.id);
  updated.api.activate();
  project.name = 'Renombrado';
  house.status = 'Terminado';
  ok('sincronización de cambios termina OK', await updated.api._syncNormalizedProjectsHouses());
  const puts = updated.calls.filter(call => call.method === 'PUT');
  ok('solo emite los dos PUT modificados', puts.length === 2, updated.calls);
  ok('project manda su versión original',
    puts.some(call => call.url === '/api/db/projects/201' && call.body.expected_updated_at === 'p1'));
  ok('house manda su versión original',
    puts.some(call => call.url === '/api/db/houses/202' && call.body.expected_updated_at === 'h1'));
  ok('ambos reemplazos completos son explícitos', puts.every(call => call.body.replace_data === true));

  console.log('\nBorrado con cascada:');
  const deleteHouse = { id: 302, num: 'Casa 3', status: 'Sin iniciar' };
  const deleteProject = { id: 301, name: 'Borrar', houses: [deleteHouse], uploads: [] };
  const deletingArray = [deleteProject];
  const deleting = environment(deletingArray);
  deleting.api._rememberProjectRow({ updated_at: 'p1' }, deleteProject);
  deleting.api._rememberHouseRow({ updated_at: 'h1' }, deleteHouse, deleteProject.id);
  deleting.api.activate();
  deletingArray.length = 0;
  ok('sincronización de borrado termina OK', await deleting.api._syncNormalizedProjectsHouses());
  ok('solo llama DELETE project; la RPC se encarga de houses',
    deleting.calls.length === 1 &&
    deleting.calls[0].method === 'DELETE' &&
    deleting.calls[0].url === '/api/db/projects/301',
    deleting.calls);
  ok('limpia snapshots de project y houses', deleting.api.sizes().p === 0 && deleting.api.sizes().h === 0);

  console.log(`\n${pass} pruebas OK, ${fail} fallas`);
  process.exit(fail ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
