// VUL-044 Fase F — comportamiento real del sincronizador append-only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function between(startText, endText) {
  const start = html.indexOf(startText);
  const end = html.indexOf(endText, start);
  if (start < 0 || end < 0) throw new Error(`No se pudo extraer ${startText}`);
  return html.slice(start, end);
}

const conversion = between('function _activityFromRow', 'function _projectCloudPayload');
const remember = between('function _rememberActivityRow', 'function _clearNormalizedState');
const sync = between('async function _syncNormalizedActivity', 'async function _syncNormalizedDocuments');

let pass = 0, fail = 0;
function ok(name, condition, detail) {
  if (condition) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name, detail || ''); }
}

function environment(initial) {
  const calls = [];
  const activityLog = initial;
  const factory = new Function('activityLog', 'calls', `
    const _activitySnapshots=new Map();
    const _activitySortOrders=new Map();
    let _normalizedActivityLoaded=true;
    function _snapshot(value){return JSON.stringify(value);}
    async function _dbRowRequest(method,path,body){
      calls.push({method,path,body});
      return {resp:{ok:true,status:200},data:{
        id:body.id,sort_order:body.sortOrder,data:body.data,updated_at:'v1'
      }};
    }
    ${conversion}
    ${remember}
    ${sync}
    return {
      sync:_syncNormalizedActivity,
      remember:_rememberActivityRow,
      fromRow:_activityFromRow,
      sizes:()=>({snapshots:_activitySnapshots.size,orders:_activitySortOrders.size})
    };
  `);
  return { api: factory(activityLog, calls), calls, activityLog };
}

(async () => {
  console.log('Alta append-only:');
  const oldEvent = { id: 1, action: 'Histórico', timestamp: 'ayer' };
  const env = environment([oldEvent]);
  env.api.remember({ id: '1', sort_order: 0, data: oldEvent }, oldEvent);
  const newEvent = { id: 'act-2-random', action: 'Nuevo', timestamp: 'hoy' };
  env.activityLog.unshift(newEvent);
  ok('sincronización termina OK', await env.api.sync());
  ok('solo crea el evento nuevo',
    env.calls.length === 1 &&
    env.calls[0].method === 'POST' &&
    env.calls[0].path === '/api/db/activity_entries');
  ok('payload conserva el evento exacto y usa orden nuevo negativo',
    JSON.stringify(env.calls[0].body.data) === JSON.stringify(newEvent) &&
    Number.isSafeInteger(env.calls[0].body.sortOrder) &&
    env.calls[0].body.sortOrder < 0);
  ok('un segundo save no vuelve a insertar', await env.api.sync() && env.calls.length === 1);

  console.log('\nInmutabilidad:');
  oldEvent.action = 'Manipulado';
  ok('rechaza modificar un evento ya registrado', !(await env.api.sync()));
  ok('no emite PUT ni DELETE', env.calls.every(call => call.method === 'POST'));

  console.log('\nLoader y settings:');
  ok('loader pide la tabla dedicada',
    html.includes('fetch(`${BACKEND_URL}/api/db/activity_entries`,{headers})'));
  ok('solo activa la tabla con filas o fuente legacy ausente',
    html.includes('if(activityRows.length||!hasLegacyActivity)'));
  ok('mantiene fallback mientras activityLog siga en settings',
    html.includes('activityLog=d.activityLog;'));
  ok('el payload de settings omite activityLog después del cutover',
    html.includes('if(!_normalizedActivityLoaded)data.activityLog=activityLog;'));
  ok('cada guardado sincroniza actividad antes de settings',
    html.indexOf('if(!await _syncNormalizedActivity())return false;') <
    html.indexOf('const settingsData=_settingsCloudData();'));
  ok('los ids nuevos incluyen entropía y no dependen solo de Date.now',
    /id: `act-\$\{now\}-\$\{entropy\}`/.test(html));

  console.log(`\n${pass} pruebas OK, ${fail} fallas`);
  process.exit(fail ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
