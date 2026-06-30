# TEST-011 Integracion Oficial INGV Italia

## Objetivo

Definir las verificaciones unitarias, tecnicas y funcionales para la
integracion del `INGV` como fuente oficial de Italia.

## Casos unitarios

| Id      | Caso                                        | Resultado esperado                                        |
| ------- | ------------------------------------------- | --------------------------------------------------------- |
| UT-1101 | Formatear fecha FDSN INGV                   | El timestamp queda como `YYYY-MM-DDThh:mm:ss` sin `Z`     |
| UT-1102 | Generar ventanas diarias UTC                | Se cubre `SOURCE_WINDOW_HOURS` sin perder dias requeridos |
| UT-1103 | Normalizar evento oficial INGV              | `source`, `title` y enlace oficial correctos              |
| UT-1104 | Filtrar evento fuera de la region operativa | Se descarta el registro                                   |
| UT-1105 | Prioridad regional Italia                   | `INGV` supera a `USGS` en Italia                          |

## Casos tecnicos

| Id      | Verificacion     | Resultado esperado |
| ------- | ---------------- | ------------------ |
| VT-1101 | Build shared     | Sin errores        |
| VT-1102 | Typecheck worker | Sin errores        |
| VT-1103 | Typecheck API    | Sin errores        |
| VT-1104 | Typecheck web    | Sin errores        |
| VT-1105 | Test worker      | Sin errores        |
| VT-1106 | Build worker     | Sin errores        |
| VT-1107 | Build API        | Sin errores        |
| VT-1108 | Build web        | Sin errores        |

## Casos funcionales

| Id      | Verificacion                | Resultado esperado                                               |
| ------- | --------------------------- | ---------------------------------------------------------------- |
| VF-1101 | Ingesta real INGV           | Estado `success` y eventos recientes persistidos                 |
| VF-1102 | Estado por fuente en API    | `/api/sources/status` lista `INGV`                               |
| VF-1103 | Persistencia de referencias | `event_source_refs` contiene registros `INGV`                    |
| VF-1104 | Feed frontend               | `INGV` usa marcador `IT`                                         |
| VF-1105 | Enlace oficial              | `sourceUrl` apunta a `terremoti.ingv.it/event/{id}?timezone=UTC` |
