// ============================================================
//  Pruebas del control de concurrencia del blob settings/1 (VUL-033) — lado frontend
//  Corre:  node test-concurrency.js
//
//  Verifica el CABLEADO en index.html: que la versión se capture al cargar, se mande al guardar,
//  y que 409/428 tengan manejo propio. Son aserciones sobre el código desplegado; la lógica
//  atómica del lado servidor se prueba en siscon-backend/test-auth-legacy.js.
// ============================================================
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗ FALLA:', name); } }

console.log('Control de concurrencia settings/1 (VUL-033):');

// 1) La versión se captura al cargar del servidor.
ok('loadDataFromAPI guarda updated_at como versión base',
  /_settingsVersion\s*=\s*record\.updated_at/.test(html));

// 2) Y se manda en cada guardado.
ok('saveDataToAPI envía expected_updated_at en el body',
  /expected_updated_at:\s*_settingsVersion/.test(html));

// 3) Se refresca con la versión que devuelve el servidor tras guardar (si no, el 2º save daría 409).
ok('tras guardar se actualiza la versión con la respuesta',
  /saved\s*&&\s*saved\.updated_at\)\s*_settingsVersion\s*=\s*saved\.updated_at/.test(html));

// 4) Trampa sutil: la lectura previa que hace saveDataToAPI para fusionar pendingAuthRequests
//    NO debe refrescar la versión. Si lo hiciera, siempre coincidiría y el conflicto nunca
//    se detectaría — el control quedaría de adorno.
const iSave = html.indexOf('async function saveDataToAPI()');
const iFin = html.indexOf('\nfunction saveData()', iSave);
const cuerpoSave = html.slice(iSave, iFin);
const iPut = cuerpoSave.indexOf("method: 'PUT'");
const antesDelPut = cuerpoSave.slice(0, iPut);
ok('la lectura previa (merge de solicitudes) NO refresca la versión',
  !/_settingsVersion\s*=/.test(antesDelPut));

// 5) Manejo explícito de las dos respuestas del servidor.
ok('409 (otro usuario guardó) tiene manejo propio',
  /resp\.status===409.*_handleSaveConflict/.test(html));
ok('428 (sin versión base) tiene manejo propio',
  /resp\.status===428.*_handleMissingVersion/.test(html));

// 6) El conflicto se le pregunta al usuario; no se resuelve solo en ninguna dirección.
ok('ante conflicto se pregunta al usuario (no decide la app)',
  /_handleSaveConflict[\s\S]{0,600}confirm\(/.test(html));
ok('si el usuario elige recargar, recarga', /_handleSaveConflict[\s\S]{0,900}location\.reload\(\)/.test(html));
ok('si elige sobrescribir, limpia la versión y reintenta',
  /_settingsVersion=null;[\s\S]{0,200}return await saveDataToAPI\(\)/.test(html));
ok('no se apilan diálogos si hay varios guardados en vuelo',
  /if\(_conflictDialogOpen\)\s*return false/.test(html));

// 7) Sin versión base se avisa una sola vez, pero no se guarda en la nube.
ok('sin versión base devuelve false (no guarda en la nube)',
  /function _handleMissingVersion\(\)[\s\S]{0,700}return false;/.test(html));
ok('el aviso de sin-versión no se repite en cada autoguardado',
  /if\(!_versionWarned\)\{[\s\S]{0,80}_versionWarned=true/.test(html));
ok('al recuperar la sincronía se rearma el aviso',
  /if\(_settingsVersion\)\s*_versionWarned=false/.test(html));

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
