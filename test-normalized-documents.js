// VUL-044 Fase D — comportamiento real del sincronizador de docs/uploads.
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

function projectWithDocument() {
  const doc = { id: 'meta-1', blobId: 'blob-1', name: 'Factura.pdf', category: 'Factura' };
  const upload = {
    id: 'up-1', name: 'Factura.pdf', type: 'PDF',
    url: 'blob:https://app/efimero', pdfBase64: 'YWJj', notes: '',
  };
  return {
    project: {
      id: 401, name: 'Proyecto', houses: [], types: [], docs: [doc], uploads: [upload],
      ocs: [], invClient: [], billVendor: [], payments: [], creditNotes: [], requis: [],
    },
    doc, upload,
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
      '_syncNormalizedProjectsHouses,_rememberProjectRow,_rememberDocumentRow,_documentGroups,' +
      'activate:()=>{' +
        '_normalizedProjectsLoaded=true;_normalizedDocumentsLoaded=true;' +
        '_normalizedHouseTypesLoaded=false;_normalizedTransactionsLoaded=false' +
      '},' +
      'sizes:()=>({p:_projectSnapshots.size,d:_documentSnapshots.size})' +
    '};'
  );
  const api = factory(...Object.values(sandbox));
  api.activate();
  return { api, calls };
}

(async () => {
  console.log('Alta y agrupación lógica:');
  const createdData = projectWithDocument();
  const created = environment([createdData.project]);
  created.api._rememberProjectRow({ updated_at: 'p1' }, createdData.project);
  ok('sincronización termina OK', await created.api._syncNormalizedProjectsHouses());
  ok('el par por nombre único crea una sola fila aunque upload no tenga blobId',
    created.calls.length === 1 &&
    created.calls[0].method === 'POST' &&
    created.calls[0].url === '/api/db/documents');
  const createBody = created.calls[0].body;
  ok('payload no contiene URL efímera y sí conserva pdfBase64',
    createBody.data.doc.id === 'meta-1' &&
    createBody.data.upload.pdfBase64 === 'YWJj' &&
    !('url' in createBody.data.upload));
  ok('el proyecto no duplica docs/uploads',
    !('docs' in createBody) && createBody.projectId === 401);

  console.log('\nActualización optimista:');
  const updatedData = projectWithDocument();
  const updated = environment([updatedData.project]);
  updated.api._rememberProjectRow({ updated_at: 'p1' }, updatedData.project);
  const group = updated.api._documentGroups(updatedData.project)[0];
  updated.api._rememberDocumentRow({ updated_at: 'd1' }, group);
  updatedData.doc.notes = 'Nueva nota';
  updatedData.upload.notes = 'Nueva nota';
  ok('actualización termina OK', await updated.api._syncNormalizedProjectsHouses());
  ok('solo emite PUT del documento con su versión',
    updated.calls.length === 1 &&
    updated.calls[0].method === 'PUT' &&
    updated.calls[0].url.includes('/api/db/documents/') &&
    updated.calls[0].body.expected_updated_at === 'd1' &&
    updated.calls[0].body.replace_data === true);

  console.log('\nBorrado individual y cascada:');
  const deletedData = projectWithDocument();
  const deleted = environment([deletedData.project]);
  deleted.api._rememberProjectRow({ updated_at: 'p1' }, deletedData.project);
  deleted.api._rememberDocumentRow(
    { updated_at: 'd1' }, deleted.api._documentGroups(deletedData.project)[0]
  );
  deletedData.project.docs = [];
  deletedData.project.uploads = [];
  ok('borrado termina OK', await deleted.api._syncNormalizedProjectsHouses());
  ok('emite un DELETE para el documento lógico',
    deleted.calls.length === 1 &&
    deleted.calls[0].method === 'DELETE' &&
    deleted.calls[0].url.includes('/api/db/documents/'));

  const cascadeData = projectWithDocument();
  const projects = [cascadeData.project];
  const cascade = environment(projects);
  cascade.api._rememberProjectRow({ updated_at: 'p1' }, cascadeData.project);
  cascade.api._rememberDocumentRow(
    { updated_at: 'd1' }, cascade.api._documentGroups(cascadeData.project)[0]
  );
  projects.length = 0;
  ok('cascada termina OK', await cascade.api._syncNormalizedProjectsHouses());
  ok('solo elimina proyecto; RPC cubre documents',
    cascade.calls.length === 1 &&
    cascade.calls[0].url === '/api/db/projects/401' &&
    cascade.calls[0].method === 'DELETE');
  ok('cascada limpia snapshot local del documento', cascade.api.sizes().d === 0);

  console.log('\nLoader y fallback:');
  ok('loader solicita documents junto con las demás tablas',
    html.includes('fetch(`${BACKEND_URL}/api/db/documents`'));
  ok('solo activa Fase D con filas o fuente legacy ausente',
    html.includes('if(documentRows.length||!hasLegacyDocuments)'));
  ok('reconstruye docs/uploads por proyecto y conserva el orden',
    html.includes('project.docs=ordered(target.docs)') &&
    html.includes('project.uploads=ordered(target.uploads)'));
  ok('proyecto normalizado deja de duplicar docs/uploads',
    html.includes('if(_normalizedDocumentsLoaded){delete payload.docs;delete payload.uploads;}'));

  console.log(`\n${pass} pruebas OK, ${fail} fallas`);
  process.exit(fail ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
