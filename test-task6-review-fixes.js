const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extractFunction(name) {
  const functionStart = html.indexOf(`function ${name}(`);
  if (functionStart < 0) throw new Error(`No se encontró ${name}`);
  const start = html.slice(Math.max(0, functionStart - 6), functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  const brace = html.indexOf('{', functionStart);
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
function ok(name, condition) {
  if (condition) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name); }
}

(async () => {
  console.log('Outlook multiproyecto:');
  const primaryUpload = {
    blobId: 'outlook-pending-7', name: 'factura.pdf', pendingBillId: 'pending-7',
  };
  const siblingUpload = { blobId: 'outlook-pending-7', name: 'factura.pdf' };
  const siblingDoc = { id: 'meta-sibling', blobId: 'outlook-pending-7', name: 'factura.pdf' };
  const primaryDoc = { id: 'meta-primary', blobId: 'outlook-pending-7', name: 'factura.pdf' };
  const projects = [
    { id: 'sibling', uploads: [siblingUpload], docs: [siblingDoc] },
    { id: 'primary', uploads: [primaryUpload], docs: [primaryDoc] },
  ];
  const snapshots = new Map();
  const calls = [];
  // Se ejerce el _documentGroups real (no un stub que devuelva los uploads por referencia):
  // ese stub ocultaba que _documentIdForUpload comparaba por referencia contra clones y nunca
  // coincidía, y que sin acotar por proyecto un blobId compartido resolvía al proyecto
  // equivocado.
  const factory = new Function(
    'projects', '_documentSnapshots', '_documentProjectIds',
    '_documentVersions', '_snapshot', '_documentCloudPayload', 'fetch', 'BACKEND_URL',
    '_sbToken', 'alert', 'console',
    `${extractFunction('_documentLogicalKey')}
     ${extractFunction('_documentRowId')}
     ${extractFunction('_documentGroups')}
     ${extractFunction('_documentIdForUpload')}
     ${extractFunction('_linkPendingBillFiles')}
     return {_documentIdForUpload,_linkPendingBillFiles,_documentGroups,_documentRowId};`
  );
  const api = factory(
    projects, snapshots, new Map(), new Map(), JSON.stringify,
    group => ({ storageKey: group.upload.storageKey || null }),
    async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ storageKey: 'documents/shared.pdf', document: { updated_at: 'v2' } }),
      };
    },
    '', 'token', () => {}, console
  );

  const primaryDocId = api._documentRowId('primary', 'outlook-pending-7');
  const siblingDocId = api._documentRowId('sibling', 'outlook-pending-7');
  snapshots.set(siblingDocId, 'old-sibling');
  snapshots.set(primaryDocId, 'old-primary');

  ok('resuelve el documentId del objeto upload, aunque un hermano comparta blobId',
    api._documentIdForUpload(primaryUpload, projects[1]) === primaryDocId);
  ok('acota la resolución al proyecto dueño en vez del primero que aparezca en `projects`',
    api._documentIdForUpload(siblingUpload, projects[0]) === siblingDocId &&
    api._documentIdForUpload(primaryUpload, projects[1]) !== siblingDocId);
  ok('enlaza correctamente el PDF pendiente', await api._linkPendingBillFiles());
  ok('consume from-pending exactamente una vez y sobre el documento primario',
    calls.length === 1 &&
    calls[0].url === `/api/files/documents/${encodeURIComponent(primaryDocId)}/from-pending`);
  ok('propaga el storageKey al upload y doc hermanos',
    siblingUpload.storageKey === 'documents/shared.pdf' &&
    siblingDoc.storageKey === 'documents/shared.pdf');
  ok('deja el snapshot hermano anterior para que el próximo sync haga PUT',
    snapshots.get(siblingDocId) === 'old-sibling');
  const attach = new Function(`${extractFunction('msAttachPendingPdf')}; return msAttachPendingPdf;`)();
  const pending = { id: 'pending-8', fileName: 'otra.pdf', storageKey: 'pending/key.pdf' };
  const primaryProject = { uploads: [], docs: [] };
  const siblingProject = { uploads: [], docs: [] };
  attach(primaryProject, {}, pending);
  attach(siblingProject, {}, pending, false);
  ok('solo la copia preferida recibe pendingBillId',
    primaryProject.uploads[0].pendingBillId === 'pending-8' &&
    !('pendingBillId' in siblingProject.uploads[0]));

  console.log('\nCola de guardado y ack:');
  let resolveEarlier, resolveImported;
  const earlier = new Promise(resolve => { resolveEarlier = resolve; });
  const imported = new Promise(resolve => { resolveImported = resolve; });
  let inFlight = earlier;
  let saveCalls = 0;
  const saveFactory = new Function(
    'saveData', 'getInFlight',
    `let _saveInFlight=getInFlight();
     ${extractFunction('saveDataForCurrentChanges')}
     return saveDataForCurrentChanges;`
  );
  const waitForImported = saveFactory(() => {
    saveCalls++;
    if (saveCalls === 1) return earlier;
    inFlight = imported;
    return imported;
  }, () => inFlight)();
  let completed = false;
  waitForImported.then(() => { completed = true; });
  resolveEarlier(true);
  await Promise.resolve();
  await Promise.resolve();
  ok('encadena un guardado posterior cuando ya había otro en vuelo', saveCalls === 2);
  ok('no termina antes de persistir el guardado que contiene la importación', !completed);
  resolveImported(true);
  ok('devuelve éxito solo al completar el guardado posterior', await waitForImported);

  const poll = extractFunction('msPollPending');
  ok('msPollPending espera el helper antes de ackear',
    poll.indexOf('await saveDataForCurrentChanges()') >= 0 &&
    poll.indexOf('await saveDataForCurrentChanges()') < poll.indexOf('await msAck('));

  console.log(`\n${pass} pruebas OK, ${fail} fallas`);
  process.exit(fail ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
