# TEST-008 Integracion Oficial SGC Colombia e IGN Espana

## Objetivo

Definir las verificaciones unitarias, tecnicas y funcionales para la
integracion de `SGC` e `IGN`.

## Casos unitarios

| Id     | Caso                                         | Resultado esperado                                                |
| ------ | -------------------------------------------- | ----------------------------------------------------------------- |
| UT-801 | Extraer `dias3` desde `terremotos.js` de IGN | Se obtiene una `FeatureCollection` valida                         |
| UT-802 | Normalizar evento oficial IGN                | `eventTimeUtc`, magnitud, coordenadas y URL oficial correctos     |
| UT-803 | Normalizar evento oficial SGC                | Corrige orden `lat, lon, depth` y convierte `updated` local a UTC |
| UT-804 | Prioridad regional Colombia                  | `SGC` supera a `USGS` en Colombia                                 |
| UT-805 | Prioridad regional Espana                    | `IGN` supera a `USGS` en Espana                                   |

## Casos tecnicos

| Id     | Verificacion     | Resultado esperado |
| ------ | ---------------- | ------------------ |
| VT-801 | Build shared     | Sin errores        |
| VT-802 | Typecheck worker | Sin errores        |
| VT-803 | Typecheck API    | Sin errores        |
| VT-804 | Typecheck web    | Sin errores        |
| VT-805 | Build worker     | Sin errores        |
| VT-806 | Build API        | Sin errores        |
| VT-807 | Build web        | Sin errores        |

## Casos funcionales

| Id     | Verificacion             | Resultado esperado                                        |
| ------ | ------------------------ | --------------------------------------------------------- |
| VF-801 | Ingesta real SGC         | Estado `success` y al menos un evento reciente persistido |
| VF-802 | Ingesta real IGN         | Estado `success` y al menos un evento reciente persistido |
| VF-803 | Estado por fuente en API | `/api/sources/status` lista `SGC` e `IGN`                 |
| VF-804 | URL oficial SGC          | `sourceUrl` apunta a `detallesismo/{id}`                  |
| VF-805 | URL oficial IGN          | `sourceUrl` apunta a `getDetails?evid=...`                |
| VF-806 | Feed frontend            | Marcadores cortos sin colision `IGN` / `IGP`              |
| VF-807 | Actualizacion automatica | El worker genera nuevas corridas sin ejecucion manual     |
