# VALIDATION-013 Integracion Oficial NCEDC, KNMI y SCEDC

## Resultado

Validacion aprobada localmente el 2026-06-30.

La entrega incorpora tres fuentes adicionales para validacion cruzada del
catalogo sismico en vivo:

- `NCEDC` para norte de California.
- `KNMI` para Paises Bajos.
- `SCEDC` para sur de California.

El objetivo de esta etapa fue aumentar corroboracion en `sources: ...` y
fortalecer `event_source_refs`, no reemplazar la fuente canonica global.

## Evidencia tecnica

Comandos ejecutados:

```powershell
npm test -w apps/worker
npm run typecheck -w apps/worker
npm run typecheck -w apps/api
npm run typecheck -w apps/web
npm run build
```

Resultado:

- `apps/worker`: 35 pruebas aprobadas, 0 fallidas.
- `apps/worker`: typecheck sin errores.
- `apps/api`: typecheck sin errores.
- `apps/web`: typecheck sin errores.
- `packages/shared`, `apps/api`, `apps/worker` y `apps/web`: build correcto.

## Evidencia de parsing y normalizacion

Cobertura validada por pruebas unitarias:

- Variante `SCEDC` con fecha `YYYY/MM/DD HH:mm:ss.ssss`.
- Alias de cabecera `Longtitude` para `SCEDC`.
- Contrato FDSN estandar de `KNMI`.
- Fallback de `providerEventCode` cuando `ContributorID` llega vacio.

## Evidencia de conectividad real

Smoke ejecutado directamente contra los providers:

| Fuente  | Estado   | Eventos parseados | Primer evento observado |
| ------- | -------- | ----------------- | ----------------------- |
| `NCEDC` | success  | 3                 | `NCEDC:75386596`, M2.5, `Boron, CA` |
| `KNMI`  | success  | 0                 | Sin eventos en la ventana activa |
| `SCEDC` | success  | 1                 | `SCEDC:10245278`, M5.5, `Port Orford, OR` |

Interpretacion:

1. `KNMI` no fallo; respondio correctamente, pero en la ventana operativa usada
   por el provider no devolvio eventos.
2. Se verifico adicionalmente el endpoint crudo de `KNMI` fuera de esa ventana y
   entrego un registro valido (`knmi2026mlbv`, `Meedhuizen`), confirmando que la
   fuente esta operativa.
3. `SCEDC` confirmo la necesidad del conversor de fecha con slashes y del alias
   `Longtitude`.

## Evidencia funcional con worker y base de datos

Comando ejecutado:

```powershell
$env:RUN_ONCE='true'; npm run start -w apps/worker
```

Resultado observado en consola:

| Fuente  | Estado   | Insertados | Actualizados | Asociados |
| ------- | -------- | ---------- | ------------ | --------- |
| `NCEDC` | success  | 0          | 0            | 0         |
| `KNMI`  | success  | 0          | 0            | 0         |
| `SCEDC` | success  | 0          | 0            | 0         |

El valor `0` en inserciones de esta corrida no representa falla. Significa que
no hubo nuevos registros dentro de la ventana o que las referencias ya estaban
persistidas.

Persistencia confirmada en `event_source_refs`:

| Fuente  | Referencias persistidas | Ultimo evento observado |
| ------- | ----------------------- | ----------------------- |
| `NCEDC` | 3                       | `2026-06-29T23:26:29.180Z` |
| `SCEDC` | 1                       | `2026-06-29T11:35:33.629Z` |

Asociacion confirmada en corridas previas del mismo bloque de validacion:

| Fuente  | Asociaciones registradas |
| ------- | ------------------------ |
| `NCEDC` | 2                        |
| `SCEDC` | 1                        |

Nota:

`KNMI` no dejo referencias en esta validacion porque la ventana activa retorno
cero eventos. Eso no invalida la integracion: el worker, la API y el parsing
respondieron en estado `success`.

## Evidencia API

Endpoint verificado:

```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/api/sources/status'
```

Resultado observado:

| Fuente  | Estado API | Inicio ultima corrida       | Fin ultima corrida          |
| ------- | ---------- | --------------------------- | --------------------------- |
| `NCEDC` | success    | `2026-06-30T23:05:52.301Z` | `2026-06-30T23:05:54.746Z` |
| `KNMI`  | success    | `2026-06-30T23:05:52.301Z` | `2026-06-30T23:05:54.747Z` |
| `SCEDC` | success    | `2026-06-30T23:05:52.301Z` | `2026-06-30T23:05:54.748Z` |

## Estado de aceptacion

| Criterio                                                   | Estado   |
| ---------------------------------------------------------- | -------- |
| `NCEDC`, `KNMI` y `SCEDC` registrados en el modelo comun   | Aprobado |
| Provider FDSN reutilizable soporta variante `SCEDC`        | Aprobado |
| Worker ejecuta las tres fuentes sin error                  | Aprobado |
| API expone las tres fuentes con estado `success`           | Aprobado |
| `NCEDC` y `SCEDC` ya dejan evidencia en `event_source_refs`| Aprobado |
| Typecheck, tests y build completan sin errores             | Aprobado |

## Riesgo residual

1. `NCEDC` y `SCEDC` son catalogos regionales; ampliar demasiado la ventana
   de consulta aumenta latencia sin aportar valor proporcional.
2. `SCEDC` depende de una salida FDSN no totalmente canonica; si el proveedor
   cambia otra vez la cabecera o el formato de fecha, habra que ajustar el
   normalizador.
3. `KNMI` puede alternar entre periodos con y sin eventos en la ventana corta;
   por eso su mejor valor en este sistema es validacion cruzada, no cobertura
   continua de alto volumen.
