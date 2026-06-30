# SDD-001 Plataforma Funcional de Visualizacion Sismica

## Estado

Vigente. Plataforma funcional en evolucion controlada.

## Documentos fuente

Este `SDD` deriva de los siguientes documentos base:

1. `output/doc/01_Informe_de_Alcance_y_Diseno_Funcional_de_la_Plataforma_de_Visualizacion_Sismica.docx`
2. `output/doc/02_Informe_Tecnico_de_Arquitectura_Desarrollo_y_Entorno_WSL2_de_la_Plataforma_de_Visualizacion_Sismica.docx`

Las decisiones de este documento deben leerse como una traduccion tecnica del
contenido ya aprobado en esos dos informes.

## Objetivo del documento

Especificar la plataforma funcional para visualizacion de eventos
sismicos sobre mapa interactivo, usando `TypeScript`, `Node.js`,
`PostgreSQL con extension PostGIS`, `CesiumJS`, `SSE` y una estructura de
carpetas ordenada por responsabilidad.

## Alcance funcional vigente

Derivado del informe funcional y tecnico, la plataforma cubre:

1. Ingesta de eventos sismicos desde `USGS`.
2. Persistencia de eventos en `PostgreSQL` con extension `PostGIS`.
3. API propia para consulta de eventos, estado de fuentes y resumen de mapa.
4. Globo 3D interactivo con `CesiumJS` para visualizar epicentros y detalle de eventos.
5. Actualizacion en vivo del frontend mediante `SSE`.
6. Worker de ingesta periodica.
7. Canal complementario para evolucion futura con `EMSC WebSocket`.

## Fuera de alcance en esta fase

1. Registro o busqueda de personas desaparecidas.
2. Datos personales o formularios ciudadanos.
3. Alertas oficiales emitidas por la plataforma.
4. Integracion completa con multiples fuentes en paralelo.
5. Autenticacion de usuarios.
6. Dashboard administrativo completo.
7. Analitica avanzada o prediccion sismica.
8. Reemplazo del globo 3D por un mapa plano en esta etapa.

## Problema que resuelve

Centralizar y visualizar eventos sismicos en una interfaz geoespacial clara,
trazable y actualizable, sin depender directamente del consumo cliente a cada
fuente externa.

## Objetivos funcionales

1. Mostrar eventos sismicos recientes en un mapa.
2. Permitir filtro por magnitud minima.
3. Permitir filtro por ventana temporal.
4. Mostrar magnitud, profundidad, coordenadas, fecha y fuente.
5. Exponer un canal en vivo para nuevos eventos ingeridos.
6. Mantener trazabilidad a la fuente original.

## Arquitectura propuesta

```text
USGS feed
  -> worker de ingesta
  -> normalizacion
  -> PostgreSQL con extension PostGIS
  -> API REST + SSE
  -> frontend web con globo 3D CesiumJS
```

## Decisiones heredadas de los documentos base

1. `CesiumJS` es el motor geoespacial de la etapa 1.
2. El mapa plano con `Leaflet` queda descartado para la plataforma vigente.
3. La persistencia aprobada es `PostgreSQL con extension PostGIS`.
4. El canal en vivo de la plataforma sera `SSE`.
5. `EMSC WebSocket` queda documentado como capacidad complementaria o de fase
   siguiente, no como requisito minimo para la primera implementacion.
6. `USGS` es la fuente primaria operativa de la plataforma.

## Estructura objetivo de carpetas

```text
apps/
  api/
  web/
  worker/
packages/
  shared/
db/
  migrations/
docs/
  specs/
  validation/
```

## Responsabilidades por modulo

### `apps/api`

- Exponer endpoints REST de la plataforma.
- Servir canal `SSE` para eventos nuevos.
- Consultar `PostgreSQL + PostGIS`.
- Transformar datos a contratos del frontend.

### `apps/worker`

- Consultar `USGS`.
- Normalizar payload externo.
- Insertar o actualizar eventos.
- Publicar eventos nuevos al canal interno.

### `apps/web`

- Renderizar mapa.
- Consumir API REST.
- Suscribirse a `SSE`.
- Mostrar lista de eventos y detalle.

### `packages/shared`

- Tipos comunes.
- Contratos de eventos.
- Utilidades de validacion livianas si hacen falta.

### `db/migrations`

- Crear extension `postgis`.
- Crear tablas.
- Crear indices espaciales.

## Stack tecnico aprobado

- `Frontend`: `React + TypeScript + Vite + CesiumJS`
- `Backend API`: `Node.js + TypeScript + Express`
- `Worker`: `Node.js + TypeScript`
- `Persistencia`: `PostgreSQL con extension PostGIS`
- `Canal en vivo`: `SSE`
- `Fuente inicial`: `USGS`

## Modelo de datos minimo

### Tabla `seismic_events`

- `event_id`
- `source`
- `source_event_id`
- `title`
- `magnitude`
- `magnitude_type`
- `depth_km`
- `event_time_utc`
- `updated_at_utc`
- `status`
- `source_url`
- `geom`
- `raw_payload`
- `created_at`
- `ingested_at`

Notas derivadas del informe tecnico:

1. `geom` debe tener indice espacial `GiST`.
2. El sistema debe conservar latitud y longitud de forma utilizable para mapa.
3. La persistencia debe habilitar consultas por region y proximidad.

### Tabla `ingestion_runs`

- `run_id`
- `source`
- `started_at`
- `finished_at`
- `status`
- `inserted_count`
- `updated_count`
- `error_message`

## Reglas funcionales

1. Un evento debe conservar referencia a su fuente.
2. La API no expone `raw_payload` al frontend por defecto.
3. El mapa debe centrarse sobre eventos disponibles al cargar.
4. La ingesta no debe duplicar eventos identicos.
5. El frontend debe poder refrescar sin recargar la pagina completa.

## Reglas de deduplicacion vigentes

Para la fase inicial se aprueban estas reglas:

1. Si `source_event_id` ya existe para una misma fuente, se actualiza el evento.
2. No se fusionan eventos de distintas fuentes en esta primera version.
3. La deduplicacion cross-source queda para una fase posterior.
4. Si luego se incorpora `EMSC`, la fusion cross-source requerira nueva
   actualizacion del `SDD`.

## API minima requerida

### `GET /api/health`

Retorna estado general del servicio.

### `GET /api/events`

Parametros:

- `minMagnitude`
- `hours`
- `limit`

Respuesta:

- lista de eventos ordenados por fecha descendente.

### `GET /api/events/:eventId`

Retorna detalle de un evento.

### `GET /api/sources/status`

Retorna estado de la fuente `USGS` y ultima ingesta.

### `GET /api/stream`

Canal `SSE` para eventos nuevos.

## Experiencia minima del frontend

1. Globo 3D `CesiumJS`.
2. Panel lateral con eventos recientes.
3. Filtro por magnitud minima.
4. Indicador de ultima sincronizacion.
5. Popup por evento con detalle.
6. Actualizacion en vivo al llegar un nuevo evento.
7. Estado visible de la fuente y de la ultima ingesta.

## Requisitos no funcionales

1. Arquitectura separada por responsabilidades.
2. Tipado consistente entre API, worker y frontend.
3. Persistencia espacial con `PostgreSQL + PostGIS`.
4. Documentacion trazable antes de implementacion.
5. Logs de ingesta y errores controlados.
6. Configuracion por variables de entorno.

## Riesgos tecnicos

1. No disponer de `PostgreSQL + PostGIS` localmente.
2. Variaciones o caidas de `USGS`.
3. Latencia del canal en vivo.
4. Consultas espaciales mal indexadas.
5. Falta de separacion entre logica de dominio y acceso a datos.
6. Desalineacion entre `SDD` y documentos Word base.

## Mitigaciones

1. Definir migraciones SQL desde el inicio.
2. Mantener una fuente primaria activa mientras se implementa la deduplicacion multi-fuente.
3. Usar `SSE` en lugar de `WebSocket` para reducir complejidad.
4. Crear indice espacial `GiST` sobre `geom`.
5. Mantener tipos y contratos en `packages/shared`.
6. Actualizar primero los documentos Word si cambia una decision de arquitectura.

## Criterios de aceptacion de la plataforma funcional

1. La base crea la extension `postgis` y tablas requeridas.
2. El worker puede ingerir al menos un feed real de `USGS`.
3. La API responde `health`, `events`, `event detail`, `source status`.
4. El frontend muestra eventos reales en mapa.
5. Un nuevo evento insertado puede notificarse por `SSE`.
6. La estructura del repo coincide con la arquitectura definida.

## Trazabilidad a documentos fuente

| Decision | Fuente Word base |
| --- | --- |
| Etapa 1 limitada a mapa, integracion sismica e interactividad en vivo | Informe 01 |
| Exclusion de busqueda de personas y alertas propias | Informe 01 |
| `CesiumJS` como globo 3D de etapa 1 | Informe 01 e Informe 02 |
| `PostgreSQL con extension PostGIS` como persistencia | Informe 01 e Informe 02 |
| `SSE/WebSocket` como capacidad de canal en vivo | Informe 01 e Informe 02 |
| `WSL2` como entorno tecnico de desarrollo | Informe 02 |
| `USGS` como fuente inicial y `EMSC` como complementaria | Informe 01 e Informe 02 |

## Plan de validacion funcional

Se documentara en:

- `docs/validation/VALIDATION-001_Plataforma_Funcional_de_Visualizacion_Sismica.md`

Casos minimos previstos:

1. Carga inicial de eventos.
2. Filtro por magnitud.
3. Visualizacion de detalle.
4. Estado de fuente.
5. Insercion de nuevo evento y recepcion en vivo.

## Plan de tests unitarios

Se documentara en:

- `docs/validation/TEST-001_Plataforma_Funcional_de_Visualizacion_Sismica.md`

Cobertura minima esperada:

1. Normalizacion de payload `USGS`.
2. Reglas de deduplicacion por `source_event_id`.
3. Mapeo de filas de base de datos a contrato API.
4. Validacion de query params criticos.

## Matriz minima de trazabilidad

| Requisito | Modulo | Validacion |
| --- | --- | --- |
| Mostrar eventos en mapa | `apps/web`, `apps/api` | carga inicial |
| Ingestar eventos USGS | `apps/worker` | corrida de ingesta |
| Persistir geometrias | `db/migrations`, `apps/api`, `apps/worker` | consulta espacial basica |
| Notificar nuevos eventos | `apps/api`, `apps/worker`, `apps/web` | prueba `SSE` |

## Condicion de salida de esta etapa

La implementacion puede iniciar solo cuando este `SDD` sea aceptado como base
de construccion.
