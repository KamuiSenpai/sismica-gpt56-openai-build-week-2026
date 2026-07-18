# VALIDATION-019 - Indicadores oficiales de area afectada

## 1. Resumen

Validacion funcional ejecutada el 18 de julio de 2026 sobre la rama `main` y
contra la aplicacion local servida por Vite y la API del proyecto.

Resultado: PAGER, ShakeMap y DYFI aprobados con productos USGS reales. La
secuencia 6 h/24 h y la priorizacion IOC quedaron aprobadas mediante funciones
puras y fixtures porque el feed actual no contenia eventos con `tsunami=true`.

## 2. Entorno

- Sistema: Windows, PowerShell.
- Node.js: `v22.17.1`.
- Web: `http://localhost:5173`.
- API: `http://localhost:3000`.
- Navegador automatizado: Chromium mediante Playwright CLI.
- Resolucion funcional: `1920 x 1080`.

## 3. Casos reales USGS

### Evento PAGER y ShakeMap

Evento: `USGS:us7000t1n5`.

El resumen oficial devolvio alerta PAGER verde y ocho localidades publicadas:
Ocos, Mazatan, La Blanca, Ciudad Hidalgo, Huehuetan, Ciudad Tecun Uman,
Tapachula y Coatepeque. Tambien publico las capas ShakeMap MMI, PGA y PGV.

Comprobaciones visuales:

1. Las localidades entraron al motor existente de colisiones antes que los
   nombres cartograficos.
2. El mapa mantuvo la distribucion 2D y los paneles existentes.
3. El hover de Ocos mostro MMI `3.9`, intensidad `IV`, poblacion expuesta
   `20,215`, alerta `GREEN`, fecha de actualizacion y procedencia USGS PAGER.
4. Las tres peticiones de GeoJSON MMI, PGA y PGV respondieron `200`.
5. No se presento PAGER como reporte de danos.

### Evento DYFI

Evento: `USGS:us7000t1mu`.

El resumen oficial informo tres reportes, CDI maximo `3.4` y producto geografico
agregado a 10 km. Las rutas de resumen y capa DYFI respondieron `200`.

Una sesion nueva de navegador, posterior al ajuste final de Cesium, termino con
`0` errores y `0` advertencias de consola.

## 4. Secuencia e IOC

La secuencia se valido con eventos controlados para comprobar:

- seleccion determinista del evento principal;
- actividad posterior y conteos independientes de 6 h y 24 h;
- ausencia de capa cuando no existe una secuencia util;
- vocabulario descriptivo sin atribuir causalidad ni clasificar replicas.

La priorizacion IOC se valido con fixtures `tsunami=true` y `tsunami=false`. El
caso positivo ordena estaciones operativas por estado y distancia y limita el
resultado a cuatro. El caso negativo no destaca ninguna estacion.

La consulta de los 100 eventos actuales no encontro una bandera de tsunami. No
se alteraron datos ni se simulo una alerta para producir una captura artificial.

## 5. Evidencia local

- `output/playwright/official-impact-pager-shakemap-1920x1080.png`
- `output/playwright/pager-city-hover-1920x1080.png`
- `output/playwright/official-impact-dyfi-1920x1080.png`
- `output/playwright/label-anchor-final-start.png`
- `output/playwright/label-anchor-final-mid.png`
- `output/playwright/label-anchor-final-end.png`

Las capturas son evidencia local de validacion y no forman parte del bundle de
produccion.

## 6. Validacion de anclaje y operacion continua

Se observo el recorrido automatico en tres momentos de una misma sesion de
Chromium. Los nombres de ciudades y paises conservaron su coordenada y altura
visual, el selector de colisiones no cambio durante el vuelo y Cesium no emitio
errores de consola.

Tambien se ejecuto un monitoreo continuo desde `14:25:12` hasta `14:55:43`
hora de Lima, con 55 muestras:

- los cuatro puertos permanecieron activos en todas las muestras;
- la API y Chatterbox no tuvieron fallos de salud;
- Chatterbox permanecio cargado en CUDA y paso de 3 a 31 sintesis;
- las sintesis registradas terminaron con HTTP `200` y no hubo errores del
  motor;
- Vite respondio HTTP `200` por `localhost`/`::1`; el sondeo inicial a
  `127.0.0.1` no era valido porque el servidor estaba enlazado solo a IPv6.

El motor de voz genero audio correctamente. La salida multimedia predeterminada
de Windows era `Realtek Digital Output (Realtek(R) Audio)`, sin silencio, pero
con volumen maestro al 4 %, condicion que explica que el audio no se percibiera
aunque Chatterbox estuviera operativo.

## 7. Matriz de aceptacion

| Criterio SDD-019                         | Estado               | Evidencia                             |
| ---------------------------------------- | -------------------- | ------------------------------------- |
| Maximo ocho localidades PAGER oficiales  | Aprobado             | `us7000t1n5`, ocho ciudades           |
| Hover con poblacion, MMI, alerta y fecha | Aprobado             | Hover real sobre Ocos                 |
| PAGER condicionado a XML oficial         | Aprobado             | Pruebas API con y sin XML             |
| Contornos MMI, PGA y PGV oficiales       | Aprobado             | Tres respuestas GeoJSON `200`         |
| Concentracion DYFI geografica oficial    | Aprobado             | `us7000t1mu`, agregado 10 km          |
| Limpieza al cambiar de evento            | Aprobado             | Flujo PAGER a DYFI en sesiones reales |
| Secuencia principal/posterior 6 h y 24 h | Aprobado con fixture | Pruebas puras deterministas           |
| IOC solo con bandera de tsunami          | Aprobado con fixture | Casos `true` y `false`                |
| Rechazo de URL externa                   | Aprobado             | Prueba SSRF del servicio API          |
| Falla independiente por producto         | Aprobado             | Normalizacion anulable por producto   |
| Estructura 2D sin cambios                | Aprobado             | Capturas de escritorio                |
| Consola limpia tras el ajuste final      | Aprobado             | `0` errores, `0` advertencias en DYFI |
| Nombres anclados durante vuelos          | Aprobado             | Tres capturas, `0` errores de Cesium  |
| Operacion continua de Chatterbox         | Aprobado             | 55 muestras durante 30 minutos        |

## 8. Resultado

La implementacion satisface `SDD-019`. Los indicadores solo aparecen cuando el
producto oficial correspondiente existe; la ausencia de producto no genera
estimaciones locales ni bloquea las demas capas disponibles.
