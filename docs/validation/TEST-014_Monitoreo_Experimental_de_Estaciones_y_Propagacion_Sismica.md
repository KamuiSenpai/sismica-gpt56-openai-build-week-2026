# TEST-014 Monitoreo Experimental de Estaciones y Propagacion Sismica

## Estado

Ejecutado y aprobado el 30 de junio de 2026 (America/Lima).

## Objetivo

Verificar el cumplimiento de `SDD-014` en parser FDSN, persistencia, seguridad
del adaptador, API, SSE, modelo de propagacion y visualizacion CesiumJS.

## Casos unitarios

| Id      | Caso                           | Resultado esperado                             |
| ------- | ------------------------------ | ---------------------------------------------- |
| UT-1401 | Parsear FDSN station text      | Normaliza filas validas por nombre de columna  |
| UT-1402 | Rechazar coordenadas invalidas | No genera estacion                             |
| UT-1403 | Validar snapshot               | Acepta contrato v1 y rechaza estados invalidos |
| UT-1404 | Secuencia monotona             | Estado antiguo no reemplaza el vigente         |
| UT-1405 | Idempotencia de picks          | Mismo `pickId` produce una sola fila           |
| UT-1406 | Calcular radio P/S             | Usa hora de origen, profundidad y velocidad    |
| UT-1407 | Evento antiguo                 | No reinicia propagacion al seleccionar         |
| UT-1408 | Validar origen experimental    | Aplica limites y estaciones minimas            |

## Casos de integracion

| Id      | Caso                     | Resultado esperado                      |
| ------- | ------------------------ | --------------------------------------- |
| IT-1401 | Migracion                | Crea tablas, restricciones e indices    |
| IT-1402 | Doble importacion        | Cero duplicados de estacion             |
| IT-1403 | Snapshot autenticado     | Persiste estado y pick                  |
| IT-1404 | Token incorrecto         | `401`, cero cambios                     |
| IT-1405 | Token ausente en entorno | `503`, cero cambios                     |
| IT-1406 | Origen experimental      | Persiste fuera de `seismic_events`      |
| IT-1407 | SSE                      | Entrega `station.state` con id monotono |

## Casos funcionales

| Id      | Caso                | Resultado esperado                       |
| ------- | ------------------- | ---------------------------------------- |
| VF-1401 | Smoke GEOFON FDSN   | Respuesta real con estaciones parseables |
| VF-1402 | GET `/api/stations` | Lista y filtros correctos                |
| VF-1403 | POST snapshot       | Conteos accepted/ignored correctos       |
| VF-1404 | Reingesta de pick   | Sin duplicidad                           |
| VF-1405 | POST origen         | No aparece en feed oficial               |
| VF-1406 | Stream SSE          | Cambio recibido sin recargar             |
| VF-1407 | Capa Cesium         | Triangulos visibles y conmutables        |
| VF-1408 | Frente P/S          | Posicion temporal coherente con origen   |

## Validacion visual

| Id      | Vista                 | Criterio                                 |
| ------- | --------------------- | ---------------------------------------- |
| VV-1401 | Escritorio 1440x900   | Estaciones, feed y leyendas sin colision |
| VV-1402 | Escritorio 1920x1080  | Globo y paneles conservan jerarquia      |
| VV-1403 | Movil 390x844         | Sin desbordamiento ni texto ilegible     |
| VV-1404 | Capa oculta           | Viewer conserva encuadre y rendimiento   |
| VV-1405 | Estacion seleccionada | Detalle no tapa controles principales    |

## Gates tecnicos

| Id      | Comando o verificacion | Resultado                 |
| ------- | ---------------------- | ------------------------- |
| VT-1401 | Typecheck shared       | Sin errores               |
| VT-1402 | Typecheck worker       | Sin errores               |
| VT-1403 | Typecheck API          | Sin errores               |
| VT-1404 | Typecheck web          | Sin errores               |
| VT-1405 | Tests automatizados    | Cero fallas               |
| VT-1406 | Build completo         | Sin errores               |
| VT-1407 | `git diff --check`     | Sin errores de whitespace |

## Evidencia requerida

1. Salida de comandos.
2. Conteos de base de datos.
3. Respuesta de smoke FDSN.
4. Evidencia de autenticacion negativa.
5. Capturas de escritorio y movil.
6. Registro de limitaciones o casos no ejecutables.

## Resultado de ejecucion

| Grupo             | Resultado | Evidencia                                                               |
| ----------------- | --------- | ----------------------------------------------------------------------- |
| UT-1401 a UT-1408 | Aprobado  | 46 pruebas automatizadas: 39 worker, 4 API y 3 web                      |
| IT-1401           | Aprobado  | Migraciones `001` a `006` aplicadas dos veces sin error                 |
| IT-1402           | Aprobado  | 82 estaciones almacenadas; segundo refresco omitido por ventana de 24 h |
| IT-1403, IT-1404  | Aprobado  | Snapshot `1/0/1`; token incorrecto `401`                                |
| IT-1405           | Aprobado  | API sin token configurado respondio `503`                               |
| IT-1406           | Aprobado  | Origen experimental persistido y feed oficial sin cambios               |
| IT-1407           | Aprobado  | SSE recibido como `station.state`, estacion y secuencia correctas       |
| VF-1401           | Aprobado  | Consulta real GEOFON FDSN: 82 estaciones `GE` activas                   |
| VF-1402 a VF-1408 | Aprobado  | API, monotonia, idempotencia, aislamiento y propagacion verificados     |
| VV-1401           | Aprobado  | `output/playwright/station-monitor-desktop-final.png`                   |
| VV-1402           | Aprobado  | `output/playwright/station-monitor-wide.png`                            |
| VV-1403           | Aprobado  | `output/playwright/station-monitor-mobile-final.png`                    |
| VV-1404           | Aprobado  | Control oculto/visible ejercitado mediante Playwright                   |
| VV-1405           | Aprobado  | `output/playwright/station-detail-mobile-final.png`                     |
| VT-1401 a VT-1407 | Aprobado  | Typecheck, tests, build y `git diff --check` sin fallas                 |

La lectura directa del framebuffer WebGL no es util con
`preserveDrawingBuffer=false`; por ello se valido la captura del area Cesium.
De 3.102 muestras, 2.868 fueron no negras (92,5 %), y la inspeccion visual
confirmo globo, imagenes, entidades y controles renderizados.

## Observaciones

1. La prueba uso GEOFON `GE`; integrar streams del IGP requiere un canal
   documentado o coordinacion institucional.
2. El modulo sigue siendo experimental y no produce alertas oficiales.

## Addendum operacional

Addendum ejecutado el 30 de junio de 2026 (`America/Lima`) y corroborado
tecnicamente el 1 de julio de 2026 UTC para cerrar el modo operacional del
monitor experimental.

### Casos del addendum

| Id      | Caso                                  | Resultado esperado                                |
| ------- | ------------------------------------- | ------------------------------------------------- |
| AO-1401 | GET `/api/experimental-origins`       | Respuesta REST con `items` y `count`              |
| AO-1402 | Capa web de epicentros experimentales | Marcador, toggle y leyenda operativos             |
| AO-1403 | Build shared                          | `npm run build -w packages/shared` sin errores    |
| AO-1404 | Typecheck y lint                      | `npm run typecheck` y `npm run lint` sin errores  |
| AO-1405 | Migracion + motor experimental        | `db:migrate` aplicado y ciclo del motor publicado |
| AO-1406 | Build web                             | `npm run build -w apps/web` sin errores           |
| AO-1407 | Tests automatizados                   | API, worker y web sin fallas                      |

### Resultado del addendum

| Id      | Resultado | Evidencia                                                                                                                                                            |
| ------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AO-1401 | Aprobado  | `GET /api/experimental-origins?hours=72&limit=10` respondio `count=10` y `generatedAt=2026-07-01T04:40:42.132Z`                                                      |
| AO-1402 | Aprobado  | `MapPanel` renderiza la capa `Epicentros exp.` con tooltip, toggle y leyenda                                                                                         |
| AO-1403 | Aprobado  | `npm run build -w packages/shared` completo                                                                                                                          |
| AO-1404 | Aprobado  | `npm run typecheck` y `npm run lint` completos                                                                                                                       |
| AO-1405 | Aprobado  | `npm run db:migrate` aplico `001` a `006`; `RUN_ONCE=true SEISMIC_ENGINE_ENABLED=true npx tsx apps/worker/src/index.ts` publico `origins=6`, `triggered stations=31` |
| AO-1406 | Aprobado  | `npm run build -w apps/web` completo                                                                                                                                 |
| AO-1407 | Aprobado  | `npm test -w apps/api` 4/4, `npm test -w apps/worker` 41/41, `npm test -w apps/web` 3/3                                                                              |
