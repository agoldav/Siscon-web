# Adjuntos permanentes (Documentos → R2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los PDF de Documentos (y los que llegan por Outlook) viven en Cloudflare R2; Supabase solo guarda `storage_key`, sin `pdfBase64`.

**Architecture:** Módulo `r2-storage.js` + rutas proxy `/api/files/documents/...` en el backend. El frontend sube con `FormData` tras crear la fila `documents`, abre con `GET` → blob de sesión, y borra el objeto R2 al soft-delete. Migración one-shot `migrate-document-files-to-r2.js` mueve los base64 existentes.

**Tech Stack:** Node/Express (siscon-backend), `@aws-sdk/client-s3` + `multer`, Supabase `documents.storage_key`, frontend vanilla en `Siscon-web/index.html`, bucket R2 `siscon-archivos`.

**Spec:** `Siscon-web/docs/superpowers/specs/2026-08-05-adjuntos-permanentes-r2-design.md`

## Global Constraints

- Alcance v1: solo Documentos de proyecto + PDF Outlook → uploads. No Mensajes. No `transactions.pdf_storage_key`.
- Backend es el único proxy a R2; sin URLs firmadas al navegador.
- Credenciales R2 solo en env de Render / `.env` local; nunca en el frontend.
- Límite de subida: 25 MB (`R2_MAX_UPLOAD_BYTES`, default `26214400`).
- Auth de rutas files: mismo `checkToken` + `authorizeTable(..., 'documents', ...)` que el CRUD de documents.
- La URL `blob:` de sesión nunca se persiste (regla ya Completada).
- Tras persistir documents, el JSON `data` no debe contener `pdfBase64`.
- OWNER autorizó tocar Completado: Documentos, `openPdfNewTab`/`viewDoc`, Outlook→PDF, rutas documents, migración.
- Commits: cambios de backend en repo `siscon-backend/`; frontend/docs en `Siscon-web/`. No `git push` hasta que el usuario lo pida.
- TDD: test que falla → implementar → test en verde → commit por tarea.

## File map

| Archivo | Responsabilidad |
|---------|-----------------|
| `siscon-backend/r2-storage.js` | Cliente S3/R2: put/get/delete, buildKey, límites |
| `siscon-backend/server.js` | Rutas `/api/files/...`; strip `pdfBase64` en POST/PUT documents; borrar R2 en DELETE documents |
| `siscon-backend/document-mapping.js` | `cleanUpload` elimina `pdfBase64`; propaga `storageKey` |
| `siscon-backend/migrate-document-files-to-r2.js` | Migración one-shot base64 → R2 |
| `siscon-backend/test-r2-files.js` | Tests del módulo + contrato de rutas |
| `siscon-backend/test-documents.js` | Actualizar aserciones “hasta conectar R2” |
| `siscon-backend/package.json` | deps `@aws-sdk/client-s3`, `multer` |
| `siscon-backend/.env.example` | vars R2 |
| `siscon-backend/README.md` | instrucciones deploy/migración |
| `Siscon-web/index.html` | subida, apertura, sync post-upload, Outlook |
| `Siscon-web/test-normalized-documents.js` | aserciones frontend sin pdfBase64 |
| `Siscon-web/PROJECT_CONTEXT.md` | mover ítem Pendiente → Completado al cerrar |

---

### Task 1: Módulo `r2-storage.js` + dependencias + env

**Files:**
- Create: `siscon-backend/r2-storage.js`
- Create: `siscon-backend/test-r2-files.js` (primera parte: tests unitarios del módulo)
- Modify: `siscon-backend/package.json`
- Modify: `siscon-backend/.env.example`

**Interfaces:**
- Produces:
  - `isR2Configured()` → `boolean`
  - `maxUploadBytes()` → `number` (default `26214400`)
  - `buildDocumentKey(projectId, documentId, fileName)` → `string`
  - `buildPendingKey(pendingBillId, fileName)` → `string`
  - `putObject({ key, body, contentType })` → `Promise<void>`
  - `getObject(key)` → `Promise<{ body: Buffer, contentType: string|null }>`
  - `deleteObject(key)` → `Promise<void>`
  - `stripPdfBase64FromData(data)` → nuevo objeto `data` sin `pdfBase64` en `upload`/`doc`

- [ ] **Step 1: Escribir tests unitarios del módulo (sin red)**

Crear `siscon-backend/test-r2-files.js`:

```javascript
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name, detail || ''); }
}

console.log('r2-storage (unitario):');
const {
  buildDocumentKey, buildPendingKey, stripPdfBase64FromData, maxUploadBytes,
} = require('./r2-storage');

const key = buildDocumentKey(12, 'doc:2:12:blob1', '../a b.pdf');
ok('buildDocumentKey sanitiza nombre y fija prefijo',
  key.startsWith('projects/12/documents/doc:2:12:blob1/') &&
  key.endsWith('a_b.pdf') && !key.includes('..'));

ok('buildPendingKey usa pending/',
  buildPendingKey('pb-1', 'x.pdf').startsWith('pending/pb-1/'));

const dirty = {
  upload: { name: 'a.pdf', pdfBase64: 'YWJj', storageKey: 'k' },
  doc: { name: 'a.pdf', pdfBase64: 'YWJj' },
};
const clean = stripPdfBase64FromData(dirty);
ok('strip quita pdfBase64 de upload y doc',
  clean.upload.pdfBase64 === undefined && clean.doc.pdfBase64 === undefined &&
  clean.upload.storageKey === 'k');
ok('strip no muta el original', dirty.upload.pdfBase64 === 'YWJj');
ok('maxUploadBytes default 25MB', maxUploadBytes() === 26214400);

console.log(`\n${pass} ok, ${fail} fail`);
if (fail) process.exit(1);
```

- [ ] **Step 2: Correr test — debe fallar (módulo ausente)**

```bash
cd "/Users/abraham/Documents/AI Programs/PM App/siscon-backend" && node test-r2-files.js
```

Expected: `Cannot find module './r2-storage'`

- [ ] **Step 3: Instalar deps y crear módulo**

```bash
cd "/Users/abraham/Documents/AI Programs/PM App/siscon-backend"
npm install @aws-sdk/client-s3 multer --save
```

Crear `r2-storage.js`:

```javascript
'use strict';
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const DEFAULT_MAX = 25 * 1024 * 1024;

function maxUploadBytes() {
  const n = Number(process.env.R2_MAX_UPLOAD_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX;
}

function isR2Configured() {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET
  );
}

function safeFileName(name) {
  const base = String(name || 'file.bin').split(/[/\\]/).pop();
  return base.replace(/[^\w.\-()+ ]+/g, '_').replace(/\s+/g, '_').slice(0, 180) || 'file.bin';
}

function buildDocumentKey(projectId, documentId, fileName) {
  return `projects/${String(projectId)}/documents/${String(documentId)}/${safeFileName(fileName)}`;
}

function buildPendingKey(pendingBillId, fileName) {
  return `pending/${String(pendingBillId)}/${safeFileName(fileName)}`;
}

function getClient() {
  if (!isR2Configured()) throw new Error('R2 no configurado');
  const accountId = process.env.R2_ACCOUNT_ID;
  const endpoint = process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

function bucket() {
  return process.env.R2_BUCKET;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function putObject({ key, body, contentType }) {
  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
  }));
}

async function getObject(key) {
  const client = getClient();
  const out = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const body = await streamToBuffer(out.Body);
  return { body, contentType: out.ContentType || null };
}

async function deleteObject(key) {
  if (!key) return;
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

function stripPdfBase64FromData(data) {
  if (!data || typeof data !== 'object') return data || {};
  const next = JSON.parse(JSON.stringify(data));
  if (next.upload && typeof next.upload === 'object') delete next.upload.pdfBase64;
  if (next.doc && typeof next.doc === 'object') delete next.doc.pdfBase64;
  return next;
}

module.exports = {
  isR2Configured, maxUploadBytes, buildDocumentKey, buildPendingKey,
  putObject, getObject, deleteObject, stripPdfBase64FromData, safeFileName,
};
```

Añadir al final de `.env.example`:

```bash
# ---- Cloudflare R2 (adjuntos permanentes de Documentos) ----
# Bucket: siscon-archivos. Credenciales S3 de R2 (Cloudflare dashboard → R2 → Manage R2 API Tokens).
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=siscon-archivos
# Opcional; default https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_ENDPOINT=
# Opcional; default 26214400 (25 MB)
R2_MAX_UPLOAD_BYTES=26214400
```

- [ ] **Step 4: Correr tests unitarios — deben pasar**

```bash
node test-r2-files.js
```

Expected: PASS.

- [ ] **Step 5: Commit (backend)**

```bash
cd "/Users/abraham/Documents/AI Programs/PM App/siscon-backend"
git add package.json package-lock.json r2-storage.js test-r2-files.js .env.example
git commit -m "$(cat <<'EOF'
feat: Módulo R2 para almacenamiento de documentos

EOF
)"
```

---

### Task 2: Rutas `/api/files/documents/...` + strip en CRUD + delete R2

**Files:**
- Modify: `siscon-backend/server.js` (después del bloque documents ~línea 2162; y dentro de POST/PUT/DELETE documents)
- Modify: `siscon-backend/document-mapping.js` (`cleanUpload`)
- Modify: `siscon-backend/test-r2-files.js` (aserciones de contrato por source inspection)
- Modify: `siscon-backend/test-documents.js` (cambiar “hasta conectar R2” → strip / storage_key)

**Interfaces:**
- Consumes: exports de `r2-storage.js` (Task 1)
- Produces HTTP:
  - `POST /api/files/documents/:documentId` multipart field `file` → `{ ok, storageKey, sizeBytes, mime, document }`
  - `GET /api/files/documents/:documentId` → bytes raw
  - `POST /api/files/documents/:documentId/from-pending` JSON `{ pendingBillId }` → mueve pending→definitivo

- [ ] **Step 1: Extender `test-r2-files.js` con contrato de rutas**

Antes del resumen pass/fail, añadir:

```javascript
console.log('\nContrato server.js (files):');
const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
ok('existe POST /api/files/documents/:documentId',
  server.includes("app.post('/api/files/documents/:documentId'"));
ok('existe GET /api/files/documents/:documentId',
  server.includes("app.get('/api/files/documents/:documentId'"));
ok('existe from-pending',
  server.includes("app.post('/api/files/documents/:documentId/from-pending'"));
ok('DELETE documents dispara deleteObject R2',
  /app\.delete\('\/api\/db\/documents\/:id'[\s\S]{0,1200}deleteObject/.test(server));
ok('POST/PUT documents usan stripPdfBase64FromData',
  /stripPdfBase64FromData/.test(server));
```

En `test-documents.js`, reemplazar la aserción `pdfBase64 se conserva hasta conectar R2` por:

```javascript
ok('cleanUpload/mapping ya no persiste pdfBase64',
  twin && !twin.data.upload.pdfBase64);
ok('storageKey del upload pasa a storage_key de fila cuando existe',
  projectDocumentsToRows({
    id: 403,
    docs: [],
    uploads: [{ id: 'u', blobId: 'b', name: 'x.pdf', storageKey: 'projects/403/documents/d/x.pdf' }],
  })[0].storage_key === 'projects/403/documents/d/x.pdf');
```

- [ ] **Step 2: Correr tests — deben fallar**

```bash
node test-r2-files.js
node test-documents.js
```

Expected: fallos en rutas ausentes / pdfBase64 aún presente.

- [ ] **Step 3: Implementar `cleanUpload` sin base64**

En `document-mapping.js`:

```javascript
function cleanUpload(upload) {
  if (!upload) return null;
  const { url, pdfBase64, ...persistent } = upload;
  return cloneJson(persistent);
}
```

- [ ] **Step 4: Implementar rutas y hooks en `server.js`**

Cerca de los requires superiores:

```javascript
const multer = require('multer');
const {
  isR2Configured, maxUploadBytes, buildDocumentKey, buildPendingKey,
  putObject, getObject, deleteObject, stripPdfBase64FromData,
} = require('./r2-storage');

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes() },
});
```

En `POST /api/db/documents` y `PUT /api/db/documents/:id`, después de armar `payload` y antes de insert/update:

```javascript
if (payload.data) payload.data = stripPdfBase64FromData(payload.data);
```

En `DELETE /api/db/documents/:id`, tras soft-delete exitoso (`data` es la fila), best-effort:

```javascript
if (data.storage_key && isR2Configured()) {
  try { await deleteObject(data.storage_key); }
  catch (e) { console.warn('[R2] no se pudo borrar', data.storage_key, e.message); }
}
```

Después del bloque DELETE documents, añadir las tres rutas del spec:

1. `POST /api/files/documents/:documentId` — multer `file` → PutObject → update `storage_key` + strip data; si falla DB, deleteObject del key nuevo; si había `prevKey` distinto, borrarlo.
2. `GET /api/files/documents/:documentId` — GetObject por `storage_key`; fallback temporal a `data.upload.pdfBase64` si aún no migró; 404 si no hay ninguno.
3. `POST /api/files/documents/:documentId/from-pending` — body `{ pendingBillId }`; lee pending de `store.pendingBills`; copia objeto a key definitiva; update document; borra key pending; limpia bill.

Auth en las tres: `checkToken` + `authorizeTable` documents read/update según corresponda. Si `!isR2Configured()` → `503`.

Oversize multer → `413` con mensaje claro.

Actualizar el comentario del bloque documents (~2047) para indicar que el binario vive en R2.

Código de referencia completo está en la spec; copiar la implementación del design brainstorm (sección endpoints) sin omitir strip ni cleanup.

- [ ] **Step 5: Correr tests**

```bash
node test-r2-files.js
node test-documents.js
```

Expected: PASS.

- [ ] **Step 6: Commit (backend)**

```bash
git add server.js document-mapping.js test-r2-files.js test-documents.js
git commit -m "$(cat <<'EOF'
feat: Proxy R2 para archivos de documents

EOF
)"
```

---

### Task 3: Outlook pending → R2 (backend)

**Files:**
- Modify: `siscon-backend/server.js` (todos los `pendingBills.push` con `pdfBase64`)
- Modify: `siscon-backend/test-r2-files.js`

Hay varios sitios (~3408, ~3586, ~3710) que empujan `pdfBase64`. Unificar.

- [ ] **Step 1: Test de contrato**

```javascript
ok('helper storePendingBillPdf / buildPendingKey en server',
  /buildPendingKey/.test(server) && /storePendingBillPdf|storageKey/.test(server));
```

- [ ] **Step 2: Helper interno**

```javascript
async function storePendingBillPdf({ id, projectRef, fileName, b64, ocrResult }) {
  const entry = {
    id, projectRef, fileName, data: ocrResult,
    createdAt: Date.now(), acked: false,
    storageKey: null, pdfBase64: null,
  };
  if (isR2Configured() && b64) {
    const key = buildPendingKey(id, fileName);
    await putObject({
      key,
      body: Buffer.from(b64, 'base64'),
      contentType: 'application/pdf',
    });
    entry.storageKey = key;
  } else {
    entry.pdfBase64 = b64;
    console.warn('[R2] pending bill con pdfBase64 (R2 no configurado)');
  }
  store.pendingBills.push(entry);
  return entry;
}
```

Reemplazar los pushes duplicados.

- [ ] **Step 3: `/api/ms/pending` no envía base64 si hay storageKey**

```javascript
map(b => ({
  ...b,
  pdfBase64: b.storageKey ? undefined : b.pdfBase64,
  hasFile: !!(b.storageKey || b.pdfBase64),
}))
```

- [ ] **Step 4: Tests + commit**

```bash
node test-r2-files.js
git add server.js test-r2-files.js
git commit -m "$(cat <<'EOF'
feat: Outlook pending PDFs a R2

EOF
)"
```

---

### Task 4: Migración one-shot `migrate-document-files-to-r2.js`

**Files:**
- Create: `siscon-backend/migrate-document-files-to-r2.js`
- Modify: `siscon-backend/README.md`
- Modify: `siscon-backend/test-r2-files.js`

**Interfaces:**
- `node migrate-document-files-to-r2.js` → dry-run (default)
- `node migrate-document-files-to-r2.js --apply` → escribe

- [ ] **Step 1: Test de existencia**

```javascript
const mig = fs.readFileSync(path.join(__dirname, 'migrate-document-files-to-r2.js'), 'utf8');
ok('migración es dry-run por defecto', /--apply/.test(mig) && /DRY_RUN|dry/.test(mig));
ok('migración usa putObject y stripPdfBase64FromData',
  /putObject/.test(mig) && /stripPdfBase64FromData/.test(mig));
```

- [ ] **Step 2: Implementar script**

1. Requiere `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, y `isR2Configured()`; si no → exit 1.
2. Cargar documents activos; filtrar en JS los que tengan `data.upload.pdfBase64` o `data.doc.pdfBase64`.
3. Dry-run: imprimir id, name, bytes estimados, storage_key actual.
4. `--apply` por fila: decode → `buildDocumentKey` → `putObject` → update `storage_key` + `data` strip + `upload.storageKey`/`doc.storageKey`; si update falla, `deleteObject` y contar error.
5. Resumen final migrados/errores/omitidos.

- [ ] **Step 3: README**

```markdown
## Documentos → R2 (adjuntos permanentes)

1. Configurar vars `R2_*` en Render y redeploy backend.
2. Dry-run: `node migrate-document-files-to-r2.js`
3. Confirmar backup Dropbox/DB reciente.
4. Apply: `node migrate-document-files-to-r2.js --apply`
5. Desplegar frontend que deja de escribir `pdfBase64`.
```

- [ ] **Step 4: Commit**

```bash
git add migrate-document-files-to-r2.js README.md test-r2-files.js
git commit -m "$(cat <<'EOF'
feat: Migración one-shot pdfBase64 de documents a R2

EOF
)"
```

---

### Task 5: Frontend — subir y abrir desde R2

**Files:**
- Modify: `Siscon-web/index.html`
- Create or modify: `Siscon-web/test-document-files.js` (o extender `test-normalized-documents.js`)

**Interfaces:**
- `const _pendingDocFiles = new Map()` // blobId → File
- `async function uploadDocumentFile(documentId, file)`
- `async function fetchDocumentBlobUrl(documentId)`
- `async function _flushPendingDocumentUploads()` — al final de `_syncNormalizedDocuments`

- [ ] **Step 1: Tests frontend (source inspection)**

```javascript
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
ok('openPdfNewTab usa /api/files/documents/',
  /async function openPdfNewTab\([\s\S]{0,2000}\/api\/files\/documents\//.test(html));
ok('flush pending uploads tras sync documents',
  /_flushPendingDocumentUploads/.test(html));
console.log(`\n${pass} ok, ${fail} fail`);
if (fail) process.exit(1);
```

Correr → FAIL.

- [ ] **Step 2: Helpers** (cerca de `_dbRowRequest`)

Implementar `_pendingDocFiles`, `uploadDocumentFile` (FormData + Bearer, sin Content-Type manual), `fetchDocumentBlobUrl`, `_findUploadByBlobId`, `_documentIdForUpload` usando `_documentGroups`.

- [ ] **Step 3: `processDocFiles`**

Quitar `FileReader` / `pdfBase64`. Guardar `File` en `_pendingDocFiles` por `blobId`. Tras `saveData()`, el flush corre dentro de `_syncNormalizedDocuments`.

`_flushPendingDocumentUploads`: por cada pending, resolver `documentId`, `uploadDocumentFile`, set `storageKey` en upload/doc, actualizar `_documentSnapshots`/`_documentVersions` con `data.document.updated_at` si viene, borrar del Map. Si falla → `alert` y `return false`.

Al final exitoso de `_syncNormalizedDocuments`:

```javascript
if (!(await _flushPendingDocumentUploads())) return false;
```

- [ ] **Step 4: `openPdfNewTab` y `viewDoc` async**

Orden: storageKey/documentId → `fetchDocumentBlobUrl`; else pdfBase64 legacy; else url sesión; else alert.

- [ ] **Step 5: Tests + commit**

```bash
cd "/Users/abraham/Documents/AI Programs/PM App/Siscon-web"
node test-document-files.js
node test-normalized-documents.js
git add index.html test-document-files.js test-normalized-documents.js test-normalized-persistence.js
git commit -m "$(cat <<'EOF'
feat: Documentos suben y abren PDF vía R2

EOF
)"
```

---

### Task 6: Frontend — Outlook `msAttachPendingPdf` + from-pending

**Files:**
- Modify: `Siscon-web/index.html`

- [ ] **Step 1: `msAttachPendingPdf`** acepta `bill.storageKey` sin exigir `pdfBase64`. Guarda `pendingBillId` / `pendingStorageKey` en el upload. Solo pone `pdfBase64` en fallback local.

- [ ] **Step 2: `_linkPendingBillFiles`**

Para cada upload con `pendingBillId` y sin `storageKey`:

`POST /api/files/documents/:docId/from-pending` con `{ pendingBillId }`.

Set `storageKey`, limpiar pending fields y `pdfBase64`.

Llamar tras import Outlook (después de `saveData` / sync) y/o al final de `_flushPendingDocumentUploads`.

Unclassified: preferir `storageKey` sobre `pdfBase64` cuando el bill ya está en R2.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: Outlook adjunta PDFs vía R2 from-pending

EOF
)"
```

---

### Task 7: Cascada proyecto + cierre docs

**Files:**
- Modify: `siscon-backend/server.js` (delete project)
- Modify: `Siscon-web/PROJECT_CONTEXT.md`

- [ ] **Step 1:** Al borrar proyecto, best-effort `deleteObject` de `storage_key` de documents de ese proyecto (activos antes del cascade o tras soft-delete).

- [ ] **Step 2: Suite**

```bash
cd "/Users/abraham/Documents/AI Programs/PM App/siscon-backend"
node test-r2-files.js && node test-documents.js

cd "/Users/abraham/Documents/AI Programs/PM App/Siscon-web"
node test-document-files.js
node test-normalized-documents.js
node test-normalized-persistence.js
```

- [ ] **Step 3: PROJECT_CONTEXT**

- §9 Completado: sesión con fecha, R2 proxy, migración, Outlook.
- §10 Pendiente: eliminar ítem Adjuntos permanentes.

- [ ] **Step 4: Commits** en ambos repos.

---

### Task 8: Deploy y verificación (manual)

- [ ] Vars `R2_*` en Render → redeploy backend
- [ ] `node migrate-document-files-to-r2.js` (dry-run) luego `--apply` tras backup
- [ ] Deploy frontend
- [ ] Smoke OWNER: PDF nuevo + recarga; PDF viejo; borrar; Outlook
- [ ] `git push` solo si el usuario lo pide

---

## Self-review (plan vs spec)

| Requisito spec | Task |
|----------------|------|
| Proxy backend upload/download | 2 |
| `storage_key`, sin `pdfBase64` en DB | 2, 4, 5 |
| Migración one-shot | 4 |
| Outlook → R2 + from-pending | 3, 6 |
| Borrado R2 al eliminar documento | 2 |
| Cascada proyecto | 7 |
| Límite 25 MB | 1, 2 |
| Tests | 1–5, 7 |
| PROJECT_CONTEXT | 7 |
| Fuera de alcance Mensajes/transactions | respetado |
