# SDD-019 - Indicadores oficiales de area afectada

## 1. Objetivo

Ampliar el mapa 2D con indicadores verificables del area relacionada con un
evento seleccionado, sin modificar su estructura visual ni presentar
estimaciones locales como informacion oficial.

La entrega incorpora:

- localidades de exposicion publicadas por USGS PAGER;
- contornos oficiales MMI, PGA y PGV de USGS ShakeMap;
- concentracion geografica de reportes sentidos USGS DYFI;
- una lectura descriptiva de la secuencia sismica visible en 6 y 24 horas;
- priorizacion visual de estaciones costeras UNESCO/IOC cuando la fuente del
  evento publica el indicador de tsunami.

## 2. Derivacion documental obligatoria

Esta especificacion deriva de los documentos matriz vigentes:

1. `output/doc/01_Informe_de_Alcance_y_Diseno_Funcional_de_la_Plataforma_de_Visualizacion_Sismica.docx`.
2. `output/doc/02_Informe_Tecnico_de_Arquitectura_Desarrollo_y_Entorno_WSL2_de_la_Plataforma_de_Visualizacion_Sismica.docx`.

Se conserva el criterio funcional de usar fuentes publicas confiables, mantener
la trazabilidad al origen y separar la informacion oficial de la representacion
visual. Tambien se conserva la arquitectura tecnica existente:

`Fuente externa -> API propia -> contrato compartido -> CesiumJS`.

La funcion sigue siendo informativa y analitica. No convierte la plataforma en
un sistema de alerta temprana, prediccion, rescate ni evaluacion de danos.

## 3. Alcance

### Incluido

- Consulta bajo demanda al detalle oficial de un evento USGS seleccionado.
- Cache temporal en API para proteger al proveedor y reducir latencia.
- Hasta ocho localidades PAGER elegidas del mismo producto oficial.
- Etiquetas `Ciudad · MMI` con prioridad sobre nombres cartograficos y uso del
  motor existente de colisiones.
- Tooltip de localidad con poblacion, MMI, nivel PAGER y hora de actualizacion.
- Contornos ShakeMap MMI, PGA y PGV servidos por la API propia.
- Concentracion DYFI desde GeoJSON oficial agregado a 10 km, con alternativa de
  1 km cuando el producto de 10 km no exista.
- Tooltip DYFI con cantidad de respuestas, CDI, dispersion y actualizacion.
- Conteos descriptivos a 6 y 24 horas alrededor del evento principal visible.
- Diferenciacion entre `Evento principal` y `Actividad posterior`.
- Hasta cuatro estaciones IOC prioritarias por proximidad al epicentro cuando
  `tsunami=true` provenga de la fuente sismica.
- Pruebas unitarias con fixtures; ninguna prueba automatica depende de la red.

### Excluido

- Inferir ciudades, poblacion, exposicion, intensidad o perdidas cuando PAGER no
  publique el producto requerido.
- Interpolar localmente MMI, PGA, PGV o CDI.
- Llamar `replicas` a los eventos posteriores sin una clasificacion oficial.
- Presentar `tsunami=true` como alerta, amenaza o confirmacion de tsunami.
- Interpretar una estacion priorizada como evidencia de una ola de tsunami.
- Mostrar observaciones individuales o datos personales de DYFI.
- Cambiar la distribucion de paneles, el encuadre 2D o reintroducir leyendas IOC
  retiradas previamente.
- Persistir los productos USGS en PostgreSQL en esta fase.

## 4. Principios de procedencia

1. PAGER se muestra solo cuando el producto `losspager` seleccionado contiene
   `pager.xml` o `exposure.xml` y ciudades oficiales utilizables.
2. Las ciudades se leen de `cities.json` del mismo producto cuando exista; como
   alternativa se leen los nodos `city` del XML oficial.
3. ShakeMap solo usa `cont_mi.json` o `cont_mmi.json`, `cont_pga.json` y
   `cont_pgv.json` del producto `shakemap` preferido.
4. DYFI solo usa `dyfi_geo_10km.geojson` o `dyfi_geo_1km.geojson` del producto
   `dyfi` preferido.
5. Un producto con estado `DELETE`, una URL no perteneciente a
   `earthquake.usgs.gov`, un documento invalido o una respuesta vacia se trata
   como no disponible.
6. Cada indicador conserva fuente, URL de producto y hora de actualizacion.
7. La ausencia de un producto es un estado normal; no activa aproximaciones.

## 5. Arquitectura

### 5.1 API

Un servicio `usgsImpactService` obtiene el evento canonico desde el repositorio,
valida que su detalle sea USGS, consulta los productos asociados y normaliza sus
metadatos. La API nunca acepta una URL externa enviada por el navegador.

La obtencion remota debe:

- permitir unicamente HTTPS y el host `earthquake.usgs.gov`;
- aplicar timeout;
- validar tambien la URL final despues de redirecciones;
- limitar el tamano de JSON/XML y GeoJSON;
- usar cache LRU por evento y version de producto;
- degradar cada producto de forma independiente.

Los GeoJSON se entregan por rutas proxy de la API. Esto evita problemas CORS,
centraliza la lista permitida y mantiene el navegador fuera del contrato externo.

### 5.2 Contratos compartidos

`OfficialImpactSummary` contiene:

- `eventId` y `generatedAtUtc`;
- `pager`, `shakeMap` y `dyfi`, cada uno anulable;
- fuente, URL oficial y `updatedAtUtc` por producto;
- localidades PAGER ya limitadas y ordenadas;
- disponibilidad y URL interna por capa geografica.

`OfficialPagerCity` contiene:

- `name`, `latitude`, `longitude`;
- `population`;
- `mmi` decimal e `intensityRoman` para lectura humana.

`OfficialGeoJsonLayer` identifica `mmi`, `pga`, `pgv` o `dyfi`, su unidad,
agregacion cuando aplique, URL interna y hora de actualizacion.

### 5.3 Frontend 2D

`MapPanel` solicita el resumen al cambiar el evento seleccionado y cancela la
solicitud anterior. Las capas de la seleccion previa se eliminan antes de
representar una nueva respuesta.

La visualizacion conserva el mapa actual:

- MMI usa el color oficial del GeoJSON y una linea de baja opacidad;
- PGA usa lineas cian sin relleno;
- PGV usa lineas ambar sin relleno;
- DYFI usa poligonos semitransparentes por CDI y borde fino;
- las localidades PAGER entran primero al selector de colisiones;
- todas las etiquetas se anclan a su coordenada sobre el terreno, sin altura
  visual que pueda separarlas del mapa durante un vuelo;
- el conjunto visible permanece estable mientras la camara se mueve y las
  colisiones se recalculan al finalizar el movimiento;
- las capas oficiales no desplazan ni redimensionan paneles existentes.

## 6. Seleccion de localidades PAGER

Las ciudades deben pertenecer al mismo producto `losspager` que habilita la
vista. Se descartan registros sin nombre, coordenadas validas, poblacion finita
no negativa o MMI finita entre 1 y 10.

El orden es determinista:

1. ciudades marcadas `on_map=1`, en el orden publicado por PAGER;
2. mayor MMI;
3. mayor poblacion;
4. nombre en orden alfabetico como desempate.

Se muestran como maximo ocho. El texto visible usa un decimal, por ejemplo
`Tapachula · MMI 3,5`. La cifra de poblacion se identifica como poblacion de
exposicion publicada por PAGER, no como censo local actualizado por la
plataforma.

## 7. Secuencia sismica descriptiva

La secuencia usa exclusivamente eventos reales ya normalizados y visibles en el
periodo de 24 horas. No es un producto oficial de clasificacion.

Reglas:

1. El evento seleccionado es el ancla de la consulta.
2. En un radio de 250 km y una ventana que empieza en la hora del ancla, se
   identifican eventos posteriores de hasta 24 horas.
3. El evento de mayor magnitud del conjunto es `Evento principal`; en empate se
   elige el mas antiguo.
4. Los eventos ocurridos despues del principal se rotulan `Actividad posterior`.
5. Se exponen conteos para 6 h y 24 h desde la hora del principal.
6. Si no hay al menos dos eventos relacionados, no se dibuja una secuencia.
7. Ningun texto de interfaz usa `replica`, `enjambre` o una relacion causal.

El radio es una regla visual explicita, no una afirmacion sismologica. El tooltip
lo identifica como `agrupacion temporal y espacial del mapa`.

## 8. Estaciones costeras IOC prioritarias

Cuando el evento seleccionado contiene `tsunami=true`, se calculan distancias
geodesicas a las estaciones de nivel del mar UNESCO/IOC ya cargadas. Se destacan
las cuatro estaciones disponibles mas cercanas, priorizando estado `online`,
luego `delayed` y finalmente `offline`.

El tooltip muestra distancia al epicentro, estado, ultima observacion y esta
advertencia: `Prioridad visual por indicador de tsunami de la fuente; no equivale
a alerta ni confirma una ola`.

No se modifica la posicion de las estaciones ni se simula propagacion. Las
estaciones siguen siendo puntos fijos de observacion; solo cambia temporalmente
su enfasis visual.

## 9. API publica

### `GET /api/events/:eventId/official-impact`

Respuestas:

- `200`: resumen; los productos ausentes se devuelven como `null`.
- `404`: evento canonico inexistente.
- `502`: no fue posible obtener un detalle USGS valido y no existe cache.

### `GET /api/events/:eventId/official-impact/:layer`

`layer` admite `mmi`, `pga`, `pgv` o `dyfi`.

Respuestas:

- `200 application/geo+json`: producto oficial validado.
- `404`: capa no publicada para ese evento.
- `502`: error remoto sin cache reutilizable.

La API aplica los limites globales de peticiones existentes y no expone una ruta
proxy generica.

## 10. Configuracion

```dotenv
USGS_IMPACT_TIMEOUT_MS=10000
USGS_IMPACT_CACHE_TTL_MS=120000
USGS_IMPACT_MAX_DOCUMENT_BYTES=5242880
USGS_IMPACT_MAX_GEOJSON_BYTES=15728640
```

Los valores tienen limites seguros internos aunque una variable de entorno sea
incorrecta.

## 11. Criterios de aceptacion

1. Un evento con `pager.xml` y ciudades validas muestra como maximo ocho
   etiquetas `Ciudad · MMI` sin superposicion entre ellas ni con los nombres
   cartograficos administrados por el mismo motor.
2. El tooltip de ciudad muestra poblacion, MMI, nivel PAGER, fuente y fecha.
3. Sin `pager.xml` ni `exposure.xml` no se muestran ciudades PAGER.
4. MMI, PGA y PGV solo aparecen si existe su GeoJSON ShakeMap oficial.
5. DYFI solo aparece si existe un GeoJSON geocodificado oficial y muestra la
   cantidad agregada de respuestas, no observaciones individuales.
6. Cambiar de evento elimina todas las capas y tooltips de la seleccion anterior.
7. La secuencia muestra `Evento principal` y `Actividad posterior`, con conteos
   6 h/24 h, y nunca usa el termino `replicas`.
8. Sin dos eventos en 250 km/24 h no se dibuja la secuencia.
9. Las estaciones IOC solo se enfatizan con `tsunami=true` y el tooltip niega que
   esa priorizacion sea una alerta.
10. Una falla en PAGER no impide mostrar ShakeMap o DYFI disponibles.
11. Las URLs externas no oficiales se rechazan y no se solicitan.
12. La estructura, los paneles y el encuadre del mapa 2D permanecen sin cambios.
13. `npm run typecheck`, pruebas API/web y build web terminan correctamente.
14. La validacion real incluye un evento con PAGER/ShakeMap, otro con DYFI y una
    comprobacion de ausencia de errores de consola en escritorio.
15. Los nombres de ciudades y paises permanecen fijados a sus coordenadas y no
    se recrean ni cambian de seleccion durante un vuelo de camara.

## 12. Riesgos y mitigaciones

| Riesgo                                        | Mitigacion                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| Productos USGS actualizados durante la sesion | Cache corta, fecha visible y reemplazo completo al cambiar version.               |
| GeoJSON grande o malformado                   | Limite de bytes, validacion de tipo y degradacion independiente.                  |
| Saturacion visual                             | Ocho ciudades maximas, prioridades compartidas y capas de linea de baja opacidad. |
| Confusion entre PAGER y danos confirmados     | Texto de exposicion, nivel e incertidumbre; no se afirman danos.                  |
| Confusion entre DYFI y MMI instrumental       | Tooltip identifica `reportes sentidos DYFI` y CDI.                                |
| Confusion entre bandera y alerta de tsunami   | Advertencia fija en tooltip IOC.                                                  |
| Falsa clasificacion de replicas               | Vocabulario descriptivo y regla visual documentada.                               |
| SSRF mediante URLs de productos               | Host HTTPS permitido, ruta proxy cerrada y validacion de redireccion.             |

## 13. Trazabilidad

| Requisito                      | Implementacion prevista                                     | Validacion prevista                                                    |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| R1 Localidades PAGER oficiales | Servicio USGS, contrato compartido y etiquetas prioritarias | Evento real con `pager.xml`, maximo ocho y hover completo              |
| R2 Contornos MMI/PGA/PGV       | Proxy API y tres fuentes Cesium GeoJSON                     | Presencia/ausencia por contenido oficial y hover por unidad            |
| R3 Concentracion DYFI          | Proxy de GeoJSON agregado y estilo CDI                      | Evento real con `dyfi_geo_10km.geojson`                                |
| R4 Secuencia 6 h/24 h          | Funcion pura sobre eventos normalizados                     | Fixtures temporales y espaciales; vocabulario sin `replicas`           |
| R5 Estaciones IOC prioritarias | Distancia geodesica y enfasis condicional                   | Fixture con/sin `tsunami=true` y tooltip preventivo                    |
| R6 Procedencia y aislamiento   | Validacion de host, limites, cache y fallos por producto    | Pruebas de URLs rechazadas, documentos invalidos y degradacion parcial |

La validacion funcional se registrara en
`docs/validation/VALIDATION-019_Indicadores_Oficiales_de_Area_Afectada.md` y los
tests en `docs/validation/TEST-019_Indicadores_Oficiales_de_Area_Afectada.md`.

## 14. Referencias oficiales

- USGS PAGER onePAGER: https://earthquake.usgs.gov/data/pager/onepager.php
- USGS LossPAGER: https://usgs.github.io/pdl/userguide/products/losspager.html
- USGS ShakeMap products: https://ghsc.code-pages.usgs.gov/esi/shakemap/docs2020/manual4_0/ug_products.html
- USGS DYFI: https://earthquake.usgs.gov/data/dyfi/
- USGS DYFI product: https://usgs.github.io/pdl/userguide/products/dyfi.html
- USGS DYFI disclaimer: https://earthquake.usgs.gov/data/dyfi/disclaimer.php
- UNESCO/IOC Sea Level Monitoring API: https://api.ioc-sealevelmonitoring.org/
- UNESCO/IOC warning levels: https://tsunami.ioc.unesco.org/en/warning-levels
