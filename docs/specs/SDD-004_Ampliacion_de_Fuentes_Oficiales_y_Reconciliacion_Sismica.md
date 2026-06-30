# SDD-004 Ampliacion de Fuentes Oficiales y Reconciliacion Sismica

## Estado

Vigente para implementacion y validacion.

## Documentos fuente

Esta especificacion complementa:

1. `SDD-001_Plataforma_Funcional_de_Visualizacion_Sismica.md`.
2. `SDD-002_Interfaz_Operativa_de_Monitoreo_Sismico.md`.
3. `SDD-003_Integracion_Multifuente_y_Deduplicacion_Sismica.md`.
4. Los informes profesionales ubicados en `output/doc`.

## Objetivo

Ampliar la cobertura institucional de la plataforma mediante servicios
oficiales, publicos y tecnicamente mantenibles, sin duplicar eventos ni
presentar como tiempo real una fuente de revision diferida.

## Decision de alcance

### Fuentes aprobadas para integracion operativa

| Codigo | Institucion | Funcion | Interfaz | Frecuencia |
| --- | --- | --- | --- | --- |
| `GEOFON` | GFZ German Research Centre for Geosciences | catalogo global complementario | FDSN Event, formato texto | 120 s |
| `GEONET` | GeoNet New Zealand | catalogo e intensidad regional | GeoJSON version 2 | 120 s |

Endpoints aprobados:

- GEOFON: `https://geofon.gfz.de/fdsnws/event/1/query`.
- GeoNet: `https://api.geonet.org.nz/quake?MMI=-1`.

GeoNet debe solicitar explicitamente
`Accept: application/vnd.geo+json;version=2`. GEOFON se consume con parametros
temporales, limite de registros y `format=text`.

### Fuentes institucionales no habilitadas como ingesta automatica

| Institucion | Evaluacion | Decision |
| --- | --- | --- |
| DHN/CNAT Peru | autoridad nacional para boletines de tsunami, sin API publica documentada localizada | mantener enlace y gestionar acceso institucional; no extraer HTML |
| SGC Colombia | catalogo oficial disponible; el servicio ArcGIS publico evaluado termina en 2020 | no usar como fuente actual hasta disponer de un servicio vigente y documentado |
| CSN Chile | publica FDSN de estaciones, formas de onda y disponibilidad; no se confirmo FDSN Event publico | no inferir eventos desde formas de onda ni extraer la pagina web |
| ISC | FDSN publico; el boletin revisado tiene retraso y las contribuciones recientes pueden no estar consolidadas | disenar una reconciliacion historica separada; no mezclar con el mapa en vivo |

Estas instituciones permanecen en el registro documental de fuentes
candidatas. Su activacion requiere endpoint oficial vigente, condiciones de
uso identificadas, contrato de datos y prueba de continuidad.

## Clasificacion operacional

1. `USGS`, `EMSC`, `IGP`, `FUNVISIS`, `GEOFON` y `GEONET` son fuentes de
   observacion operativa.
2. `ISC` es una fuente candidata para reconciliacion historica, fuera del
   worker operativo de esta entrega.
3. `GDACS` conserva el dominio de contexto de desastre.
4. `NOAA_PTWC` y `NOAA_NTWC` conservan el dominio de productos de tsunami.
5. La plataforma no emite alertas oficiales y siempre enlaza la fuente.

## Contratos de normalizacion

### FDSN texto

El adaptador de GEOFON interpreta por nombre las columnas:

- `EventID`, `Time`, `Latitude`, `Longitude` y `Depth/km`.
- `Author`, `Catalog`, `Contributor` y `ContributorID`.
- `MagType`, `Magnitude`, `MagAuthor`, `EventLocationName` y `EventType`.

Una fila sin identificador, fecha valida o coordenadas validas se descarta. El
payload normalizado conserva todas las columnas para auditoria.

### GeoNet GeoJSON v2

El adaptador interpreta `publicID`, `time`, `depth`, `magnitude`, `mmi`,
`locality` y `quality`. Los eventos con `quality=deleted` se excluyen. Un MMI
negativo se conserva como dato no disponible en el contrato interno.

## Ventanas y volumen

1. GEOFON consulta la ventana global configurada y magnitud minima 2.5, con
   limite de 1000 eventos.
2. GeoNet filtra localmente la ventana configurada y magnitud minima 2.5,
   porque su endpoint retorna hasta 100 eventos potencialmente sentidos.
3. Timeout y limite de respuesta se aplican de forma uniforme.

## Deduplicacion y preferencia

Se mantienen los umbrales de SDD-003: 60 segundos, menos de 100 km y menos de
0.5 unidades de magnitud cuando ambos valores existen.

Orden de preferencia:

| Zona | Orden principal |
| --- | --- |
| Peru | IGP, USGS, GEOFON, EMSC |
| Venezuela | FUNVISIS, USGS, GEOFON, EMSC |
| Nueva Zelanda y Kermadec | GEONET, USGS, GEOFON, EMSC |
| Resto del mundo | USGS, GEOFON, EMSC |

Las fuentes regionales fuera de su zona conservan prioridad baja.

## Cambios de software

1. Ampliar `SourceCode` y `OperationalSourceCode`.
2. Incorporar un parser FDSN texto reutilizable.
3. Incorporar adaptadores `geofonProvider` y `geoNetProvider`.
4. Registrar frecuencias independientes y estados en el worker y la API.
5. Ampliar prioridades regionales sin modificar el esquema PostgreSQL, porque
   los codigos de fuente se almacenan como texto.
6. Mantener un evento canonico y referencias originales por proveedor.

## Seguridad, continuidad y responsabilidad

1. No realizar scraping de portales institucionales.
2. No usar un endpoint historico como fuente de estado actual.
3. Una falla o limitacion de tasa debe afectar solo a su adaptador.
4. Se debe conservar URL, payload y fecha de ingesta para auditoria.
5. Los datos ISC no ingresan al mapa operativo hasta contar con un proceso de
   reconciliacion historica separado.
6. La ausencia de productos CNAT no equivale a ausencia de riesgo de tsunami.

## Criterios de aceptacion

1. GEOFON y GeoNet responden mediante sus interfaces oficiales.
2. Cada adaptador normaliza una muestra contractual mediante prueba unitaria.
3. La ingesta real registra estado independiente por fuente.
4. La API lista las siete fuentes existentes y las dos nuevas, sin ocultar
   estados desconocidos o de error.
5. La reingesta por identificador es idempotente.
6. Eventos compatibles de varias fuentes producen un solo evento canonico.
7. GeoNet es preferida en su region.
8. Typecheck, build, validacion funcional y pruebas unitarias concluyen sin
   errores.

## Plan de validacion

1. Ejecutar una ingesta real de cada fuente nueva.
2. Consultar `/api/sources/status` y verificar tiempos, conteos y errores.
3. Consultar eventos y referencias en PostgreSQL.
4. Confirmar ausencia de duplicados por `(source, source_event_id)`.
5. Confirmar asociaciones multi-fuente creadas por PostGIS.
6. Verificar continuidad del frontend y de las fuentes existentes.

## Plan de pruebas unitarias

1. Parser de cabecera y fila FDSN texto.
2. Normalizacion GEOFON.
3. Normalizacion GeoNet y exclusion de eliminados.
4. Prioridad regional de GeoNet.

## Trazabilidad

| Requisito | Componente | Evidencia prevista |
| --- | --- | --- |
| Catalogo GFZ | adaptador GEOFON | ejecucion real y estado API |
| Catalogo regional NZ | adaptador GeoNet | ejecucion real y prueba GeoJSON |
| Reconciliacion | diseno futuro separado | ISC no ingresa al mapa en vivo |
| Sin duplicidad | servicio de asociacion PostGIS | referencias y asociaciones SQL |
| Transparencia | estado por fuente | `/api/sources/status` |
| Fuentes condicionadas | documentacion tecnica | matriz de decisiones institucionales |
