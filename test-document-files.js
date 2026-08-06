const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name, detail || ''); }
}
function between(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  return from >= 0 && to >= 0 ? html.slice(from, to) : '';
}

const openPdfSource = between('async function openPdfNewTab', 'function _findDoc');
const viewDocSource = between('async function viewDoc', 'function closeDocViewer');
const flushSource = between('async function _flushPendingDocumentUploads', '// Una aprobación propia');
const syncSource = between('async function _syncNormalizedDocuments', 'async function _syncNormalizedProjectCollections');

ok('processDocFiles ya no asigna pdfBase64',
  !/function processDocFiles\([\s\S]*?entry\.pdfBase64\s*=/.test(html));
ok('existe uploadDocumentFile', /function uploadDocumentFile\(/.test(html));
ok('upload usa FormData sin Content-Type manual',
  /function uploadDocumentFile\([\s\S]{0,1200}new FormData\(\)[\s\S]{0,1200}Authorization[\s\S]{0,1200}body:formData/.test(html) &&
  !/function uploadDocumentFile\([\s\S]{0,1600}Content-Type/.test(html));
ok('openPdfNewTab usa /api/files/documents/',
  /async function openPdfNewTab\([\s\S]{0,2000}\/api\/files\/documents\//.test(html));
ok('flush pending uploads tras sync documents',
  /async function _syncNormalizedDocuments\([\s\S]{0,3500}await _flushPendingDocumentUploads\(\)/.test(html));
ok('payload normalizado no conserva pdfBase64',
  /function _documentGroups\([\s\S]{0,2600}const \{url,pdfBase64,\.\.\.persistent\}=item/.test(html));
ok('openPdfNewTab usa sesión primero solo si sigue pendiente',
  openPdfSource.indexOf('_pendingDocFiles.has(blobId)') >= 0 &&
  openPdfSource.indexOf('_pendingDocFiles.has(blobId)') <
    openPdfSource.indexOf('fetchDocumentBlobUrl(documentId)'));
ok('openPdfNewTab prioriza R2 y base64 antes del fallback de sesión',
  openPdfSource.indexOf('fetchDocumentBlobUrl(documentId)') <
    openPdfSource.indexOf('pdfBase64') &&
  openPdfSource.indexOf('pdfBase64') <
    openPdfSource.lastIndexOf('docBlobMap[blobId]'));
ok('viewDoc usa sesión primero solo si sigue pendiente',
  viewDocSource.indexOf('_pendingDocFiles.has(blobId)') >= 0 &&
  viewDocSource.indexOf('_pendingDocFiles.has(blobId)') <
    viewDocSource.indexOf('fetchDocumentBlobUrl(documentId)'));
ok('viewDoc prioriza R2 y base64 antes del fallback de sesión',
  viewDocSource.indexOf('fetchDocumentBlobUrl(documentId)') <
    viewDocSource.indexOf('pdfBase64') &&
  viewDocSource.indexOf('pdfBase64') <
    viewDocSource.lastIndexOf('docBlobMap[blobId]'));
ok('flush descarta pendientes cuyo upload ya fue eliminado',
  /if\(!found\)\{\s*_pendingDocFiles\.delete\(blobId\);\s*continue;\s*\}/.test(flushSource));
ok('flush resuelve el documentId acotado al proyecto dueño del upload (no global)',
  /_documentIdForUpload\(upload,uploadProject\)/.test(flushSource));
ok('sync elimina pendientes que ya no existen en documentos actuales',
  /_pendingDocFiles\.delete\(blobId\)/.test(syncSource));
ok('borrado UI individual limpia el archivo pendiente',
  /function docDelete\([\s\S]{0,800}_pendingDocFiles\.delete\(/.test(html));
ok('borrado UI masivo limpia los archivos pendientes',
  /function docBulkDelete\([\s\S]{0,1200}_pendingDocFiles\.delete\(/.test(html));
ok('openPdfNewTab y viewDoc resuelven documentId acotado al proyecto dueño del upload',
  /_documentIdForUpload\(up,_found\?\.project\)/.test(openPdfSource) &&
  /_documentIdForUpload\(up,_found\?\.project\)/.test(viewDocSource));
ok('_findUploadByBlobId expone también el proyecto dueño del upload',
  /function _findUploadByBlobId\(blobId(?:,preferredProject)?\)\{[\s\S]{0,800}return \{upload,project\};/.test(html));
ok('_findUploadByBlobId prefiere preferredProject antes del barrido global',
  /function _findUploadByBlobId\(blobId(?:,preferredProject)?\)\{[\s\S]{0,400}if\(preferredProject\)/.test(html));
ok('openPdfNewTab y viewDoc pasan curProj al resolver upload duplicado',
  /_findUploadByBlobId\(blobId,curProj\)/.test(openPdfSource) &&
  /_findUploadByBlobId\(blobId,curProj\)/.test(viewDocSource));

console.log(`\n${pass} ok, ${fail} fail`);
if (fail) process.exit(1);
