# TEST-019 - Indicadores oficiales de area afectada

## 1. Ejecucion

Pruebas ejecutadas el 18 de julio de 2026 despues de la validacion funcional de
`VALIDATION-019`.

| Comando                   | Resultado                            |
| ------------------------- | ------------------------------------ |
| `npm run typecheck`       | Aprobado en todos los workspaces     |
| `npm run lint`            | Aprobado, 0 errores y 0 advertencias |
| `npm test -w apps/api`    | 55/55 aprobadas                      |
| `npm test -w apps/worker` | 52/52 aprobadas                      |
| `npm test -w apps/web`    | 125/125 aprobadas                    |
| `npm run build`           | Aprobado en todos los workspaces     |
| `npm run verify`          | Aprobado de extremo a extremo        |

La verificacion posterior a la correccion de anclaje termino con codigo de
salida `0` en `100.2 s`. El build web transformo 114 modulos y genero el bundle
de produccion correctamente.

## 2. Cobertura API

Archivo: `apps/api/test/usgsImpact.test.ts`.

Casos cubiertos:

1. Seleccion determinista y limite de ocho ciudades PAGER.
2. Normalizacion independiente de PAGER, ShakeMap y DYFI.
3. Cache de GeoJSON oficial.
4. Respaldo XML cuando `cities.json` no esta publicado.
5. Bloqueo de URLs ajenas a `earthquake.usgs.gov`.
6. PAGER deshabilitado si no existe `pager.xml` ni `exposure.xml`.

Los fixtures sustituyen `fetch`; las pruebas no dependen de disponibilidad de
red ni modifican datos del proveedor.

## 3. Cobertura web

Archivo: `apps/web/test/officialImpactMap.test.ts`.

Casos cubiertos:

1. Distancia geodesica y agrupacion espacial de 250 km.
2. Seleccion del evento principal por magnitud y antiguedad.
3. Conteos de actividad posterior a 6 h y 24 h.
4. Omision de la secuencia cuando falta actividad relacionada.
5. Priorizacion IOC por estado y distancia solo con `tsunami=true`.
6. Resultado vacio de IOC con `tsunami=false`.

La suite web completa conserva ademas las pruebas del motor de colisiones,
etiquetas en espanol, nitidez HiDPI, precache y presupuesto 4K ya existentes.
La validacion de navegador complementa estas pruebas con tres capturas durante
el recorrido automatico y una consola sin errores de Cesium.

## 4. Verificacion de seguridad

- La API no recibe ni resuelve URLs arbitrarias del navegador.
- Solo permite HTTPS hacia `earthquake.usgs.gov` y valida la URL final.
- Los documentos y GeoJSON tienen timeout y limites de bytes.
- Los productos se degradan de forma independiente.
- Las pruebas no usan credenciales ni secretos.

## 5. Resultado

Todas las pruebas automatizadas y builds requeridos por `SDD-019` finalizaron
correctamente. No quedan fallos conocidos en el alcance implementado.
