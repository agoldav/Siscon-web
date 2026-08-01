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
const qboStatus = functionSource('async function qboStatus()');
const qboClearCompanyCaches = functionSource('function qboClearCompanyCaches()');

console.log('Conexión QuickBooks mediante proxy gratuito:');
ok('existe qboTestConnection', start >= 0 && end > start);
ok('consulta el estado del backend', /await qboStatus\(\)/.test(qboTestConnection));
ok('no rechaza la base vacía válida del proxy mismo origen',
  !/if\s*\(\s*!\s*backendUrl\(\)\s*\)/.test(qboTestConnection));
ok('Ajustes ofrece un solo botón sin selector Sandbox/Producción',
  !/id="s-qbo-env"/.test(html) && /Conectar QuickBooks/.test(html) && !/compañía de prueba/.test(html));
ok('la conexión abre directamente el OAuth normal del backend',
  /\/api\/qbo\/connect'/.test(qboConnect) && !/environment=/.test(qboConnect));
ok('la UI aclara que usuario y contraseña se ingresan solo en Intuit',
  /Siscon nunca recibe tu contraseña/.test(html));
ok('ya no existen confirmación o cancelación pendiente',
  !/qboConfirmCompany|qboCancelCompany|confirm-company|cancel-company/.test(html));
ok('detectar otro realm limpia las cachés de la compañía anterior',
  /companyChanged/.test(qboStatus) && /qboClearCompanyCaches\(\)/.test(qboStatus) &&
  /_qboTransactionsCache=null/.test(qboClearCompanyCaches) && /vendorCache/.test(qboClearCompanyCaches) && /projectCache/.test(qboClearCompanyCaches));
ok('la UI identifica la compañía activa por nombre', /SYS\.qbo\.companyName/.test(html));

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
