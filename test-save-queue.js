// ============================================================
//  Prueba de COMPORTAMIENTO real (no solo patrón de código) del bug #2 encontrado en vivo
//  (2026-07-24+): "conflicto contra uno mismo" cuando saveData() dispara guardados casi
//  simultáneos desde la misma pestaña.
//
//  saveData() se llama ~127 veces en index.html, sin esperar saveDataToAPI() (fire-and-forget).
//  Si dos llamadas casi seguidas leían la misma _settingsVersion antes de que ninguna respondiera,
//  la SEGUNDA llegaba al servidor con una versión ya vieja (porque la primera ya la había
//  actualizado) y el servidor la marcaba, correctamente, como conflicto — pero el conflicto era
//  contra sí misma, en la misma pestaña, sin que existiera ningún otro usuario.
//
//  Esta prueba dispara VARIAS llamadas a saveDataToAPI() en el mismo tick (como pasaría si una
//  sola acción del usuario disparara varios saveData() seguidos) contra un fetch simulado con
//  latencia real, y verifica que solo sale UN PUT a la vez — nunca dos en vuelo al mismo tiempo.
// ============================================================
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FALLA:', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
}

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const iInicio = html.indexOf('let _settingsVersion=null;');
const iFin = html.indexOf('\nasync function loadDataFromAPI()', iInicio);
const bloqueSrc = html.slice(iInicio, iFin);
if (!bloqueSrc || iInicio === -1) { console.error('No se pudo extraer el bloque real de index.html'); process.exit(1); }

function construirEntorno({ latenciaMs = 30 } = {}) {
  const putsRealizados = [];
  let putsEnVuelo = 0;
  let maxPutsSimultaneos = 0;
  let contadorVersion = 1;
  const SYS = {};

  function fetchSimulado(url, opts) {
    if (opts && opts.method === 'PUT') {
      putsEnVuelo++;
      maxPutsSimultaneos = Math.max(maxPutsSimultaneos, putsEnVuelo);
      const cuerpoEnviado = JSON.parse(opts.body);
      putsRealizados.push(cuerpoEnviado);
      return new Promise(resolve => {
        setTimeout(() => {
          putsEnVuelo--;
          contadorVersion++;
          resolve({
            ok: true, status: 200,
            json: async () => ({ updated_at: 'v' + contadorVersion }),
          });
        }, latenciaMs);
      });
    }
    // GET de merge de pendingAuthRequests (dentro de _saveDataToAPICore)
    return Promise.resolve({ ok: true, json: async () => ({ data: { SYS: { pendingAuthRequests: [] } } }) });
  }

  const sandbox = {
    fetch: fetchSimulado,
    _sbToken: 'token-de-prueba',
    currentUser: { id: 'u1' },
    BACKEND_URL: '',
    projects: [],
    SYS,
    activityLog: [],
    _normalizedProjectsLoaded: false,
    _normalizedActivityLoaded: false,
    _syncNormalizedProjectsHouses: async () => true,
    _syncNormalizedActivity: async () => true,
    confirm: () => { throw new Error('confirm() no debería llamarse en esta prueba (no hay 409 real)'); },
    console,
  };
  const fn = new Function(...Object.keys(sandbox), bloqueSrc + '\nreturn { saveDataToAPI, _saveDataToAPICore };');
  const exportado = fn(...Object.values(sandbox));
  return {
    ...exportado,
    SYS,
    putsRealizados,
    getMaxSimultaneos: () => maxPutsSimultaneos,
    getPutsEnVuelo: () => putsEnVuelo,
  };
}

(async () => {
  console.log('Bug #2 — cola de guardados (nunca más de un PUT en vuelo a la vez):');

  const env = construirEntorno({ latenciaMs: 40 });
  // Simula un primer guardado y luego un cambio REAL mientras ese PUT sigue en vuelo. Las llamadas
  // repetidas se coalescen, pero el guardado de seguimiento debe conservar el cambio nuevo.
  const resultados = [];
  resultados.push(env.saveDataToAPI());
  await new Promise(r => setTimeout(r, 5));
  env.SYS.changedWhileSaving = true;
  resultados.push(env.saveDataToAPI());
  resultados.push(env.saveDataToAPI());
  resultados.push(env.saveDataToAPI());
  resultados.push(env.saveDataToAPI());

  ok('nunca hay más de 1 PUT en vuelo al mismo tiempo (antes del fix, podían solaparse)',
    env.getMaxSimultaneos() <= 1, env.getMaxSimultaneos());

  await Promise.all(resultados);
  // Esperar un poco más por si quedó el guardado de seguimiento en curso
  await new Promise(r => setTimeout(r, 150));

  ok('de 5 llamadas casi simultáneas, no salieron 5 PUT reales (se coalescen)',
    env.putsRealizados.length < 5, env.putsRealizados.length);
  ok('pero tampoco se perdió el trabajo: salió al menos 1 guardado de seguimiento además del primero',
    env.putsRealizados.length >= 2, env.putsRealizados.length);
  ok('no queda ningún PUT en vuelo al terminar (todo se resolvió limpio)',
    env.getPutsEnVuelo() === 0);

  console.log('\nNinguno de los guardados de seguimiento llega con force:true (no lo heredan):');
  const conFuerza = env.putsRealizados.filter(b => b.force === true);
  ok('ninguna de las llamadas normales mandó force:true', conFuerza.length === 0, env.putsRealizados);

  console.log('\nUn solo guardado (caso normal, sin solapamiento) sigue funcionando igual que antes:');
  const env2 = construirEntorno({ latenciaMs: 10 });
  const ok1 = await env2.saveDataToAPI();
  ok('un guardado aislado devuelve true (éxito)', ok1 === true);
  ok('un guardado aislado hace exactamente 1 PUT', env2.putsRealizados.length === 1, env2.putsRealizados.length);

  console.log(`\n${pass} pruebas OK, ${fail} fallas`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Error en las pruebas:', e); process.exit(1); });
