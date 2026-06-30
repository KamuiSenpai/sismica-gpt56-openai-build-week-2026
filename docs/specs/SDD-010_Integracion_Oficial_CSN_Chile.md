# SDD-010 Integracion Oficial CSN Chile

## Estado

Vigente para implementacion y validacion.

## Documentos fuente

Esta especificacion complementa:

1. `SDD-003_Integracion_Multifuente_y_Deduplicacion_Sismica.md`.
2. `SDD-004_Ampliacion_de_Fuentes_Oficiales_y_Reconciliacion_Sismica.md`.
3. `SDD-009_Integracion_Oficial_SSN_Mexico.md`.

## Objetivo

Incorporar la fuente oficial del `Centro Sismologico Nacional de Chile (CSN)`
para reforzar la cobertura operacional en Chile y su borde costero.

## Decision de alcance

### Fuente aprobada en esta entrega

| Codigo | Institucion                          | Canal oficial validado                                      | Formato                  | Frecuencia |
| ------ | ------------------------------------ | ----------------------------------------------------------- | ------------------------ | ---------- |
| `CSN`  | Centro Sismologico Nacional de Chile | `https://www.sismologia.cl/` + informes oficiales enlazados | HTML server-side oficial | 180 s      |

### Hallazgos de verificacion

1. El `fdsnws/event/1` previamente evaluado no entrego un contrato operativo
   confiable para esta plataforma.
2. La portada oficial `https://www.sismologia.cl/` publica la lista de ultimos
   sismos con enlace oficial por evento.
3. Cada informe oficial contiene `Referencia`, `Hora UTC`, `Latitud`,
   `Longitud`, `Profundidad` y `Magnitud`.
4. No se detecto un `JSON` o `GeoJSON` oficial publico en la portada o en el
   detalle del informe.

## Contrato externo aprobado

### Portada oficial

- Endpoint: `https://www.sismologia.cl/`
- Contenido observado:
  - enlace a informe
  - hora publicada
  - referencia geografica resumida
  - profundidad
  - magnitud

### Informe oficial por evento

- Patron: `https://www.sismologia.cl/sismicidad/informes/{yyyy}/{mm}/{id}.html`
- Campos observados:
  - `Referencia`
  - `Hora UTC`
  - `Latitud`
  - `Longitud`
  - `Profundidad`
  - `Magnitud`

## Normalizacion interna

1. `sourceEventId` se obtiene del identificador numerico del informe.
2. `eventTimeUtc` se obtiene de `Hora UTC`.
3. `title` se construye como `M{magnitud} - {referencia}`.
4. `magnitudeType` se obtiene del sufijo de `Magnitud` cuando existe
   (ejemplo: `MLv`).
5. `sourceUrl` y `detailUrl` apuntan al informe oficial del evento.
6. `status` se normaliza como `official`.

## Deduplicacion y prioridad regional

Se mantienen los umbrales vigentes:

1. 60 segundos.
2. Menos de 100 km.
3. Menos de 0.5 unidades de magnitud cuando ambos valores existen.

Orden de preferencia agregado:

| Zona  | Orden principal         |
| ----- | ----------------------- |
| Chile | CSN, USGS, GEOFON, EMSC |

## Cambios de software requeridos

1. Ampliar `SourceCode` y `OperationalSourceCode` con `CSN`.
2. Agregar `CSN_HOME_URL` a configuracion.
3. Incorporar `csnProvider`.
4. Ajustar prioridad regional para Chile en `eventAssociationService`.
5. Incorporar `CSN` en estado operativo de API y en marcadores del frontend.

## Criterios de aceptacion

1. La portada oficial del `CSN` responde y expone enlaces de informes.
2. El detalle oficial se normaliza correctamente.
3. La prioridad regional favorece `CSN` en Chile.
4. La API expone el estado operativo de `CSN`.
5. Typecheck, pruebas unitarias y build concluyen sin errores.
