const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, condition) {
  if (condition) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name); }
}

const start = html.indexOf('async function qboTestConnection()');
const end = html.indexOf('\n}\n', start);
const qboTestConnection = html.slice(start, end + 2);
function functionSource(signature) {
  const functionStart = html.indexOf(signature);
  const functionEnd = html.indexOf('\n}\n', functionStart);
  return functionStart >= 0 && functionEnd > functionStart ? html.slice(functionStart, functionEnd + 2) : '';
}
const qboConnect = functionSource('function qboConnect()');
const qboConfirmCompany = functionSource('async function qboConfirmCompany()');
const qboCancelCompany = functionSource('async function qboCancelCompany()');

console.log('Conexión QuickBooks mediante proxy gratuito:');
ok('existe qboTestConnection', start >= 0 && end > start);
ok('consulta el estado del backend', /await qboStatus\(\)/.test(qboTestConnection));
ok('no rechaza la base vacía válida del proxy mismo origen',
  !/if\s*\(\s*!\s*backendUrl\(\)\s*\)/.test(qboTestConnection));
ok('Ajustes ofrece Sandbox y Producción sin pedir credenciales al usuario',
  /id="s-qbo-env"/.test(html) && /value="sandbox"/.test(html) && /value="production"/.test(html) &&
  !/QBO_DEVELOPMENT_CLIENT_SECRET|QBO_PRODUCTION_CLIENT_SECRET/.test(html));
ok('la conexión manda únicamente el entorno seleccionado al backend',
  /\/api\/qbo\/connect\?environment=/.test(qboConnect));
ok('la compañía pendiente muestra nombre, entorno y realm antes de activarse',
  /SYS\.qbo\.pending\.companyName/.test(html) && /SYS\.qbo\.pending\.realmId/.test(html));
ok('confirmar y cancelar requieren endpoints protegidos del backend',
  /\/api\/qbo\/confirm-company/.test(qboConfirmCompany) && /\/api\/qbo\/cancel-company/.test(qboCancelCompany));
ok('cambiar compañía limpia las cachés de la compañía anterior',
  /_qboTransactionsCache=null/.test(qboConfirmCompany) && /vendorCache/.test(qboConfirmCompany) && /projectCache/.test(qboConfirmCompany));
ok('la UI identifica la compañía activa por nombre y entorno',
  /SYS\.qbo\.companyName/.test(html) && /Producción/.test(html) && /Sandbox/.test(html));

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
