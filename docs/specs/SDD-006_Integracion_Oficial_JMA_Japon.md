# SDD-006 Integracion Oficial JMA Japon

## Estado

Vigente para implementacion y validacion.

## Documentos relacionados

1. `SDD-003_Integracion_Multifuente_y_Deduplicacion_Sismica.md`.
2. `SDD-004_Ampliacion_de_Fuentes_Oficiales_y_Reconciliacion_Sismica.md`.
3. `SDD-005_Integracion_Oficial_BMKG_Indonesia.md`.
4. Informes profesionales ubicados en `output/doc`.

## Objetivo

Incorporar a la Japan Meteorological Agency (`JMA`) como fuente sismologica
nacional preferida para Japon, conservando la trazabilidad de sus reportes, la
escala de intensidad Shindo y la deduplicacion PostGIS existente.

## Fuente y autoridad

JMA publica en su portal Bosai informacion oficial de terremotos e intensidad
sismica. El visor institucional consume un listado JSON publico alojado en el
dominio oficial:

- Portal: `https://www.jma.go.jp/bosai/map.html#contents=earthquake`.
- Feed: `https://www.jma.go.jp/bosai/quake/data/list.json`.

El feed no requiere autenticacion y, al 30 de junio de 2026, responde con JSON.
No se realizara scraping de HTML.

El endpoint es un recurso operativo del visor oficial, pero JMA no publica en
esa ruta un SLA ni un contrato de API versionado. Por ello, la integracion debe
validar el contenedor y aislar cualquier cambio de esquema como falla exclusiva
de JMA.

## Alcance funcional

1. Consultar el listado JSON cada 120 segundos.
2. Validar la estructura externa antes de normalizar.
3. Consolidar los distintos reportes de un mismo terremoto mediante `eid`.
4. Normalizar fecha con huso horario, coordenadas ISO 6709, magnitud,
   profundidad, region e intensidad maxima JMA.
5. Persistir el payload original y la referencia JMA.
6. Aplicar prioridad regional JMA dentro de Japon.
7. Exponer el estado independiente de JMA mediante la API.

## Exclusiones

1. No convertir la escala JMA Shindo a MMI.
2. No interpretar avisos de tsunami desde este feed de terremotos.
3. No descargar automaticamente los archivos de detalle asociados.
4. No traducir nombres cuando JMA no entregue `en_anm`.
5. No presentar el endpoint como servicio con disponibilidad garantizada.

## Contrato externo

El contenedor esperado es un arreglo JSON en la raiz. Cada reporte debe incluir
`eid`; los registros normalizables requieren ademas `at`, `cod` y `mag`.

| Campo JMA        | Campo interno             | Regla                                               |
| ---------------- | ------------------------- | --------------------------------------------------- |
| `eid`            | `sourceEventId`           | identificador estable del terremoto                 |
| `ctt`            | revision                  | seleccionar el reporte mas reciente por evento      |
| `at`             | `eventTimeUtc`            | convertir ISO 8601 con `+09:00` a UTC               |
| `rdt`            | `updatedAtUtc`            | aceptar solo fecha valida                           |
| `cod`            | coordenadas y profundidad | interpretar ISO 6709 `lat lon profundidad`          |
| `mag`            | `magnitude`               | conversion numerica obligatoria                     |
| `maxi`           | `intensityText`           | conservar como `JMA <valor>`                        |
| `en_anm` / `anm` | `title`                   | preferir nombre ingles y conservar respaldo japones |
| `json`           | `detailUrl`               | construir URL dentro del dominio oficial            |

Una fila sin `eid`, fecha de origen valida, magnitud o coordenadas validas se
descarta. Los valores deben respetar latitud `[-90, 90]` y longitud
`[-180, 180]`.

## Identidad y consolidacion

`eid` se utiliza directamente como `source_event_id`. JMA emite varios reportes
para un mismo evento, por ejemplo informacion inicial, hipocentro e intensidad.
Antes de persistir:

1. Se agrupan los reportes por `eid`.
2. Se conserva como base el reporte localizado con mayor `ctt`.
3. Se conserva la intensidad `maxi` mas reciente disponible para ese `eid`.
4. Se produce una sola referencia JMA por terremoto.

La restriccion `(source, source_event_id)` y la asociacion espacial y temporal
evitan duplicidad interna y visible con otras fuentes.

## Prioridad regional

Se utiliza una envolvente geografica conservadora para Japon:

```text
latitud:  24.0 a 46.0
longitud: 122.0 a 154.0
```

Orden de preferencia regional:

1. JMA: 100.
2. USGS: 80.
3. GEOFON: 75.
4. EMSC: 70.
5. Otras fuentes regionales fuera de su territorio: 40.

Fuera de Japon, JMA conserva prioridad baja y no reemplaza una fuente global
preferida.

## Cambios de software

1. Ampliar `SourceCode` con `JMA`.
2. Agregar la variable `JMA_LIST_URL`.
3. Agregar esquema Zod del arreglo JMA.
4. Implementar `jmaProvider` y consolidacion por `eid`.
5. Registrar intervalo, orquestacion y estado API.
6. Incorporar prioridad geografica para Japon.
7. No se requiere migracion SQL porque los codigos se almacenan como texto.

## Seguridad y continuidad

1. Aplicar timeout y limite de tamano comunes del worker.
2. Enviar identificacion de cliente mediante `User-Agent`.
3. Conservar payload original para auditoria.
4. Una falla JMA no debe detener otros proveedores.
5. Validar tipos y fechas antes de persistir.
6. Mantener el intervalo en 120 segundos para reducir carga innecesaria.

## Criterios de aceptacion

1. El endpoint oficial responde con estructura valida.
2. JMA aparece en `/api/sources/status`.
3. La primera ingesta real finaliza con estado `success`.
4. Varios reportes con el mismo `eid` generan una sola referencia.
5. Una segunda ingesta es idempotente cuando el payload no cambia.
6. JMA tiene prioridad sobre USGS en Japon y prioridad inferior fuera de esa
   region.
7. No existen duplicados por `(source, source_event_id)`.
8. Pruebas unitarias, typecheck y build finalizan sin errores.

## Plan de validacion funcional

1. Ejecutar worker contra el feed oficial.
2. Verificar estado y conteos en `ingestion_runs`.
3. Verificar referencias JMA en `event_source_refs`.
4. Verificar asociaciones con eventos existentes.
5. Ejecutar segunda ingesta y comprobar idempotencia.
6. Consultar API, frontend y estado de fuentes.

## Plan de pruebas unitarias

1. Normalizacion de fecha `+09:00`, coordenadas ISO 6709 y profundidad.
2. Conservacion de intensidad Shindo como texto.
3. Rechazo de registros incompletos o invalidos.
4. Consolidacion determinista de reportes por `eid`.
5. Prioridad JMA dentro y fuera de Japon.

## Trazabilidad

| Requisito          | Componente                        | Evidencia prevista             |
| ------------------ | --------------------------------- | ------------------------------ |
| Consulta oficial   | `jmaProvider`                     | ejecucion real                 |
| Validacion externa | esquema Zod                       | rechazo de contenedor invalido |
| Sin duplicidad     | consolidacion por `eid` + PostGIS | conteos SQL                    |
| Prioridad nacional | `sourcePriority`                  | prueba regional                |
| Observabilidad     | `ingestion_runs` y API            | estado JMA                     |
