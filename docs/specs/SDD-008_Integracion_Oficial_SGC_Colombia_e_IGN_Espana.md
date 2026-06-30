# SDD-008 Integracion Oficial SGC Colombia e IGN Espana

## Estado

Vigente para implementacion y validacion.

## Documentos fuente

Esta especificacion complementa:

1. `SDD-003_Integracion_Multifuente_y_Deduplicacion_Sismica.md`.
2. `SDD-004_Ampliacion_de_Fuentes_Oficiales_y_Reconciliacion_Sismica.md`.
3. `SDD-006_Integracion_Oficial_JMA_Japon.md`.
4. `SDD-007_Integracion_Oficial_CWA_Taiwan.md`.

## Objetivo

Ampliar la cobertura operativa de la plataforma con dos fuentes oficiales
adicionales de alta relevancia regional:

1. `SGC` para Colombia y el norte andino.
2. `IGN` para Espana, Canarias y el entorno iberico inmediato.

La integracion debe conservar la deduplicacion multi-fuente, la prioridad
regional del organismo oficial y la trazabilidad del payload recibido.

## Decision de alcance

### Fuentes aprobadas en esta entrega

| Codigo | Institucion                             | Canal oficial validado                                      | Formato                                                          | Frecuencia |
| ------ | --------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- | ---------- |
| `SGC`  | Servicio Geologico Colombiano           | `archive.sgc.gov.co/feed/v1.0.1/summary/five_days_all.json` | GeoJSON-like JSON                                                | 120 s      |
| `IGN`  | Instituto Geografico Nacional de Espana | `.../tproximos/terremotos.js`                               | JavaScript con colecciones oficiales `dias3`, `dias10`, `dias30` | 180 s      |

### Fuentes revisadas pero no aprobadas en esta entrega

| Institucion | Hallazgo de verificacion                                                                 | Decision                                         |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| CSN Chile   | La evaluacion inicial quedo supersedida por `SDD-010_Integracion_Oficial_CSN_Chile.md`   | seguimiento trasladado a especificacion dedicada |
| INGV Italia | La evaluacion inicial quedo supersedida por `SDD-011_Integracion_Oficial_INGV_Italia.md` | seguimiento trasladado a especificacion dedicada |

## Contratos externos aprobados

### SGC

- Endpoint: `https://archive.sgc.gov.co/feed/v1.0.1/summary/five_days_all.json`
- Tipo: `FeatureCollection`
- Campo de identidad: `id`
- Campos principales:
  - `geometry.coordinates`
  - `properties.mag`
  - `properties.magType`
  - `properties.place`
  - `properties.utcTime`
  - `properties.updated`
  - `properties.status`
  - `properties.nst`, `gap`, `rms`, `cdi`, `mmi`, `felt`

Restriccion contractual:
la muestra validada publica coordenadas en orden `lat, lon, depth`, aunque el
contenedor use sintaxis tipo GeoJSON. El adaptador debe corregir ese orden de
forma explicita y documentada.

### IGN

- Endpoint: `https://www.ign.es/web/resources/sismologia/tproximos/terremotos.js`
- Tipo: JavaScript oficial con variables:
  - `dias3`
  - `dias10`
  - `dias30`
- Campo de identidad: `properties.evid`
- Campos principales:
  - `geometry.coordinates`
  - `properties.mag`
  - `properties.magtype`
  - `properties.depth`
  - `properties.fecha`
  - `properties.loc`
  - `properties.intensidad`

Restriccion contractual:
el adaptador no debe ejecutar el script remoto como codigo arbitrario. Debe
extraer el objeto JSON esperado por nombre de variable y parsearlo de forma
determinista.

## Normalizacion interna

### SGC

1. `properties.utcTime` se interpreta como hora UTC del evento.
2. `properties.updated` se interpreta como hora local de Colombia (`UTC-5`) y
   se convierte a UTC.
3. `status=manual` se normaliza como `official`.
4. `mmi=0` y `felt=0` se consideran ausencia de dato operativo.
5. `sourceUrl` y `detailUrl` apuntan a
   `https://www.sgc.gov.co/detallesismo/{id}`.

### IGN

1. `properties.fecha` se interpreta como UTC.
2. `dias3`, `dias10` o `dias30` se seleccionan segun `SOURCE_WINDOW_HOURS`.
3. `intensidad` vacia o con solo espacios se descarta.
4. `sourceUrl` y `detailUrl` apuntan al detalle oficial
   `https://www.ign.es/web/ign/portal/ultimos-terremotos/-/ultimos-terremotos/getDetails?evid={evid}`.

## Ventanas y volumen

1. `SGC` expone cinco dias de eventos; el adaptador filtra localmente por
   `SOURCE_WINDOW_HOURS`.
2. `IGN` expone ventanas publicadas de 3, 10 y 30 dias; el adaptador selecciona
   la coleccion minima suficiente y luego filtra localmente.
3. La plataforma mantiene la magnitud minima global en la capa de consulta del
   frontend/API, no en el adaptador.

## Deduplicacion y prioridad regional

Se mantienen los umbrales vigentes:

1. 60 segundos.
2. Menos de 100 km.
3. Menos de 0.5 unidades de magnitud cuando ambos valores existen.

Orden de preferencia agregado:

| Zona                                | Orden principal         |
| ----------------------------------- | ----------------------- |
| Colombia                            | SGC, USGS, GEOFON, EMSC |
| Espana / Canarias / entorno iberico | IGN, USGS, GEOFON, EMSC |

Las nuevas fuentes fuera de su zona conservan prioridad baja.

## Cambios de software requeridos

1. Ampliar `SourceCode` y `OperationalSourceCode` con `SGC` e `IGN`.
2. Agregar variables de entorno y estado operativo por fuente.
3. Incorporar `sgcProvider` e `ignProvider`.
4. Ajustar la prioridad regional en `eventAssociationService`.
5. Evitar ambiguedad visual en el feed para `IGN` frente a `IGP`.
6. Mantener aislamiento de falla por adaptador.

## Criterios de aceptacion

1. `SGC` e `IGN` responden con sus contratos oficiales verificados.
2. Cada adaptador normaliza correctamente una muestra contractual.
3. La prioridad regional favorece `SGC` en Colombia.
4. La prioridad regional favorece `IGN` en Espana.
5. La API expone el estado operativo independiente de ambas fuentes.
6. La reingesta es idempotente por `(source, source_event_id)`.
7. Typecheck, pruebas unitarias y build concluyen sin errores.

## Plan de validacion

1. Ejecutar ingesta real de `SGC` e `IGN`.
2. Verificar `/api/sources/status`.
3. Verificar eventos canonicos y referencias en PostgreSQL.
4. Confirmar detalle oficial navegable por `sourceUrl`.
5. Confirmar que el frontend no genera codigos ambiguos en el feed.
