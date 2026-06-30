# SDD-011 Integracion Oficial INGV Italia

## Estado

Vigente para implementacion y validacion.

## Documentos fuente

Esta especificacion complementa:

1. `SDD-003_Integracion_Multifuente_y_Deduplicacion_Sismica.md`.
2. `SDD-004_Ampliacion_de_Fuentes_Oficiales_y_Reconciliacion_Sismica.md`.
3. `SDD-008_Integracion_Oficial_SGC_Colombia_e_IGN_Espana.md`.
4. `SDD-010_Integracion_Oficial_CSN_Chile.md`.

## Objetivo

Incorporar la fuente oficial del `Istituto Nazionale di Geofisica e
Vulcanologia (INGV)` para reforzar la cobertura operacional de Italia y el
Mediterraneo central dentro de la plataforma.

## Decision de alcance

### Fuente aprobada en esta entrega

| Codigo | Institucion                                    | Canal oficial validado                             | Formato              | Frecuencia |
| ------ | ---------------------------------------------- | -------------------------------------------------- | -------------------- | ---------- |
| `INGV` | Istituto Nazionale di Geofisica e Vulcanologia | `https://webservices.ingv.it/fdsnws/event/1/query` | FDSNWS `format=text` | 180 s      |

### Hallazgos de verificacion

1. El portal oficial `terremoti.ingv.it/webservices_and_software` documenta el
   servicio `fdsnws/event/1/` como canal oficial para eventos sismicos.
2. El recurso `version` y `application.wadl` responden correctamente.
3. El endpoint `query` responde de forma estable cuando se usan:
   - `format=text`
   - `starttime`
   - `endtime`
   - `orderby=time`
4. El endpoint devuelve `400` si `starttime` o `endtime` se envian con sufijo
   `Z`; exige el patron `YYYY-MM-DDThh:mm:ss`.
5. El endpoint devolvio `500` en verificaciones vivas cuando se usaron filtros
   espaciales (`minlatitude`, `maxlatitude`, `maxradiuskm`) o ciertas
   combinaciones con `minmagnitude`.
6. La estrategia aprobada es consultar por ventanas diarias UTC completas y
   aplicar el recorte regional dentro del adaptador.

## Contrato externo aprobado

- Endpoint base: `https://webservices.ingv.it/fdsnws/event/1/query`
- Tipo: FDSN texto delimitado por `|`
- Parametros aprobados:
  - `format=text`
  - `starttime=YYYY-MM-DDThh:mm:ss`
  - `endtime=YYYY-MM-DDThh:mm:ss`
  - `orderby=time`

Comportamiento operativo adoptado:

1. La consulta primaria se ejecuta sin `limit` explicito.
2. Si una ventana falla, el adaptador reintenta con limites conservadores.
3. No se adopta un `limit` fijo unico porque el servicio devolvio `500` con
   ciertos valores aun sobre ventanas que respondian correctamente sin ese
   parametro.

Campos observados:

- `EventID`
- `Time`
- `Latitude`
- `Longitude`
- `Depth/Km`
- `Author`
- `ContributorID`
- `MagType`
- `Magnitude`
- `EventLocationName`
- `EventType`

Enlace oficial por evento:

- `https://terremoti.ingv.it/event/{EventID}?timezone=UTC`

## Normalizacion interna

1. `sourceEventId` se obtiene de `EventID`.
2. `Time` se interpreta en UTC y se normaliza a ISO con sufijo `Z`.
3. `title` se construye como `M{magnitud} - {EventLocationName}`.
4. `magnitudeType` se obtiene de `MagType`.
5. `networkCode` se obtiene de `Author`.
6. `sourceUrl` y `detailUrl` apuntan a
   `https://terremoti.ingv.it/event/{EventID}?timezone=UTC`.
7. `status` se normaliza como `official`.

## Ventanas y recorte regional

1. El adaptador genera ventanas diarias UTC completas que cubren
   `SOURCE_WINDOW_HOURS`.
2. Cada ventana se consulta por separado para reducir el riesgo de `500`.
3. La deduplicacion intra-fuente se realiza por `sourceEventId`.
4. El recorte regional se aplica en cliente con el poligono operacional:
   - latitud `34` a `48.5`
   - longitud `5` a `20.5`
5. Este recorte incluye Italia continental, Sicilia, Cerdeña y mares
   adyacentes, y evita incorporar eventos lejanos no relevantes para el
   rol regional de `INGV`.

## Deduplicacion y prioridad regional

Se mantienen los umbrales vigentes:

1. 60 segundos.
2. Menos de 100 km.
3. Menos de 0.5 unidades de magnitud cuando ambos valores existen.

Orden de preferencia agregado:

| Zona                          | Orden principal          |
| ----------------------------- | ------------------------ |
| Italia / Mediterraneo central | INGV, USGS, GEOFON, EMSC |

Fuera de esa zona, `INGV` conserva prioridad baja y no desplaza a las fuentes
globales principales salvo ausencia de mejor referencia.

## Cambios de software requeridos

1. Ampliar `SourceCode` y `OperationalSourceCode` con `INGV`.
2. Agregar `INGV_FDSN_URL` a configuracion.
3. Incorporar `ingvProvider`.
4. Ajustar prioridad regional para Italia en `eventAssociationService`.
5. Incorporar `INGV` en estado operativo de API y en marcadores del frontend.
6. Mantener aislamiento de falla ante respuestas `500` del servicio oficial.

## Criterios de aceptacion

1. El WADL oficial de `INGV` expone `event/query`.
2. El adaptador genera ventanas diarias con formato de fecha aceptado por
   `INGV`.
3. El adaptador normaliza correctamente una muestra contractual de Italia.
4. Los eventos fuera de la region operacional se descartan.
5. La prioridad regional favorece `INGV` en Italia.
6. La API expone el estado operativo de `INGV`.
7. Typecheck, pruebas unitarias y build concluyen sin errores.
