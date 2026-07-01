# TEST-012 Integracion Oficial IGEPN, INPRES y Redes de Centroamerica

## Objetivo

Definir las verificaciones unitarias, tecnicas y funcionales para integrar
`IGEPN`, `INPRES`, `MARN`, `OVSICORI` e `INSIVUMEH` como fuentes oficiales o
institucionales regionales.

## Casos unitarios

| Id      | Caso                             | Resultado esperado                                   |
| ------- | -------------------------------- | ---------------------------------------------------- |
| UT-1201 | Parsear CSV oficial IGEPN        | Devuelve registros con coordenadas, magnitud y fecha |
| UT-1202 | Normalizar evento IGEPN          | `source=IGEPN`, pais Ecuador y estado oficial        |
| UT-1203 | Parsear XML oficial INPRES       | Devuelve items XML con `idSismo`                     |
| UT-1204 | Normalizar evento INPRES         | `source=INPRES`, hora local convertida a UTC         |
| UT-1205 | Parsear tabla HTML MARN          | Devuelve eventos con intensidad textual              |
| UT-1206 | Normalizar evento MARN           | `source=MARN`, coordenadas y profundidad correctas   |
| UT-1207 | Parsear marcadores OVSICORI      | Extrae `eqid`, coordenadas, magnitud y profundidad   |
| UT-1208 | Normalizar evento OVSICORI       | `reviewed` si el marcador indica revision            |
| UT-1209 | Parsear HTML Leaflet INSIVUMEH   | Extrae `ID`, `NST`, `RMS`, `GAP` y magnitud          |
| UT-1210 | Normalizar evento INSIVUMEH      | `source=INSIVUMEH`, enlace historico correcto        |
| UT-1211 | Prioridad regional Ecuador       | `IGEPN` supera a `USGS` en Ecuador                   |
| UT-1212 | Prioridad regional Argentina     | `INPRES` supera a `USGS` en Argentina                |
| UT-1213 | Prioridad regional Centroamerica | fuente local supera a `USGS` en su pais              |

## Casos tecnicos

| Id      | Verificacion     | Resultado esperado |
| ------- | ---------------- | ------------------ |
| VT-1201 | Build shared     | Sin errores        |
| VT-1202 | Typecheck worker | Sin errores        |
| VT-1203 | Typecheck API    | Sin errores        |
| VT-1204 | Typecheck web    | Sin errores        |
| VT-1205 | Test worker      | Sin errores        |
| VT-1206 | Build worker     | Sin errores        |
| VT-1207 | Build API        | Sin errores        |
| VT-1208 | Build web        | Sin errores        |

## Casos funcionales

| Id      | Verificacion                | Resultado esperado                                |
| ------- | --------------------------- | ------------------------------------------------- |
| VF-1201 | Ingesta real IGEPN          | Estado `success` y referencias persistidas        |
| VF-1202 | Ingesta real INPRES         | Estado `success` y referencias persistidas        |
| VF-1203 | Ingesta real MARN           | Estado `success`; puede insertar hasta 10 eventos |
| VF-1204 | Ingesta real OVSICORI       | Estado `success` si HTML mantiene estructura      |
| VF-1205 | Ingesta real INSIVUMEH      | Estado `success` o error aislado si TLS falla     |
| VF-1206 | Estado por fuente en API    | `/api/sources/status` lista las cinco fuentes     |
| VF-1207 | Persistencia de referencias | `event_source_refs` contiene registros por fuente |
| VF-1208 | Feed frontend               | marcas `EC`, `AR`, `SV`, `CR`, `GT` disponibles   |
| VF-1209 | Aislamiento de falla        | falla de una fuente no detiene las demas          |
