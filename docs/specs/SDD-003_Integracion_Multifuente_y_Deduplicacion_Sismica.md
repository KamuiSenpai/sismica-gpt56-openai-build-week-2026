# SDD-003 Integracion Multifuente y Deduplicacion Sismica

## Estado

Vigente para implementacion en la plataforma funcional.

## Documentos fuente

Esta especificacion deriva de:

1. `output/doc/01_Informe_de_Alcance_y_Diseno_Funcional_de_la_Plataforma_de_Visualizacion_Sismica.docx`
2. `output/doc/02_Informe_Tecnico_de_Arquitectura_Desarrollo_y_Entorno_WSL2_de_la_Plataforma_de_Visualizacion_Sismica.docx`
3. `docs/specs/SDD-001_Plataforma_Funcional_de_Visualizacion_Sismica.md`
4. `docs/specs/SDD-002_Interfaz_Operativa_de_Monitoreo_Sismico.md`

Los informes Word fueron actualizados para incorporar `IGP/CENSIS` como
fuente nacional prioritaria para Peru y para reflejar el estado funcional de
la plataforma.

## Objetivo

Integrar fuentes sismicas y de contexto confiables sin mostrar varias veces el
mismo evento, conservando cada referencia original y separando catalogo
sismico, impacto de desastre y productos de tsunami.

## Alcance

1. Catalogos sismicos: `USGS`, `EMSC`, `IGP/CENSIS` y `FUNVISIS`.
2. Contexto de desastre: `GDACS`.
3. Productos de tsunami: `NOAA/PTWC` y `NOAA/NTWC` mediante `CAP-TSU`.
4. Normalizacion a contratos internos tipados.
5. Asociacion multi-fuente con trazabilidad de todos los proveedores.
6. Preferencia regional de `IGP/CENSIS` para Peru y `FUNVISIS` para Venezuela.
7. Estado de ingesta independiente por fuente.
8. Exposicion por API y representacion diferenciada en CesiumJS.

## Exclusiones

1. Procesamiento de formas de onda o deteccion sismica propia.
2. Emision de alertas oficiales por parte de la plataforma.
3. Fusion de productos NOAA o GDACS dentro del catalogo como nuevos sismos.
4. Prediccion de terremotos.
5. Consumo de redes sociales como fuente sismologica.

## Fuentes y contratos externos

| Codigo | Dominio | Canal | Estado de acceso | Frecuencia objetivo |
| --- | --- | --- | --- | --- |
| `USGS` | catalogo global | GeoJSON Summary/FDSN | API publica documentada | 60 s |
| `EMSC` | catalogo global | FDSN JSON; WebSocket opcional | API publica CC BY 4.0 | 60 s |
| `IGP` | catalogo Peru | endpoint JSON del portal CENSIS | publico, no versionado | 120 s |
| `FUNVISIS` | catalogo Venezuela | GeoJSON `maravilla.json` | publico oficial sobre HTTP | 120 s |
| `GDACS` | impacto | API GeoJSON | API publica documentada | 360 s |
| `NOAA_PTWC` | tsunami | CAP-TSU XML | producto publico oficial | 120 s |
| `NOAA_NTWC` | tsunami | CAP-TSU XML | producto publico oficial | 120 s |

### Endpoints aprobados

- USGS: `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson`
- EMSC: `https://www.seismicportal.eu/fdsnws/event/1/query?format=json`
- IGP/CENSIS: `https://ultimosismo.igp.gob.pe/api/ultimo-sismo/ajaxb/{year}`
- FUNVISIS: `http://www.funvisis.gob.ve/maravilla.json`
- GDACS: `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH`
- NOAA/PTWC: `https://www.tsunami.gov/events/xml/PHEBCAP.xml`
- NOAA/NTWC: `https://www.tsunami.gov/events/xml/PAAQCAP.xml`

Los endpoints IGP y FUNVISIS deben quedar encapsulados en adaptadores y bajo
banderas de configuracion. Un cambio de formato deshabilita solo esa fuente y
no debe interrumpir las demas.

## Separacion de dominios

### Eventos sismicos

`USGS`, `EMSC`, `IGP` y `FUNVISIS` producen candidatos sismicos normalizados.
Varios candidatos pueden representar un unico evento canonico.

### Contexto GDACS

GDACS aporta nivel y puntaje de impacto, paises afectados y enlace de reporte.
Se asocia a un evento canonico cuando existe coincidencia, pero no crea una
copia visible del sismo.

### Productos NOAA

Los mensajes CAP de tsunami se almacenan como productos independientes con
centro emisor, vigencia, severidad, certeza, descripcion y enlace oficial. No
se convierten en eventos sismicos.

## Modelo normalizado de evento

Cada evento canonico conserva:

- identificador interno estable
- fuente preferida y referencia preferida
- titulo, magnitud, tipo de magnitud y profundidad
- coordenadas PostGIS
- hora de origen y hora de actualizacion
- estado de revision
- MMI, CDI y parametros tecnicos disponibles
- enlace oficial preferido
- prioridad de la fuente preferida
- fechas de creacion e ingesta

Cada referencia de fuente conserva de forma independiente:

- `source`
- `source_event_id`
- `event_id` canonico asociado
- valores originales normalizados
- URL y URL de detalle
- payload original
- fecha de ingesta

La restriccion unica se aplica a `(source, source_event_id)`.

## Reglas de deduplicacion

### Identidad exacta

1. Si ya existe `(source, source_event_id)`, se actualiza esa referencia.
2. La actualizacion no crea un nuevo evento canonico.

### Asociacion entre fuentes

Un candidato nuevo puede asociarse a un evento existente cuando cumple todos
los criterios disponibles:

1. Diferencia temporal absoluta menor o igual a 60 segundos.
2. Distancia entre epicentros menor a 100 km mediante `ST_DWithin`.
3. Diferencia de magnitud menor a 0.5 cuando ambos valores existen.
4. El candidato con menor puntaje normalizado de tiempo, distancia y magnitud
   es el elegido.

La asociacion registra sus metricas para auditoria. Si no existe una
coincidencia admisible, se crea un nuevo evento canonico.

### Preferencia de fuente

| Zona | Orden de preferencia |
| --- | --- |
| Peru | IGP, USGS, EMSC, FUNVISIS |
| Venezuela | FUNVISIS, USGS, EMSC, IGP |
| Resto del mundo | USGS, EMSC, IGP, FUNVISIS |

La zona se determina inicialmente por limites geograficos conservadores. La
preferencia cambia los valores visibles del evento canonico, pero nunca elimina
las referencias de las otras fuentes.

## Modelo de persistencia

### `seismic_events`

Tabla canonica. Se amplia con parametros tecnicos y prioridad de fuente.

### `event_source_refs`

Tabla de referencias originales con restriccion unica por proveedor.

### `event_associations`

Auditoria de asociaciones con diferencia temporal, distancia, diferencia de
magnitud, regla aplicada y fecha.

### `disaster_contexts`

Productos GDACS asociados opcionalmente a `seismic_events`.

### `tsunami_products`

Productos CAP-TSU de NOAA, independientes del catalogo sismico.

### `ingestion_runs`

Una ejecucion por fuente con estado, conteos y error aislado.

## Comportamiento del worker

1. Cada proveedor implementa `fetch`, `normalize` y codigo de fuente.
2. `Promise.allSettled` aisla fallas entre proveedores.
3. Cada ejecucion registra inicio, fin, insertados, actualizados y asociados.
4. Solo los eventos canonicos nuevos se notifican como `event.created`.
5. Las actualizaciones relevantes se notifican como `event.updated`.
6. Los payloads externos se conservan para auditoria.
7. Los limites temporales evitan descargar historicos completos en cada ciclo.

## API

### Endpoints existentes ampliados

- `GET /api/events`: retorna eventos canonicos sin duplicidad.
- `GET /api/events/:eventId`: retorna evento y referencias de fuente.
- `GET /api/sources/status`: retorna todas las fuentes configuradas.
- `GET /api/stream`: emite creaciones y actualizaciones canonicas.

### Endpoints funcionales adicionales

- `GET /api/tsunami/active`: productos NOAA vigentes o informativos recientes.
- `GET /api/disasters/active`: contextos GDACS recientes.

## Interfaz

1. El feed lista solo eventos canonicos.
2. Cada fila indica la fuente preferida y cantidad de fuentes asociadas.
3. El detalle permite ver todas las referencias y enlaces oficiales.
4. Peru prioriza el reporte IGP cuando existe asociacion.
5. Venezuela prioriza FUNVISIS cuando existe asociacion.
6. GDACS aparece como contexto de impacto, no como sismo adicional.
7. NOAA aparece en una franja o capa de tsunami claramente diferenciada.
8. El estado por fuente permite identificar retrasos o fallas parciales.

## Seguridad y responsabilidad

1. Aplicar timeout, validacion de esquema y limite de tamano a respuestas.
2. No ejecutar contenido HTML recibido de proveedores.
3. Mantener atribucion visible de EMSC y GDACS segun sus condiciones.
4. No llamar `alerta propia` a un indicador de la plataforma.
5. Enlazar siempre al producto oficial.

## Criterios de aceptacion

1. Las cuatro fuentes sismicas pueden ingerir respuestas reales.
2. Dos referencias compatibles producen un solo evento visible.
3. Todas las referencias originales quedan consultables.
4. IGP es preferido para eventos asociados dentro de Peru.
5. FUNVISIS es preferido para eventos asociados dentro de Venezuela.
6. Una fuente caida no detiene las demas.
7. GDACS y NOAA se persisten en tablas y endpoints separados.
8. El mapa no duplica marcadores por proveedor.
9. Typecheck, build, validacion funcional y tests unitarios finalizan sin error.

## Plan de validacion

1. Ingesta real por cada endpoint.
2. Reingesta idempotente por identificador de fuente.
3. Asociacion controlada de candidatos USGS/EMSC.
4. Preferencia IGP en un evento de Peru.
5. Preferencia FUNVISIS en un evento de Venezuela.
6. Persistencia y consulta de GDACS.
7. Persistencia y consulta CAP NOAA.
8. Falla simulada de una fuente con continuidad de las demas.
9. Inspeccion visual del feed canonico y estado multi-fuente.

## Plan de tests unitarios

1. Normalizador USGS.
2. Normalizador EMSC.
3. Normalizador IGP y conversion correcta de hora UTC.
4. Normalizador FUNVISIS y generacion de identificador estable.
5. Normalizador GDACS.
6. Parser CAP NOAA.
7. Calculo de prioridad regional.
8. Reglas limite de deduplicacion.

## Matriz de trazabilidad

| Requisito | Implementacion | Evidencia |
| --- | --- | --- |
| Catalogo multi-fuente | `apps/worker/src/providers` | ejecuciones reales por fuente |
| Evento canonico unico | servicio de asociacion + PostGIS | prueba de duplicidad |
| Trazabilidad | `event_source_refs` | consulta de detalle API |
| Peru oficial | adaptador IGP + prioridad regional | evento IGP asociado |
| Venezuela oficial | adaptador FUNVISIS + prioridad regional | evento FUNVISIS asociado |
| Impacto | adaptador y tabla GDACS | `/api/disasters/active` |
| Tsunami | parser y tabla NOAA | `/api/tsunami/active` |
| Continuidad parcial | orquestacion aislada | prueba de fuente caida |
