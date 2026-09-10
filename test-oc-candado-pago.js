// ============================================================
//  Fase 0 — Candado del pago. Corre:  node test-oc-candado-pago.js
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`No se encontró ${name}`);
  const brace = html.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name, extra !== undefined ? '→ ' + extra : ''); }
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(['ocIsComplete', 'parseComprobanteName', 'ocsListasParaPagar',
  'ocDiasSinFactura', 'ocsPagadasSinFactura'].map(extractFunction).join('\n'), sandbox);

// OC mínima válida: proveedor, una casa, una línea imputada al presupuesto, monto.
const ocOk = {
  status: 'Borrador', vendorName: 'Polycenter', totalUSD: 883.11,
  houseIds: ['h-7'], bodegaMode: false, bodegaLines: [],
  lines: { 'h-7': [{ lineId: 'l-33', qty: 3, price: 156.4, isExtra: false }] },
};

console.log('\nocIsComplete:');
ok('OC completa con casa, línea presupuestada y monto', sandbox.ocIsComplete(ocOk) === true);
ok('sin proveedor no está completa',
  sandbox.ocIsComplete({ ...ocOk, vendorName: '' }) === false);
ok('proveedor solo con espacios no cuenta',
  sandbox.ocIsComplete({ ...ocOk, vendorName: '   ' }) === false);
ok('sin casas ni bodega no está completa',
  sandbox.ocIsComplete({ ...ocOk, houseIds: [], bodegaLines: [] }) === false);
ok('monto en cero no está completa',
  sandbox.ocIsComplete({ ...ocOk, totalUSD: 0 }) === false);
ok('línea con cantidad pero sin lineId no está completa',
  sandbox.ocIsComplete({ ...ocOk, lines: { 'h-7': [{ lineId: '', qty: 3 }] } }) === false);
ok('línea extra sin autorización no está completa',
  sandbox.ocIsComplete({ ...ocOk, lines: { 'h-7': [{ lineId: 'x', qty: 3, isExtra: true, authorizedBy: '' }] } }) === false);
ok('línea extra autorizada sí completa',
  sandbox.ocIsComplete({ ...ocOk, lines: { 'h-7': [{ lineId: 'x', qty: 3, isExtra: true, authorizedBy: 'Abraham' }] } }) === true);
ok('línea en cero se ignora y no invalida',
  sandbox.ocIsComplete({ ...ocOk, lines: { 'h-7': [{ lineId: 'l-33', qty: 3 }, { lineId: '', qty: 0 }] } }) === true);
ok('OC solo de bodega con línea válida está completa',
  sandbox.ocIsComplete({ ...ocOk, houseIds: [], bodegaMode: true,
    lines: {}, bodegaLines: [{ name: 'Tornillo', qty: 100, price: 0.05 }] }) === true);
ok('OC sin ninguna línea con cantidad no está completa',
  sandbox.ocIsComplete({ ...ocOk, lines: { 'h-7': [{ lineId: 'l-33', qty: 0 }] } }) === false);
ok('OC cancelada nunca está completa',
  sandbox.ocIsComplete({ ...ocOk, status: 'Cancelada' }) === false);
ok('null / undefined no revientan',
  sandbox.ocIsComplete(null) === false && sandbox.ocIsComplete(undefined) === false);

console.log('\nparseComprobanteName:');
// Arreglo de moneda (2026-09-10) — el nombre real trae el símbolo pegado al monto ($ o ₡).
// La función ya NO devuelve `montoUSD` (asumía dólares siempre); devuelve `monto` (el número tal
// como aparece) y `moneda` ('USD'|'CRC'|null si no hay símbolo — no se adivina).
// p1 es el ejemplo real de dólares del brief.
const p1 = sandbox.parseComprobanteName('Polycenter-$883.11-OC-2026-014-PRO 5567-116 Este.pdf');
ok('proveedor', p1 && p1.proveedor === 'Polycenter', p1 && p1.proveedor);
ok('monto', p1 && p1.monto === 883.11, p1 && p1.monto);
ok('símbolo $ detectado como moneda USD', p1 && p1.moneda === 'USD', p1 && p1.moneda);
ok('número de OC reconstruido', p1 && p1.ocNum === 'OC-2026-014', p1 && p1.ocNum);
ok('proforma', p1 && p1.proforma === 'PRO 5567', p1 && p1.proforma);
ok('proyecto', p1 && p1.proyecto === '116 Este', p1 && p1.proyecto);

// p2 es el ejemplo real de colones del brief.
const p2 = sandbox.parseComprobanteName('Extralum-₡450000-OC-2026-007-4821-Dor.pdf');
ok('símbolo ₡ detectado como moneda CRC', p2 && p2.moneda === 'CRC', p2 && p2.moneda);
ok('monto en colones (sin separador de miles)', p2 && p2.monto === 450000, p2 && p2.monto);

// p3: sin símbolo — no se adivina la moneda. Sigue cubriendo lo que cubría antes: separador de
// miles y el padding del consecutivo de OC de un dígito.
const p3 = sandbox.parseComprobanteName('Extralum-1,250.00-OC-2026-7-4821-Dor.jpg');
ok('sin símbolo, moneda queda en null (no se adivina)', p3 && p3.moneda === null, p3 && p3.moneda);
ok('monto con separador de miles, sin símbolo', p3 && p3.monto === 1250, p3 && p3.monto);
ok('consecutivo de OC de un dígito se rellena a 3', p3 && p3.ocNum === 'OC-2026-007', p3 && p3.ocNum);

// p4: separador de miles CON símbolo — la limpieza del número tiene que tolerar los dos a la vez.
const p4 = sandbox.parseComprobanteName('Polycenter-$1,250.00-OC-2026-014-4821-Dor.pdf');
ok('separador de miles con símbolo: la moneda se detecta igual', p4 && p4.moneda === 'USD', p4 && p4.moneda);
ok('separador de miles con símbolo: el monto se limpia igual', p4 && p4.monto === 1250, p4 && p4.monto);

// El brief también pide reconocer el texto USD/CRC pegado al monto, no solo el símbolo.
ok('texto "USD" pegado al monto también se detecta',
  sandbox.parseComprobanteName('Prov-USD500-OC-2026-001-x-Proy.pdf').moneda === 'USD');
ok('texto "CRC" pegado al monto también se detecta',
  sandbox.parseComprobanteName('Prov-CRC500-OC-2026-001-x-Proy.pdf').moneda === 'CRC');

ok('nombre sin suficientes partes devuelve null',
  sandbox.parseComprobanteName('comprobante.pdf') === null);
ok('nombre vacío devuelve null', sandbox.parseComprobanteName('') === null);
ok('null no revienta', sandbox.parseComprobanteName(null) === null);
ok('sin OC en el nombre igual devuelve el resto',
  (() => { const r = sandbox.parseComprobanteName('Ferretería X-45.00-sin ref-Proyecto Z.pdf');
           return r && r.ocNum === '' && r.proveedor === 'Ferretería X' && r.proyecto === 'Proyecto Z'; })());
ok('monto no numérico queda en null (y tampoco hay símbolo que detectar)',
  (() => { const r = sandbox.parseComprobanteName('Prov-abc-OC-2026-001-x-Proy.pdf');
           return r && r.monto === null && r.moneda === null; })());

// ---------- Seguimiento del arreglo de moneda (punto 3) — el símbolo ¢ también es colones ----------
// ¢ (U+00A2, "cent sign") se usa en Costa Rica como sustituto de ₡ porque está en más teclados.
// El propio archivo ya lo trataba como colones en el prompt de importación de Excel
// (ctImportExcelViaClaude: "si tiene ¢ es CRC"), así que no reconocerlo acá era además una
// inconsistencia interna. Sin el arreglo, este comprobante quedaba en moneda:null y el modal se
// quedaba en USD — $450.000 en vez de ₡450.000, el modo de falla exacto que este arreglo evita.
const pCent = sandbox.parseComprobanteName('Extralum-¢450000-OC-2026-014-4821-Dor.pdf');
ok('punto 3 — el símbolo ¢ (U+00A2) se reconoce como colones, igual que ₡',
  pCent && pCent.moneda === 'CRC', pCent && pCent.moneda);
ok('punto 3 — con ¢ el monto se limpia igual que con ₡ (450000)',
  pCent && pCent.monto === 450000, pCent && pCent.monto);

// ---------- Seguimiento del arreglo de moneda (punto 4) — separador de miles según la moneda ----------
// En CRC, el punto es separador de MILES (formato es-CR, el mismo con el que fmtCRC() imprime
// colones: fmtCRC(450000) === '₡450.000'), no decimal. Sin el arreglo, `parseFloat('450.000')`
// da 450 — un error de mil veces si alguien copia el monto tal como la propia app lo muestra.
const pPuntoCRC = sandbox.parseComprobanteName('Extralum-₡450.000-OC-2026-014-4821-Dor.pdf');
ok('punto 4 — en colones, el punto es separador de miles: ₡450.000 = 450000, no 450',
  pPuntoCRC && pPuntoCRC.monto === 450000, pPuntoCRC && pPuntoCRC.monto);
ok('punto 4 — la moneda se sigue detectando bien aunque el monto lleve separador',
  pPuntoCRC && pPuntoCRC.moneda === 'CRC', pPuntoCRC && pPuntoCRC.moneda);
// La coma también es separador de miles en CRC (no hay una única convención tipográfica fija).
const pComaCRC = sandbox.parseComprobanteName('Extralum-¢450,000-OC-2026-014-4821-Dor.pdf');
ok('punto 4 — en colones, la coma también es separador de miles: ¢450,000 = 450000',
  pComaCRC && pComaCRC.monto === 450000, pComaCRC && pComaCRC.monto);
// En USD el criterio no cambia: coma = miles, punto = decimal (ya cubierto arriba por p4, se deja
// explícito acá para que las tres reglas queden una al lado de la otra en el mismo bloque).
ok('punto 4 — en dólares el punto sigue siendo decimal: $1,250.00 = 1250, no 1250000',
  sandbox.parseComprobanteName('Polycenter-$1,250.00-OC-2026-014-4821-Dor.pdf').monto === 1250);
// Sin moneda detectada, el comportamiento previo se mantiene intacto: punto = decimal. No hay
// forma de saber si el separador de miles pretendido es CRC o USD sin el símbolo.
ok('punto 4 — sin símbolo de moneda, el punto sigue siendo decimal (comportamiento previo intacto)',
  sandbox.parseComprobanteName('Extralum-1,250.00-OC-2026-7-4821-Dor.jpg').monto === 1250);

console.log('\nSelectores:');
// C1(b) — desde esta ola de arreglos, `ocsListasParaPagar()` exige el sello `createdAtISO`, que
// solo llevan las OCs creadas a partir del despliegue. Las fixtures de abajo lo traen porque
// representan OCs nuevas; las pruebas específicas del sello viven más abajo.
const mkOc = extra => ({ id: 'oc-1', num: 'OC-2026-014', status: 'Borrador', vendorName: 'Polycenter',
  totalUSD: 100, houseIds: ['h-1'], bodegaLines: [], createdAtISO: '2026-09-09T15:00:00.000Z',
  lines: { 'h-1': [{ lineId: 'l-1', qty: 1 }] }, ...extra });

const projs = [
  { id: 1, name: 'A', ocs: [mkOc({ id: 'oc-a' }), mkOc({ id: 'oc-b', vendorName: '' })] },
  { id: 2, name: 'B', ocs: [mkOc({ id: 'oc-c', pago: { fecha: '2026-09-01' } })] },
  { id: 3, name: 'C' },   // sin arreglo ocs
];

const listas = sandbox.ocsListasParaPagar(projs);
ok('solo lista OCs completas y sin pago', listas.length === 1 && listas[0].oc.id === 'oc-a',
  listas.map(x => x.oc.id).join(','));
ok('incluye el proyecto dueño', listas[0].proj.name === 'A');
ok('proyecto sin ocs no revienta', Array.isArray(sandbox.ocsListasParaPagar(projs)));
ok('lista vacía con entrada vacía', sandbox.ocsListasParaPagar([]).length === 0);

ok('días desde el pago', sandbox.ocDiasSinFactura({ pago: { fecha: '2026-09-01' } }, '2026-09-11') === 10);
ok('OC sin pago devuelve null', sandbox.ocDiasSinFactura({}, '2026-09-11') === null);
ok('OC ya facturada devuelve null',
  sandbox.ocDiasSinFactura({ status: 'Facturada', pago: { fecha: '2026-09-01' } }, '2026-09-11') === null);

const alertas = sandbox.ocsPagadasSinFactura(projs, 10, '2026-09-11');
ok('alerta cuando pasa el umbral', alertas.length === 1 && alertas[0].oc.id === 'oc-c');
ok('reporta los días', alertas[0].dias === 10);
ok('no alerta antes del umbral', sandbox.ocsPagadasSinFactura(projs, 10, '2026-09-05').length === 0);

console.log('\nCableado del modal de pago:');
ok('existe ocOpenPagoModal', /function ocOpenPagoModal\(/.test(html));
ok('existe ocConfirmPago', /function ocConfirmPago\(/.test(html));
ok('el modal prellena desde el nombre del archivo',
  /function ocPagoFilePicked[\s\S]{0,900}parseComprobanteName\(/.test(html));
ok('el comprobante va al proyecto dueño de la OC, no a curProj',
  /function ocConfirmPago[\s\S]{0,2600}proj\.uploads/.test(html) &&
  !/function ocConfirmPago[\s\S]{0,2600}curProj\.uploads/.test(html));
ok('transferencia exige comprobante',
  /function ocConfirmPago[\s\S]{0,2000}Transferencia[\s\S]{0,400}alert\(/.test(html));
ok('el comprobante se encola para subir a R2',
  /function ocConfirmPago[\s\S]{0,2600}_pendingDocFiles\.set\(/.test(html));
ok('el pago queda registrado con autor y fecha',
  /registradoPor:/.test(html) && /registradoAt:/.test(html));

// ============================================================
// Ronda de arreglo — bugs del brief original (no del agente anterior):
// 1) logAction() atribuía el pago a curProj (global, puede ser null u otro proyecto) en vez
//    de al proyecto dueño de la OC.
// 2) ocOpenPagoModal() no impedía registrar un segundo pago sobre la misma OC.
// ============================================================

console.log('\nlogAction — atribuye al proyecto dueño de la OC, no a curProj (fix):');
// Rangos ampliados tras el arreglo de moneda: el bloque de comentario nuevo antes de armar
// oc.pago empuja la llamada a logAction() más lejos del inicio de la función (3000→3400), y el
// objeto que se le pasa ahora también lleva `moneda` (antes/después), así que la llamada en sí
// es más larga (400→700). Seguimiento del arreglo de moneda (punto 1 + punto 2): la distancia
// función→logAction() creció otra vez (3400→3986 reales) por el bloque nuevo que decide si se
// conserva el exchangeRate histórico al editar, y la llamada en sí también (700→964 reales) por
// el comentario que explica por qué `montoUSD` ya no va en `after` — medido con un script aparte
// antes de ajustar los rangos, no ampliado a ciegas.
ok('ocConfirmPago le pasa el proyecto dueño (proj) a logAction, no depende de curProj implícito',
  /function ocConfirmPago[\s\S]{0,4100}logAction\([\s\S]{0,1050},\s*proj\)\s*;/.test(html));

// Prueba de comportamiento real: se extrae logAction del archivo y se ejecuta en un sandbox
// aislado con curProj apuntando a un proyecto DISTINTO del dueño de la OC — reproduce
// exactamente el escenario del bug (modal de pago global abierto con otro proyecto activo).
const logSandbox = {
  activityLog: [],
  currentUser: { name: 'Tester' },
  curProj: { id: 999, name: 'Proyecto Global Abierto (no el dueño de la OC)' },
  saveData: () => {},
};
vm.createContext(logSandbox);
vm.runInContext(extractFunction('logAction'), logSandbox);

logSandbox.logAction('Pago registrado para "OC-1" (Transferencia)', 'log-create', 'OC', null,
  { num: 'OC-1' }, { id: 42, name: 'Proyecto Dueño de la OC' });
const entryConProjOverride = logSandbox.activityLog[0];
ok('con projOverride, la entrada de auditoría queda con el proyecto dueño de la OC (no curProj)',
  entryConProjOverride.projectId === 42 && entryConProjOverride.projectName === 'Proyecto Dueño de la OC',
  JSON.stringify({ projectId: entryConProjOverride.projectId, projectName: entryConProjOverride.projectName }));

logSandbox.logAction('Acción cualquiera sin override', 'log-edit', 'OC', null, { x: 1 });
const entrySinOverride = logSandbox.activityLog[0];
ok('sin projOverride, las ~80 llamadas existentes siguen usando curProj exactamente como antes (retrocompatible)',
  entrySinOverride.projectId === 999 && entrySinOverride.projectName === 'Proyecto Global Abierto (no el dueño de la OC)');

logSandbox.curProj = null;
logSandbox.logAction('Acción sin override y sin curProj', 'log-edit', 'OC', null, { x: 1 });
const entrySinCurProj = logSandbox.activityLog[0];
ok('sin projOverride y con curProj null, el comportamiento previo (huérfano) se mantiene intacto',
  entrySinCurProj.projectId === null && entrySinCurProj.projectName === null);

console.log('\nocOpenPagoModal — candado de pago duplicado (fix):');
// ACTUALIZADO por la Decisión 3 (editar/anular pago): la guarda ya no puede ser `if(oc.pago)` a
// secas, porque el modo edición reabre el modal con el pago existente a propósito. El invariante
// que importa —no se puede registrar un SEGUNDO pago sobre una OC ya pagada— es el mismo, y la
// condición pasó a `if(oc.pago && !editando)`. Las 4 aserciones siguen verificando lo mismo,
// escritas contra la condición nueva; ninguna se debilitó.
ok('ocOpenPagoModal rechaza abrir el modal en modo registro si la OC ya tiene un pago',
  /function ocOpenPagoModal[\s\S]{0,1500}if\(oc\.pago&&!editando\)\{[\s\S]{0,250}alert\([\s\S]{0,250}return;\s*\}/.test(html));
// Seguimiento del arreglo de moneda (punto 7) — el comentario nuevo que explica montoEsSugerido
// empuja _ocPagoCtx= más lejos del return; de la guarda (400→616 reales, medido antes de ajustar).
ok('la guarda de pago duplicado corre ANTES de armar el contexto del modal (_ocPagoCtx=)',
  /function ocOpenPagoModal[\s\S]{0,1500}if\(oc\.pago&&!editando\)[\s\S]{0,250}return;[\s\S]{0,750}_ocPagoCtx=/.test(html));
ok('el mensaje de pago duplicado informa cuándo (fmtDate) y quién (registradoPor) lo registró',
  /if\(oc\.pago&&!editando\)\{[\s\S]{0,250}fmtDate\(oc\.pago\.fecha\)[\s\S]{0,150}registradoPor/.test(html));
ok('la guarda de pago duplicado sigue después de la guarda existente de ocIsComplete (no la reemplaza)',
  /function ocOpenPagoModal[\s\S]{0,900}ocIsComplete\(oc\)[\s\S]{0,400}if\(oc\.pago&&!editando\)/.test(html));
ok('el modo edición no se puede abrir sobre una OC que nunca tuvo pago',
  /function ocOpenPagoModal[\s\S]{0,1500}if\(!oc\.pago&&editando\)\{[\s\S]{0,200}return;\s*\}/.test(html));

console.log('\nPantalla Listo para pagar:');
ok('existe openPagosWin', /function openPagosWin\(/.test(html));
ok('existe renderPagosBody', /function renderPagosBody\(/.test(html));
ok('la lista se arma solo con OCs listas para pagar',
  /function renderPagosBody[\s\S]{0,1200}ocsListasParaPagar\(projects\)/.test(html));
ok('cada fila ofrece registrar el pago',
  /function renderPagosBody[\s\S]{0,3000}ocOpenPagoModal\(/.test(html));
ok('hay botón en la barra lateral', /onclick="openPagosWin\(\)"/.test(html));
ok('el vacío explica el candado en vez de decir solo "sin datos"',
  /function renderPagosBody[\s\S]{0,3000}incompleta/i.test(html));

console.log('\nAlerta de OC pagada sin factura:');
ok('existe ocAlertasAutoCheck', /function ocAlertasAutoCheck\(/.test(html));
ok('usa el umbral configurable', /function ocAlertasAutoCheck[\s\S]{0,700}SYS\.alertas/.test(html));
ok('crea notificación con addNotif',
  /function ocAlertasAutoCheck[\s\S]{0,900}addNotif\(/.test(html));
// login() y bootstrapCloudflareAuth() son caminos de login mutuamente excluyentes (usuario/clave vs.
// Cloudflare Access). Contar ocurrencias en TODO el archivo no distingue: una implementación que
// pusiera las dos llamadas dentro de una sola función (dejando la otra sin disparar la alerta)
// pasaría igual. Se acota la búsqueda al cuerpo de cada función por separado.
ok('se dispara tras el login por usuario/clave (login())',
  extractFunction('login').includes('ocAlertasAutoCheck();'));
ok('se dispara tras el login por Cloudflare Access (bootstrapCloudflareAuth())',
  extractFunction('bootstrapCloudflareAuth').includes('ocAlertasAutoCheck();'));
// El string 'paidOcsNoInvoice' por sí solo pasaría con solo un comentario, o con la declaración
// inicial sin la migración (o viceversa) — la migración es lo más fácil de romper porque instalaciones
// existentes cargan datos guardados sin el campo. Se verifican las dos ubicaciones por separado.
ok('paidOcsNoInvoice declarada en el SYS inicial (junto a pendingBillsDigest)',
  /pendingBillsDigest:\s*\{[\s\S]{0,600}paidOcsNoInvoice:\s*\{[\s\S]{0,400}\}/.test(html));
ok('paidOcsNoInvoice migrada en applyDefaults() con recipients garantizado como arreglo', (() => {
  const body = extractFunction('applyDefaults');
  return /SYS\.emailAutomations\.paidOcsNoInvoice\s*=\s*\{/.test(body)
    && /Array\.isArray\(SYS\.emailAutomations\.paidOcsNoInvoice\.recipients\)/.test(body);
})());

(async function nuevosArreglos(){

// ============================================================
//  Ola de arreglos de la revisión final (C1, I1-I6, M5 + Decisión 3).
//  Los defectos estaban en el PLAN, no en la implementación anterior.
// ============================================================

// El extractor de arriba busca `function <nombre>(`; para una función async hay que incluir el
// prefijo `async `, si no el cuerpo extraído tiene `await` dentro de una función no-async
// (SyntaxError). Mismo algoritmo de conteo de llaves.
function extractAsyncFunction(name) {
  const start = html.indexOf(`async function ${name}(`);
  if (start < 0) throw new Error(`No se encontró async function ${name}`);
  const brace = html.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

// ---------- C1 — la pantalla no puede nacer llena de OCs viejas ya liquidadas ----------
console.log('\nC1 — estados terminales y sello de OC nueva:');
const SELLO = '2026-09-09T15:00:00.000Z';
const c1Base = { id: 'x', num: 'OC-2026-100', status: 'Borrador', vendorName: 'Polycenter',
  totalUSD: 500, houseIds: ['h-1'], bodegaLines: [], createdAtISO: SELLO,
  lines: { 'h-1': [{ lineId: 'l-1', qty: 2 }] } };
const c1 = extra => sandbox.ocsListasParaPagar([{ id: 9, name: 'P', ocs: [{ ...c1Base, ...extra }] }]);

ok('una OC nueva, completa y sin pago sí es pagable', c1().length === 1);
ok('C1(a) — status Facturada NO es pagable (saveVendorBill ya ligó la factura)',
  c1({ status: 'Facturada' }).length === 0);
ok('C1(a) — status Recibida NO es pagable (el material ya entró)',
  c1({ status: 'Recibida' }).length === 0);
ok('C1(a) — status Cancelada NO es pagable', c1({ status: 'Cancelada' }).length === 0);
ok('C1(a) — Enviada sigue siendo pagable (no es terminal)', c1({ status: 'Enviada' }).length === 1);
ok('C1(b) — una OC histórica (sin createdAtISO) queda fuera para siempre',
  c1({ createdAtISO: undefined }).length === 0);
ok('C1(b) — createdAtISO vacío o solo espacios tampoco cuenta como sello',
  c1({ createdAtISO: '' }).length === 0 && c1({ createdAtISO: '   ' }).length === 0);
// El escenario exacto del hallazgo: el día del despliegue, una cartera entera de OCs históricas
// completas (incluidas las ya facturadas de hace un año) NO puede aparecer como pagable.
const carteraHistorica = [{ id: 1, name: 'Histórico', ocs: [
  { ...c1Base, id: 'h1', createdAtISO: undefined, status: 'Facturada' },
  { ...c1Base, id: 'h2', createdAtISO: undefined, status: 'Recibida' },
  { ...c1Base, id: 'h3', createdAtISO: undefined, status: 'Enviada' },
  { ...c1Base, id: 'h4', createdAtISO: undefined, status: 'Borrador' },
] }];
ok('C1 — la pantalla nace VACÍA con una cartera de OCs históricas completas',
  sandbox.ocsListasParaPagar(carteraHistorica).length === 0,
  JSON.stringify(sandbox.ocsListasParaPagar(carteraHistorica).map(x => x.oc.id)));
ok('C1 — ocIsComplete() sigue midiendo completitud de datos, no pagabilidad: una OC Facturada con datos completos sigue siendo "completa"',
  sandbox.ocIsComplete({ ...c1Base, status: 'Facturada' }) === true);

ok('C1(b) — openNewOC() sella la OC nueva con createdAtISO',
  extractFunction('openNewOC').includes('createdAtISO: new Date().toISOString()'));
ok('C1(b) — ocFromHouse() sella la OC nueva con createdAtISO',
  /createdAtISO:\s*new Date\(\)\.toISOString\(\)/.test(extractFunction('ocFromHouse')));
ok('C1(b) — duplicateOC() sella la copia con SU PROPIO createdAtISO, no el del original',
  /clone\.createdAtISO\s*=\s*new Date\(\)\.toISOString\(\)/.test(extractFunction('duplicateOC')));
ok('C1(b) — duplicateOC() no hereda el pago del original',
  /delete clone\.pago/.test(extractFunction('duplicateOC')));
// Si aparece un cuarto lugar que cree una OC, tiene que sellarla o nunca será pagable.
ok('C1(b) — no hay más puntos de creación de OC que los tres sellados',
  (html.match(/\.ocs\.push\(/g) || []).length === 3,
  (html.match(/\.ocs\.push\(/g) || []).length);

// ---------- I2 — guardar la OC no puede borrar el pago ya registrado ----------
console.log('\nI2 — el guardado del formulario preserva el pago de la fila viva:');
vm.runInContext(extractFunction('ocPreserveLiveFields'), sandbox);

// Escenario real, un solo usuario: la OC está abierta en el formulario (clon sin pago), se
// registra el pago desde la ventana flotante "Listo para pagar", y después se guarda el
// formulario. Sin el fix, el spread del clon pisaba oc.pago y no había 409 que lo frenara.
const clonViejo = { id: 'oc-14', num: 'OC-2026-014', totalUSD: 100 };       // clonado ANTES del pago
const filaViva = { id: 'oc-14', num: 'OC-2026-014', totalUSD: 100,
  createdAtISO: SELLO, pago: { montoUSD: 100, fecha: '2026-09-09', blobId: 'blob_x' } };
const guardado = sandbox.ocPreserveLiveFields({ ...clonViejo }, filaViva);
ok('I2 — el pago sobrevive al guardado del formulario',
  guardado.pago && guardado.pago.blobId === 'blob_x', JSON.stringify(guardado.pago));
ok('I2 — el sello createdAtISO también sobrevive', guardado.createdAtISO === SELLO);
ok('I2 — si la fila viva no tiene pago, el clon no puede inventar uno',
  sandbox.ocPreserveLiveFields({ ...clonViejo, pago: { montoUSD: 1 } }, { id: 'oc-14' }).pago === undefined);
ok('I2 — si la fila viva no tiene sello, el clon no puede inventarlo (una OC histórica no se vuelve pagable al editarla)',
  sandbox.ocPreserveLiveFields({ ...clonViejo, createdAtISO: SELLO }, { id: 'oc-14' }).createdAtISO === undefined);
ok('I2 — el resto de los campos editados en el formulario NO se tocan',
  sandbox.ocPreserveLiveFields({ ...clonViejo, totalUSD: 250 }, filaViva).totalUSD === 250);
ok('I2 — sin fila viva (OC nueva) devuelve el objeto tal cual',
  sandbox.ocPreserveLiveFields({ id: 'nueva', totalUSD: 5 }, null).totalUSD === 5);
// Cableado: los tres caminos que reemplazan la fila entera tienen que usarlo.
ok('I2 — ocSave() preserva antes de reemplazar la fila',
  /ocPreserveLiveFields\(ocData,p\.ocs\[idx\]\);\s*p\.ocs\[idx\]=ocData;/.test(extractFunction('ocSave')));
ok('I2 — ocSaveSilent() preserva antes de reemplazar la fila',
  /ocPreserveLiveFields\(ocData,p\.ocs\[idx\]\);\s*p\.ocs\[idx\]=ocData;/.test(extractFunction('ocSaveSilent')));
ok('I2 — ningún reemplazo total de fila de OC quedó sin la preservación',
  (html.match(/p\.ocs\[(?:idx|ocIdx)\]=/g) || []).length === 3
  && (html.match(/ocPreserveLiveFields\(/g) || []).length === 4,
  `reemplazos=${(html.match(/p\.ocs\[(?:idx|ocIdx)\]=/g) || []).length} usos=${(html.match(/ocPreserveLiveFields\(/g) || []).length}`);

// ---------- I5 — nada de notificaciones eternas para una OC cancelada ----------
console.log('\nI5 — criterio terminal alineado con el backend:');
ok('I5 — una OC pagada y luego CANCELADA deja de contar días (no genera alerta diaria eterna)',
  sandbox.ocDiasSinFactura({ status: 'Cancelada', pago: { fecha: '2026-08-01' } }, '2026-09-11') === null);
ok('I5 — Facturada sigue devolviendo null (comportamiento previo intacto)',
  sandbox.ocDiasSinFactura({ status: 'Facturada', pago: { fecha: '2026-08-01' } }, '2026-09-11') === null);
ok('I5 — un estado no terminal sigue contando días',
  sandbox.ocDiasSinFactura({ status: 'Enviada', pago: { fecha: '2026-09-01' } }, '2026-09-11') === 10);
ok('I5 — ocsPagadasSinFactura ya no reporta la OC cancelada',
  sandbox.ocsPagadasSinFactura(
    [{ id: 1, name: 'P', ocs: [{ id: 'oc-x', status: 'Cancelada', pago: { fecha: '2026-01-01' } }] }],
    10, '2026-09-11').length === 0);
ok('I5 — queda anotado que el criterio debe seguir al de buildPaidOcsDigestRows del backend',
  /buildPaidOcsDigestRows[\s\S]{0,600}function ocDiasSinFactura/.test(html));

// ---------- M5 — el número de OC del comprobante se compara ----------
console.log('\nM5 — advertencia cuando el comprobante es de otra OC:');
vm.runInContext([extractFunction('ocPagoNumCoincide'), extractFunction('ocPagoFormatos'),
  extractFunction('ocPagoAccept'), extractFunction('ocPagoExtOk')].join('\n'), sandbox);
ok('M5 — mismo número no advierte', sandbox.ocPagoNumCoincide('OC-2026-014', 'OC-2026-014') === true);
ok('M5 — número distinto advierte (comprobante de la 020 sobre la 014)',
  sandbox.ocPagoNumCoincide('OC-2026-020', 'OC-2026-014') === false);
ok('M5 — la comparación ignora mayúsculas y espacios',
  sandbox.ocPagoNumCoincide(' oc-2026-014 ', 'OC-2026-014') === true);
ok('M5 — sin número parseado no se advierte nada (el nombre es una conveniencia)',
  sandbox.ocPagoNumCoincide('', 'OC-2026-014') === true);
const pickedSrc = extractFunction('ocPagoFilePicked');
const warnBlock = pickedSrc.slice(pickedSrc.indexOf('if(warnEl){'));
ok('M5 — ocPagoFilePicked compara el número y pinta el aviso en el modal',
  /ocPagoNumCoincide\(parsed\.ocNum,ocNumReal\)/.test(warnBlock)
  && /warnEl\.textContent=/.test(warnBlock));
ok('M5 — es advertencia, NO bloqueo: el bloque del aviso no corta el flujo ni descarta el archivo',
  !/return/.test(warnBlock) && !/_ocPagoCtx\.file=null/.test(warnBlock) && !/alert\(/.test(warnBlock));
ok('M5 — el archivo se acepta ANTES de evaluar el número (el aviso nunca lo descarta)',
  pickedSrc.indexOf('_ocPagoCtx.file=f;') >= 0
  && pickedSrc.indexOf('_ocPagoCtx.file=f;') < pickedSrc.indexOf('ocPagoNumCoincide('));
ok('M5 — el modal tiene su propio contenedor de advertencia, sin pisar el hint de transferencia',
  /id="oc-pago-warn"/.test(html) && /id="oc-pago-hint"/.test(html));

// ---------- Arreglo de moneda — ocPagoFilePicked preselecciona la moneda detectada ----------
ok('moneda — el prellenado de monto usa parsed.monto (ya no parsed.montoUSD, que ya no existe)',
  /parsed&&parsed\.monto!=null/.test(pickedSrc) && !/parsed\.montoUSD/.test(pickedSrc));
ok('moneda — si el nombre trae símbolo, se preselecciona esa moneda en el selector',
  /if\(parsed&&parsed\.moneda\)\{[\s\S]{0,200}oc-pago-moneda/.test(pickedSrc));
ok('moneda — la preselección corre ANTES del bloque de advertencia del número de OC',
  pickedSrc.indexOf('if(parsed&&parsed.moneda)') >= 0
  && pickedSrc.indexOf('if(parsed&&parsed.moneda)') < pickedSrc.indexOf('if(warnEl){'));
// Si el nombre no trae símbolo (moneda: null), el guard `if(parsed&&parsed.moneda)` de la
// aserción anterior es justamente lo que evita tocar el selector: no hay una rama `else` que
// fuerce una moneda — se deja como estaba para que el usuario la confirme, sin adivinar.
ok('moneda — el bloque de preselección está guardado por parsed.moneda, sin rama "else" que fuerce una moneda',
  !/if\(parsed&&parsed\.moneda\)[\s\S]{0,250}\}\s*else/.test(pickedSrc));

// ---------- I1 — el toast de éxito no puede salir antes del guardado ----------
console.log('\nI1 — accept acotado a la allowlist real del backend:');
// La allowlist real vive en siscon-backend/r2-storage.js (DOCUMENT_MIME_ALLOWLIST):
// pdf, png, jpeg, gif, webp, docx, xlsx.
ok('I1 — el accept ya no dice image/* (que dejaba elegir un .heic de iPhone)',
  !/id="oc-pago-file"[^>]*accept="application\/pdf,image\/\*"/.test(html));
ok('I1 — el accept sale de la misma lista que valida el archivo elegido',
  /id="oc-pago-file"[^>]*accept="\$\{ocPagoAccept\(\)\}"/.test(html));
ok('I1 — ocPagoAccept() genera exactamente la allowlist del backend',
  sandbox.ocPagoAccept() === '.pdf,.png,.jpg,.jpeg,.gif,.webp,.docx,.xlsx', sandbox.ocPagoAccept());
ok('I1 — un .heic se rechaza al elegirlo (era el disparador real del bug)',
  sandbox.ocPagoExtOk('IMG_0421.HEIC') === false);
ok('I1 — pdf/jpg/png/webp/gif/docx/xlsx se aceptan',
  ['a.pdf', 'a.JPG', 'a.jpeg', 'a.png', 'a.webp', 'a.gif', 'a.docx', 'a.xlsx']
    .every(n => sandbox.ocPagoExtOk(n) === true));
ok('I1 — archivo sin extensión se rechaza', sandbox.ocPagoExtOk('comprobante') === false);
ok('I1 — ocPagoFilePicked avisa al elegir en vez de dejar que falle al guardar',
  /function ocPagoFilePicked[\s\S]{0,900}ocPagoExtOk\(f\.name\)[\s\S]{0,700}alert\(/.test(html));

// ---------- I1 + I3 + I4 — comportamiento real de ocConfirmPago ----------
// No es una prueba de patrón: se extrae la función real de index.html y se ejecuta en un sandbox
// con `saveData` simulado (que resuelve false / true / lanza) y con el arreglo `projects`
// reemplazado a mitad de camino, exactamente como lo hace el polling de startVersionSync().
console.log('\nI1 + I3 + I4 — ocConfirmPago ejecutado de verdad:');
const pagoSandbox = { console, JSON, Date, Math, Number, parseFloat, String, Array, Object };
pagoSandbox.window = pagoSandbox;
// Arreglo de moneda — ocConfirmPago ahora llama a tcGet(), que lee SYS.exchangeRate. Tasa fija
// para que las pruebas de conversión CRC→USD sean deterministas (450000 ÷ 500 = 900 exacto).
pagoSandbox.SYS = { exchangeRate: 500 };
vm.createContext(pagoSandbox);
vm.runInContext([
  extractFunction('ocPagoPuedeRegistrar'),
  extractFunction('ocPagoGateRol'),
  extractFunction('_ocPagoResolve'),
  extractFunction('tcGet'),
  extractAsyncFunction('ocConfirmPago'),
].join('\n'), pagoSandbox);

function mkPagoProjects() {
  return [{
    id: 7, name: 'Dor', lastActivity: 0, uploads: [],
    ocs: [{ id: 'oc-14', num: 'OC-2026-014', status: 'Enviada', vendorName: 'Polycenter',
      totalUSD: 883.11, createdAtISO: SELLO }],
  }];
}
// Devuelve {alerts, toasts, projects, oc} tras ejecutar ocConfirmPago con el escenario pedido.
// `monto`/`moneda` alimentan los campos del modal (oc-pago-monto / oc-pago-moneda); por defecto
// reproducen el caso de siempre: 883.11 dólares (el total de la OC de la fixture).
async function runConfirm({ saveResult = true, saveThrows = false, role = 'Administrador',
                            ocId = 'oc-14', metodo = 'Tarjeta', file = null, repollear = false,
                            monto = '883.11', moneda = 'USD', editando = false, pagoPrevio = null } = {}) {
  const alerts = [], toasts = [], logs = [];
  pagoSandbox.projects = mkPagoProjects();
  const ocOriginal = pagoSandbox.projects[0].ocs[0];
  pagoSandbox.currentUser = { name: 'Abraham', role };
  pagoSandbox._ocPagoCtx = { projId: 7, ocId, file, editando, pagoPrevio };
  pagoSandbox.docBlobMap = {};
  pagoSandbox._pendingDocFiles = new Map();
  pagoSandbox.URL = { createObjectURL: () => 'blob:fake' };
  pagoSandbox.alert = m => alerts.push(String(m));
  pagoSandbox.showToast = m => toasts.push(String(m));
  pagoSandbox.logAction = (...a) => logs.push(a);
  pagoSandbox.closeModal = () => {};
  pagoSandbox.curTab = 'info'; pagoSandbox.curTxnTab = 'oc'; pagoSandbox.curOCId = null;
  const campos = { 'oc-pago-monto': { value: monto }, 'oc-pago-fecha': { value: '2026-09-10' },
                   'oc-pago-metodo': { value: metodo }, 'oc-pago-moneda': { value: moneda } };
  pagoSandbox.document = { getElementById: id => campos[id] || null };
  pagoSandbox.saveData = () => {
    if (saveThrows) return Promise.reject(new Error('R2 caído'));
    return Promise.resolve(saveResult);
  };
  // startVersionSync() hace polling cada 10 s y loadDataFromAPI() reemplaza `projects` completo:
  // eso ocurre mientras el modal está abierto, entre abrirlo y confirmar. Las referencias que el
  // contexto hubiera capturado al abrir quedan huérfanas a partir de acá.
  if (repollear) pagoSandbox.projects = mkPagoProjects();
  await pagoSandbox.ocConfirmPago();
  return { alerts, toasts, logs, ocOriginal,
    ocVivo: (pagoSandbox.projects[0].ocs || []).find(o => o.id === 'oc-14') };
}

const okExito = await runConfirm({ saveResult: true });
ok('I1 — con guardado exitoso sí sale el toast de éxito',
  okExito.toasts.some(t => t.includes('Pago registrado')) && okExito.alerts.length === 0,
  JSON.stringify({ toasts: okExito.toasts, alerts: okExito.alerts }));
ok('I1 — el pago queda escrito en la OC', !!(okExito.ocVivo && okExito.ocVivo.pago));

// Seguimiento del arreglo de moneda (punto 2) — el objeto `after` que ocConfirmPago le pasa a
// logAction() ya NO lleva `montoUSD`: `monto`+`moneda` alcanzan para auditar, igual que `before`
// (que nunca lo llevó). Antes `montoUSD` era un flotante de hasta 17 dígitos que, sumado al
// resto del objeto, empujaba el JSON serializado sobre el corte de 200 caracteres de logAction()
// y lo invalidaba a la mitad (se pierde `fecha`, `metodo` y `proyecto`, ver historial en 80
// caracteres — index.html:~3715).
ok('punto 2 — el log de ocConfirmPago ya no lleva montoUSD en `after` (evita el corte a 200 caracteres)',
  okExito.logs.length === 1 && !('montoUSD' in okExito.logs[0][4])
  && 'monto' in okExito.logs[0][4] && 'moneda' in okExito.logs[0][4],
  JSON.stringify(okExito.logs[0] && okExito.logs[0][4]));

// ---------- Arreglo de moneda — ocConfirmPago ejecutado de verdad, las dos monedas ----------
// runConfirm() por defecto no toca el selector de moneda (queda en 'USD', el valor con el que
// abre el modal siempre) y paga el total de la OC de la fixture (883.11). Con SYS.exchangeRate
// fijo en 500 (arriba), un pago en colones de ₡450.000 tiene que dar exactamente $900 de
// equivalente — sin redondeos raros porque los números se eligieron para que la división sea exacta.
ok('moneda — un pago sin tocar el selector queda en USD, con monto===montoUSD (compatibilidad con OC en dólares)',
  okExito.ocVivo.pago.moneda === 'USD'
  && okExito.ocVivo.pago.monto === 883.11
  && okExito.ocVivo.pago.montoUSD === 883.11,
  JSON.stringify(okExito.ocVivo.pago));
ok('moneda — igual se guarda el exchangeRate del momento (tcGet()), aunque sea USD',
  okExito.ocVivo.pago.exchangeRate === 500);

const pagoCRC = await runConfirm({ monto: '450000', moneda: 'CRC' });
ok('moneda — un pago en colones guarda monto, moneda y el tipo de cambio usado',
  pagoCRC.ocVivo.pago.moneda === 'CRC'
  && pagoCRC.ocVivo.pago.monto === 450000
  && pagoCRC.ocVivo.pago.exchangeRate === 500,
  JSON.stringify(pagoCRC.ocVivo.pago));
ok('moneda — el equivalente en dólares se calcula como monto/exchangeRate (450000/500=900)',
  pagoCRC.ocVivo.pago.montoUSD === 900, pagoCRC.ocVivo.pago.montoUSD);
ok('moneda — un pago en colones también sale exitoso (toast, sin alertas)',
  pagoCRC.toasts.some(t => t.includes('Pago registrado')) && pagoCRC.alerts.length === 0,
  JSON.stringify({ toasts: pagoCRC.toasts, alerts: pagoCRC.alerts }));
ok('moneda — la validación de monto mayor a 0 usa el monto nativo, no el equivalente en dólares',
  (await runConfirm({ monto: '0', moneda: 'CRC' })).alerts.some(a => /monto mayor a 0/i.test(a)));

// ---------- Seguimiento del arreglo de moneda (punto 1) — editar no reescribe el tc histórico ----------
// Escenario exacto del brief: un pago de ₡450.000 registrado con tc 500 (montoUSD 900) se edita
// un mes después, con el dólar ya en 530, tocando SOLO el método de pago. Sin el arreglo,
// ocConfirmPago llamaba a tcGet() sin condición y el registro pasaba a exchangeRate:530,
// montoUSD:849.06 — el equivalente en dólares de un pago histórico cambiaba solo, sin que nadie
// tocara el monto.
pagoSandbox.SYS.exchangeRate = 530; // "hoy": el tc subió desde que se registró el pago original
const pagoOriginalCRC = { monto: 450000, moneda: 'CRC', exchangeRate: 500, montoUSD: 900,
  fecha: '2026-08-01', metodo: 'Transferencia', registradoPor: 'Abraham',
  registradoAt: '2026-08-01T10:00:00.000Z', blobId: 'blob_old',
  comprobanteName: 'Extralum-₡450000-OC-2026-014-Dor.pdf' };

const edicionSinTocarMonto = await runConfirm({
  editando: true, pagoPrevio: pagoOriginalCRC, monto: '450000', moneda: 'CRC', metodo: 'Tarjeta',
});
ok('punto 1 — editar solo el método de pago NO reescribe el tipo de cambio histórico (sigue en 500, no 530)',
  edicionSinTocarMonto.ocVivo.pago.exchangeRate === 500, edicionSinTocarMonto.ocVivo.pago.exchangeRate);
ok('punto 1 — montoUSD tampoco cambia si nadie tocó el monto ni la moneda (900, no 849.06)',
  edicionSinTocarMonto.ocVivo.pago.montoUSD === 900, edicionSinTocarMonto.ocVivo.pago.montoUSD);

// Si el monto SÍ cambió, recalcular con el tc de hoy es lo correcto (es un pago distinto).
const edicionCambiandoMonto = await runConfirm({
  editando: true, pagoPrevio: pagoOriginalCRC, monto: '500000', moneda: 'CRC', metodo: 'Transferencia',
});
ok('punto 1 — si el monto cambió, el tc SÍ se recalcula con tcGet() (el de hoy: 530)',
  edicionCambiandoMonto.ocVivo.pago.exchangeRate === 530, edicionCambiandoMonto.ocVivo.pago.exchangeRate);
ok('punto 1 — montoUSD sigue siendo monto/exchangeRate, con el tc nuevo (500000/530)',
  Math.abs(edicionCambiandoMonto.ocVivo.pago.montoUSD - (500000 / 530)) < 1e-9,
  edicionCambiandoMonto.ocVivo.pago.montoUSD);

// Si la moneda cambió (aunque el número sea el mismo), también hay que recalcular: no es el
// mismo pago que se registró en la otra moneda.
const edicionCambiandoMoneda = await runConfirm({
  editando: true, pagoPrevio: pagoOriginalCRC, monto: '450000', moneda: 'USD', metodo: 'Transferencia',
});
ok('punto 1 — si la moneda cambió, también se recalcula el tc con tcGet() actual',
  edicionCambiandoMoneda.ocVivo.pago.exchangeRate === 530);
ok('punto 1 — con moneda USD, montoUSD===monto sin importar el tc',
  edicionCambiandoMoneda.ocVivo.pago.montoUSD === 450000);

// Un pago NUEVO (no edición) siempre usa el tc de hoy, sin excepción — comportamiento intacto:
// la condición del arreglo es `editando&&pagoPrevio&&pagoPrevio.exchangeRate`, así que un alta
// nueva (editando=false) nunca entra a esa rama.
const altaNueva = await runConfirm({ monto: '450000', moneda: 'CRC' });
ok('punto 1 — un pago nuevo (no edición) sigue usando siempre el tc de hoy (530), sin excepción',
  altaNueva.ocVivo.pago.exchangeRate === 530);
pagoSandbox.SYS.exchangeRate = 500; // vuelve a la tasa base del resto de esta sección

const falla = await runConfirm({ saveResult: false });
ok('I1 — si saveData() resuelve false NO sale el toast de éxito',
  !falla.toasts.some(t => t.includes('Pago registrado')), JSON.stringify(falla.toasts));
ok('I1 — si saveData() resuelve false sale un alert() bloqueante que dice que el pago NO quedó registrado',
  falla.alerts.length === 1 && /NO QUED[ÓO] REGISTRADO/i.test(falla.alerts[0]),
  JSON.stringify(falla.alerts));
ok('I1 — el alert le dice al usuario que reintente',
  /intent/i.test(falla.alerts[0] || ''));

const revienta = await runConfirm({ saveThrows: true });
ok('I1 — si el guardado lanza tampoco sale el toast y sí sale el alert bloqueante',
  !revienta.toasts.some(t => t.includes('Pago registrado'))
  && revienta.alerts.length === 1 && /NO QUED[ÓO] REGISTRADO/i.test(revienta.alerts[0]),
  JSON.stringify({ toasts: revienta.toasts, alerts: revienta.alerts }));

// I3: el modal quedó abierto mientras el polling reemplazó `projects`. Sin el fix, ocConfirmPago
// escribía sobre el objeto huérfano capturado al abrir el modal y el pago se perdía en silencio.
const repoll = await runConfirm({ repollear: true });
ok('I3 — el pago se escribe sobre la fila VIVA re-resuelta por id, no sobre la capturada al abrir',
  !!(repoll.ocVivo && repoll.ocVivo.pago), JSON.stringify(repoll.ocVivo && repoll.ocVivo.pago));
ok('I3 — el objeto huérfano de antes del polling NO queda con el pago',
  repoll.ocOriginal.pago === undefined);
ok('I3 — con re-resolución exitosa no hay alerta de error', repoll.alerts.length === 0,
  JSON.stringify(repoll.alerts));

const desaparecida = await runConfirm({ ocId: 'oc-que-ya-no-existe' });
ok('I3 — si la OC ya no existe al re-resolver, avisa con alert()',
  desaparecida.alerts.length === 1 && /NO se registr/i.test(desaparecida.alerts[0]),
  JSON.stringify(desaparecida.alerts));
ok('I3 — si la OC ya no existe NO se escribe nada',
  !desaparecida.ocVivo.pago && desaparecida.logs.length === 0 && desaparecida.toasts.length === 0);

// Ola de cierre — el dueño revirtió I4: registrar un pago vuelve a estar abierto a cualquier
// usuario autenticado. Estas dos aserciones afirmaban lo contrario (Supervisor/Regular
// bloqueados); ahora verifican que SÍ pueden registrar, igual que un Administrador.
const supervisorSiPuede = await runConfirm({ role: 'Supervisor' });
ok('Ola de cierre (I4 revertida) — un Supervisor SÍ puede registrar el pago',
  supervisorSiPuede.toasts.some(t => t.includes('Pago registrado')) && supervisorSiPuede.alerts.length === 0
  && !!(supervisorSiPuede.ocVivo && supervisorSiPuede.ocVivo.pago),
  JSON.stringify({ toasts: supervisorSiPuede.toasts, alerts: supervisorSiPuede.alerts }));
const regularSiPuede = await runConfirm({ role: 'Regular' });
ok('Ola de cierre (I4 revertida) — un Regular también puede registrar el pago',
  regularSiPuede.toasts.some(t => t.includes('Pago registrado'))
  && !!(regularSiPuede.ocVivo && regularSiPuede.ocVivo.pago));

ok('I1 — el toast está DESPUÉS del await del guardado, no antes',
  /await saveData\(\)[\s\S]{0,900}showToast\(/.test(extractAsyncFunction('ocConfirmPago'))
  && !/showToast\([\s\S]{0,200}await saveData\(\)/.test(extractAsyncFunction('ocConfirmPago'))); 
ok('I3 — _ocPagoCtx guarda ids, no los objetos proj/oc',
  /_ocPagoCtx=\{projId:proj\.id,ocId:oc\.id/.test(html)
  && !/_ocPagoCtx=\{proj,oc/.test(html));
ok('I3 — la re-resolución sigue el patrón de assignUnclassified (find por id sobre projects)',
  /function _ocPagoResolve[\s\S]{0,400}projects\.find\(p=>String\(p\.id\)===String\(_ocPagoCtx\.projId\)\)/.test(html));

// ---------- Ola de cierre — I4 revertida: registrar abierto a todos; editar/anular siguen Admin ----------
console.log('\nOla de cierre — I4 revertida (botón visible siempre; gate solo en editar/anular):');
ok('el botón de la barra lateral tiene id y nace oculto en el HTML (recién visible tras login), igual que sb-btn-settings',
  /id="sb-btn-pagos"[^>]*style="display:none"/.test(html));
ok('la visibilidad se fija en los mismos 4 lugares que sb-btn-settings',
  (html.match(/sb-btn-pagos'\)\.style\.display/g) || []).length
    === (html.match(/sb-btn-settings'\)\.style\.display/g) || []).length,
  `pagos=${(html.match(/sb-btn-pagos'\)\.style\.display/g) || []).length} settings=${(html.match(/sb-btn-settings'\)\.style\.display/g) || []).length}`);
ok('ninguno de los 4 lugares condiciona la visibilidad del botón por rol (a diferencia de sb-btn-settings)',
  !/sb-btn-pagos'\)\.style\.display=[^;]*role/.test(html));
ok('openPagosWin() YA NO gatea por rol antes de abrir la ventana',
  !/ocPagoGateRol/.test(extractFunction('openPagosWin')));
ok('ocOpenPagoModal() YA NO gatea por rol al abrir en modo registro',
  !/ocPagoGateRol/.test(extractFunction('ocOpenPagoModal')));
ok('ocConfirmPago() YA NO gatea por rol',
  !/ocPagoGateRol/.test(extractAsyncFunction('ocConfirmPago')));
ok('ocPagoGateRol() sigue vivo, pero solo en ocEditarPago() y ocAnularPago() (editar/anular siguen solo Admin)',
  (html.match(/ocPagoGateRol\(\)/g) || []).length === 3   // la definición + las 2 llamadas
  && extractFunction('ocEditarPago').includes('if(!ocPagoGateRol()) return;')
  && extractAsyncFunction('ocAnularPago').includes('if(!ocPagoGateRol()) return;'),
  `usos totales=${(html.match(/ocPagoGateRol\(\)/g) || []).length}`);
ok('el gate de editar/anular reconoce exactamente el rol Administrador',
  /function ocPagoPuedeRegistrar\(\)\{[^}]*currentUser\.role==='Administrador'/.test(html));

// ---------- I6 — el pago se ve en la lista y en el formulario ----------
console.log('\nI6 — el pago es visible:');
ok('I6 — renderOCList pinta el distintivo de OC pagada',
  /function renderOCList[\s\S]{0,4000}\$\{ocPagoBadgeHTML\(oc\)\}/.test(html));
ok('I6 — el distintivo dice "Pagada" y lleva la fecha',
  /function ocPagoBadgeHTML[\s\S]{0,500}Pagada \$\{esc\(fmtDate\(oc\.pago\.fecha\)\)\}/.test(html));
ok('I6 — el distintivo no se pinta si la OC no tiene pago',
  /function ocPagoBadgeHTML\(oc\)\{\s*if\(!oc\|\|!oc\.pago\) return '';/.test(html));
ok('I6 — el formulario de OC reserva el contenedor de la franja de pago',
  /id="oc-pago-strip">\$\{ocPagoStripHTML\(\)\}/.test(html));
const stripSrc = html.slice(html.indexOf('function ocPagoStripHTML'),
  html.indexOf('function ocPagoRefreshStrip'));
// Arreglo de moneda — el monto ya no se interpola directo como `pg.montoUSD`: pasa por
// ocPagoMontoTexto(pg), que elige fmt()/fmtCRC() según la moneda real del pago.
ok('I6 — la franja muestra monto, fecha, método y quién lo registró',
  /ocPagoMontoTexto\(pg\)/.test(stripSrc) && /fmtDate\(pg\.fecha\)/.test(stripSrc)
  && /pg\.metodo/.test(stripSrc) && /pg\.registradoPor/.test(stripSrc));
ok('I6 — el comprobante se abre por el mismo camino que Documentos (openPdfNewTab por blobId)',
  /openPdfNewTab\('\$\{esc\(String\(pg\.blobId\)\)\}'\)/.test(stripSrc));
ok('I6 — la franja lee la fila VIVA de curProj.ocs, no el clon ocState del formulario',
  /function ocPagoStripHTML[\s\S]{0,400}curProj\.ocs\|\|\[\]\)\.find\(o=>String\(o\.id\)===String\(curOCId\)\)/.test(html));
ok('I6 — todo el texto de usuario de la franja pasa por esc()',
  !/\$\{pg\.(comprobanteName|metodo|registradoPor)\}/.test(stripSrc));

// Render real de la franja: se ejecuta la función tal cual está en index.html.
// (No se puede usar extractFunction acá: el cuerpo tiene template literals anidados y el
// contador de llaves del extractor se pierde; por eso se acota por posición, como arriba.)
const stripSandbox = { console, JSON, String, Number, Array, Object, Date };
vm.createContext(stripSandbox);
// esc() no se puede sacar con extractFunction: su cuerpo tiene literales de expresión regular
// (/"/g, /'/g) y el contador de llaves los confunde con comillas. Es un one-liner, así que se
// toma la línea real del archivo — sigue siendo el esc() de producción, no una copia.
const escSrc = html.split('\n').find(l => l.trim().startsWith('function esc(s)'));
if (!escSrc) throw new Error('No se encontró la definición de esc()');
// Arreglo de moneda — ocPagoStripHTML/ocPagoBadgeHTML ahora llaman a ocPagoMontoTexto(pg), que a
// su vez llama a fmt()/fmtCRC(). Se extrae ocPagoMontoTexto real de index.html (es una función
// simple, sin template literals anidados) y se agregan los mismos stubs de fmt/fmtCRC que usa
// el resto de la app (fmt real: '$'+toLocaleString con 2 decimales; fmtCRC real: '₡'+Math.round).
vm.runInContext([stripSrc, escSrc, extractFunction('fmtDate'),
  extractFunction('ocPagoPuedeRegistrar'), extractFunction('ocPagoMontoTexto'),
  "function fmt(v){return '$'+(Number(v)||0).toFixed(2);}",
  "function fmtCRC(v){return '₡'+Math.round(v).toLocaleString('es-CR');}"].join('\n'), stripSandbox);
function renderStrip({ pago, role = 'Administrador', ocId = 'oc-14' } = {}) {
  stripSandbox.currentUser = { name: 'Abraham', role };
  stripSandbox.curProj = { id: 7, name: 'Dor', ocs: [{ id: 'oc-14', num: 'OC-2026-014', pago }] };
  stripSandbox.curOCId = ocId;
  return stripSandbox.ocPagoStripHTML();
}
const pagoDemo = { montoUSD: 883.11, fecha: '2026-09-09', metodo: 'Transferencia',
  blobId: 'blob_abc', comprobanteName: 'Polycenter-883.11-OC-2026-014.pdf', registradoPor: 'Abraham' };
const strip = renderStrip({ pago: pagoDemo });
ok('I6 (render real) — la franja muestra el monto', strip.includes('$883.11'), strip.slice(0, 200));
// fmtDate() es la función de fechas de toda la app (dd/mm/aaaa); lo que se verifica es que la
// franja pase la fecha por ella y no vuelque el ISO crudo.
ok('I6 (render real) — la franja muestra la fecha con fmtDate (dd/mm/aaaa), no el ISO crudo',
  /\d{2}\/\d{2}\/\d{4}/.test(strip) && strip.includes(stripSandbox.fmtDate(pagoDemo.fecha))
  && !strip.includes('2026-09-09'), strip);
ok('I6 (render real) — la franja muestra el método', strip.includes('Transferencia'));
ok('I6 (render real) — la franja dice quién lo registró', strip.includes('Abraham'));
ok('I6 (render real) — la franja enlaza el comprobante por blobId',
  strip.includes("openPdfNewTab('blob_abc')") && strip.includes('Polycenter-883.11-OC-2026-014.pdf'));
ok('I6 (render real) — una OC sin pago no pinta nada', renderStrip({ pago: undefined }) === '');
ok('I6 (render real) — una OC nueva (curOCId === "new") no pinta nada',
  renderStrip({ pago: pagoDemo, ocId: 'new' }) === '');
ok('I6 (render real) — sin comprobante lo dice en vez de dejar un enlace roto',
  renderStrip({ pago: { ...pagoDemo, blobId: '', comprobanteName: '' } }).includes('Sin comprobante adjunto'));
ok('D3 (render real) — el Administrador ve Editar y Anular',
  strip.includes('ocEditarPago(') && strip.includes('ocAnularPago('));
ok('D3 (render real) — un Supervisor NO ve esos botones',
  (() => { const s = renderStrip({ pago: pagoDemo, role: 'Supervisor' });
           return s.includes('Pagada') && !s.includes('ocEditarPago(') && !s.includes('ocAnularPago('); })());
ok('I6 (render real) — un nombre de comprobante con payload XSS no sobrevive crudo',
  (() => { const s = renderStrip({ pago: { ...pagoDemo,
             comprobanteName: '<img src=x onerror=alert(1)>', registradoPor: '"><script>alert(2)</script>' } });
           return !s.includes('<img src=x onerror=alert(1)>') && !s.includes('<script>alert(2)</script>')
             && s.includes('&lt;img src=x onerror=alert(1)&gt;'); })());

// ---------- Arreglo de moneda — la franja respeta la moneda real del pago ----------
// pagoDemo (arriba) solo tiene `montoUSD`, sin `moneda` ni `monto` propios: es exactamente la
// forma de un pago registrado ANTES de este cambio. Que "I6 (render real) — la franja muestra
// el monto" siga viendo "$883.11" con esa fixture YA prueba la compatibilidad hacia atrás; acá
// se deja explícito y se cubre el caso nuevo (CRC).
ok('moneda — compatibilidad hacia atrás: un pago viejo sin `moneda` se lee como dólares',
  renderStrip({ pago: { montoUSD: 883.11, fecha: '2026-09-09', metodo: 'Transferencia',
    registradoPor: 'Abraham' } }).includes('$883.11'));
const pagoCRCDemo = { monto: 450000, moneda: 'CRC', exchangeRate: 500, montoUSD: 900,
  fecha: '2026-09-09', metodo: 'Transferencia', blobId: 'blob_crc',
  comprobanteName: 'Extralum-₡450000-OC-2026-014.pdf', registradoPor: 'Abraham' };
const stripCRC = renderStrip({ pago: pagoCRCDemo });
// El separador de miles de toLocaleString('es-CR') depende de los datos ICU del runtime (puede
// ser '.', ',' o un espacio no separable) — se compara contra el fmtCRC() real en vez de
// adivinar el carácter exacto.
ok('moneda — un pago en colones se muestra con fmtCRC(), no con el símbolo $',
  stripCRC.includes(stripSandbox.fmtCRC(450000)) && !/\$450[.,]?000/.test(stripCRC), stripCRC.slice(0, 250));
ok('moneda — un pago en colones también muestra el equivalente en dólares entre paréntesis',
  stripCRC.includes(stripSandbox.fmt(900)) && new RegExp('\\(.*' + stripSandbox.fmt(900).replace('$', '\\$') + '.*\\)').test(stripCRC),
  stripCRC.slice(0, 250));
ok('moneda — un pago en dólares NO muestra equivalente entre paréntesis (no hace falta)',
  !strip.includes('≈'));

// Render real del distintivo de la lista.
vm.runInContext([extractFunction('ocPagoBadgeHTML')].join('\n'), stripSandbox);
ok('I6 (render real) — el distintivo de la lista dice "Pagada" con la fecha en dd/mm/aaaa',
  (() => { const b = stripSandbox.ocPagoBadgeHTML({ pago: pagoDemo });
           return b.includes('Pagada') && b.includes(stripSandbox.fmtDate(pagoDemo.fecha))
             && /\d{2}\/\d{2}\/\d{4}/.test(b); })(),
  stripSandbox.ocPagoBadgeHTML({ pago: pagoDemo }));
ok('I6 (render real) — sin pago el distintivo es vacío',
  stripSandbox.ocPagoBadgeHTML({ num: 'OC-1' }) === '' && stripSandbox.ocPagoBadgeHTML(null) === '');
// Arreglo de moneda — el distintivo de la lista también muestra el monto con su símbolo.
ok('moneda — el distintivo muestra el monto en dólares con $',
  stripSandbox.ocPagoBadgeHTML({ pago: pagoDemo }).includes('$883.11'));
ok('moneda — el distintivo de un pago en colones muestra fmtCRC() y el equivalente en dólares',
  (() => { const b = stripSandbox.ocPagoBadgeHTML({ pago: pagoCRCDemo });
           return b.includes(stripSandbox.fmtCRC(450000)) && b.includes(stripSandbox.fmt(900)); })(),
  stripSandbox.ocPagoBadgeHTML({ pago: pagoCRCDemo }));

// ---------- Decisión 3 — editar y anular un pago con contraseña de administrador ----------
console.log('\nDecisión 3 — editar y anular pago:');
ok('D3 — existe ocEditarPago', /function ocEditarPago\(/.test(html));
ok('D3 — existe ocAnularPago', /async function ocAnularPago\(/.test(html));
ok('D3 — la franja de pago ofrece las dos acciones',
  /ocEditarPago\(/.test(stripSrc) && /ocAnularPago\(/.test(stripSrc));
ok('D3 — las dos acciones solo se ofrecen al rol que puede pagar',
  /const puede=ocPagoPuedeRegistrar\(\)/.test(stripSrc) && /\$\{puede\?/.test(stripSrc));
ok('D3 — editar pide contraseña de administrador con el mismo mecanismo que borrar un proyecto (isAdminPwd)',
  /function ocEditarPago[\s\S]{0,900}prompt\([\s\S]{0,200}isAdminPwd\(pwd\)[\s\S]{0,120}Contraseña incorrecta/.test(html));
ok('D3 — anular pide contraseña de administrador (isAdminPwd)',
  /function ocAnularPago[\s\S]{0,900}prompt\([\s\S]{0,200}isAdminPwd\(pwd\)[\s\S]{0,120}Contraseña incorrecta/.test(html));
ok('D3 — cancelar el prompt no hace nada (pwd===null)',
  (extractFunction('ocEditarPago').match(/if\(pwd===null\) return;/g) || []).length === 1
  && (extractAsyncFunction('ocAnularPago').match(/if\(pwd===null\) return;/g) || []).length === 1);
ok('D3 — editar reabre el modal en modo edición sobre la MISMA OC',
  /function ocEditarPago[\s\S]{0,900}ocOpenPagoModal\(proj\.id,oc\.id,true\)/.test(html));
// montoInicial se actualizó con el arreglo de moneda: lee `previo.monto` (nativo, en su propia
// moneda) y cae a `previo.montoUSD` solo para pagos viejos que no tienen `monto` propio.
ok('D3 — el modal en modo edición prellena monto, fecha, método y el nombre del comprobante actual',
  /const previo=editando\?oc\.pago:null/.test(html)
  && /const monedaActual=previo\?\(previo\.moneda\|\|'USD'\):'USD'/.test(html)
  && /const montoInicial=previo\?Number\(previo\.monto!=null\?previo\.monto:\(previo\.montoUSD\|\|0\)\):Number\(oc\.totalUSD\|\|0\)/.test(html)
  && /const fechaInicial=previo&&previo\.fecha/.test(html)
  && /const metodoActual=previo&&previo\.metodo/.test(html)
  && /const nombreArchivo=previo&&previo\.comprobanteName/.test(html));
ok('D3 — editar sin reemplazar el archivo conserva el comprobante anterior',
  /let blobId=comprobantePrevioId;/.test(html));
ok('D3 — anular borra el pago y devuelve la OC a "Listo para pagar"',
  /function ocAnularPago[\s\S]{0,1400}delete oc\.pago;/.test(html));
// Seguimiento del arreglo de moneda (punto 6) — el log de anulación ahora guarda el monto NATIVO
// (con fallback a montoUSD solo para pagos viejos sin `monto` propio) más `moneda`, igual que el
// log de registro, en vez de `monto:anulado.montoUSD` a secas.
ok('D3 — anular deja en el log EL PAGO que se anuló, no solo que se anuló algo',
  /logAction\(`Pago anulado en[\s\S]{0,400}monto:\(anulado\.monto!=null\?anulado\.monto:anulado\.montoUSD\),moneda:anulado\.moneda\|\|'USD'[\s\S]{0,200}comprobante:anulado\.comprobanteName/.test(html));
// logAction toma el proyecto de la global curProj si no se le pasa, y estas pantallas son globales.
ok('D3 — ambas acciones pasan el proyecto dueño como último argumento de logAction',
  /function ocAnularPago[\s\S]{0,1600}logAction\([\s\S]{0,600},proj\);/.test(html));
ok('D3 — la edición del pago también atribuye el log al proyecto dueño',
  /logAction\(editando\?`Pago editado[\s\S]{0,1050},proj\);/.test(html));
ok('D3 — la edición no reescribe quién registró el pago original; deja rastro aparte de quién editó',
  /oc\.pago\.editadoPor=/.test(html) && /registradoPor:\(editando&&pagoPrevio&&pagoPrevio\.registradoPor\)/.test(html));
ok('D3 — anular también espera el guardado antes de cantar victoria',
  /function ocAnularPago[\s\S]{0,1800}await saveData\(\)[\s\S]{0,700}NO QUED[ÓO] GUARDADA/.test(html));

// ---------- Seguimiento del arreglo de moneda (puntos 5 y 6) — anular respeta la moneda real ----------
// Prueba de comportamiento real: se extrae ocAnularPago() de index.html y se ejecuta en un
// sandbox aislado (mismo patrón que deleteOC() más abajo), con ocPagoGateRol()/isAdminPwd()
// stubbeadas a "siempre pasa" porque el rol y la contraseña no son el objeto de estas pruebas.
console.log('\nArreglo de moneda (puntos 5 y 6) — anular un pago respeta la moneda real:');
const anularSandbox = { console, JSON, Date, Math, Number, parseFloat, String, Array, Object };
anularSandbox.window = anularSandbox;
vm.createContext(anularSandbox);
vm.runInContext([
  extractFunction('fmtDate'),
  "function fmt(n){ return '$' + (Number(n)||0).toFixed(2); }",
  "function fmtCRC(n){ return '₡' + Math.round(n).toLocaleString('es-CR'); }",
  extractFunction('ocPagoMontoTexto'),
  "function ocPagoGateRol(){ return true; }",
  "function isAdminPwd(pwd){ return !!pwd; }",
  extractAsyncFunction('ocAnularPago'),
].join('\n'), anularSandbox);

async function runAnular({ pago }) {
  anularSandbox.projects = [{ id: 7, name: 'Dor', lastActivity: 0,
    ocs: [{ id: 'oc-14', num: 'OC-2026-014', pago }] }];
  anularSandbox.currentUser = { name: 'Abraham', role: 'Administrador' };
  const alerts = [], toasts = [], logs = [];
  let confirmMsg = null;
  anularSandbox.alert = m => alerts.push(String(m));
  anularSandbox.showToast = m => toasts.push(String(m));
  anularSandbox.logAction = (...a) => logs.push(a);
  anularSandbox.prompt = () => 'admin123';
  anularSandbox.confirm = m => { confirmMsg = m; return true; };
  anularSandbox.saveData = () => Promise.resolve(true);
  anularSandbox.closeModal = () => {};
  anularSandbox.curTab = 'info'; anularSandbox.curTxnTab = 'oc'; anularSandbox.curOCId = null;
  await anularSandbox.ocAnularPago(7, 'oc-14');
  return { alerts, toasts, logs, confirmMsg,
    ocVivo: anularSandbox.projects[0].ocs.find(o => o.id === 'oc-14') };
}

const pagoCRCAnular = { monto: 450000, moneda: 'CRC', exchangeRate: 500, montoUSD: 900,
  fecha: '2026-08-01', metodo: 'Transferencia', registradoPor: 'Abraham', comprobanteName: 'x.pdf' };
const anulacionCRC = await runAnular({ pago: pagoCRCAnular });
ok('punto 5 — el diálogo de confirmación de ocAnularPago muestra el monto nativo en colones (ocPagoMontoTexto), no solo el equivalente en dólares',
  anulacionCRC.confirmMsg.includes(anularSandbox.fmtCRC(450000))
  && anulacionCRC.confirmMsg.indexOf(anularSandbox.fmtCRC(450000)) < anulacionCRC.confirmMsg.indexOf(anularSandbox.fmt(900)),
  anulacionCRC.confirmMsg);
ok('punto 6 — el log de anulación guarda el monto NATIVO (450000) y la moneda (CRC), no montoUSD (900)',
  anulacionCRC.logs.length === 1 && anulacionCRC.logs[0][3].monto === 450000
  && anulacionCRC.logs[0][3].moneda === 'CRC',
  JSON.stringify(anulacionCRC.logs[0] && anulacionCRC.logs[0][3]));
ok('punto 6 — el ciclo completo de un pago en colones queda consistente en el log: 450000 al crear (punto 2) y 450000 al anular, no 900 en un lado y otra cosa en el otro',
  anulacionCRC.logs[0][3].monto === 450000);
ok('el pago se anula igual que antes (compatibilidad): oc.pago desaparece y la OC vuelve a "Listo para pagar"',
  anulacionCRC.ocVivo && anulacionCRC.ocVivo.pago === undefined);
ok('el flujo de anulación sigue guardando y avisando con toast, sin alertas de error',
  anulacionCRC.toasts.includes('Pago anulado') && anulacionCRC.alerts.length === 0,
  JSON.stringify({ toasts: anulacionCRC.toasts, alerts: anulacionCRC.alerts }));

// Compatibilidad hacia atrás: un pago viejo en dólares (solo montoUSD, sin `moneda` ni `monto`
// propios) se sigue viendo y auditando exactamente como antes de este arreglo.
const pagoUSDAnular = { montoUSD: 883.11, fecha: '2026-08-01', metodo: 'Transferencia', registradoPor: 'Abraham' };
const anulacionUSD = await runAnular({ pago: pagoUSDAnular });
ok('compatibilidad — un pago viejo en dólares (sin campo `moneda`) sigue mostrando $ en el diálogo de anular',
  anulacionUSD.confirmMsg.includes('$883.11'), anulacionUSD.confirmMsg);
ok('compatibilidad — y el log de anulación lo sigue guardando como USD (moneda||\'USD\')',
  anulacionUSD.logs[0][3].monto === 883.11 && anulacionUSD.logs[0][3].moneda === 'USD');

// ---------- Seguimiento del arreglo de moneda (punto 7) — cambiar la moneda recalcula el sugerido ----------
// Al abrir el modal para un pago NUEVO, el monto se prellena con oc.totalUSD (p.ej. 883.11). Sin
// el arreglo, cambiar el selector a CRC dejaba el campo diciendo "883.11" — ahora interpretado
// como ₡883,11 en vez de convertir el total a colones. Precedente: vbOpenPaymentModal()
// (index.html:~14909) ya calcula su monto por defecto en la moneda del documento.
console.log('\nArreglo de moneda (punto 7) — cambiar la moneda del selector recalcula el monto SUGERIDO:');
ok('punto 7 — ocOpenPagoModal() arranca _ocPagoCtx.montoEsSugerido en true SOLO para pago nuevo (false en edición: el monto inicial ahí es un dato real, no una sugerencia)',
  /_ocPagoCtx=\{projId:proj\.id,ocId:oc\.id,file:null,editando,pagoPrevio:previo\|\|null,montoEsSugerido:!editando\}/.test(html));
ok('punto 7 — el selector de moneda llama a ocPagoMonedaChanged(), que además de renderizar el rótulo puede recalcular el sugerido',
  /id="oc-pago-moneda" onchange="ocPagoMonedaChanged\(\)"/.test(html));
ok('punto 7 — el campo de monto apaga el flag de "sugerido" en cuanto el usuario escribe (oninput)',
  /id="oc-pago-monto"[^>]*oninput="ocPagoMontoEditadoManual\(\)"/.test(html));
ok('punto 7 — el prellenado desde el nombre del archivo también apaga "sugerido" (no se pisa un monto ya explícito)',
  /if\(parsed&&parsed\.monto!=null\)\{[\s\S]{0,350}_ocPagoCtx\.montoEsSugerido=false;/.test(extractFunction('ocPagoFilePicked')));

// Prueba de comportamiento real: se extraen ocPagoMonedaChanged()/ocPagoMontoEditadoManual() (y
// sus dependencias _ocPagoResolve()/tcGet()/ocPagoRenderMontoLabel()) y se ejecutan en un sandbox
// con stubs de `document`/`projects`, exactamente como el resto de esta suite.
const monedaSandbox = { console, Number, String, Math };
monedaSandbox.window = monedaSandbox;
vm.createContext(monedaSandbox);
vm.runInContext([
  extractFunction('_ocPagoResolve'),
  extractFunction('tcGet'),
  extractFunction('ocPagoRenderMontoLabel'),
  extractFunction('ocPagoMonedaChanged'),
  extractFunction('ocPagoMontoEditadoManual'),
].join('\n'), monedaSandbox);
monedaSandbox.SYS = { exchangeRate: 500 };

function runMonedaChanged({ montoEsSugerido, monedaDestino, montoActual = '883.11', totalUSD = 883.11 }) {
  monedaSandbox.projects = [{ id: 7, ocs: [{ id: 'oc-14', totalUSD }] }];
  monedaSandbox._ocPagoCtx = { projId: 7, ocId: 'oc-14', montoEsSugerido };
  const campos = { 'oc-pago-moneda': { value: monedaDestino }, 'oc-pago-monto': { value: montoActual },
                   'oc-pago-monto-label': { textContent: '' } };
  monedaSandbox.document = { getElementById: id => campos[id] || null };
  monedaSandbox.ocPagoMonedaChanged();
  return campos;
}

ok('punto 7 — con el monto todavía SUGERIDO, cambiar a CRC lo recalcula convirtiendo oc.totalUSD con tcGet() (883.11 × 500)',
  runMonedaChanged({ montoEsSugerido: true, monedaDestino: 'CRC', montoActual: '883.11', totalUSD: 883.11 })
    ['oc-pago-monto'].value === (883.11 * 500).toFixed(2));
ok('punto 7 — con el monto todavía SUGERIDO, volver a USD lo recalcula al totalUSD tal cual (sin multiplicar por tc)',
  runMonedaChanged({ montoEsSugerido: true, monedaDestino: 'USD', montoActual: '441555.00', totalUSD: 883.11 })
    ['oc-pago-monto'].value === (883.11).toFixed(2));
ok('punto 7 — si el usuario YA editó el monto a mano (montoEsSugerido=false), cambiar la moneda NO lo toca',
  runMonedaChanged({ montoEsSugerido: false, monedaDestino: 'CRC', montoActual: '150.00', totalUSD: 883.11 })
    ['oc-pago-monto'].value === '150.00');
ok('punto 7 — el rótulo del campo también se actualiza al cambiar la moneda (ocPagoRenderMontoLabel sigue corriendo)',
  runMonedaChanged({ montoEsSugerido: true, monedaDestino: 'CRC', montoActual: '883.11', totalUSD: 883.11 })
    ['oc-pago-monto-label'].textContent === 'Monto pagado (₡)');
ok('punto 7 — ocPagoMontoEditadoManual() apaga el flag de "sugerido" en el contexto activo',
  (() => { monedaSandbox._ocPagoCtx = { montoEsSugerido: true };
           monedaSandbox.ocPagoMontoEditadoManual();
           return monedaSandbox._ocPagoCtx.montoEsSugerido === false; })());
ok('punto 7 — sin _ocPagoCtx (modal cerrado a mitad de camino) ninguna de las dos funciones revienta',
  (() => { monedaSandbox._ocPagoCtx = null;
           monedaSandbox.document = { getElementById: () => null };
           try { monedaSandbox.ocPagoMonedaChanged(); monedaSandbox.ocPagoMontoEditadoManual(); return true; }
           catch (e) { return false; } })());

// ---------- Ola de cierre (punto 1) — no se puede eliminar una OC con pago registrado ----------
// Prueba de comportamiento real: se extrae deleteOC() de index.html y se ejecuta en un sandbox
// aislado, verificando que la guarda de `oc.pago` corta ANTES de llegar a confirm() — nunca se
// pregunta, nunca se borra, nunca se guarda — y que no hay excepción de rol (a diferencia de la
// guarda de factura pagada, que sí permite al Administrador seguir adelante).
console.log('\nOla de cierre (1) — deleteOC() bloquea el borrado si hay pago registrado:');
const deleteSandbox = { console, JSON, Date, Math, Number, String, Array, Object };
deleteSandbox.window = deleteSandbox;
vm.createContext(deleteSandbox);
vm.runInContext([
  extractFunction('fmtDate'),
  // `const fmt=...` en vm.runInContext no queda como propiedad del contexto (solo `function`/`var`
  // lo hacen) — se usa function declaration, mismo patrón que el stub de fmt() en la sección I6.
  "function fmt(n){ return '$' + (Number(n)||0).toFixed(2); }",
  // Seguimiento del arreglo de moneda (punto 5) — deleteOC() ahora llama a ocPagoMontoTexto(),
  // que a su vez llama a fmtCRC() cuando el pago es en colones. Mismos stubs que la sección I6.
  "function fmtCRC(n){ return '₡' + Math.round(n).toLocaleString('es-CR'); }",
  extractFunction('ocPagoMontoTexto'),
  extractFunction('deleteOC'),
].join('\n'), deleteSandbox);

function runDeleteOC({ pago = null, linkedPaidBill = null, role = 'Administrador', confirmReturns = true } = {}) {
  const oc = { id: 'oc-9', num: 'OC-2026-009', pago };
  deleteSandbox.curProj = { ocs: [oc], billVendor: linkedPaidBill ? [linkedPaidBill] : [] };
  deleteSandbox.currentUser = { name: 'Abraham', role };
  const alerts = [];
  let confirmCalled = false;
  deleteSandbox.alert = m => alerts.push(String(m));
  deleteSandbox.confirm = () => { confirmCalled = true; return confirmReturns; };
  const logs = [];
  deleteSandbox.logAction = (...a) => logs.push(a);
  let saved = false;
  deleteSandbox.saveData = () => { saved = true; };
  deleteSandbox.curOCId = 'oc-9';
  let rendered = false;
  deleteSandbox.renderOCList = () => { rendered = true; };
  deleteSandbox.deleteOC('oc-9');
  return { alerts, confirmCalled, saved, rendered, logs, ocsRestantes: deleteSandbox.curProj.ocs };
}

const pagoExistente = { montoUSD: 883.11, fecha: '2026-09-01', metodo: 'Transferencia', registradoPor: 'Abraham' };

const conPagoAdmin = runDeleteOC({ pago: pagoExistente, role: 'Administrador' });
ok('con pago registrado, deleteOC() corta ANTES de llamar confirm() — ni siquiera pregunta',
  !conPagoAdmin.confirmCalled && conPagoAdmin.ocsRestantes.length === 1
  && !conPagoAdmin.saved && conPagoAdmin.logs.length === 0 && !conPagoAdmin.rendered,
  JSON.stringify(conPagoAdmin));
ok('sin excepción de rol: ni el Administrador puede saltarse la guarda del pago',
  conPagoAdmin.alerts.length === 1);
ok('el alert explica qué pasó (fecha y monto del pago) y qué hacer (anular primero)',
  /2026/.test(conPagoAdmin.alerts[0])
  && conPagoAdmin.alerts[0].includes(deleteSandbox.fmtDate(pagoExistente.fecha))
  && conPagoAdmin.alerts[0].includes(deleteSandbox.ocPagoMontoTexto(pagoExistente))
  && /anular/i.test(conPagoAdmin.alerts[0]),
  JSON.stringify(conPagoAdmin.alerts));

// Seguimiento del arreglo de moneda (punto 5) — el diálogo destructivo de deleteOC() ahora
// respeta la moneda real del pago: un pago en colones debe mostrar fmtCRC(), no el equivalente
// en dólares crudo (antes decía "$849.06", un número que no aparece en ninguna otra pantalla).
const pagoExistenteCRC = { monto: 450000, moneda: 'CRC', exchangeRate: 500, montoUSD: 900,
  fecha: '2026-09-01', metodo: 'Transferencia', registradoPor: 'Abraham' };
const conPagoAdminCRC = runDeleteOC({ pago: pagoExistenteCRC, role: 'Administrador' });
// ocPagoMontoTexto() muestra fmtCRC() como cifra principal y fmt() (el equivalente en dólares)
// entre paréntesis a propósito (mismo patrón que la franja del formulario) — lo que el bug
// original hacía mal era mostrar SOLO fmt(montoUSD) suelto, sin el monto nativo en colones. Se
// verifica que el monto nativo esté presente y que aparezca ANTES del equivalente en dólares.
ok('punto 5 — deleteOC() con un pago en colones muestra el monto nativo en colones (fmtCRC), no solo el equivalente en dólares',
  conPagoAdminCRC.alerts[0].includes(deleteSandbox.fmtCRC(450000))
  && conPagoAdminCRC.alerts[0].indexOf(deleteSandbox.fmtCRC(450000)) < conPagoAdminCRC.alerts[0].indexOf(deleteSandbox.fmt(900)),
  JSON.stringify(conPagoAdminCRC.alerts));

const conPagoSupervisor = runDeleteOC({ pago: pagoExistente, role: 'Supervisor' });
ok('un rol no-Administrador tampoco llega a confirm() (mismo bloqueo, sin distinción de rol)',
  !conPagoSupervisor.confirmCalled && conPagoSupervisor.ocsRestantes.length === 1);

const sinPago = runDeleteOC({ pago: null, confirmReturns: true });
ok('sin pago, el camino normal sigue intacto: pide confirm() y borra al confirmar',
  sinPago.confirmCalled && sinPago.ocsRestantes.length === 0 && sinPago.saved);

const sinPagoNoConfirma = runDeleteOC({ pago: null, confirmReturns: false });
ok('sin pago, si el usuario cancela el confirm() no se borra nada (comportamiento previo intacto)',
  sinPagoNoConfirma.confirmCalled && sinPagoNoConfirma.ocsRestantes.length === 1 && !sinPagoNoConfirma.saved);

const facturaPagadaNoAdmin = runDeleteOC({
  pago: null, role: 'Supervisor',
  linkedPaidBill: { linkedOcId: 'oc-9', status: 'Pagada', num: 'FP-1' },
});
ok('la guarda existente de factura pagada sigue intacta: sin pago en la OC pero con factura pagada, un no-Admin sigue bloqueado',
  !facturaPagadaNoAdmin.confirmCalled && facturaPagadaNoAdmin.ocsRestantes.length === 1
  && facturaPagadaNoAdmin.alerts.some(a => /Administrador/.test(a)));

ok('la guarda de pago es la PRIMERA verificación del cuerpo (corre antes que la de factura pagada)',
  /function deleteOC\(ocId\)\{\s*const oc=curProj\.ocs\.find[^;]+;\s*if\(!oc\)return;\s*(?:\/\/[^\n]*\n\s*)*if\(oc\.pago\)\{/.test(html));
// Seguimiento del arreglo de moneda (punto 5) — el mensaje ya no usa fmt(oc.pago.montoUSD)
// crudo: pasa por ocPagoMontoTexto(oc.pago), igual que la franja del formulario y el distintivo
// de la lista, para mostrar el monto en la moneda con la que el usuario realmente lo registró.
ok('el mensaje formatea el monto con ocPagoMontoTexto() y la fecha con fmtDate(), como pide el brief',
  /if\(oc\.pago\)\{[\s\S]{0,300}alert\(`[\s\S]{0,250}fmtDate\(oc\.pago\.fecha\)[\s\S]{0,120}ocPagoMontoTexto\(oc\.pago\)/.test(html)
  && !/fmt\(oc\.pago\.montoUSD/.test(html));

})().then(() => {
  console.log(`\n${pass} pruebas OK, ${fail} fallas`);
  process.exit(fail ? 1 : 0);
}).catch(e => {
  console.error('\n✗ La suite reventó:', e);
  process.exit(1);
});
