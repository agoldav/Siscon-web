// VUL-044 Fase A — regresión del conflicto artificial al iniciar una segunda sesión.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
function ok(name, condition, extra) {
  if (condition) {
    pass++;
    console.log('  ✓', name);
  } else {
    fail++;
    console.error('  ✗ FALLA:', name, extra === undefined ? '' : `→ ${JSON.stringify(extra)}`);
  }
}

function sourceBetween(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  return from >= 0 && to > from ? html.slice(from, to) : '';
}

console.log('Login multiusuario sin escritura artificial:');

const passwordLogin = sourceBetween('async function login(){', '\nasync function logout()');
const cloudflareLogin = sourceBetween('async function bootstrapCloudflareAuth(){', '\nfunction openSettings');

ok('login tradicional no registra Inicio de sesión en settings/1',
  passwordLogin.length > 0 && !/logAction\(['"]Inicio de sesión/.test(passwordLogin));
ok('bootstrap de Cloudflare no registra Inicio de sesión en settings/1',
  cloudflareLogin.length > 0 && !/logAction\(['"]Inicio de sesión/.test(cloudflareLogin));
ok('logAction bloquea eventos de autenticación aunque otro flujo vuelva a invocarlos',
  /action==='Inicio de sesión'[\s\S]{0,220}action==='Invitación aceptada'[\s\S]{0,120}action==='Cierre de sesión'/.test(html));

console.log('\nGuardado de settings solo cuando cambió su payload:');

const saveBlock = sourceBetween('let _settingsVersion=null;', '\nasync function loadDataFromAPI()');
ok('se pudo extraer el bloque real de guardado', saveBlock.length > 0);
ok('la carga confirma una fotografía de settings',
  /_settingsSnapshot=_settingsCloudSnapshot\(_settingsCloudData\(\)\)/.test(html));
ok('el core omite el PUT cuando la fotografía no cambió',
  /if\(!forzar&&_settingsSnapshot!==null&&nextSettingsSnapshot===_settingsSnapshot\)\s*return true/.test(saveBlock));

function buildEnvironment() {
  const putBodies = [];
  const activityLog = [];
  const SYS = { theme: 'dark' };
  const sandbox = {
    fetch: async (_url, options) => {
      if (options && options.method === 'PUT') {
        putBodies.push(JSON.parse(options.body));
        return { ok: true, status: 200, json: async () => ({ updated_at: `v${putBodies.length + 1}` }) };
      }
      throw new Error('No se esperaba otra solicitud en esta prueba');
    },
    _sbToken: 'token-prueba',
    currentUser: { id: 'u1' },
    BACKEND_URL: '',
    projects: [],
    SYS,
    activityLog,
    _normalizedProjectsLoaded: true,
    _normalizedActivityLoaded: false,
    _syncNormalizedProjectsHouses: async () => true,
    _syncNormalizedActivity: async () => true,
    confirm: () => { throw new Error('No debe abrirse un conflicto en esta prueba'); },
    console,
  };
  const factory = new Function(
    ...Object.keys(sandbox),
    `${saveBlock}
     return {
       saveCore:_saveDataToAPICore,
       confirmSnapshot:()=>{ _settingsSnapshot=_settingsCloudSnapshot(_settingsCloudData()); }
     };`,
  );
  const exported = factory(...Object.values(sandbox));
  return { ...exported, putBodies, activityLog };
}

(async () => {
  const env = buildEnvironment();
  env.confirmSnapshot();

  const noChange = await env.saveCore(false);
  ok('un save automático sin cambios termina bien', noChange === true);
  ok('un save automático sin cambios hace 0 PUT a settings/1', env.putBodies.length === 0, env.putBodies);

  env.activityLog.unshift({ id: 1, action: 'Cambio real' });
  const changed = await env.saveCore(false);
  ok('un cambio real sí se guarda', changed === true);
  ok('un cambio real hace exactamente 1 PUT', env.putBodies.length === 1, env.putBodies);
  ok('el PUT contiene el cambio real', env.putBodies[0]?.data?.activityLog?.length === 1);

  await env.saveCore(false);
  ok('repetir sin nuevos cambios no vuelve a incrementar la versión', env.putBodies.length === 1, env.putBodies);

  console.log(`\n${pass} pruebas OK, ${fail} fallas`);
  process.exit(fail ? 1 : 0);
})().catch(error => {
  console.error('Error en las pruebas:', error);
  process.exit(1);
});
