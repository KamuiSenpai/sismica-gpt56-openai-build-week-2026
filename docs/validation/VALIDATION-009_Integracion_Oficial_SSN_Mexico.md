# VALIDATION-009 Integracion Oficial SSN Mexico

## Estado

Conforme al 30/06/2026.

## Evidencia ejecutada

1. `http://www.ssn.unam.mx/rss/ultimos-sismos.xml`: respuesta oficial `200`.
2. `npm run build -w packages/shared`: conforme.
3. `npm run typecheck -w apps/worker`: conforme.
4. `npm run typecheck -w apps/api`: conforme.
5. `npm run typecheck -w apps/web`: conforme.
6. `npm test -w apps/worker`: 24/24 pruebas conformes.
7. `npm run build -w apps/worker`: conforme.
8. `npm run build -w apps/api`: conforme.
9. `npm run build -w apps/web`: conforme.
10. Ejecucion real `RUN_ONCE=true npm run start -w apps/worker`: `SSN` finalizo con `success`.
11. API `http://localhost:3000/api/sources/status`: expone `SSN` con estado `success`.
12. Evidencia SQL:
    - `event_source_refs`: `SSN` con 15 referencias persistidas.
    - `seismic_events`: eventos canonicos con `source = SSN`.
13. Smoke visual del frontend:
    - `MX` visible en el feed global.
    - Verificacion DOM: `mxMarks = 5`.

## Evidencia puntual

### Corridas operativas verificadas

- `SSN | success | 2026-06-30T18:24:33.670Z | 2026-06-30T18:24:45.224Z | i=0 | u=0 | a=0`
- `SSN | success | 2026-06-30T18:22:53.693Z | 2026-06-30T18:23:05.445Z | i=4 | u=0 | a=11`

### Persistencia verificada

- `event_source_refs`:
  `SSN | 15 | 2026-06-30T10:53:25.000Z | 2026-06-30T18:23:05.366Z`
- Muestras canonicas:
  - `SSN:869fcbbb244e905b9524c113 | SSN | M2.5 - 8 km al SUROESTE de SAN MARCOS, GRO`
  - `EMSC:20260630_0000167 | SSN | M3.3 - 16 km al SUR de PETATLAN, GRO`

### Capa funcional validada

1. `/api/events?hours=72&minMagnitude=0&limit=500` devuelve eventos con
   `source = SSN`.
2. El feed global del frontend muestra items con marcador `MX`.
3. El enlace oficial de cada item apunta al detalle del `SSN` en
   `localizacion-de-sismo.jsp`.

## Riesgos abiertos externos

1. El RSS oficial del `SSN` publica solo una ventana corta de eventos recientes.
2. El catalogo historico `www2.ssn.unam.mx:8080/catalogo/` requiere captcha
   para consultas interactivas, por lo que no se adopta como canal automatizado.

## Criterio de cierre

La validacion se considera cerrada porque:

1. `SSN` quedo operativo en el worker.
2. Existen corridas `success` para la fuente.
3. Se confirmo su aparicion en base de datos, API y frontend.
