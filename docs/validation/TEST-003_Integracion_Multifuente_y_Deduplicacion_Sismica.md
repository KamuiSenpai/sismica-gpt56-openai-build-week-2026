# TEST-003 Integracion Multifuente y Deduplicacion Sismica

## Estado

Ejecutado satisfactoriamente el 30 de junio de 2026.

## Base documental

1. `docs/specs/SDD-003_Integracion_Multifuente_y_Deduplicacion_Sismica.md`
2. `docs/validation/VALIDATION-003_Integracion_Multifuente_y_Deduplicacion_Sismica.md`

## Comando

```powershell
npm test -w apps/worker
```

## Cobertura ejecutada

1. Parametros tecnicos de USGS.
2. Normalizacion GeoJSON de EMSC.
3. Combinacion de fecha y hora UTC de IGP/CENSIS.
4. Conversion de hora local UTC-4 e identificador estable de FUNVISIS.
5. Separacion de contexto GDACS.
6. Parser CAP-TSU de NOAA.
7. Prioridad regional de fuentes para Peru y Venezuela.
8. Limites estrictos de tiempo, distancia y magnitud para deduplicacion.

## Resultado

```text
tests: 8
passed: 8
failed: 0
skipped: 0
duration: 327.3346 ms
```

## Criterio de salida

Conforme. Los normalizadores y reglas puras criticas de la integracion
multi-fuente superan la ejecucion automatizada.

## Revalidacion del 18 de julio de 2026

Se agregaron casos para:

1. Omitir un CAP NOAA valido sin bloque `info`.
2. Rechazar una cabecera CAP sin identificador ni fecha.
3. Interpretar un cuerpo JSON vacio como ausencia de datos.
4. Reintentar solo estados transitorios y no un `404` permanente.

Resultados posteriores al ajuste:

```text
npm test -w apps/worker: 54/54
npm run verify: codigo 0
API: 55/55
Web: 125/125
Build: aprobado en todos los workspaces
```
