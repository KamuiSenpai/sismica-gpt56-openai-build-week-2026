# SDD-014 Monitoreo Experimental de Estaciones y Propagacion Sismica

## Estado

Vigente para implementacion y validacion.

## Documentos matriz

Esta especificacion deriva de:

1. `output/doc/01_Informe_de_Alcance_y_Diseno_Funcional_de_la_Plataforma_de_Visualizacion_Sismica.docx`, version 1.7.
2. `output/doc/02_Informe_Tecnico_de_Arquitectura_Desarrollo_y_Entorno_WSL2_de_la_Plataforma_de_Visualizacion_Sismica.docx`, version 1.7.
3. `docs/specs/PROCESO_DE_ENTREGA_Y_VALIDACION.md`.

En caso de contradiccion prevalecen los limites de uso responsable definidos en
los documentos matriz.

## 1. Objetivo

Incorporar a la plataforma un subsistema experimental que:

1. Importe metadatos publicos de estaciones sismologicas.
2. Represente las estaciones sobre el globo CesiumJS.
3. Reciba estados y activaciones producidos por un motor cientifico externo.
4. Distribuya cambios mediante API y SSE.
5. Sincronice la representacion de frentes P y S con la hora de origen del
   evento.
6. Mantenga separados los resultados experimentales del catalogo oficial.

El subsistema busca aportar observabilidad y capacidad de experimentacion. No
se considera un sistema oficial de alerta temprana.

## 2. Alcance

### 2.1 Incluido

1. Catalogo inicial de estaciones `GE` obtenido por `fdsnws-station` de GEOFON.
2. Parser FDSN text a nivel `station`.
3. Persistencia PostgreSQL/PostGIS de estaciones y ultimo estado.
4. Endpoint publico de consulta de estaciones.
5. Endpoint SSE para cambios de estado.
6. Endpoint interno autenticado para snapshots del motor cientifico.
7. Contratos para picks y origenes experimentales.
8. Simbolos triangulares y leyenda de estados en CesiumJS.
9. Detalle de estacion seleccionada.
10. Frentes P/S sincronizados con `eventTimeUtc` y `depthKm`.
11. Configuracion y guia de integracion con SeisComP en Linux.
12. Pruebas unitarias, integracion, smoke real FDSN y validacion visual.

### 2.2 Excluido

1. Implementar un cliente SeedLink o parser MiniSEED propio en Node.js.
2. Implementar STA/LTA, picking, localizacion o magnitud desde cero.
3. Exponer conexiones SeedLink al navegador.
4. Publicar origenes experimentales como eventos oficiales.
5. Emitir alertas de evacuacion, tsunami, daño o tiempo de llegada oficial.
6. Integrar directamente estaciones IGP sin un canal publico documentado o un
   acuerdo institucional.
7. Copiar codigo, recursos o interfaz de GlobalQuake 1.1.2.

## 3. Fuentes y herramientas aprobadas

| Elemento                    | Fuente o herramienta        | Uso                                          |
| --------------------------- | --------------------------- | -------------------------------------------- |
| Metadatos iniciales         | GEOFON FDSN Station         | Catalogo de estaciones `GE`                  |
| Formato de metadatos        | FDSN StationXML / FDSN text | Contrato estandar de red y estacion          |
| Flujo de formas de onda     | SeedLink                    | Entrada exclusiva del motor cientifico       |
| Procesamiento               | SeisComP                    | Picking, asociacion, localizacion y magnitud |
| Fuente nacional prioritaria | IGP/CENSIS                  | Comparacion oficial; no SeedLink asumido     |
| Visualizacion               | CesiumJS                    | Estaciones y propagacion estimada            |

Referencias:

- https://geofon.gfz.de/waveform/seedlink.php
- https://geofon.gfz.de/fdsnws/station/1/
- https://www.fdsn.org/xml/station/
- https://docs.gempa.de/seiscomp/current/apps/scautopick.html
- https://docs.gempa.de/seiscomp/5.5.9/apps/scautoloc.html
- https://docs.gempa.de/seiscomp/current/apps/scmag.html
- https://ultimosismo.igp.gob.pe/red-sismica-nacional

## 4. Arquitectura

```text
GEOFON FDSN Station -----------------------> station catalog provider

SeedLink -> SeisComP Linux
              |
              +-> station states / picks / experimental origins
                              |
                              v
                    internal API adapter
                              |
                              v
                PostgreSQL/PostGIS + NOTIFY
                              |
                    +---------+---------+
                    |                   |
                 REST API              SSE
                    |                   |
                    +---------+---------+
                              |
                         React/CesiumJS
```

### 4.1 Responsabilidades

| Modulo             | Responsabilidad                                               |
| ------------------ | ------------------------------------------------------------- |
| `apps/worker`      | Importar y actualizar catalogo FDSN                           |
| `apps/api`         | Consultar estaciones, recibir snapshots internos y emitir SSE |
| `packages/shared`  | Contratos, validacion estructural y tipos                     |
| PostgreSQL/PostGIS | Persistencia, idempotencia y consulta geoespacial             |
| SeisComP           | Procesamiento de formas de onda                               |
| `apps/web`         | Renderizado, seleccion, leyenda y estado experimental         |

## 5. Modelo de datos

### 5.1 `seismic_stations`

| Campo                    | Tipo                 | Regla                          |
| ------------------------ | -------------------- | ------------------------------ |
| `station_id`             | text PK              | `FUENTE:RED.ESTACION`          |
| `source`                 | text                 | Fuente de metadatos            |
| `network_code`           | text                 | Codigo FDSN                    |
| `station_code`           | text                 | Codigo FDSN                    |
| `site_name`              | text nullable        | Nombre publicado               |
| `country_code`           | text nullable        | ISO alfa-2 cuando sea conocido |
| `latitude` / `longitude` | geography point      | Rango geografico valido        |
| `elevation_m`            | double nullable      | Elevacion publicada            |
| `start_time_utc`         | timestamptz nullable | Inicio operativo               |
| `end_time_utc`           | timestamptz nullable | Fin operativo                  |
| `source_url`             | text                 | Atribucion consultable         |
| `raw_metadata`           | jsonb                | Registro FDSN original         |
| `metadata_updated_at`    | timestamptz          | Hora de sincronizacion         |

Restriccion unica adicional: `(source, network_code, station_code)`.

### 5.2 `station_states`

Una fila vigente por estacion.

| Campo             | Tipo             | Regla                                                  |
| ----------------- | ---------------- | ------------------------------------------------------ |
| `station_id`      | text PK/FK       | Estacion existente                                     |
| `status`          | text             | `unknown`, `online`, `delayed`, `offline`, `triggered` |
| `phase`           | text nullable    | `P`, `S` o `UNKNOWN`                                   |
| `latency_ms`      | integer nullable | Mayor o igual a cero                                   |
| `trigger_value`   | double nullable  | Valor normalizado del motor                            |
| `observed_at_utc` | timestamptz      | No mas de 5 minutos en el futuro                       |
| `sequence`        | bigint           | Monotono por estacion                                  |
| `engine`          | text             | Motor y version                                        |
| `raw_payload`     | jsonb            | Mensaje original                                       |

Una actualizacion con `sequence` menor o igual a la almacenada no reemplaza el
estado vigente.

### 5.3 `seismic_picks`

| Campo           | Tipo            | Regla                        |
| --------------- | --------------- | ---------------------------- |
| `pick_id`       | text PK         | Idempotente desde el motor   |
| `station_id`    | text FK         | Estacion conocida            |
| `phase`         | text            | `P`, `S` o `UNKNOWN`         |
| `pick_time_utc` | timestamptz     | Hora de llegada              |
| `snr`           | double nullable | Mayor o igual a cero         |
| `amplitude`     | double nullable | Valor producido por el motor |
| `algorithm`     | text            | Nombre y version             |
| `raw_payload`   | jsonb           | Mensaje original             |

### 5.4 `experimental_origins`

| Campo                    | Tipo             | Regla                                            |
| ------------------------ | ---------------- | ------------------------------------------------ |
| `origin_id`              | text PK          | Idempotente desde el motor                       |
| `origin_time_utc`        | timestamptz      | Hora de origen calculada                         |
| `latitude` / `longitude` | geography point  | Coordenada valida                                |
| `depth_km`               | double           | Entre 0 y 800                                    |
| `magnitude`              | double nullable  | Entre -2 y 10                                    |
| `station_count`          | integer          | Mayor o igual a 4 para estado `located`          |
| `rms_sec`                | double nullable  | Residual del ajuste                              |
| `azimuthal_gap_deg`      | double nullable  | Entre 0 y 360                                    |
| `quality`                | text             | `preliminary`, `acceptable`, `rejected`          |
| `status`                 | text             | `candidate`, `located`, `discarded`, `confirmed` |
| `official_event_id`      | text nullable FK | Solo despues de reconciliacion                   |
| `engine`                 | text             | Motor y version                                  |
| `raw_payload`            | jsonb            | Mensaje original                                 |

Los origenes experimentales no se insertan en `seismic_events`.

## 6. Contratos compartidos

### 6.1 Estacion publica

```ts
type StationStatus = "unknown" | "online" | "delayed" | "offline" | "triggered";
type StationPhase = "P" | "S" | "UNKNOWN";

type SeismicStation = {
  stationId: string;
  source: "GEOFON";
  networkCode: string;
  stationCode: string;
  siteName: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  startTimeUtc: string | null;
  endTimeUtc: string | null;
  status: StationStatus;
  phase: StationPhase | null;
  latencyMs: number | null;
  triggerValue: number | null;
  observedAtUtc: string | null;
  sourceUrl: string;
};
```

### 6.2 Snapshot interno

```ts
type StationSnapshotInput = {
  schemaVersion: 1;
  engine: string;
  states: Array<{
    stationId: string;
    status: StationStatus;
    phase?: StationPhase;
    latencyMs?: number;
    triggerValue?: number;
    observedAtUtc: string;
    sequence: number;
  }>;
  picks?: Array<{
    pickId: string;
    stationId: string;
    phase: StationPhase;
    pickTimeUtc: string;
    snr?: number;
    amplitude?: number;
    algorithm: string;
  }>;
};
```

Limites por solicitud:

- Maximo 1.000 estados.
- Maximo 5.000 picks.
- Cuerpo maximo 2 MiB.

## 7. API

### 7.1 `GET /api/stations`

Parametros:

| Parametro  | Regla                              |
| ---------- | ---------------------------------- |
| `bbox`     | `west,south,east,north`            |
| `status`   | Lista de estados separada por coma |
| `network`  | Codigo exacto                      |
| `activeAt` | ISO UTC opcional                   |
| `limit`    | 1 a 5.000; default 1.000           |

Respuesta:

```json
{
  "generatedAt": "2026-06-30T00:00:00.000Z",
  "items": [],
  "count": 0
}
```

### 7.2 `GET /api/stations/stream`

SSE con:

- `event: station.state`
- `id`: `stationId:sequence`
- `data`: estado vigente para fusionar sobre la estacion publica

Debe enviar heartbeat cada 20 segundos.

### 7.3 `POST /internal/seismic-engine/snapshots`

Reglas:

1. Requiere header `x-seismic-engine-token`.
2. El token se compara en tiempo constante.
3. Si `SEISMIC_ENGINE_TOKEN` no esta configurado, responde `503`.
4. Payload invalido responde `400`.
5. Token invalido responde `401`.
6. Insercion idempotente responde con conteos `accepted`, `ignored`, `picks`.

### 7.4 Origenes experimentales

`POST /internal/seismic-engine/origins` usa la misma autenticacion. La primera
entrega implementa persistencia y validacion, pero no publica estos origenes en
el feed global.

## 8. Importacion FDSN

Endpoint inicial:

```text
https://geofon.gfz.de/fdsnws/station/1/query
  ?net=GE
  &level=station
  &format=text
  &starttime=<UTC actual>
  &includeRestricted=false
```

Reglas:

1. Ignorar lineas vacias y comentarios.
2. Resolver columnas por nombre, no por posicion fijo.
3. Rechazar filas sin red, estacion o coordenadas validas.
4. Formar `stationId` estable con fuente, red y estacion.
5. Actualizar por `UPSERT`.
6. No eliminar estaciones ausentes en una sola respuesta.
7. Refrescar como maximo cada 24 horas por defecto.
8. Conservar atribucion y payload original.

## 9. Integracion SeisComP

El motor se ejecuta en Ubuntu 24.04 sobre WSL2, maquina virtual o servidor
Linux. La configuracion recomendada usa:

1. `SeedLink` para formas de onda.
2. `scautopick` para detecciones y picks.
3. `scautoloc` con perfil `iasp91` para origenes.
4. `scamp` y `scmag` para amplitudes y magnitudes.
5. Un adaptador independiente para convertir salidas a los contratos internos.

La plataforma TypeScript no afirma que SeisComP esta operativo solo por existir
la configuracion. El estado se considera `configured`, `connected`, `degraded`
o `offline` segun evidencia reciente.

## 10. Visualizacion CesiumJS

### 10.1 Estaciones

1. Simbolo: triangulo de dimensiones estables.
2. `unknown`: gris.
3. `online`: azul/celeste.
4. `delayed`: amarillo.
5. `offline`: rojo oscuro.
6. `triggered`: verde lima.
7. Fase `P`: acento celeste.
8. Fase `S`: acento naranja.
9. La leyenda debe declarar que son estados experimentales.
10. Las estaciones se pueden ocultar mediante un control de capa.

### 10.2 Propagacion

Para un evento con profundidad `h`, velocidad `v` y tiempo transcurrido `t`:

```text
radio_superficie(t) = sqrt((v * t)^2 - h^2), si v * t >= h
```

Valores iniciales configurables:

- `Vp = 6.5 km/s`
- `Vs = 3.75 km/s`

Reglas:

1. `t` se calcula desde `eventTimeUtc`, no desde el clic.
2. No se usa aceleracion temporal en modo en vivo.
3. Un evento antiguo no reinicia ondas al seleccionarse.
4. El replay acelerado solo puede existir como modo explicito y etiquetado.
5. La representacion es estimada y no sustituye tiempos de viaje calculados por
   el motor.

## 11. Requisitos funcionales

| Codigo  | Requisito                                               |
| ------- | ------------------------------------------------------- |
| RF-1401 | Importar estaciones GEOFON desde FDSN text              |
| RF-1402 | Persistir estaciones de forma idempotente               |
| RF-1403 | Consultar estaciones por API y filtros                  |
| RF-1404 | Recibir snapshots internos autenticados                 |
| RF-1405 | Rechazar secuencias antiguas                            |
| RF-1406 | Persistir picks idempotentes                            |
| RF-1407 | Persistir origenes experimentales sin mezclar catalogos |
| RF-1408 | Emitir cambios de estado por SSE                        |
| RF-1409 | Renderizar estaciones y estados en CesiumJS             |
| RF-1410 | Mostrar detalle y atribucion de estacion                |
| RF-1411 | Sincronizar frentes P/S con hora de origen              |
| RF-1412 | Permitir ocultar la capa de estaciones                  |

## 12. Requisitos no funcionales

| Codigo   | Requisito                                         |
| -------- | ------------------------------------------------- |
| RNF-1401 | Token interno fuera del frontend y repositorio    |
| RNF-1402 | Fechas y secuencias validadas                     |
| RNF-1403 | Importacion FDSN tolerante a columnas adicionales |
| RNF-1404 | Maximo 5.000 estaciones renderizadas              |
| RNF-1405 | Actualizacion visual sin recrear el Viewer        |
| RNF-1406 | Cero alertas oficiales producidas por el modulo   |
| RNF-1407 | Typecheck, tests, build y migraciones correctos   |
| RNF-1408 | Interfaz utilizable en escritorio y movil         |
| RNF-1409 | Trazabilidad de fuente, motor y payload           |

## 13. Criterios de aceptacion

1. El smoke real de GEOFON devuelve y parsea estaciones.
2. Dos importaciones iguales no crean duplicados.
3. La API lista estaciones con coordenadas y estado.
4. Un snapshot valido actualiza estado y genera evento SSE.
5. Un snapshot con secuencia anterior se ignora.
6. Un token incorrecto no modifica la base.
7. Picks repetidos no se duplican.
8. Origenes experimentales no aparecen en `/api/events`.
9. CesiumJS muestra triangulos sin solapamientos incoherentes con el feed.
10. La capa puede ocultarse.
11. Los frentes P/S reflejan el tiempo real del evento.
12. Tests, typecheck, build, migraciones y validacion visual concluyen sin
    errores.

## 14. Riesgos y mitigaciones

| Riesgo                      | Mitigacion                                               |
| --------------------------- | -------------------------------------------------------- |
| Falsos triggers             | No convertir estados o picks en alertas                  |
| Estacion ruidosa            | Conservar estado, SNR y motor; permitir descarte externo |
| Caida SeedLink              | Estado degradado y aislamiento del catalogo oficial      |
| Cambio FDSN                 | Parser por cabecera y fixtures                           |
| Exceso de entidades Cesium  | Limite, capa conmutable y actualizacion incremental      |
| Exposicion del adaptador    | Token, limite de cuerpo y ruta interna                   |
| Confusion del usuario       | Etiqueta experimental y leyenda explicita                |
| Cobertura Peru insuficiente | Gestionar convenio con IGP; no inventar acceso           |

## 15. Trazabilidad

| Requisito                 | Implementacion prevista       | Validacion        |
| ------------------------- | ----------------------------- | ----------------- |
| RF-1401, RF-1402          | worker provider + repository  | UT-1401, VF-1401  |
| RF-1403                   | API station repository/router | UT-1402, VF-1402  |
| RF-1404, RF-1405          | internal adapter              | UT-1403, VF-1403  |
| RF-1406                   | pick repository               | UT-1404, VF-1404  |
| RF-1407                   | origin repository             | UT-1405, VF-1405  |
| RF-1408                   | PostgreSQL NOTIFY + SSE       | VF-1406           |
| RF-1409, RF-1410, RF-1412 | Cesium station layer          | VF-1407, VV-1401  |
| RF-1411                   | wavefront time model          | UT-1406, VF-1408  |
| RNF-1401 a RNF-1409       | configuracion y gates         | VT-1401 a VT-1407 |
