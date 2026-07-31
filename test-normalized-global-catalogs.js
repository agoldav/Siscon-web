// VUL-044 Fase H — cableado frontend de cotizaciones y sin clasificar normalizados.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name); }
}

console.log('Carga y fallback escalonado:');
ok('carga las dos tablas globales junto al resto del estado',
  /fetch\(`\$\{BACKEND_URL\}\/api\/db\/cotizaciones`/.test(html) &&
  /fetch\(`\$\{BACKEND_URL\}\/api\/db\/unclassified_items`/.test(html));
ok('solo activa el lector normalizado con marcador explícito',
  /cotizacionesData\.migration_applied===true/.test(html) &&
  /unclassifiedData\.migration_applied===true/.test(html) &&
  /_normalizedGlobalCatalogsLoaded=true/.test(html));
ok('conserva fallback de SYS antes del cutover',
  /hasLegacyCotizaciones/.test(html) && /hasLegacyUnclassified/.test(html));
ok('falla cerrado si no hay marcador ni fuente legacy',
  /Catálogos sin marcador de cutover ni fuente legacy; carga abortada/.test(html));
ok('reconstruye orden estable y recuerda versiones por fila',
  /_globalCatalogFromRow\(row\)/.test(html) &&
  /_rememberGlobalCatalogRow\(row,table,item,sortOrder\)/.test(html) &&
  /sortOrder-b\.sortOrder/.test(html));

console.log('\nSincronización incremental:');
ok('mantiene versiones y snapshots por elemento global',
  /const _globalCatalogVersions=new Map\(\)/.test(html) &&
  /const _globalCatalogSnapshots=new Map\(\)/.test(html));
ok('crea, actualiza y elimina filas sin reemplazar el catálogo entero',
  /_dbRowRequest\('POST',`\/api\/db\/\$\{table\}`/.test(html) &&
  /expected_updated_at:_globalCatalogVersions\.get\(key\)/.test(html) &&
  /_dbRowRequest\('DELETE',`\/api\/db\/\$\{table\}/.test(html));
ok('conflictos 409/428 usan el manejador común',
  /async function _syncNormalizedGlobalCatalogs[\s\S]{0,2600}_handleRowConflict/.test(html));
ok('sincroniza proyectos/transacciones antes de borrar un sin clasificar',
  /_syncNormalizedProjectsHouses\(\)[\s\S]{0,500}_syncNormalizedGlobalCatalogs\(\)/.test(html));

console.log('\nCierre del blob:');
ok('settings omite ambos catálogos después del cutover',
  /if\(_normalizedGlobalCatalogsLoaded\)[\s\S]{0,180}delete cloudSYS\.cotizaciones[\s\S]{0,100}delete cloudSYS\.unclassified/.test(html));
ok('settings limpia los tres residuos legacy sin tocar sus tablas normalizadas',
  /delete cloudSYS\.notifications/.test(html) &&
  /delete cloudSYS\.pendingAuthRequests/.test(html) &&
  /delete cloudSYS\.conversations/.test(html));
ok('la UI conserva los arreglos históricos para no recrear funcionalidades',
  /SYS\.cotizaciones/.test(html) && /SYS\.unclassified/.test(html));
ok('localStorage conserva la copia completa de recuperación',
  /localStorage\.setItem\(LS_KEY,JSON\.stringify\(\{projects:projectsClean,SYS,activityLog\}\)\)/.test(html));

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
