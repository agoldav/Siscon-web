// ============================================================
//  Pruebas de la remediación de XSS almacenado (VUL-036, reabre VUL-028)
//  Corre:  node test-xss.js
//
//  El informe encontró que la remediación anterior de VUL-028 quedó incompleta: 4 sinks seguían
//  insertando datos controlables por el atacante sin escapar. No se reimplementan aquí — se
//  EXTRAEN los bloques reales de index.html (misma técnica que test-passwords.js) y se ejecutan
//  con payloads de ataque de verdad, para que el test falle si alguien revierte el escapado.
// ============================================================
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
}

// esc() real del archivo (no una copia)
const iEsc = html.indexOf('function esc(s){');
const escSrc = html.slice(iEsc, html.indexOf('\n', iEsc) + 1);
const sandbox = {};
new Function('sandbox', escSrc + 'sandbox.esc = esc;')(sandbox);
const { esc } = sandbox;

// Payloads de ataque reales, no strings inocuos.
const PAYLOAD_SCRIPT = '<img src=x onerror=alert(document.cookie)>';
const PAYLOAD_ATTR   = '"><script>alert(1)</script>';
const PAYLOAD_QUOTE  = 'x" onmouseover="alert(1)';       // rompe atributos con comillas dobles
const PAYLOAD_SQUOTE = "x' onmouseover='alert(1)";       // rompe atributos con comillas simples

function sinEjecutar(htmlFragment, ...payloads) {
  // Ninguno de los payloads debe sobrevivir intacto en el HTML resultante: si `<`, `>` o `"` del
  // payload llegaron sin escapar, el fragmento original aparecería literal en la salida.
  return payloads.every(p => !htmlFragment.includes(p));
}

console.log('esc() — la primitiva de escapado:');
ok('escapa < y >',        esc(PAYLOAD_SCRIPT) === '&lt;img src=x onerror=alert(document.cookie)&gt;');
ok('escapa comillas dobles', esc('a"b') === 'a&quot;b');
ok('escapa comillas simples', esc("a'b") === 'a&#39;b');
ok('escapa &',             esc('a&b') === 'a&amp;b');
ok('null/undefined → cadena vacía', esc(null) === '' && esc(undefined) === '');
ok('el payload de atributo no sobrevive intacto', sinEjecutar(esc(PAYLOAD_ATTR), PAYLOAD_ATTR, '<script>', '">'));

console.log('\nmsgEsc() — ahora es esc(), cubre los ~15 sitios de Mensajes:');
const iMsgEsc = html.indexOf('function msgEsc(s){');
const msgEscSrc = html.slice(iMsgEsc, html.indexOf('\n', iMsgEsc) + 1);
const sb2 = {};
new Function('sandbox', escSrc + msgEscSrc + 'sandbox.msgEsc = msgEsc;')(sb2);
ok('msgEsc ahora escapa comillas (antes NO lo hacía — el bug original)',
  sb2.msgEsc('x"y') === 'x&quot;y' && sb2.msgEsc("x'y") === 'x&#39;y');
ok('un nombre de adjunto que rompía atributos ya no rompe',
  sinEjecutar(`<img alt="${sb2.msgEsc(PAYLOAD_QUOTE)}"/>`, PAYLOAD_QUOTE));

console.log('\nDashboard — vista de Lista (cellVal): antes solo la vista Kanban escapaba:');
// Extraer cellVal completa desde index.html. Necesita KANBAN_COLORS (real, del archivo) y esc.
const iKanban = html.indexOf("const KANBAN_COLORS=");
const kanbanSrc = html.slice(iKanban, html.indexOf('\n', iKanban) + 1);
const iCellValFn = html.indexOf('function cellVal(col, p, realSpent, prog, budgeted, facturado, projPending){');
const iCellValEnd = html.indexOf('\n  }\n', iCellValFn) + 4;
const cellValSrc = html.slice(iCellValFn, iCellValEnd);
ok('se pudo extraer cellVal completa', /default: return/.test(cellValSrc));
const sb3 = {};
new Function('sandbox', escSrc + kanbanSrc + cellValSrc + 'sandbox.cellVal = cellVal;')(sb3);

const proyectoMalicioso = { name: PAYLOAD_SCRIPT, num: PAYLOAD_ATTR, client: PAYLOAD_QUOTE, status: PAYLOAD_SQUOTE, budget: 1000 };
const outNombre = sb3.cellVal({ id: 'nombre' }, proyectoMalicioso, 0, 50, 0, 0, 0);
const outEstatus = sb3.cellVal({ id: 'estatus' }, proyectoMalicioso, 0, 50, 0, 0, 0);
ok('columna "nombre": ni name, num ni client sobreviven crudos',
  sinEjecutar(outNombre, PAYLOAD_SCRIPT, PAYLOAD_ATTR, PAYLOAD_QUOTE), outNombre);
ok('columna "nombre" SÍ contiene la versión escapada (no se perdió el dato)',
  outNombre.includes(esc(PAYLOAD_SCRIPT)));
ok('columna "estatus": status no sobrevive crudo', sinEjecutar(outEstatus, PAYLOAD_SQUOTE), outEstatus);
// Regresión de comportamiento normal: un proyecto sin caracteres especiales se ve igual que antes.
const outNormal = sb3.cellVal({ id: 'nombre' }, { name: 'Casa Azul', num: 'P-01', client: 'ACME' }, 0, 0, 0, 0, 0);
ok('un proyecto normal se ve sin cambios', outNormal.includes('Casa Azul') && outNormal.includes('P-01') && outNormal.includes('ACME'));

console.log('\nDocumentos — nombre y notas (el vector remoto confirmado: factura OCR/Outlook):');
// Extraer el cuerpo del map(d=>{...}) de renderDocs — depende de DTYPE, _docBillInfo,
// docSelected, DOC_CATS y esc, ninguno de los cuales necesita DOM real.
const iMap = html.indexOf('${filtered.map(d=>{');
const iMapEnd = html.indexOf("+'</tr>';\n      }).join('')}", iMap);
const mapBody = html.slice(iMap + '${filtered.map(d=>{'.length, iMapEnd + "+'</tr>';".length);
ok('se pudo extraer el cuerpo de la fila de documento', /notasCell/.test(mapBody) && /nombreCell/.test(mapBody));

function ejecutarFilaDoc(d) {
  const DTYPE = {};
  const docSelected = new Set();
  const DOC_CATS = ['Factura de Gastos', 'Contrato'];
  const visibleCols = ['nombre', 'notas', 'categoria', 'proveedor', 'factura', 'monto'];
  function _docBillInfo() { return { vendorName: '', invoiceNum: '', amount: '' }; }
  const fn = new Function('d', 'DTYPE', 'docSelected', 'DOC_CATS', 'visibleCols', '_docBillInfo', 'esc',
    mapBody);
  return fn(d, DTYPE, docSelected, DOC_CATS, visibleCols, _docBillInfo, esc);
}

const filaNombreMalicioso = ejecutarFilaDoc({ id: '1', name: PAYLOAD_SCRIPT, notes: '', type: 'PDF' });
ok('nombre de documento (OCR/Outlook) no sobrevive crudo', sinEjecutar(filaNombreMalicioso, PAYLOAD_SCRIPT), filaNombreMalicioso);
ok('nombre de documento sí aparece escapado', filaNombreMalicioso.includes(esc(PAYLOAD_SCRIPT)));

const filaNotasMalicioso = ejecutarFilaDoc({ id: '2', name: 'factura.pdf', notes: PAYLOAD_SCRIPT, type: 'PDF' });
ok('notas del documento no sobreviven crudas (antes solo se limpiaban comillas del title, no el texto)',
  sinEjecutar(filaNotasMalicioso, PAYLOAD_SCRIPT), filaNotasMalicioso);
ok('notas del documento sí aparecen escapadas', filaNotasMalicioso.includes(esc(PAYLOAD_SCRIPT)));

const filaNotasComillas = ejecutarFilaDoc({ id: '3', name: 'factura.pdf', notes: PAYLOAD_QUOTE, type: 'PDF' });
ok('notas con comillas dobles ya no rompen el atributo title', sinEjecutar(filaNotasComillas, PAYLOAD_QUOTE), filaNotasComillas);

const filaNormal = ejecutarFilaDoc({ id: '4', name: 'factura-enero.pdf', notes: 'pago parcial', type: 'PDF' });
ok('un documento normal se ve sin cambios', filaNormal.includes('factura-enero.pdf') && filaNormal.includes('pago parcial'));

console.log('\nCuentas de acceso (openUsersModal) — self-XSS contra el Admin:');
// El vector real: accept-invitation solo valida longitud del nombre (validateName en el backend,
// max 100 chars), no contenido. Un usuario recién invitado elige su propio `name`.
const iUsersList = html.indexOf('const usersList=users.map(u=>{');
const iInvListStart = html.indexOf('\n  const invList=(invitations||[])', iUsersList);
const usersListSrc = html.slice(iUsersList, iInvListStart);
ok('se pudo extraer la construcción de usersList', /roleBadge/.test(usersListSrc));

function ejecutarUsersList(users, currentUser) {
  function roleBadge(r) { return '[badge:' + r + ']'; }
  function roleOpts() { return ''; }
  const fn = new Function('users', 'currentUser', 'roleBadge', 'roleOpts', 'esc',
    usersListSrc + '\nreturn usersList;');
  return fn(users, currentUser, roleBadge, roleOpts, esc);
}

const usuarioMalicioso = [{ id: 'u2', name: PAYLOAD_SCRIPT, email: 'nombre@' + 'evil.com', role: 'Regular' }];
const outUsers = ejecutarUsersList(usuarioMalicioso, { id: 'admin-id' });
ok('el nombre elegido por el invitado no sobrevive crudo en el panel del Admin',
  sinEjecutar(outUsers, PAYLOAD_SCRIPT), outUsers);
ok('el nombre sí aparece escapado', outUsers.includes(esc(PAYLOAD_SCRIPT)));

const usuarioEmailMalicioso = [{ id: 'u3', name: 'Juan', email: PAYLOAD_ATTR, role: 'Regular' }];
const outUsers2 = ejecutarUsersList(usuarioEmailMalicioso, { id: 'admin-id' });
ok('un email con payload de atributo no sobrevive crudo', sinEjecutar(outUsers2, PAYLOAD_ATTR), outUsers2);

console.log('\nInvitaciones pendientes — email con comilla doble ya no rompe el botón "Copiar link":');
// validateEmail en el backend permite comillas en la parte local (/^[^\s@]+@[^\s@]+\.[^\s@]+$/ no
// las excluye), así que un email como `x"onmouseover="alert(1)@evil.com` pasa la validación.
const iInvList = html.indexOf('const invList=(invitations||[]).map(iv=>');
const iModalInnerStart = html.indexOf("\n  document.getElementById('modal-inner')", iInvList);
const invListSrc = html.slice(iInvList, iModalInnerStart);
ok('se pudo extraer la construcción de invList', /ucopyInvite/.test(invListSrc));
ok('el backend en efecto permite comillas dobles en el local-part del email (por eso hace falta el fix)',
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test('x"onmouseover="alert(1)@evil.com'));

function ejecutarInvList(invitations) {
  function roleBadge(r) { return '[badge:' + r + ']'; }
  const fn = new Function('invitations', 'roleBadge', 'esc', invListSrc + '\nreturn invList;');
  return fn(invitations, roleBadge, esc);
}
const invMaliciosa = [{ email: 'x"onmouseover="alert(1)@evil.com', role: 'Regular', code: 'abc123' }];
const outInv = ejecutarInvList(invMaliciosa);
ok('el email de la invitación ya no rompe el atributo del botón (usa data-email + esc)',
  !/onclick="ucopyInvite\('/.test(outInv));           // ya no se arma el onclick con el string crudo
ok('el botón lee el email vía dataset, no interpolado en el onclick',
  /onclick="ucopyInvite\(this\.dataset\.code,this\.dataset\.email\)"/.test(outInv));
ok('el data-email queda escapado (comillas convertidas a entidades)',
  outInv.includes('data-email="x&quot;onmouseover=&quot;alert(1)@evil.com"'));

console.log(`\n${pass} pruebas OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
