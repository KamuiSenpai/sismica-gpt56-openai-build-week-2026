# TEST-009 Integracion Oficial SSN Mexico

## Objetivo

Definir las verificaciones unitarias, tecnicas y funcionales para la
integracion del `SSN` como fuente oficial de Mexico.

## Casos unitarios

| Id     | Caso                        | Resultado esperado                                            |
| ------ | --------------------------- | ------------------------------------------------------------- |
| UT-901 | Normalizar item RSS del SSN | Magnitud, ubicacion, UTC, coordenadas y profundidad correctas |
| UT-902 | Prioridad regional Mexico   | `SSN` supera a `USGS` en Mexico                               |

## Casos tecnicos

| Id     | Verificacion     | Resultado esperado |
| ------ | ---------------- | ------------------ |
| VT-901 | Build shared     | Sin errores        |
| VT-902 | Typecheck worker | Sin errores        |
| VT-903 | Typecheck API    | Sin errores        |
| VT-904 | Typecheck web    | Sin errores        |
| VT-905 | Test worker      | Sin errores        |
| VT-906 | Build worker     | Sin errores        |
| VT-907 | Build API        | Sin errores        |
| VT-908 | Build web        | Sin errores        |

## Casos funcionales

| Id     | Verificacion                | Resultado esperado                                                |
| ------ | --------------------------- | ----------------------------------------------------------------- |
| VF-901 | Ingesta real SSN            | Estado `success` y al menos un evento reciente persistido         |
| VF-902 | Estado por fuente en API    | `/api/sources/status` lista `SSN`                                 |
| VF-903 | Persistencia de referencias | `event_source_refs` contiene registros `SSN`                      |
| VF-904 | Feed frontend               | `SSN` usa marcador `MX`                                           |
| VF-905 | Enlace oficial              | `sourceUrl` apunta al detalle oficial `localizacion-de-sismo.jsp` |
