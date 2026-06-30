# SDD-007 Integracion Oficial CWA Taiwan

## Estado

Vigente para implementacion y validacion.

## Documentos relacionados

1. `SDD-003_Integracion_Multifuente_y_Deduplicacion_Sismica.md`.
2. `SDD-004_Ampliacion_de_Fuentes_Oficiales_y_Reconciliacion_Sismica.md`.
3. `SDD-006_Integracion_Oficial_JMA_Japon.md`.
4. Informes profesionales ubicados en `output/doc`.

## Objetivo

Incorporar a la Central Weather Administration de Taiwan (`CWA`) como fuente
sismologica oficial preferida para Taiwan, reutilizando la deduplicacion
PostGIS existente y preservando la intensidad maxima reportada por CWA.

## Fuente y autoridad

CWA expone un servicio oficial de datos abiertos con autenticacion mediante
`Authorization` y recursos `datastore` versionados. Para esta integracion se
selecciona el recurso oficial en ingles:

- Portal de datos abiertos: `https://opendata.cwa.gov.tw/`.
- Endpoint operativo: `https://opendata.cwa.gov.tw/api/v1/rest/datastore/E-A0016-002`.
- Recurso: `E-A0016-002` (`Earthquake Report`).

El recurso requiere un `Authorization` personal emitido por CWA. La
autenticacion se realizara exclusivamente por header HTTP para evitar exponer
la credencial en URLs, logs del navegador o parametros compartidos.

## Alcance funcional

1. Consultar el recurso oficial CWA cada 120 segundos.
2. Autenticar la solicitud por header `Authorization`.
3. Validar la estructura externa antes de normalizar.
4. Normalizar tiempo de origen, epicentro, profundidad, magnitud, intensidad
   maxima y reporte oficial.
5. Persistir payload original y referencia CWA.
6. Aplicar prioridad regional CWA dentro de Taiwan.
7. Exponer el estado independiente de CWA mediante la API.

## Exclusiones

1. No se integran otros recursos CWA no sismicos.
2. No se usa `EarthquakeNo` como identificador unico del evento.
3. No se interpretan alertas de tsunami a partir de este recurso.
4. No se persisten todas las estaciones como entidades propias.
5. No se traduce texto adicional cuando el recurso ya provee ingles.

## Contrato externo

El contenedor esperado es un objeto JSON con `success`, `records` y
`records.Earthquake[]`. Cada item normalizable debe contener:

1. `Web`.
2. `IssueTime`.
3. `EarthquakeInfo.OriginTime`.
4. `EarthquakeInfo.Epicenter.EpicenterLatitude`.
5. `EarthquakeInfo.Epicenter.EpicenterLongitude`.
6. `EarthquakeInfo.EarthquakeMagnitude.MagnitudeValue`.

| Campo CWA                                           | Campo interno   | Regla                                                 |
| --------------------------------------------------- | --------------- | ----------------------------------------------------- |
| `Web`                                               | `sourceEventId` | usar el slug final del detalle; fallback hash estable |
| `IssueTime`                                         | `updatedAtUtc`  | convertir ISO 8601 `+08:00` a UTC                     |
| `EarthquakeInfo.OriginTime`                         | `eventTimeUtc`  | convertir ISO 8601 `+08:00` a UTC                     |
| `EarthquakeInfo.Epicenter.EpicenterLatitude`        | `latitude`      | conversion numerica obligatoria                       |
| `EarthquakeInfo.Epicenter.EpicenterLongitude`       | `longitude`     | conversion numerica obligatoria                       |
| `EarthquakeInfo.FocalDepth`                         | `depthKm`       | profundidad en kilometros                             |
| `EarthquakeInfo.EarthquakeMagnitude.MagnitudeType`  | `magnitudeType` | conservar literal recibido                            |
| `EarthquakeInfo.EarthquakeMagnitude.MagnitudeValue` | `magnitude`     | conversion numerica obligatoria                       |
| `EarthquakeInfo.Epicenter.Location`                 | `title`         | usar ubicacion oficial en ingles                      |
| `Intensity.ShakingArea[].AreaIntensity`             | `intensityText` | conservar intensidad maxima como texto CWA            |
| `Intensity.ShakingArea[].EqStation[]`               | `stationCount`  | total de estaciones presentes                         |
| `ReportType` / `ReportColor`                        | `status`        | conservar origen oficial del reporte                  |
| `Web`                                               | `detailUrl`     | URL oficial del reporte CWA                           |

Los registros con fecha, coordenadas o magnitud invalidas deben descartarse.

## Identidad y deduplicacion

`EarthquakeNo` no es suficiente como identidad estable dentro del recurso
`E-A0016-002`, ya que durante la validacion real se observaron multiples
eventos recientes con el valor `115000`. Por ello:

1. Si `Web` contiene `/details/<slug>`, se usa `<slug>` como `sourceEventId`.
2. Si falta `Web`, se genera un hash determinista con `OriginTime`, latitud,
   longitud y magnitud redondeados.
3. La restriccion `(source, source_event_id)` y la deduplicacion PostGIS
   conservan la unicidad visible y referencial.

## Prioridad regional

Se utiliza una envolvente geografica conservadora para Taiwan:

```text
latitud:  20.0 a 27.0
longitud: 118.0 a 123.0
```

Orden de preferencia regional:

1. CWA: 100.
2. USGS: 80.
3. GEOFON: 75.
4. EMSC: 70.
5. Otras fuentes fuera de su jurisdiccion: 40.

Fuera de Taiwan, CWA conserva prioridad baja y no reemplaza una fuente global
preferida.

## Cambios de software

1. Ampliar `SourceCode` con `CWA`.
2. Agregar `CWA_AUTHORIZATION` y `CWA_EARTHQUAKE_URL`.
3. Permitir solicitudes JSON con headers adicionales.
4. Agregar esquema Zod del contenedor CWA.
5. Implementar `cwaProvider`.
6. Registrar intervalo, orquestacion y estado API.
7. Incorporar prioridad geografica para Taiwan.

## Seguridad y continuidad

1. No exponer `Authorization` en frontend.
2. No persistir la credencial en payloads ni logs.
3. Aplicar timeout y limite de tamano comunes del worker.
4. Enviar `User-Agent` institucional.
5. Una falla de CWA no debe detener otras fuentes.

## Criterios de aceptacion

1. El endpoint oficial responde `200` con JSON usando header `Authorization`.
2. CWA aparece en `/api/sources/status`.
3. La primera ingesta real finaliza con estado `success`.
4. No existen duplicados por `(source, source_event_id)`.
5. Una segunda ingesta es idempotente cuando el payload no cambia.
6. CWA tiene prioridad sobre USGS en Taiwan y prioridad inferior fuera de esa
   region.
7. Pruebas unitarias, typecheck y build finalizan sin errores.

## Plan de validacion funcional

1. Ejecutar worker contra `E-A0016-002` con autenticacion por header.
2. Verificar estado y conteos en `ingestion_runs`.
3. Verificar referencias CWA en `event_source_refs`.
4. Verificar prioridad canonica sobre eventos ubicados en Taiwan.
5. Ejecutar segunda ingesta y comprobar idempotencia.
6. Consultar API y frontend para confirmar visibilidad de la fuente.

## Plan de pruebas unitarias

1. Extraccion de `sourceEventId` desde `Web`.
2. Fallback hash estable cuando falta `Web`.
3. Normalizacion de fecha `+08:00`, coordenadas, profundidad y magnitud.
4. Conservacion de intensidad maxima y conteo de estaciones.
5. Rechazo de registros incompletos o invalidos.
6. Prioridad CWA dentro y fuera de Taiwan.

## Trazabilidad

| Requisito          | Componente         | Evidencia prevista             |
| ------------------ | ------------------ | ------------------------------ |
| Consulta oficial   | `cwaProvider`      | ejecucion real                 |
| Validacion externa | esquema Zod        | rechazo de contenedor invalido |
| Identidad estable  | `buildCwaSourceId` | pruebas unitarias y SQL        |
| Prioridad nacional | `sourcePriority`   | prueba regional                |
| Observabilidad     | `ingestion_runs`   | estado CWA                     |
