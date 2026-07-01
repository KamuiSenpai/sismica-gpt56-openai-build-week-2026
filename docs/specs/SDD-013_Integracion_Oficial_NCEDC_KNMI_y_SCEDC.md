# SDD-013 Integracion Oficial NCEDC, KNMI y SCEDC

## Estado

Vigente para implementacion y validacion.

## Objetivo

Ampliar la validacion cruzada del catalogo sismico en vivo mediante tres fuentes
adicionales de eventos:

1. `NCEDC` para catalogo regional del norte de California.
2. `KNMI` para eventos del Real Time Data Services del instituto neerlandes.
3. `SCEDC` para catalogo regional del sur de California.

La prioridad de esta entrega no es reemplazar a `USGS` como fuente canonica
global, sino aumentar corroboracion en `sources: ...` y capturar eventos
regionales que puedan aparecer antes o con metadatos distintos.

## Fuentes aprobadas

| Codigo  | Institucion                                              | Canal validado                                           | Formato   | Observacion                  |
| ------- | -------------------------------------------------------- | -------------------------------------------------------- | --------- | ---------------------------- |
| `NCEDC` | Northern California Earthquake Data Center               | `https://service.ncedc.org/fdsnws/event/1/query`         | FDSN text | Contrato FDSN estandar       |
| `KNMI`  | KNMI Real Time Data Services                             | `https://rdsa.knmi.nl/fdsnws/event/1/query`              | FDSN text | Contrato FDSN estandar       |
| `SCEDC` | Southern California Earthquake Data Center / Caltech USC | `https://service.scedc.caltech.edu/fdsnws/event/1/query` | FDSN text | Variante de fecha y cabecera |

## Decision de diseno

1. Se reutiliza `createFdsnProvider`.
2. No se crea una nueva familia de providers para esta entrega.
3. `SCEDC` se integra endureciendo el normalizador FDSN existente.
4. No se agrega prioridad regional especifica en esta etapa; el valor buscado
   es validacion cruzada y enriquecimiento de `event_source_refs`.
5. `NCEDC` y `SCEDC` consultan una ventana mas corta para reducir riesgo de
   timeout y respetar la naturaleza regional del servicio.

## Contrato tecnico observado

### NCEDC

Contrato observado:

- Cabecera FDSN estandar.
- `Time` en ISO UTC.
- `Longitude` con nombre estandar.
- `ContributorID` puede venir vacio.

Decision:

1. `sourceEventId` se toma de `EventID`.
2. `providerEventCode` cae a `EventID` cuando `ContributorID` no existe.

### KNMI

Contrato observado:

- Cabecera FDSN estandar.
- `Time` con precision decimal variable.
- `EventType` puede indicar `induced or triggered event`.

Decision:

1. Se conserva `EventType` textual publicado por KNMI.
2. No se fuerza reclasificacion mientras el dato sea valido y parseable.

### SCEDC

Contrato observado:

- `Time` usa slashes: `YYYY/MM/DD HH:mm:ss.ssss`.
- La cabecera usa `Longtitude` en lugar de `Longitude`.
- Publica columnas `ET` y `GT` en lugar de `EventType`.
- Incluye pie `# of events : N`.

Decision:

1. El normalizador convierte slashes a fecha ISO UTC.
2. El normalizador acepta `Longtitude` como alias de `Longitude`.
3. `ET=eq` se normaliza a `earthquake`.
4. El parser FDSN ignora el pie final comentado.

## Cambios de software requeridos

1. Ampliar `SourceCode` con `NCEDC`, `KNMI` y `SCEDC`.
2. Agregar variables:
   - `NCEDC_FDSN_URL`
   - `KNMI_FDSN_URL`
   - `SCEDC_FDSN_URL`
3. Registrar los tres providers en `ingestionService`.
4. Registrar las tres fuentes en `sourceStatusRepository`.
5. Agregar marcas de feed:
   - `NC` para `NCEDC`
   - `NL` para `KNMI`
   - `SC` para `SCEDC`
6. Agregar banderas de pais:
   - `us` para `NCEDC`
   - `nl` para `KNMI`
   - `us` para `SCEDC`
7. Agregar pruebas unitarias para la variante SCEDC y el contrato KNMI.

## Criterios de aceptacion

1. `NCEDC`, `KNMI` y `SCEDC` responden dentro del timeout operativo local.
2. El provider FDSN reutilizable parsea registros de las tres fuentes.
3. La variante SCEDC con slashes y `Longtitude` se normaliza sin error.
4. `/api/sources/status` incluye las tres nuevas fuentes.
5. `npm run typecheck`, `npm test -w apps/worker` y `npm run build`
   concluyen sin errores.

## Riesgos y limitaciones

1. `NCEDC` y `SCEDC` son regionales; una ventana larga aumenta latencia sin dar
   valor proporcional.
2. `SCEDC` no publica un FDSN text totalmente canonico; depende de alias y
   normalizacion defensiva.
3. `KNMI` puede publicar eventos inducidos o disparados; se respetan tal como
   la fuente los clasifica.
