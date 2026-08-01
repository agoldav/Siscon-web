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

console.log('Conexión QuickBooks mediante proxy gratuito:');
ok('existe qboTestConnection', start >= 0 && end > start);
ok('consulta el estado del backend', /await qboStatus\(\)/.test(qboTestConnection));
ok('no rechaza la base vacía válida del proxy mismo origen',
  !/if\s*\(\s*!\s*backendUrl\(\)\s*\)/.test(qboTestConnection));

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
