# VALIDATION-010 Integracion Oficial CSN Chile

## Estado

Conforme al 30/06/2026.

## Evidencia ejecutada

1. `https://www.sismologia.cl/`: respuesta oficial `200`.
2. `https://www.sismologia.cl/sismicidad/informes/2026/06/372144.html`:
   respuesta oficial `200`.
3. `npm run build -w packages/shared`: conforme.
4. `npm run typecheck -w apps/worker`: conforme.
5. `npm run typecheck -w apps/api`: conforme.
6. `npm run typecheck -w apps/web`: conforme.
7. `npm test -w apps/worker`: `26/26` pruebas conformes.
8. `npm run build -w apps/worker`: conforme.
9. `npm run build -w apps/api`: conforme.
10. `npm run build -w apps/web`: conforme.
11. API `http://localhost:3000/api/sources/status`: expone `CSN` con
    estado `success`.
12. API `http://localhost:3000/api/events?hours=72&minMagnitude=0&limit=100`:
    devuelve eventos canonicos con `source = CSN`.
13. Evidencia SQL:
    - `ingestion_runs`: corridas `success` para `CSN`.
    - `event_source_refs`: `15` referencias `CSN`.
    - `seismic_events`: `15` eventos canonicos vinculados a `CSN`.
14. Smoke visual en `http://localhost:5173/` con captura en
    `output/playwright/ui-smoke-csn-2026-06-30.png`.

## Evidencia puntual

### Corridas operativas verificadas

- `CSN | success | 2026-06-30T18:42:55.292Z | 2026-06-30T18:42:57.600Z | i=0 | u=0 | a=0`
- `CSN | success | 2026-06-30T18:38:19.233Z | 2026-06-30T18:38:21.328Z | i=0 | u=0 | a=0`
- `CSN | success | 2026-06-30T18:35:31.619Z | 2026-06-30T18:35:35.359Z | i=1 | u=0 | a=14`

### Incidencia resuelta durante la habilitacion

- En la primera corrida de activacion se observo:
  `CSN | error | 2026-06-30T18:34:14.257Z | 2026-06-30T18:34:16.041Z | null value in column "preferred_source_priority" ...`
- La causa fue una activacion parcial antes de recompilar el contrato
  compartido que incorpora `CSN` en la matriz de prioridad regional.
- Luego de recompilar y reejecutar el worker, la fuente quedo estable y no
  reaparecio el error.

### Persistencia verificada

- `event_source_refs`:
  `CSN | 15 referencias persistidas`
- Muestras canonicas:
  - `EMSC:20260630_0000242 | CSN | M3.8 - 31 km al SO de Pica | 2026-06-30T18:19:22.000Z | source_count=2`
  - `EMSC:20260630_0000231 | CSN | M2.6 - 112 km al O de Caldera | 2026-06-30T17:38:14.000Z | source_count=2`
  - `CSN:372132 | CSN | M2.7 - 37 km al E de Los Andes | 2026-06-30T13:48:51.000Z | source_count=1`

### Capa funcional validada

1. `http://localhost:3000/api/sources/status` expone `CSN` con corrida
   reciente `success`.
2. `http://localhost:3000/api/events?hours=72&minMagnitude=0&limit=100`
   devuelve eventos oficiales de Chile con `detailUrl` y `sourceUrl`
   apuntando a `sismologia.cl/sismicidad/informes/...`.
3. El frontend muestra `Fuentes operativas 16/16` y `Feed global 100 eventos`
   en la sesion validada.
4. Playwright verifico items visibles `CL`, entre ellos:
   - `CL 31 km al SO de Pica`
   - `CL 112 km al O de Caldera`
5. La verificacion DOM de la sesion visual conto `13` items del feed cuyo
   marcador comienza con `CL`.

## Riesgos abiertos externos

1. La integracion depende de HTML oficial server-side al no existir un `JSON`
   publico estable detectado.
2. Cambios de markup en portada o informe requeriran ajuste del adaptador.
3. No se detecto un `GeoJSON` o `API REST` oficial publica equivalente para
   sustituir este contrato al momento de la validacion.

## Criterio de cierre

La validacion se considera cerrada porque:

1. `CSN` quedo operativo en el worker.
2. Existen corridas `success` para la fuente.
3. Se confirmo su aparicion en API, base de datos y frontend.
