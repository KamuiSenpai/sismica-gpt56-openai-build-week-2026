# SDD-009 Integracion Oficial SSN Mexico

## Estado

Vigente para implementacion y validacion.

## Documentos fuente

Esta especificacion complementa:

1. `SDD-003_Integracion_Multifuente_y_Deduplicacion_Sismica.md`.
2. `SDD-004_Ampliacion_de_Fuentes_Oficiales_y_Reconciliacion_Sismica.md`.
3. `SDD-008_Integracion_Oficial_SGC_Colombia_e_IGN_Espana.md`.

## Objetivo

Incorporar la fuente oficial del `Servicio Sismologico Nacional de Mexico
(SSN)` para mejorar la cobertura operacional del sistema en el territorio
mexicano y sus zonas marinas inmediatas.

## Decision de alcance

### Fuente aprobada en esta entrega

| Codigo | Institucion                             | Canal oficial validado                          | Formato                            | Frecuencia |
| ------ | --------------------------------------- | ----------------------------------------------- | ---------------------------------- | ---------- |
| `SSN`  | Servicio Sismologico Nacional de Mexico | `http://www.ssn.unam.mx/rss/ultimos-sismos.xml` | RSS 2.0 con `geo:lat` y `geo:long` | 120 s      |

### Hallazgos de verificacion

1. El catalogo oficial `http://www2.ssn.unam.mx:8080/catalogo/` existe y es
   valido, pero requiere captcha para consultas interactivas.
2. El RSS oficial de ultimos sismos es publico y consumible sin token.
3. El RSS publica solo un subconjunto operativo de eventos recientes
   (ventana corta; en la verificacion viva se observaron 15 items), por lo que
   su uso es adecuado para monitoreo en vivo y no para backfill historico.

## Contrato externo aprobado

- Endpoint: `http://www.ssn.unam.mx/rss/ultimos-sismos.xml`
- Tipo: RSS 2.0
- Campos observados por item:
  - `title`
  - `description`
  - `link`
  - `geo:lat`
  - `geo:long`

Ejemplo contractual validado:

- `title`: `3.3, 16 km al SUR de PETATLAN, GRO`
- `description`: fecha local, coordenadas y profundidad
- `link`: detalle oficial `localizacion-de-sismo.jsp`

## Normalizacion interna

1. La magnitud se obtiene del prefijo numerico del `title`.
2. La ubicacion se obtiene del resto del `title`.
3. La fecha/hora se extrae de `description`.
4. La leyenda `Hora de Mexico` se interpreta como `UTC-6`.
5. `geo:lat` y `geo:long` son la fuente primaria de coordenadas.
6. `depthKm` se obtiene de `description`.
7. `status` se normaliza como `official`.
8. `sourceUrl` y `detailUrl` apuntan al `link` oficial del item.

## Verificacion horaria

En la validacion viva se confirmo la conversion `UTC-6` comparando:

1. `SSN RSS`: `2026-06-30 04:50:59 (Hora de Mexico)`.
2. Evento equivalente observado en el sistema global: `2026-06-30 10:50:59 UTC`.

La diferencia observada fue exactamente de seis horas.

## Ventanas y volumen

1. El RSS no cubre el historico completo del SSN.
2. El adaptador filtra por `SOURCE_WINDOW_HOURS`, pero el volumen real queda
   limitado por la cantidad de items publicados en el RSS.
3. El RSS debe considerarse fuente oficial de monitoreo reciente.

## Deduplicacion y prioridad regional

Se mantienen los umbrales vigentes:

1. 60 segundos.
2. Menos de 100 km.
3. Menos de 0.5 unidades de magnitud cuando ambos valores existen.

Orden de preferencia agregado:

| Zona   | Orden principal         |
| ------ | ----------------------- |
| Mexico | SSN, USGS, GEOFON, EMSC |

## Cambios de software requeridos

1. Ampliar `SourceCode` y `OperationalSourceCode` con `SSN`.
2. Agregar `SSN_RSS_URL` a configuracion.
3. Incorporar `ssnProvider`.
4. Ajustar prioridad regional para Mexico en `eventAssociationService`.
5. Incorporar `SSN` en estado operativo de API y en marcadores del frontend.

## Criterios de aceptacion

1. El RSS oficial del `SSN` responde sin autenticacion.
2. El adaptador normaliza correctamente un item contractual.
3. La hora local del RSS se convierte a UTC de forma consistente.
4. La prioridad regional favorece `SSN` en Mexico.
5. La API expone el estado operativo de `SSN`.
6. Typecheck, pruebas unitarias y build concluyen sin errores.
