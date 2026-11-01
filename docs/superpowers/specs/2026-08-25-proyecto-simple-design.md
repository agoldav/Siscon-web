# Proyecto Simple (sin sub-tipos) — Diseño

## Problema

Hoy todo proyecto en Siscon se modela como **Tipos → Casas**: se definen uno o más tipos de
vivienda con su presupuesto de materiales, y cada casa se asigna a un tipo. Pero hay proyectos
que son una **cotización global única** para todo el proyecto — no hay varias casas, hay un solo
presupuesto. Forzar ese caso a crear un "Tipo" y una "Casa" ficticios es confuso para el usuario
y ensucia reportes/listas que asumen varias casas.

## Objetivo

Al crear un proyecto, el usuario elige entre:
- **Proyecto con Sub Tipos**: comportamiento actual, sin cambios.
- **Proyecto Simple**: un único presupuesto para todo el proyecto, sin pestañas de Tipos ni
  Lista de Casas, y sin el paso de "asignar a casa" en OC / Factura de Proveedor / Requisición.

## Arquitectura

**Enfoque: "casa oculta única".** Un Proyecto Simple mantiene, internamente, exactamente **1
`type`** (que la UI muestra como pestaña **Presupuesto**) y **1 `house`** que referencia ese tipo,
ambos creados automáticamente y nunca expuestos en listas ni selectores. Toda la lógica de
negocio existente (facturación por % de avance, recuperación financiera, garantías, avances de
subcontrato, cálculo de presupuesto/precio de venta/área/utilidad desde `houses`+`types`) sigue
funcionando sin cambios, alimentada por esa única casa/tipo en vez de varias.

Se descartó un modelo de datos paralelo (`project.presupuesto` independiente de `types`/`houses`
con ramas `if(mode==='simple')` duplicando cada función financiera) por duplicar y volver a
probar prácticamente todo el motor financiero de la app, con mucho más riesgo de regresiones.

**Única excepción:** el Gantt. En Proyecto Simple no deriva de casas — es una lista libre de
tareas con descripción editable, con su propio arreglo de datos (`project.ganttTasks`).

**Beneficio del enfoque:** el cambio de modo (ver más abajo) no requiere migrar datos reales —
solo mostrar/ocultar el tipo y la casa que ya existen.

## Modelo de datos

- `project.mode`: `'subtipos'` (default si el campo no existe — proyectos existentes) o
  `'simple'`.
- Proyecto Simple: al crearse, se generan automáticamente 1 `type` (vacío, sin categorías) y 1
  `house` con `typeId` apuntando a ese tipo. Ninguno de los dos se expone en listas/selectores
  de casas/tipos mientras `mode==='simple'`.
- `project.ganttTasks: [{id, desc, start, dur}]` — nuevo arreglo, solo usado en modo Simple;
  independiente de `houses`.

## Flujo de creación

1. Click en "+ Nuevo Proyecto" → prompt previo con dos botones: **"Crear Proyecto Simple"** /
   **"Crear Proyecto con Sub Tipos"**.
2. Formulario de datos generales (nombre, cliente, etc.) igual a hoy en ambos casos.
3. Si es Simple: al guardar se crean el tipo y la casa ocultos; el usuario cae directo en la
   pestaña **Presupuesto**.
4. **Presupuesto** reutiliza el mismo editor de categorías/líneas que hoy usa "Tipos", pero
   editando directamente el único tipo (sin lista intermedia de tipos).
5. Presupuesto / Precio de Venta / Área / % Utilidad de "Información General" se calculan con la
   misma fórmula que ya suma desde `houses`+`types` hoy — sin lógica nueva, porque solo hay 1
   casa/tipo.

## Comportamiento por pestaña (Proyecto Simple)

| Pestaña | Comportamiento |
|---|---|
| Tipos / Lista de Casas | No aparecen. |
| Presupuesto (nueva) | Reemplaza a Tipos; edita el único tipo oculto. |
| OC | Sin selector de casas ni "+ Agregar Casa"; se llena directo con las líneas del Presupuesto (equivalente a la vista "Resumen" que ya existe hoy en OC, como única vista). |
| Factura de Proveedor | Sin botón "Asignar" por línea; cada línea se asigna automáticamente 100% a la casa oculta. |
| Requisición | Sin selector de "Casas incluidas"; trabaja directo contra presupuesto/bodega del proyecto. |
| Factura a Cliente | Se factura por % de avance del proyecto completo (global) en vez de elegir casas — reetiquetado, misma mecánica interna. |
| Garantías | Se registran a nivel de proyecto (sin selector de casa) — reetiquetado. |
| Calculadora de Avances de Subcontratistas | Avance global del proyecto (sin selector de casa) — reetiquetado. |
| Lista de Materiales | Igual a hoy: presupuestado vs. comprado, línea por línea. |
| Bodega | Igual a hoy: inventario general del proyecto. |
| Gantt | Empieza en blanco; el usuario agrega líneas manualmente con descripción editable (`project.ganttTasks`), no deriva de casas. |
| Documentos / Bitácora / Tareas / Mapa | Sin cambios; en Bitácora simplemente no se muestra el campo "Casa" (ya es opcional hoy). |

## Cambio de modo (con contraseña de administrador)

- Botón "Cambiar modo de proyecto" (Información General o menú ⋮), visible solo para Admin,
  pide contraseña de supervisor — mismo mecanismo que "Eliminar proyecto".
- **Simple → Sub Tipos**: siempre permitido. Se revelan Tipos/Lista de Casas; el tipo y casa
  ocultos pasan a estar visibles y editables.
- **Sub Tipos → Simple**: solo permitido si el proyecto tiene ≤1 tipo y ≤1 casa. Si tiene más,
  el botón explica por qué no se puede en vez de ejecutar el cambio.
- Gantt no se migra entre modos: al pasar a Sub Tipos, `ganttTasks` deja de usarse (Gantt vuelve
  a ser por casa); al pasar a Simple, `ganttTasks` inicia vacío.

## Casos borde

- Proyectos existentes sin `mode`: se tratan como `'subtipos'`, cero impacto.
- Reportes/Dashboard que iteran `houses.length` o listan casas por proyecto: siguen funcionando
  igual (mostrarán 1 casa oculta) — sin cambios en esta iteración.
- Validación de "Solicitud de material fuera de lista": sigue igual, comparando contra el
  presupuesto único en vez del tipo de una casa específica — sin cambio de comportamiento
  visible.

## Fuera de alcance

- No se migra el Gantt entre modos.
- No se ajusta el Dashboard/reportes para ocultar el conteo de "1 casa" en proyectos Simple.
- No se resuelve automáticamente qué pasa si el usuario intenta Sub Tipos → Simple con más de
  1 casa/tipo — simplemente se bloquea con mensaje.
