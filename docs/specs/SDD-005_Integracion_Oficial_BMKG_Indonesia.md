# SDD-005 Integracion Oficial BMKG Indonesia

## Estado

Vigente para implementacion y validacion.

## Documentos relacionados

1. `SDD-003_Integracion_Multifuente_y_Deduplicacion_Sismica.md`.
2. `SDD-004_Ampliacion_de_Fuentes_Oficiales_y_Reconciliacion_Sismica.md`.
3. Informes profesionales ubicados en `output/doc`.

## Objetivo

Incorporar a la Badan Meteorologi, Klimatologi, dan Geofisika (`BMKG`) como
fuente sismologica nacional preferida para Indonesia, reutilizando el modelo
canonico, la auditoria de referencias y la deduplicacion PostGIS existentes.

## Fuente y autoridad

BMKG publica datos abiertos de terremotos ocurridos en Indonesia. El portal
oficial informa actualizacion por evento, formatos JSON y XML, y un limite de
60 solicitudes por minuto por direccion IP.

Portal oficial:

- `https://data.bmkg.go.id/gempabumi/`

Endpoints aprobados:

- `https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json`: ultimos 15
  terremotos de magnitud 5.0 o superior.
- `https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json`: ultimos 15
  terremotos reportados como sentidos.

No se utilizara scraping del portal HTML.

## Alcance funcional

1. Consultar ambos feeds JSON cada 120 segundos.
2. Validar la estructura externa antes de normalizar.
3. Fusionar registros repetidos entre ambos feeds.
4. Normalizar fecha UTC, coordenadas, magnitud, profundidad, region, potencial
   de tsunami e intensidad sentida.
5. Persistir el payload original y la referencia BMKG.
6. Aplicar prioridad regional BMKG dentro de Indonesia.
7. Exponer el estado independiente de BMKG mediante la API.

## Exclusiones

1. No interpretar el campo `Potensi` como una alerta de tsunami propia.
2. No descargar ni procesar imagenes ShakeMap en esta entrega.
3. No sustituir productos oficiales NOAA ni decisiones de autoridades
   nacionales de tsunami.
4. No inferir intensidad numerica cuando BMKG entrega texto por localidades.
5. No consultar con una frecuencia superior al limite publicado.

## Contrato externo

El contenedor esperado es:

```text
Infogempa.gempa[]
```

Campos utilizados:

| Campo BMKG    | Campo interno      | Regla                                  |
| ------------- | ------------------ | -------------------------------------- |
| `DateTime`    | `eventTimeUtc`     | ISO 8601 UTC obligatorio               |
| `Coordinates` | latitud y longitud | BMKG publica `latitud,longitud`        |
| `Magnitude`   | `magnitude`        | conversion numerica                    |
| `Kedalaman`   | `depthKm`          | extraer valor numerico en km           |
| `Wilayah`     | `title`            | conservar descripcion oficial          |
| `Potensi`     | `tsunami`          | verdadero solo si no contiene negacion |
| `Dirasakan`   | `intensityText`    | conservar escala y localidades         |

Una fila sin fecha valida o coordenadas validas se descarta. Los valores deben
respetar latitud `[-90, 90]` y longitud `[-180, 180]`.

## Identidad de fuente

Los feeds evaluados no incluyen un identificador explicito de evento. El
adaptador generara `source_event_id` mediante SHA-256 truncado a partir de:

```text
DateTime UTC | latitud normalizada | longitud normalizada
```

Este identificador es estable para reingestas sin cambios. Si BMKG modifica la
hora de origen o las coordenadas, puede generarse una nueva referencia; la
deduplicacion espacial y temporal entre proveedores reduce el impacto, pero el
modelo actual no fusiona automaticamente dos identificadores diferentes de la
misma fuente. Este riesgo queda registrado para una futura estrategia de
reconciliacion de revisiones nacionales.

## Fusion de feeds

1. Se normalizan ambos feeds antes de persistir.
2. Registros con el mismo `source_event_id` producen una sola referencia.
3. Cuando existe duplicidad, se prefiere el registro con `Dirasakan` porque
   aporta intensidad y localidades sentidas.
4. La fusion ocurre dentro del adaptador y no altera las reglas canonicas.

## Prioridad regional

Se utiliza una envolvente geografica conservadora para Indonesia:

```text
latitud:  -11.5 a 6.5
longitud: 94.0 a 142.0
```

Orden de preferencia regional:

1. BMKG: 100.
2. USGS: 80.
3. GEOFON: 75.
4. EMSC: 70.
5. Otras fuentes regionales fuera de su territorio: 40.

Fuera de Indonesia, BMKG conserva prioridad baja y no reemplaza una fuente
global preferida.

## Cambios de software

1. Ampliar `SourceCode` con `BMKG`.
2. Agregar variables `BMKG_LATEST_URL` y `BMKG_FELT_URL`.
3. Agregar esquema Zod del contenedor BMKG.
4. Implementar `bmkgProvider`.
5. Registrar intervalo, orquestacion y estado API.
6. Incorporar prioridad geografica para Indonesia.
7. No se requiere migracion SQL porque los codigos se almacenan como texto.

## Seguridad y continuidad

1. Aplicar timeout y limite de tamano comunes del worker.
2. Enviar identificacion de cliente mediante `User-Agent`.
3. Conservar payload original para auditoria.
4. Una falla BMKG no debe detener otros proveedores.
5. Mostrar el campo de tsunami como dato reportado por BMKG, no como alerta de
   la plataforma.

## Criterios de aceptacion

1. Ambos endpoints responden con estructura valida.
2. BMKG aparece en `/api/sources/status`.
3. La primera ingesta real finaliza con estado `success`.
4. Registros compartidos entre feeds no se duplican.
5. Una segunda ingesta es idempotente cuando el payload no cambia.
6. BMKG tiene prioridad sobre USGS en Indonesia y prioridad inferior fuera de
   esa region.
7. No existen duplicados por `(source, source_event_id)`.
8. Pruebas unitarias, typecheck y build finalizan sin errores.

## Plan de validacion funcional

1. Ejecutar worker contra los dos feeds oficiales.
2. Verificar estado y conteos en `ingestion_runs`.
3. Verificar referencias BMKG en `event_source_refs`.
4. Verificar asociaciones con eventos existentes.
5. Ejecutar segunda ingesta y comprobar idempotencia.
6. Consultar API, frontend y estado de las fuentes existentes.

## Plan de pruebas unitarias

1. Normalizacion de fecha, coordenadas, magnitud y profundidad.
2. Interpretacion negativa y positiva de potencial de tsunami.
3. Conservacion de intensidad textual.
4. Identificador determinista.
5. Fusion de registros duplicados de ambos feeds.
6. Prioridad BMKG dentro y fuera de Indonesia.

## Trazabilidad

| Requisito          | Componente                     | Evidencia prevista             |
| ------------------ | ------------------------------ | ------------------------------ |
| Consulta oficial   | `bmkgProvider`                 | ejecucion real                 |
| Validacion externa | esquema Zod                    | rechazo de contenedor invalido |
| Sin duplicidad     | fusion del adaptador + PostGIS | conteos SQL                    |
| Prioridad nacional | `sourcePriority`               | prueba regional                |
| Observabilidad     | `ingestion_runs` y API         | estado BMKG                    |
