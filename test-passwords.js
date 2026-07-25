// ============================================================
//  Pruebas del hash de contraseñas locales y de la migración (VUL-034)
//  Corre:  node test-passwords.js
//
//  No copia el código: extrae las funciones reales de index.html y las evalúa, para que la
//  prueba falle si alguien cambia la implementación que de verdad se despliega.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗ FALLA:', name); } }

// --- Extraer las funciones bajo prueba directamente del HTML desplegado ---
// Se toma desde `const _PWD_SALT` hasta el final de `pwdMatches` (bloque contiguo en index.html).
const start = html.indexOf('const _PWD_SALT');
const endMark = 'return diff===0;\n}';
const end = html.indexOf(endMark, start);
if (start === -1 || end === -1) {
  console.error('✗ No se encontró el bloque de hash de contraseñas en index.html.');
  console.error('  Si lo renombraste, actualiza este test — no lo borres.');
  process.exit(1);
}
const src = html.slice(start, end + endMark.length);

// El bloque usa unescape(), que en Node existe como global (deprecado pero disponible).
const sandbox = {};
new Function('sandbox', src + '\nsandbox.sha256Hex=sha256Hex;sandbox.hashPwd=hashPwd;sandbox.pwdMatches=pwdMatches;')(sandbox);
const { sha256Hex, hashPwd, pwdMatches } = sandbox;

console.log('Hash de contraseñas (VUL-034):');

// 1) La implementación SHA-256 casera debe coincidir con la de Node en todos los casos borde.
const vectores = [
  '', 'a', 'abc', '13/11/81', 'siscon2026', '1234',
  'contraseña con ñ y acentos áéíóú',      // multibyte UTF-8
  '🔐 emoji fuera del BMP',                 // surrogate pair
  'x'.repeat(55),  'x'.repeat(56),          // borde exacto del padding (55/56/64 bytes)
  'x'.repeat(63),  'x'.repeat(64), 'x'.repeat(65),
  'y'.repeat(1000),                         // varios bloques
];
let sha_ok = true;
for (const v of vectores) {
  const esperado = crypto.createHash('sha256').update(v, 'utf8').digest('hex');
  if (sha256Hex(v) !== esperado) { sha_ok = false; console.error('    ↳ difiere para:', JSON.stringify(v.slice(0, 40))); }
}
ok('sha256Hex coincide con crypto de Node en ' + vectores.length + ' vectores (incl. bordes de padding y UTF-8)', sha_ok);

// 2) El hash va salteado: no es un SHA-256 pelado de la contraseña.
ok('hashPwd aplica sal (no es sha256 crudo)', hashPwd('13/11/81') !== crypto.createHash('sha256').update('13/11/81').digest('hex'));

// 3) Los hashes por defecto que quedaron escritos en index.html son los correctos.
ok("hash por defecto de supervisor corresponde a '13/11/81'",
  html.includes("supervisorPasswordHash: '" + hashPwd('13/11/81') + "'"));

// 4) pwdMatches acepta la correcta y rechaza el resto.
ok('pwdMatches acepta la contraseña correcta', pwdMatches('13/11/81', hashPwd('13/11/81')));
ok('pwdMatches rechaza una incorrecta',       !pwdMatches('13/11/82', hashPwd('13/11/81')));
ok('pwdMatches rechaza hash vacío/ausente',   !pwdMatches('13/11/81', '') && !pwdMatches('13/11/81', undefined) && !pwdMatches('13/11/81', null));
ok('pwdMatches rechaza cadena vacía',         !pwdMatches('', hashPwd('13/11/81')));
// Regresión: comparar el hash contra sí mismo como si fuera la contraseña no debe pasar.
ok('pwdMatches no acepta el hash como contraseña', !pwdMatches(hashPwd('13/11/81'), hashPwd('13/11/81')));

console.log('\nContraseñas en claro fuera del blob (VUL-034):');

// 5) Regresión dura: las contraseñas históricas NO pueden volver a aparecer en el HTML.
//    Este es el hallazgo original: el blob settings/1 viaja al navegador de los 4 usuarios.
for (const secreto of ["'siscon2026'", "'13/11/81'", "'1234'"]) {
  const usos = html.split('password' + ': ' + secreto).length - 1
             + html.split('password:' + secreto).length - 1
             + html.split('supervisorPassword: ' + secreto).length - 1;
  ok('no hay campo de contraseña con ' + secreto + ' en claro', usos === 0);
}
ok('no queda la propiedad supervisorPassword en el objeto SYS por defecto',
  !/supervisorPassword\s*:\s*'/.test(html));
ok('el auto-login de Cmd+click ya no escribe la contraseña en localStorage',
  !/autoLogin:\s*currentUser\s*\?\s*\{[^}]*password/.test(html));

// 6) La migración convierte los datos que YA están en producción y borra el texto plano.
const mStart = html.indexOf('function migratePasswordsToHash');
const mEnd = html.indexOf('\n}', html.indexOf('(sys.users||[]).forEach', mStart)) + 2;
const mSrc = html.slice(mStart, mEnd);
const s2 = {};
new Function('sandbox', src + '\n' + mSrc + '\nsandbox.migrate=migratePasswordsToHash;')(s2);

console.log('\nMigración de datos existentes:');
const viejo = {
  supervisorPassword: '13/11/81',
  users: [
    { id: 1, role: 'Administrador', password: 'siscon2026' },
    { id: 2, role: 'Supervisor',    password: '13/11/81'  },
    { id: 3, role: 'Regular',       password: '1234'      },
  ],
};
s2.migrate(viejo);
ok('borra supervisorPassword en claro',      viejo.supervisorPassword === undefined);
ok('deja el hash de supervisor equivalente', pwdMatches('13/11/81', viejo.supervisorPasswordHash));
ok('borra la contraseña de cada usuario',    viejo.users.every(u => u.password === undefined));
ok('deja el hash de cada usuario',           viejo.users.every(u => !!u.passwordHash));
ok('el hash migrado del admin valida',       pwdMatches('siscon2026', viejo.users[0].passwordHash));

// Idempotencia: correrla de nuevo (o sobre datos ya migrados) no rompe nada.
const antes = JSON.stringify(viejo);
s2.migrate(viejo);
ok('migrar dos veces no cambia nada (idempotente)', JSON.stringify(viejo) === antes);
s2.migrate({}); s2.migrate({ users: [] }); s2.migrate(null);
ok('migrar objetos vacíos/nulos no lanza excepción', true);

// Si un dato traía hash Y texto plano (estado a medias), gana el hash existente y se borra el plano.
const mixto = { supervisorPassword: 'otra', supervisorPasswordHash: hashPwd('13/11/81') };
s2.migrate(mixto);
ok('con hash previo conserva el hash y descarta el texto plano',
  mixto.supervisorPassword === undefined && pwdMatches('13/11/81', mixto.supervisorPasswordHash));

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
