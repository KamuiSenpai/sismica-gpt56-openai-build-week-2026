# SDD-012 Integracion Oficial IGEPN, INPRES y Redes de Centroamerica

## Estado

Implementado y validado localmente al 2026-06-30.

## Documentos fuente

Esta especificacion complementa:

1. `SDD-003_Integracion_Multifuente_y_Deduplicacion_Sismica.md`.
2. `SDD-004_Ampliacion_de_Fuentes_Oficiales_y_Reconciliacion_Sismica.md`.
3. `SDD-006_Gobernanza_de_Normalizacion_de_Datos.md`.
4. `SDD-008_Integracion_Oficial_SGC_Colombia_e_IGN_Espana.md`.
5. `SDD-009_Integracion_Oficial_SSN_Mexico.md`.
6. `SDD-010_Integracion_Oficial_CSN_Chile.md`.
7. `SDD-011_Integracion_Oficial_INGV_Italia.md`.

## Objetivo

Ampliar la cobertura regional oficial en Ecuador, Argentina y Centroamerica
mediante fuentes nacionales o institucionales publicas, reduciendo dependencia
exclusiva de fuentes globales para eventos locales de magnitud baja o moderada.

## Fuentes aprobadas

| Codigo      | Institucion                                                               | Pais        | Canal validado                                                                                | Formato         | Prioridad |
| ----------- | ------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------- | --------------- | --------- |
| `IGEPN`     | Instituto Geofisico de la Escuela Politecnica Nacional                    | Ecuador     | `https://www.igepn.edu.ec/portal/eventos/www/events.csv`                                      | CSV             | Alta      |
| `INPRES`    | Instituto Nacional de Prevencion Sismica                                  | Argentina   | `http://contenidos.inpres.gob.ar/mapa/sismos.xml`                                             | XML             | Alta      |
| `MARN`      | Ministerio de Medio Ambiente y Recursos Naturales                         | El Salvador | `https://www.snet.gob.sv/ver/sismologia/monitoreo/sismos%2Breportados/ultimos%2B10%2Bsismos/` | HTML tabla      | Media     |
| `OVSICORI`  | Observatorio Vulcanologico y Sismologico de Costa Rica                    | Costa Rica  | `https://www.ovsicori.una.ac.cr/sistemas/mapa_sismicidad/mapa_sismos.php`                     | HTML/JS markers | Media     |
| `INSIVUMEH` | Instituto Nacional de Sismologia, Vulcanologia, Meteorologia e Hidrologia | Guatemala   | `https://geo.insivumeh.gob.gt/MAPA_SISMOS/`                                                   | HTML Leaflet    | Media     |

## Decision de alcance

1. Se incorporan las cinco fuentes como fuentes sismicas operativas.
2. `IGEPN` e `INPRES` se consideran integraciones de menor riesgo relativo por
   exponer datos estructurados (`CSV` y `XML`).
3. `MARN`, `OVSICORI` e `INSIVUMEH` se incorporan con parsers defensivos sobre
   HTML oficial. Estos parsers deben aislar fallas y no bloquear la ingesta
   global si cambia la estructura del portal.
4. No se adoptan canales no oficiales, redes sociales ni scraping de terceros.
5. La integracion es informativa y debe mantener el aviso general de confirmar
   decisiones con autoridades oficiales.

## Contrato externo observado

### IGEPN

Campos observados:

- `latitude`
- `longitude`
- `mag`
- `depth`
- `time`
- `status`
- `id`
- `place`

Normalizacion:

1. `sourceEventId` se toma de `id`.
2. `time` se interpreta como hora local de Ecuador (`UTC-05:00`) mientras el
   CSV no publique zona horaria explicita.
3. `status=confirmed` se normaliza como `official`.
4. `sourceUrl` apunta al mapa oficial de ultimos sismos de IGEPN.

### INPRES

Campos XML observados:

- `idSismo`
- `fecha`
- `hora`
- `latitud`
- `longitud`
- `prof`
- `mg`
- `prov`
- `link`
- `color_link`

Normalizacion:

1. `sourceEventId` se toma de `idSismo`.
2. `fecha` no incluye anio; el adaptador infiere el anio operativo desde la
   fecha actual y corrige cruce de anio cuando corresponda.
3. `hora` se interpreta como hora local de Argentina (`UTC-03:00`).
4. `link` se normaliza contra `http://contenidos.inpres.gob.ar/`.
5. El color informativo de INPRES no se usa como criterio de severidad.

### MARN

Campos HTML observados:

- numero de fila
- fecha
- hora local
- latitud norte
- longitud oeste
- localizacion
- intensidad
- magnitud
- profundidad

Normalizacion:

1. Se genera `sourceEventId` estable desde fecha, hora, coordenadas, magnitud y
   localizacion.
2. La hora se interpreta como hora local de El Salvador (`UTC-06:00`).
3. La intensidad textual se conserva en `intensityText`.
4. La fuente publica solo ultimos 10 sismos, por lo que no se usa como archivo
   historico.

### OVSICORI

Campos observados en marcadores JavaScript:

- coordenadas `L.marker([lat, lon])`
- magnitud
- fecha y hora local
- ubicacion
- profundidad
- autor
- marca de revision
- enlace o parametro por `eqid`

Normalizacion:

1. `sourceEventId` se toma del `eqid` cuando existe; si no existe, se genera
   hash estable.
2. La hora se interpreta como hora local de Costa Rica (`UTC-06:00`).
3. `Revisado: y` se normaliza como `reviewed`; en otro caso `automatic`.
4. La ubicacion se limpia para no mezclar coordenadas tecnicas en el titulo del
   evento.

### INSIVUMEH

Campos observados en HTML Leaflet/Folium:

- coordenadas `L.circleMarker([lat, lon])`
- `ID`
- `NST`
- `RMS`
- `GAP`
- magnitud
- tiempo de origen
- profundidad
- enlace historico por evento

Normalizacion:

1. `sourceEventId` se toma de `ID`.
2. La hora se interpreta como hora local de Guatemala (`UTC-06:00`).
3. `NST`, `RMS` y `GAP` se conservan en campos tecnicos cuando existan.
4. Si el certificado TLS del portal no valida en Node, el adaptador usa un
   cliente HTTPS aislado para esa fuente. Esta decision evita bloquear la
   ingesta regional, pero debe revisarse si INSIVUMEH regulariza su cadena de
   certificados.

## Deduplicacion y prioridad regional

Se mantienen umbrales vigentes:

1. 60 segundos.
2. Menos de 100 km.
3. Menos de 0.5 unidades de magnitud cuando ambos valores existen.

Orden regional agregado:

| Region      | Orden principal                            |
| ----------- | ------------------------------------------ |
| Ecuador     | IGEPN, IGP, SGC, USGS, GEOFON, EMSC        |
| Argentina   | INPRES, CSN, USGS, GEOFON, EMSC            |
| Costa Rica  | OVSICORI, MARN, INSIVUMEH, SSN, USGS, EMSC |
| El Salvador | MARN, INSIVUMEH, OVSICORI, SSN, USGS, EMSC |
| Guatemala   | INSIVUMEH, MARN, OVSICORI, SSN, USGS, EMSC |

Para evitar decisiones incorrectas por cajas geograficas solapadas, la
implementacion evalua primero las regiones que historicamente quedan absorbidas
por vecinos mas grandes: Ecuador frente a Peru/Colombia, costa chilena frente a
Argentina, y Guatemala frente al sur de Mexico y El Salvador.

## Cambios de software implementados

1. Ampliacion de `SourceCode` con `MARN`, `OVSICORI` e `INSIVUMEH`.
2. Variables de configuracion para las cinco fuentes.
3. Providers:
   - `igepnProvider`
   - `inpresProvider`
   - `marnProvider`
   - `ovsicoriProvider`
   - `insivumehProvider`
4. Registro de fuentes en `ingestionService`.
5. Registro de fuentes en `sourceStatusRepository`.
6. Prioridad regional en `eventAssociationService`.
7. Marcas de feed y banderas de fuente en frontend.
8. Pruebas unitarias de normalizacion, parseo y prioridad regional.

## Criterios de aceptacion

1. Los endpoints oficiales responden con datos parseables.
2. Cada provider normaliza al menos una muestra contractual.
3. Cada provider descarta registros sin coordenadas, fecha o identificador
   recuperable.
4. `/api/sources/status` lista las cinco nuevas fuentes.
5. La base de datos persiste referencias por fuente cuando hay eventos dentro
   de ventana.
6. El feed frontend presenta marcas nacionales:
   - `EC` para `IGEPN`
   - `AR` para `INPRES`
   - `SV` para `MARN`
   - `CR` para `OVSICORI`
   - `GT` para `INSIVUMEH`
7. Typecheck, pruebas unitarias y build concluyen sin errores.

## Riesgos y limitaciones

1. `MARN` publica una ventana corta de ultimos 10 sismos.
2. `OVSICORI` e `INSIVUMEH` no exponen API JSON publica validada en esta etapa;
   se integran desde HTML oficial.
3. Los parsers HTML son mas sensibles a cambios de maquetacion que un API
   estructurada.
4. `INSIVUMEH` puede presentar problemas de certificado TLS en entornos Node;
   el workaround actual debe permanecer limitado a esa fuente.
5. Las zonas horarias se documentan por pais porque las fuentes no siempre
   incluyen offset explicito en el dato publicado.
