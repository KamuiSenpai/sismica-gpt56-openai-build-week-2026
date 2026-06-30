# VALIDATION-011 Integracion Oficial INGV Italia

## Estado

Conforme al 30/06/2026.

## Evidencia ejecutada

1. `https://terremoti.ingv.it/webservices_and_software`: referencia oficial al
   servicio `fdsnws/event/1`, respuesta `200`.
2. `https://webservices.ingv.it/fdsnws/event/1/version`: respuesta oficial
   `200`.
3. `https://webservices.ingv.it/fdsnws/event/1/application.wadl`: contrato
   oficial accesible, respuesta `200`.
4. `npm run build -w packages/shared`: conforme.
5. `npm run typecheck -w apps/worker`: conforme.
6. `npm run typecheck -w apps/api`: conforme.
7. `npm run typecheck -w apps/web`: conforme.
8. `npm test -w apps/worker`: `28/28` pruebas conformes.
9. `npm run build -w apps/worker`: conforme.
10. `npm run build -w apps/api`: conforme.
11. `npm run build -w apps/web`: conforme.
12. Ejecucion real `RUN_ONCE=true npm run start -w apps/worker`: `INGV`
    finalizo con `success`.
13. API `http://localhost:3000/api/sources/status`: expone `INGV` con estado
    `success`.
14. API `http://localhost:3000/api/events?hours=72&minMagnitude=0&limit=200`:
    devuelve eventos `INGV`.
15. Evidencia SQL:
    - `event_source_refs`: `114` referencias `INGV`.
    - `seismic_events`: `114` eventos canonicos vinculados a `INGV`.
16. Smoke visual en `http://localhost:5173/` con captura en
    `output/playwright/ui-smoke-ingv-2026-06-30.png`.

## Evidencia puntual

### Corridas operativas verificadas

- `INGV | success | 2026-06-30T19:01:03.774Z | 2026-06-30T19:01:05.820Z | i=0 | u=0 | a=0`
- `INGV | success | 2026-06-30T19:00:31.359Z | 2026-06-30T19:00:33.405Z | i=112 | u=0 | a=2`

### Incidencia resuelta durante la habilitacion

- Las primeras corridas fallaron con:
  `INGV | error | ... | Source request failed: 500 Internal Server Error`
- La causa no fue un defecto interno de parseo, sino la inestabilidad del
  servicio oficial al combinar ciertas ventanas con `limit` alto.
- La correccion aplicada fue:
  1. consultar por ventanas diarias UTC;
  2. usar la variante sin `limit` como intento primario;
  3. dejar limites conservadores solo como fallback.
- Despues de este ajuste la ingesta quedo operativa y persistio `114`
  referencias oficiales.

### Persistencia verificada

- `event_source_refs`:
  `INGV | 114 referencias persistidas`
- Muestras canonicas:
  - `INGV:46395552 | INGV | M1.0 - 1 km SW Pradleves (CN) | 2026-06-30T16:52:35.300Z | source_count=1`
  - `INGV:46395432 | INGV | M0.9 - 2 km NW Penna San Giovanni (MC) | 2026-06-30T16:49:22.990Z | source_count=1`
  - `EMSC:20260630_0000056 | INGV | M3.6 - Bosnia and Herz. [Land] | 2026-06-30T04:18:16.060Z | source_count=2`

### Capa funcional validada

1. `http://localhost:3000/api/sources/status` expone `INGV` como fuente
   operativa y la plataforma suma `17/17` fuentes activas.
2. `http://localhost:3000/api/events?hours=72&minMagnitude=0&limit=200`
   devuelve eventos `INGV` con `detailUrl` y `sourceUrl` apuntando a
   `terremoti.ingv.it/event/{id}?timezone=UTC`.
3. En la consulta visual `M2.5+` se confirmaron items `IT` visibles en el
   feed, entre ellos:
   - `IT Tirreno Meridionale [Mare]`
   - `IT 4 km W Senerchia (AV)`
   - `IT Bosnia and Herz. [Land]`
4. La UI validada muestra `Fuentes operativas 17/17` y `Feed global 100
eventos`.

## Riesgos abiertos

1. El servicio oficial devuelve `500` con varias combinaciones validas segun el
   WADL, por lo que la integracion depende de una combinacion de parametros
   empiricamente estable.
2. Los filtros espaciales del servicio no fueron adoptados porque en las
   pruebas vivas devolvieron `500`; el recorte regional se aplica dentro del
   adaptador.

## Criterio de cierre

La validacion se considera cerrada porque:

1. `INGV` quedo operativo en el worker.
2. Existan corridas `success` para la fuente.
3. Se confirme su aparicion en API, base de datos y frontend.
