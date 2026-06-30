# VALIDATION-008 Integracion Oficial SGC Colombia e IGN Espana

## Estado

Conforme al 30/06/2026.

## Evidencia ejecutada

1. `npm run build -w packages/shared`: conforme.
2. `npm run typecheck -w apps/api`: conforme.
3. `npm run typecheck -w apps/worker`: conforme.
4. `npm run typecheck -w apps/web`: conforme.
5. `npm test -w apps/worker`: 23/23 pruebas conformes.
6. `npm run build -w apps/api`: conforme.
7. `npm run build -w apps/worker`: conforme.
8. `npm run build -w apps/web`: conforme.
9. Ejecucion real `RUN_ONCE=true npm run start -w apps/worker`: `SGC` e `IGN` finalizaron con `success`.
10. API `http://localhost:3000/api/sources/status`: expone `SGC` e `IGN` con estado `success`.
11. Evidencia SQL en `event_source_refs`:
    - `SGC`: 281 referencias persistidas.
    - `IGN`: 38 referencias persistidas.
12. Smoke visual en `http://localhost:5173/` con captura en
    `output/playwright/ui-smoke-2026-06-30.png`.

## Evidencia puntual

### Corridas operativas verificadas

- `SGC | success | 2026-06-30T18:02:48.796Z | 2026-06-30T18:02:51.498Z`
- `IGN | success | 2026-06-30T18:02:48.796Z | 2026-06-30T18:02:51.518Z`

Estas corridas fueron detectadas despues de la ejecucion manual, lo que confirma
que el worker sigue actualizando automaticamente en segundo plano.

### Persistencia verificada

- Muestra `SGC` persistida:
  `SGC:SGC2026mtichz | M1.6 - Simiti - Bolivar, Colombia |
2026-06-30T11:46:00.000Z | 7.611333333333334,-74.21466666666667`
- Muestra `IGN` persistida:
  `IGN:es2026mqhjc | M2.4 - SE AMPOSTA.T | 2026-06-29T15:23:41.000Z |
40.7037,0.5911`

### Capa funcional validada

1. `SGC` aparece visible en el feed global con marcador `CO`.
2. `IGN` aparece operativo en API y base de datos.
3. En la corrida validada, los eventos `IGN` recientes quedaron por debajo del
   umbral visual `M2.5+`, por lo que su presencia en frontend se valida por
   contrato de codigo, API y persistencia, no por aparicion en la primera
   pantalla del feed.

## Riesgos abiertos externos

1. El seguimiento posterior de `CSN` se movio a
   `VALIDATION-010_Integracion_Oficial_CSN_Chile.md`.
2. El seguimiento posterior de `INGV` se movio a
   `VALIDATION-011_Integracion_Oficial_INGV_Italia.md`.

## Criterio de cierre

La validacion se considera cerrada porque:

1. `SGC` e `IGN` quedaron operativos en el worker.
2. Existen corridas `success` para ambas fuentes.
3. Se confirmo su aparicion en API y frontend.
