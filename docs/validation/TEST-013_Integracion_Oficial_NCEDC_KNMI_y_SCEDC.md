# TEST-013 Integracion Oficial NCEDC, KNMI y SCEDC

## Objetivo

Definir las verificaciones unitarias, tecnicas y funcionales para integrar
`NCEDC`, `KNMI` y `SCEDC` usando el provider FDSN reutilizable.

## Casos unitarios

| Id      | Caso                            | Resultado esperado                           |
| ------- | ------------------------------- | -------------------------------------------- |
| UT-1301 | Parsear FDSN text estandar      | Registros validos por cabecera `EventID`     |
| UT-1302 | Normalizar FDSN KNMI            | Conserva `EventType` y UTC correcto          |
| UT-1303 | Parsear variante SCEDC          | Tolera pie `# of events : N`                 |
| UT-1304 | Normalizar variante SCEDC       | Convierte slashes y `Longtitude`             |
| UT-1305 | Fallback de `providerEventCode` | Usa `EventID` si `ContributorID` viene vacio |

## Casos tecnicos

| Id      | Verificacion     | Resultado esperado |
| ------- | ---------------- | ------------------ |
| VT-1301 | Build shared     | Sin errores        |
| VT-1302 | Typecheck worker | Sin errores        |
| VT-1303 | Typecheck API    | Sin errores        |
| VT-1304 | Typecheck web    | Sin errores        |
| VT-1305 | Test worker      | Sin errores        |
| VT-1306 | Build completo   | Sin errores        |

## Casos funcionales

| Id      | Verificacion          | Resultado esperado                                            |
| ------- | --------------------- | ------------------------------------------------------------- |
| VF-1301 | Fetch real NCEDC      | Al menos un registro o respuesta valida en ventana corta      |
| VF-1302 | Fetch real KNMI       | Al menos un registro o respuesta valida                       |
| VF-1303 | Fetch real SCEDC      | Respuesta valida con variante de fecha                        |
| VF-1304 | Estado API por fuente | `/api/sources/status` lista `NCEDC`, `KNMI`, `SCEDC`          |
| VF-1305 | Integracion al panel  | Las fuentes pueden aparecer en `sources: ...` tras asociacion |
