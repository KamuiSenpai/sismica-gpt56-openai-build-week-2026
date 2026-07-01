# VALIDATION-012 Integracion Oficial IGEPN, INPRES y Redes de Centroamerica

## Resultado

Validacion aprobada localmente el 2026-06-30.

La entrega incorpora cinco fuentes regionales oficiales o institucionales al
worker de ingesta sismica:

- `IGEPN` para Ecuador.
- `INPRES` para Argentina.
- `MARN` para El Salvador.
- `OVSICORI` para Costa Rica.
- `INSIVUMEH` para Guatemala.

## Evidencia tecnica

Comando ejecutado:

```powershell
npm run typecheck
```

Resultado:

- `packages/shared`: sin errores.
- `apps/api`: sin errores.
- `apps/worker`: sin errores.
- `apps/web`: sin errores.

Comando ejecutado:

```powershell
npm test -w apps/worker
```

Resultado:

- 33 pruebas ejecutadas.
- 33 pruebas aprobadas.
- 0 pruebas fallidas.

Comando ejecutado:

```powershell
npm run build
```

Resultado:

- Build `packages/shared`: correcto.
- Build `apps/api`: correcto.
- Build `apps/worker`: correcto.
- Build `apps/web`: correcto.

## Evidencia de conectividad y parsing

Smoke live ejecutado contra las fuentes reales:

| Fuente      | Estado  | Eventos parseados | Primer evento observado                        |
| ----------- | ------- | ----------------- | ---------------------------------------------- |
| `IGEPN`     | success | 2                 | `IGEPN:igepn2026mrim`, M4.3, Ecuador           |
| `INPRES`    | success | 30                | `INPRES:20260630202257`, M2.6, Argentina       |
| `MARN`      | success | 4                 | M3.9 frente a costa de La Libertad             |
| `OVSICORI`  | success | 31                | M1.7 al noroeste de Savegre de Puntarenas      |
| `INSIVUMEH` | success | 114               | `INSIVUMEH:insivumeh2026mppx`, M2.6, Guatemala |

## Evidencia funcional con base de datos

Comando ejecutado:

```powershell
$env:RUN_ONCE='true'; npm run start -w apps/worker
```

Resultado de ingesta:

| Fuente      | Estado  | Insertados | Actualizados | Asociados |
| ----------- | ------- | ---------- | ------------ | --------- |
| `IGEPN`     | success | 0          | 0            | 0         |
| `INPRES`    | success | 0          | 0            | 0         |
| `MARN`      | success | 0          | 0            | 0         |
| `OVSICORI`  | success | 0          | 31           | 0         |
| `INSIVUMEH` | success | 0          | 0            | 0         |

El resultado con cero inserciones no indica falla: en esta corrida las
referencias de varias fuentes ya existian o no cambiaron. La persistencia fue
confirmada consultando `event_source_refs` y `seismic_events`.

Referencias persistidas:

| Fuente      | Referencias en `event_source_refs` |
| ----------- | ---------------------------------- |
| `IGEPN`     | 2                                  |
| `INPRES`    | 30                                 |
| `MARN`      | 4                                  |
| `OVSICORI`  | 32                                 |
| `INSIVUMEH` | 43                                 |

Eventos canonicos por fuente preferida:

| Fuente      | Eventos canonicos |
| ----------- | ----------------- |
| `IGEPN`     | 2                 |
| `INPRES`    | 29                |
| `MARN`      | 4                 |
| `OVSICORI`  | 31                |
| `INSIVUMEH` | 37                |

## Evidencia API

Endpoint verificado:

```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/api/sources/status'
```

Resultado observado:

| Fuente      | Estado API |
| ----------- | ---------- |
| `IGEPN`     | success    |
| `INPRES`    | success    |
| `MARN`      | success    |
| `OVSICORI`  | success    |
| `INSIVUMEH` | success    |

## Hallazgos corregidos durante validacion

1. `OVSICORI` tenia un contrato de retorno distinto al ingestion service. Se
   normalizo a `{ event, rawPayload }`.
2. La ubicacion de `OVSICORI` incluia texto tecnico de coordenadas en el titulo.
   Se separo para mostrar solo el lugar.
3. Se detectaron solapes geograficos en prioridad regional:
   - Ecuador vs norte de Peru.
   - Chile vs Argentina.
   - Guatemala vs sur de Mexico y El Salvador.
4. Se ajusto el orden y limites regionales para que la fuente local gane en su
   pais sin desplazar fuentes vecinas.

## Estado de aceptacion

| Criterio                                          | Estado   |
| ------------------------------------------------- | -------- |
| Endpoints oficiales responden y son parseables    | Aprobado |
| Providers normalizan muestras contractuales       | Aprobado |
| Worker registra fuentes en ingesta                | Aprobado |
| API conoce las cinco nuevas fuentes               | Aprobado |
| Frontend tiene marcas nacionales `EC/AR/SV/CR/GT` | Aprobado |
| Typecheck, tests y build sin errores              | Aprobado |

## Riesgo residual

`MARN`, `OVSICORI` e `INSIVUMEH` dependen de HTML oficial. Si la institucion
cambia la estructura de su portal, el parser puede requerir ajuste. `INSIVUMEH`
usa un workaround TLS limitado a esa fuente por cadena de certificado no
validada en Node durante la verificacion.
