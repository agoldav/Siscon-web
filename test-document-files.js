const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name, detail || ''); }
}

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

console.log(`\n${pass} ok, ${fail} fail`);
if (fail) process.exit(1);
