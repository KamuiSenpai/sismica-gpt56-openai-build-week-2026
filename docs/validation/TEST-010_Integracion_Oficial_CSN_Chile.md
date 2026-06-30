# TEST-010 Integracion Oficial CSN Chile

## Objetivo

Definir las verificaciones unitarias, tecnicas y funcionales para la
integracion del `CSN` como fuente oficial de Chile.

## Casos unitarios

| Id      | Caso                                         | Resultado esperado                                       |
| ------- | -------------------------------------------- | -------------------------------------------------------- |
| UT-1001 | Extraer informes recientes desde portada CSN | Se obtienen rutas e identificadores validos              |
| UT-1002 | Parsear detalle oficial CSN                  | UTC, coordenadas, profundidad, magnitud y tipo correctos |
| UT-1003 | Normalizar evento oficial CSN                | `source`, `title` y URL oficial correctos                |
| UT-1004 | Prioridad regional Chile                     | `CSN` supera a `USGS` en Chile                           |

## Casos tecnicos

| Id      | Verificacion     | Resultado esperado |
| ------- | ---------------- | ------------------ |
| VT-1001 | Build shared     | Sin errores        |
| VT-1002 | Typecheck worker | Sin errores        |
| VT-1003 | Typecheck API    | Sin errores        |
| VT-1004 | Typecheck web    | Sin errores        |
| VT-1005 | Test worker      | Sin errores        |
| VT-1006 | Build worker     | Sin errores        |
| VT-1007 | Build API        | Sin errores        |
| VT-1008 | Build web        | Sin errores        |

## Casos funcionales

| Id      | Verificacion                | Resultado esperado                                                            |
| ------- | --------------------------- | ----------------------------------------------------------------------------- |
| VF-1001 | Ingesta real CSN            | Estado `success` y al menos un evento reciente persistido                     |
| VF-1002 | Estado por fuente en API    | `/api/sources/status` lista `CSN`                                             |
| VF-1003 | Persistencia de referencias | `event_source_refs` contiene registros `CSN`                                  |
| VF-1004 | Feed frontend               | `CSN` usa marcador `CL`                                                       |
| VF-1005 | Enlace oficial              | `sourceUrl` apunta al informe oficial `sismologia.cl/sismicidad/informes/...` |
