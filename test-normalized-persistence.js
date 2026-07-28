// VUL-044 Fase A — cableado frontend de projects/houses normalizados.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name); }
}

console.log('Carga y reconstrucción:');
ok('carga settings, projects y houses en paralelo',
  /Promise\.all\(\[[\s\S]{0,500}\/api\/db\/settings\/1[\s\S]{0,300}\/api\/db\/projects[\s\S]{0,300}\/api\/db\/houses/.test(html));
ok('convierte ids text de Postgres a número seguro',
  /function _restoreDbId\(value\)/.test(html) && /Number\.isSafeInteger\(n\)\?n:value/.test(html));
ok('reconstruye proyectos desde columnas + data',
  /function _projectFromRow\(row\)/.test(html) && /razonSocial:row\.razon_social/.test(html));
ok('reconstruye casas y las adjunta a su proyecto',
  /function _houseFromRow\(row\)/.test(html) &&
  /project\.houses\.push\(house\)/.test(html));
ok('una casa huérfana aborta la carga normalizada',
  /throw new Error\(`Casa \$\{house\.id\} referencia proyecto inexistente/.test(html));
ok('tablas vacías antes de migrar conservan fallback del blob',
  /tablas vacías; se mantiene temporalmente projects desde settings\/1/.test(html));

console.log('\nVersiones y snapshots por fila:');
for (const name of ['_projectVersions','_houseVersions','_projectSnapshots','_houseSnapshots']) {
  ok(`existe ${name}`, new RegExp(`const ${name}=new Map\\(\\)`).test(html));
}
ok('la versión de cada respuesta queda registrada',
  /_projectVersions\.set\(id,row\.updated_at\|\|null\)/.test(html) &&
  /_houseVersions\.set\(id,row\.updated_at\|\|null\)/.test(html));
ok('los snapshots excluyen houses del proyecto',
  /const \{houses,\.\.\.rest\}=project\|\|\{\}/.test(html));
ok('los payloads de uploads excluyen blobId/url efímeros',
  /map\(\(\{blobId,url,\.\.\.upload\}\)=>upload\)/.test(html));

console.log('\nSincronización incremental:');
ok('save core sincroniza filas antes de settings',
  /const rowsOk=await _syncNormalizedProjectsHouses\(\)[\s\S]{0,350}const settingsData=_settingsCloudData\(\)/.test(html));
ok('en modo normalizado settings ya no recibe projects',
  /function _settingsCloudData\(\)[\s\S]{0,250}if\(!_normalizedProjectsLoaded\)\{[\s\S]{0,180}data\.projects=/.test(html));
ok('proyectos nuevos usan POST',
  /_dbRowRequest\('POST','\/api\/db\/projects',payload\)/.test(html));
ok('proyectos modificados mandan versión y replace_data',
  /replace_data:true,expected_updated_at:_projectVersions\.get\(id\)/.test(html));
ok('casas nuevas usan POST',
  /_dbRowRequest\('POST','\/api\/db\/houses',payload\)/.test(html));
ok('casas modificadas mandan versión y replace_data',
  /replace_data:true,expected_updated_at:_houseVersions\.get\(id\)/.test(html));
ok('proyectos eliminados usan DELETE y limpian sus casas locales',
  /_dbRowRequest\('DELETE',`\/api\/db\/projects\//.test(html) &&
  /if\(projectId===id\)/.test(html));
ok('casas eliminadas usan DELETE',
  /_dbRowRequest\('DELETE',`\/api\/db\/houses\//.test(html));
ok('409/428 genuinos requieren decisión explícita del usuario',
  /if\(resp\.status===409\|\|resp\.status===428\)/.test(html) &&
  /async function _handleRowConflict/.test(html) &&
  /const reload=confirm\(/.test(html));
ok('una aprobación propia usa el flujo específico antes del diálogo genérico por fila',
  /async function _handleRowConflict[\s\S]{0,250}_handleRecentOwnApproval\(\)[\s\S]{0,250}const reload=confirm\(/.test(html));
ok('el overwrite por conflicto usa force:true explícito',
  /replace_data:true,force:true/.test(html));

console.log('\nCompatibilidad y almacenamiento local:');
ok('localStorage conserva el modelo completo para recuperación local',
  /localStorage\.setItem\(LS_KEY,JSON\.stringify\(\{projects:projectsClean,SYS,activityLog\}\)\)/.test(html));
ok('backend anterior conserva escritura legacy temporal',
  /if\(!_normalizedProjectsLoaded\)[\s\S]{0,200}data\.projects/.test(html));

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
