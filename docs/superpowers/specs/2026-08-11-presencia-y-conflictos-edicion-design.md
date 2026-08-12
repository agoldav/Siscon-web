# Presencia y aviso de conflictos de edición concurrente — Facturas de Proveedor y OC

## Contexto y motivación

El 2026-08-11 se investigó por qué un cambio de nombre de material en un Tipo de vivienda
no persistía. Se encontraron y arreglaron dos bugs reales:

1. `saveData()` bloqueaba silenciosamente el guardado en la nube cuando `localStorage`
   estaba lleno (el reintento sin `pdfBase64` no tenía su propio `try/catch`, y la
   excepción escapaba antes de llamar `saveDataToAPI()`).
2. Los diálogos de conflicto de versión (409) tenían el camino destructivo
   ("sobrescribir") activado por defecto al presionar Cancelar/Escape — ya se corrigió
   para que Cancelar nunca sobrescriba sin una segunda confirmación explícita.

Durante las pruebas, el usuario tuvo varias pestañas/sesiones abiertas a la vez
(administrador + usuario regular), y un guardado automático en segundo plano
(sincronización de QuickBooks) disparó el diálogo de conflicto de forma confusa —
aunque nadie estaba editando activamente ese documento. Esto reveló un problema de
fondo: el sistema no distingue entre "una escritura automática de fondo" y "dos
personas editando el mismo documento a la vez", y no hay forma de saber quién tiene
un documento abierto en este momento.

Este documento diseña ese mecanismo, con alcance inicial limitado a **Facturas de
Proveedor y Órdenes de Compra (OC)** — los dos tipos de documento donde surgió el
problema y donde además hay sincronización automática de QuickBooks escribiendo sobre
las mismas filas que un usuario puede estar editando.

## Objetivo

- Las escrituras automáticas de fondo (sync de QuickBooks cada 5 min, polling de
  Outlook cada 2 min, guardados de otros documentos) nunca deben interrumpir ni avisar
  al usuario — se resuelven solas.
- Solo se avisa cuando **dos personas** tienen el **mismo documento** abierto para
  editar al mismo tiempo, identificando a la otra persona por su nombre.
- El aviso ocurre en dos momentos: al **abrir** un documento que otra persona ya tiene
  abierto (informativo, no bloqueante), y al **guardar** mientras otra persona sigue
  presente (con confirmación explícita antes de sobrescribir).
- Cuando alguien guarda mientras otra persona sigue editando ese mismo documento, esa
  otra persona recibe una notificación dirigida avisándole que hay una versión nueva.

## Fuera de alcance (por ahora)

- Otros tipos de documento (Facturas a Cliente, Tipos de vivienda, Casas, Garantías,
  Bitácora, Proyecto). Se extenderá después de validar que esto funciona bien con
  Facturas de Proveedor y OC.
- Fusión campo por campo de cambios simultáneos (real-time merge tipo Google Docs).
  Se acepta el trade-off descrito abajo en vez de construir esto.
- WebSockets / infraestructura de tiempo real. Se reutiliza el polling de 15s que ya
  existe en producción (`pollPendingAuth`).
- Notificaciones "push" fuera de la app (email, WhatsApp, etc.) — se usa el centro de
  notificaciones que ya existe.

## Diseño

### 1. Modelo de datos: tabla `document_presence`

Tabla nueva en Supabase, minimalista:

```sql
create table document_presence (
  id           text primary key default gen_id(),
  table_name   text not null,        -- 'transactions' (facturas de proveedor y OC viven ahí)
  record_id    text not null,
  user_id      uuid not null references profiles(id),
  last_seen_at timestamptz not null default now(),
  unique(table_name, record_id, user_id)
);
```

No se guarda el nombre del usuario en esta tabla — se resuelve del lado del cliente
contra `SYS.users` (ya cargado en memoria), para no duplicar ni desincronizar el
nombre.

Rutas nuevas y dedicadas en el backend (no la CRUD genérica — se necesita upsert real,
que la factory genérica no soporta):

- `POST /api/db/presence/heartbeat` — body `{table_name, record_id}`. El `user_id` lo
  determina el token de autenticación, nunca el cliente. Inserta o actualiza
  `last_seen_at`. Como efecto secundario, borra cualquier fila de la tabla con
  `last_seen_at` de más de 5 minutos de antigüedad (limpieza oportunista, sin cron
  aparte — ver sección 2).
- `GET /api/db/presence` — trae todas las filas activas. La tabla es chica (a lo
  sumo un puñado de filas a la vez); se filtra por antigüedad del lado del cliente.
- `DELETE /api/db/presence` — body `{table_name, record_id}`. Salida explícita al
  cerrar un documento.

Política de acceso: `any` (cualquier usuario autenticado puede leer/escribir/borrar
cualquier fila), igual que otras tablas compartidas de la app (notificaciones,
catálogos). No se restringe a "solo tu propia fila" — es una simplificación aceptada:
el peor caso es que alguien borre la presencia de otro por error/bug, lo cual como
mucho causa que un aviso no aparezca (inconveniente de UX), nunca pérdida de datos.

### 2. Ciclo de vida de la presencia

- **Al abrir** una Factura de Proveedor u OC para editar: heartbeat inmediato (no
  espera el siguiente ciclo de polling).
- **Mientras sigue abierta**: se reaprovecha el `setInterval` de 15s que ya existe en
  producción (`pollPendingAuth`, hoy usado para autorizaciones pendientes y
  notificaciones) para reenviar el heartbeat de cualquier documento que la sesión
  tenga abierto.
- **Ventana de actividad**: una fila cuenta como "presencia activa" si
  `last_seen_at` es de los últimos **40 segundos** (~2-3 ciclos de 15s; tolera un tick
  perdido por una red lenta).
- **Al cerrar** la ventana flotante (✕, Cancelar, o justo después de Guardar): salida
  explícita vía `DELETE`.
- **Si el navegador se cierra de golpe** (crash, cierre accidental, se cae la
  conexión) sin pasar por el cierre explícito: la fila simplemente deja de recibir
  heartbeats. Dentro de los 40 segundos deja de contar como "activa" para efectos de
  avisos — nadie queda bloqueado indefinidamente.
- **Limpieza de filas viejas**: cada llamada a `heartbeat` (que ocurre cada 15s desde
  cualquier sesión con un documento abierto) de paso borra filas de más de 5 minutos
  de antigüedad. No hace falta una tarea programada aparte: mientras la app esté en
  uso normal, la limpieza ocurre sola como efecto secundario de algo que ya pasa
  constantemente.

### 3. Aviso al abrir un documento

Al abrir un documento, en paralelo:

1. Se registra la propia presencia (heartbeat inmediato).
2. Se consulta si alguien más (activo, distinto al usuario actual) ya está en ese
   mismo documento.

Si lo hay, aparece un banner **informativo y no bloqueante** arriba del formulario:

> "Abraham Goldberg está trabajando en este documento ahora mismo. Si guardas
> cambios, vas a sobrescribir su trabajo — mejor espera a que termine o coordina con
> él."

El usuario puede seguir editando de todos modos si lo necesita; el sistema avisa, no
impide.

### 4. Qué pasa al hacer clic en "Guardar"

Antes del guardado real, se revisa la presencia de ese documento (excluyendo al
usuario actual):

- **Si alguien más activo está presente** → aparece un diálogo de confirmación
  explícito: *"Abraham Goldberg está trabajando en este mismo documento. ¿Deseas
  guardar de todos modos?"* con **Cancelar** (no hace nada, seguro) y **Guardar de
  todos modos** (fuerza el guardado directo, sin pasar por el chequeo de versión de
  abajo — ya se avisó, ya se decidió).
- **Si nadie más está presente** → se guarda normal. Si en ese instante el guardado
  choca de versión (por ejemplo, porque QuickBooks sincronizó segundos antes), se
  resuelve **en silencio**: se toma la versión más reciente del servidor y se
  reintenta con los cambios del usuario, sin preguntar nada.

  Trade-off aceptado explícitamente: este reintento silencioso puede, en el peor
  caso, pisar momentáneamente un campo que QuickBooks acababa de actualizar (por
  ejemplo, saldo pendiente o estado de pago). No es pérdida permanente — QuickBooks
  vuelve a sincronizar cada 5 minutos y corrige cualquier diferencia en el siguiente
  ciclo. Se elige este trade-off en vez de construir una fusión campo por campo,
  desproporcionada para el tamaño de este equipo.

  Además: para Facturas de Proveedor importadas de QuickBooks, el propio código de
  sincronización (`qboBillLinesForSlice`) ya preserva la asignación de material a
  casas (`assign`) emparejando por el ID interno de línea de QuickBooks
  (`qboLineId`), incluso cuando QuickBooks reescribe precio/cantidad/descripción en
  cada sync. La asignación de materiales no se pierde por un sync automático, salvo
  el caso raro de que una línea cambie de ID en QuickBooks.

Este chequeo de presencia reemplaza, para Facturas de Proveedor y OC, al diálogo
genérico de conflicto de versión que existe hoy (`_handleRowConflict`) — ese diálogo
ya no debería dispararse en el flujo normal para estos dos tipos de documento (ver
casos límite).

El chequeo se aplica a **cualquier acción que persista el documento**, sin importar
qué botón la dispare — incluye las variantes de la OC ("Guardar y Cerrar", "Guardar y
Enviar", "Guardar y Descargar"), no solo el botón principal. Se implementa en el
punto común donde el formulario efectivamente escribe el documento, no repetido por
cada botón.

### 5. Notificación al otro usuario cuando alguien guarda

Justo después de un guardado exitoso, si había otra persona con presencia activa en
ese documento (haya forzado el guardado o no), se crea una notificación **dirigida
solo a esa persona** (no a todo el equipo):

> "Abraham Goldberg guardó una nueva versión de la Factura de Proveedor
> FP-QB-00100001010000313147."

Con enlace directo al documento, reutilizando el patrón "Ver →" que ya existe en el
centro de notificaciones.

**Cambio necesario en la infraestructura existente:** hoy `addNotif(msg, link)`
siempre crea notificaciones con `user_id: null` (para todo el equipo). La columna
`notifications.user_id` ya soporta un destinatario específico según el esquema de la
base de datos, pero el código nunca la usa así. Se necesita:

- Una variante de `addNotif` que acepte un `user_id` destinatario específico.
- Filtrar en el cliente (`notifLoad`/`updateNotifBadge`/`renderNotifList`) para que
  una notificación dirigida solo le aparezca a esa persona, no a todo el mundo. La
  ruta `GET /api/db/notifications` no filtra por destinatario en el servidor — el
  filtro debe aplicarse al recibir los datos en el frontend.

La otra persona ve la notificación en su badge/panel dentro de los próximos 15
segundos (mismo ciclo de polling), sin necesidad de recargar la página.

### 6. Casos límite

- **Dos personas abren el documento casi al mismo instante**: puede que ninguna vea
  el banner de aviso al abrir (ventana de carrera de ~1 segundo entre el heartbeat y
  la consulta). No es grave — el chequeo de presencia al **guardar** es el que
  realmente protege, porque ocurre justo antes de escribir y no tiene esa ventana de
  carrera práctica.
- **Alguien fuerza el guardado a pesar del aviso, y justo en ese instante también hay
  un cambio real de QuickBooks**: se guarda igual (forzar gana sobre todo), y el dato
  de QuickBooks se corrige solo en el siguiente ciclo de sync. Mismo trade-off de la
  sección 4.
- **El diálogo de conflicto de versión genérico (409) todavía puede aparecer** en un
  caso raro: si la propia sesión estuvo con la pestaña dormida/en segundo plano por
  más de 40 segundos sin mandar heartbeat, y en ese lapso alguien más editó, guardó y
  ya se fue — la presencia de ambos ya expiró para cuando se intenta guardar, pero la
  versión sí cambió. Cuando pasa, se ve el diálogo de conflicto ya mejorado (con la
  doble confirmación segura de 2026-08-11), como red de seguridad de último recurso.
- **La tabla `document_presence` queda vacía/sin filas la primera vez que se usa esta
  función**: comportamiento normal, ningún aviso se dispara hasta que haya presencia
  real registrada.

## Testing

- Prueba manual con dos sesiones simultáneas (dos navegadores o uno normal + uno
  privado), una Factura de Proveedor de prueba:
  - Abrir en sesión A, luego abrir la misma en sesión B → B debe ver el banner con el
    nombre de A.
  - A guarda → B debe recibir la notificación dirigida dentro de ~15s.
  - B intenta guardar después → debe ver el diálogo de confirmación con el nombre de
    A antes de que el guardado se complete.
  - B cancela → nada se sobrescribe. B guarda de todos modos → se sobrescribe, A no
    recibe ningún aviso adicional (ya se le notificó cuando guardó él primero — no se
    duplica).
- Prueba de expiración: abrir un documento, cerrar la pestaña del navegador sin usar
  el botón de cerrar (simulando un crash), verificar que la presencia deja de contar
  como activa a los ~40 segundos en otra sesión.
- Prueba del trade-off de sync silencioso: con la sincronización de QuickBooks activa
  y un documento importado de QBO, editar y guardar sin que nadie más tenga el
  documento abierto — confirmar que no aparece ningún diálogo aunque QuickBooks haya
  escrito sobre la misma fila recientemente.
