# TEST-004 Ampliacion de Fuentes Oficiales

## Objetivo

Verificar la implementacion definida por `SDD-004`, con enfasis en contratos
externos, normalizacion, continuidad parcial, deduplicacion y prioridad
regional.

## Entorno

- Windows, Node.js 22 y npm workspaces.
- PostgreSQL 16 con PostGIS 3.6 en `localhost:5433`.
- API local en `localhost:3000`.
- Frontend local en `localhost:5173`.
- Fecha de ejecucion: 30 de junio de 2026.

## Casos funcionales

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| VF-401 | Consultar GEOFON FDSN | respuesta texto valida dentro de timeout |
| VF-402 | Consultar GeoNet v2 | respuesta GeoJSON valida con cabecera versionada |
| VF-403 | Ejecutar worker | ambas fuentes terminan en estado `success` |
| VF-404 | Consultar estado API | nueve fuentes configuradas son visibles |
| VF-405 | Persistir referencias | identificadores unicos por fuente |
| VF-406 | Asociar eventos | referencias compatibles comparten evento canonico |
| VF-407 | Verificar prioridad | GeoNet puede ser fuente preferida en su region |
| VF-408 | Verificar continuidad | API y frontend responden despues de la ingesta |

## Casos unitarios

1. Parser de cabecera y fila FDSN texto.
2. Normalizacion GEOFON y conversion explicita a UTC.
3. Normalizacion GeoNet con MMI y calidad.
4. Exclusion de eventos GeoNet eliminados.
5. Prioridad de GeoNet en Nueva Zelanda.
6. Prioridad global subordinada de GEOFON respecto de USGS.
7. Regresion de los normalizadores y reglas existentes.

## Comandos

```text
npm test -w apps/worker
npm run typecheck
npm run build
```

## Criterio de aprobacion

Todos los casos unitarios deben pasar; la ingesta real no debe registrar error;
no deben existir duplicados de `(source, source_event_id)`; API y frontend deben
continuar disponibles.
