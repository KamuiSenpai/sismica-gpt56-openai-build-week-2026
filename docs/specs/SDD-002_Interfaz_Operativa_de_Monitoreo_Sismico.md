# SDD-002 Interfaz Operativa de Monitoreo Sismico

## Estado

Vigente para implementacion.

## Documentos fuente

Esta especificacion deriva de:

1. `output/doc/01_Informe_de_Alcance_y_Diseno_Funcional_de_la_Plataforma_de_Visualizacion_Sismica.docx`
2. `output/doc/02_Informe_Tecnico_de_Arquitectura_Desarrollo_y_Entorno_WSL2_de_la_Plataforma_de_Visualizacion_Sismica.docx`
3. `docs/specs/SDD-001_Plataforma_Funcional_de_Visualizacion_Sismica.md`

Los informes establecen a `GlobalQuake` como referente de experiencia y a
`CesiumJS` como motor del globo 3D. La plataforma no depende del codigo, marca,
servicios privados ni activos visuales de GlobalQuake.

## Objetivo

Definir una interfaz compacta de monitoreo en vivo que permita observar el
globo, identificar el evento focal, leer sus parametros tecnicos y recorrer el
feed global sin superposiciones.

## Alcance

1. Mantener el globo 3D con `CesiumJS`.
2. Usar una composicion de monitor operativo inspirada en GlobalQuake.
3. Mostrar un panel tecnico del evento seleccionado.
4. Mostrar una escala vertical de magnitud.
5. Mostrar un feed global compacto y seleccionable.
6. Mantener la leyenda de placas a la derecha, debajo del feed.
7. Actualizar eventos mediante carga REST, refresco periodico y `SSE`.
8. Enriquecer el contrato con parametros disponibles en el feed GeoJSON de USGS.

## Exclusiones

1. Copiar logotipos, nombre, tipografia propietaria o textos promocionales de GlobalQuake.
2. Presentar a la plataforma como sistema de alerta temprana certificado.
3. Simular estaciones, errores de localizacion o revision cuando la fuente no los entrega.
4. Procesar formas de onda o ejecutar deteccion sismica propia.
5. Sustituir boletines de autoridades nacionales.

## Fuentes y prioridad

| Prioridad | Fuente | Uso aprobado |
| --- | --- | --- |
| 1 | USGS GeoJSON/FDSN | Catalogo primario operativo y parametros tecnicos globales |
| 2 | EMSC SeismicPortal FDSN/WebSocket | Segunda fuente y eventos casi en tiempo real |
| 3 | GDACS API/GeoJSON/RSS | Contexto de desastre, severidad e impacto; no sustituye el catalogo sismico |
| 4 | NOAA PTWC/NTWC CAP | Productos oficiales de tsunami en un dominio separado |
| Nacional | FUNVISIS | Autoridad para Venezuela; integracion solo con API o convenio autorizado |

No se aprueba scraping de sitios web sin interfaz publica estable. La
integracion de una segunda fuente exige reglas de asociacion y deduplicacion
cross-source antes de activarse.

## Contrato de datos del panel

### Datos disponibles en USGS y aprobados

| Dato visual | Campo de origen | Regla |
| --- | --- | --- |
| Magnitud | `mag`, `magType` | Mostrar valor y tipo cuando exista |
| Ubicacion | `place` o `title` | Texto de fuente, sin reinterpretacion |
| Fecha y hora | `time` | Mostrar en UTC |
| Coordenadas | `geometry.coordinates` | Latitud, longitud y profundidad |
| Estado | `status` | Mostrar `automatic` o `reviewed`; no llamarlo calidad instrumental |
| Intensidad | `mmi`, `cdi` | Mostrar `N/D` si USGS no publico el producto |
| Estaciones usadas | `nst` | Mostrar conteo; no equivale a estaciones totales |
| Cobertura azimutal | `gap` | Mostrar grados |
| Estacion mas cercana | `dmin` | Mostrar grados, no kilometros |
| Residuo RMS | `rms` | Mostrar segundos |
| Significancia | `sig` | Mostrar indice USGS |
| Reportes sentidos | `felt` | Mostrar conteo recibido por USGS |
| Alerta PAGER | `alert` | Mostrar nivel cuando exista |
| Indicador tsunami | `tsunami` | Mostrar como indicador, no como alerta propia |
| Revision de fuente | `updated`, `status` | Mostrar fecha de actualizacion y estado |
| Trazabilidad | `url`, `detail`, `net`, `code` | Conservar enlace e identificadores |

### Datos no disponibles en el feed resumido actual

1. Numero total de estaciones de la red.
2. Error N-S y E-W calculado por GlobalQuake.
3. Error de origen expresado con la semantica de GlobalQuake.
4. Porcentaje de coincidencia `Match` de GlobalQuake.
5. Numero de revision equivalente al mostrado por GlobalQuake.

Estos campos no se mostraran con valores sinteticos. Un futuro consumo de
detalle USGS/QuakeML podra incorporar `horizontalError`, `depthError`,
`magError` y fases, previa ampliacion de esta especificacion.

## Diseno de interfaz

### Franja superior

- Altura compacta y fondo oscuro opaco.
- Nombre propio de la plataforma, criterio de filtro y reloj UTC.
- Estado del canal en vivo visible.

### Panel tecnico izquierdo

- Ancho objetivo de 318 px en escritorio.
- Encabezado con magnitud, ubicacion y estado de revision.
- Bloque MMI/CDI con valor o `N/D`.
- Escala vertical de magnitud estable de 1 a 9.
- Tabla tecnica compacta con profundidad, estaciones usadas, `gap`, `dmin`,
  `rms`, significancia, reportes sentidos y fuente.
- Enlace a la fuente oficial.

### Feed derecho

- Ancho objetivo entre 270 y 300 px.
- Filas rectangulares densas, no tarjetas separadas.
- Cada fila muestra magnitud, lugar, profundidad, hora UTC, fuente y estado.
- La seleccion enfoca el evento en CesiumJS.

### Leyenda y pie

- La leyenda de placas permanece a la derecha y debajo del feed.
- Feed y leyenda no pueden compartir area visual ni superponerse.
- El pie muestra fuente, ultima ingesta, total de eventos y descargo de responsabilidad.

## Comportamiento adaptable

1. En escritorio, paneles superpuestos sobre el globo sin ocultar su zona central.
2. Entre 961 y 1200 px, reducir anchos y tipografia manteniendo la leyenda visible.
3. En movil, el globo ocupa la primera seccion y los paneles pasan al flujo vertical.
4. Ningun texto puede desbordar su contenedor.

## Accesibilidad y honestidad informativa

1. Contraste legible y foco visible en controles.
2. Botones del feed accesibles por teclado.
3. `N/D` significa que la fuente no entrego el dato.
4. Los indicadores de tsunami y PAGER deben incluir su fuente.
5. La interfaz debe declarar que es informativa y no reemplaza alertas oficiales.

## Criterios de aceptacion

1. El globo CesiumJS permanece operativo e interactivo.
2. El panel izquierdo se aproxima a la densidad visual del referente sin copiar su marca.
3. El feed y la leyenda no se superponen en 1366x768, 1440x900 y 1920x1080.
4. La seleccion desde feed o globo actualiza el mismo evento focal.
5. Los campos tecnicos proceden del contrato normalizado o muestran `N/D`.
6. El proyecto compila y supera el chequeo de tipos.
7. Existe validacion visual con navegador real.
8. Existen tests unitarios para normalizacion y presentacion de datos opcionales.

## Matriz de trazabilidad

| Requisito | Implementacion | Validacion |
| --- | --- | --- |
| Globo 3D vigente | `apps/web/src/components/MapPanel.tsx` | VF-01 y captura visual |
| Panel tecnico compacto | `apps/web/src/App.tsx`, `apps/web/src/styles/app.css` | VF-07 |
| Feed sin colision | `EventList.tsx`, `app.css` | VF-08 en tres resoluciones |
| Datos USGS verificables | `packages/shared`, worker, API y migracion | tests de normalizacion |
| Ausencia de datos simulados | componentes de presentacion | inspeccion funcional |

## Riesgos

1. Muchos eventos USGS no incluyen MMI, CDI, PAGER o reportes sentidos.
2. El feed puede contener valores preliminares que cambian con una revision.
3. Dos fuentes pueden describir el mismo sismo con identificadores distintos.
4. Una interfaz muy densa puede perder legibilidad en pantallas pequenas.

## Mitigaciones

1. Mostrar `N/D` y no ocultar la ausencia del dato.
2. Exponer estado y hora de actualizacion de la fuente.
3. Mantener una sola fuente activa hasta definir deduplicacion cross-source.
4. Validar visualmente resoluciones de escritorio y movil.
