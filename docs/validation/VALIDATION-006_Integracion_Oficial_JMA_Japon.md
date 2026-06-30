# VALIDATION-006 Integracion Oficial JMA Japon

## Resultado

Integracion validada y operativa al 30 de junio de 2026.

## Fuente verificada

- Portal oficial: `https://www.jma.go.jp/bosai/map.html#contents=earthquake`.
- Feed oficial: `https://www.jma.go.jp/bosai/quake/data/list.json`.
- Respuesta observada: HTTP 200, `application/json`, 206 reportes.

## Evidencia funcional

| Verificacion               | Evidencia                                                    | Resultado            |
| -------------------------- | ------------------------------------------------------------ | -------------------- |
| Primera ejecucion          | Fallo por prioridad JMA no definida en todos los mapas       | Incidencia detectada |
| Correccion                 | JMA agregada a las prioridades regionales y global           | Conforme             |
| Primera ingesta conforme   | 5 inserciones y 11 asociaciones                              | Conforme             |
| Persistencia               | 16 referencias, 16 `eid` distintos                           | Conforme             |
| Duplicidad interna         | 0 identificadores duplicados                                 | Conforme             |
| Actualizacion de auditoria | 16 actualizaciones al conservar todos los reportes por `eid` | Cambio controlado    |
| Reingesta final            | 0 inserciones, 0 actualizaciones, 0 asociaciones             | Conforme             |
| Estado API                 | JMA `success`; 11 fuentes configuradas                       | Conforme             |
| API y frontend             | HTTP 200                                                     | Conforme             |

La primera corrida del adaptador dejo una ejecucion `error` auditada porque
`preferred_source_priority` recibio `null`. La causa fue que JMA ya estaba en el
tipo compartido, pero faltaba en los mapas exhaustivos de prioridad. Se agrego
JMA a todas las regiones, se incorporo prioridad 100 para Japon y la siguiente
corrida finalizo correctamente. No se persistieron datos parciales en la
ejecucion fallida debido a la transaccion del worker.

Posteriormente se amplio el payload de auditoria desde un solo reporte hasta el
conjunto completo asociado al `eid`. Esto genero 16 actualizaciones controladas
una sola vez. Las dos ejecuciones posteriores finalizaron con conteos `0/0/0`,
demostrando idempotencia sobre el contrato definitivo.

## Evidencia automatizada

| Comando                   | Resultado                                   |
| ------------------------- | ------------------------------------------- |
| `npm test -w apps/worker` | 16 pruebas aprobadas, 0 fallidas            |
| `npm run typecheck`       | API, worker y frontend sin errores de tipos |
| `npm run build`           | shared, API, worker y frontend compilados   |

Las pruebas nuevas cubren fecha con huso `+09:00`, ISO 6709, profundidad,
intensidad Shindo, descarte de datos invalidos, consolidacion por `eid` y
prioridad regional.

## Trazabilidad de aceptacion

| Criterio SDD-006                          | Estado   |
| ----------------------------------------- | -------- |
| Endpoint oficial con estructura valida    | Conforme |
| JMA visible en estado de fuentes          | Conforme |
| Ingesta real en `success`                 | Conforme |
| Consolidacion de reportes por `eid`       | Conforme |
| Reingesta idempotente                     | Conforme |
| Prioridad regional Japon                  | Conforme |
| Sin duplicados por fuente e identificador | Conforme |
| Pruebas, typecheck y build                | Conforme |

## Limitaciones vigentes

1. El feed pertenece al dominio oficial de JMA, pero no publica un SLA ni un
   contrato versionado en esa ruta.
2. La intensidad JMA se conserva como texto y no se compara numericamente con
   MMI.
3. El feed de terremotos no sustituye productos oficiales de tsunami.
4. Los archivos de detalle se enlazan, pero no se descargan ni procesan.

## Conclusiones por rol

**Ingenieria de software:** el adaptador cumple validacion, normalizacion,
consolidacion, trazabilidad, aislamiento de fallas e idempotencia.

**Ingenieria de sistemas:** JMA queda operativa con consulta cada 120 segundos,
estado independiente y riesgo contractual documentado para monitoreo.
