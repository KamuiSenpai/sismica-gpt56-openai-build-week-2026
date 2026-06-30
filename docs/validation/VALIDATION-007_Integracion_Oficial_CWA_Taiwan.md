# VALIDATION-007 Integracion Oficial CWA Taiwan

## Resultado

Integracion validada y operativa al 30 de junio de 2026.

## Fuente verificada

- Portal oficial: `https://opendata.cwa.gov.tw/`.
- Endpoint oficial: `https://opendata.cwa.gov.tw/api/v1/rest/datastore/E-A0016-002`.
- Autenticacion validada: header `Authorization`.
- Respuesta observada: HTTP 200, `application/json`, longitud aproximada 16.7 KB
  para `limit=1`.

## Evidencia funcional

| Verificacion             | Evidencia                                                     | Resultado            |
| ------------------------ | ------------------------------------------------------------- | -------------------- |
| Contrato oficial         | `E-A0016-002` responde con JSON autenticado por header        | Conforme             |
| Identidad observada      | `EarthquakeNo = 115000` repetido en multiples eventos         | Incidencia detectada |
| Correccion de identidad  | `sourceEventId` tomado desde `Web` y fallback hash disponible | Conforme             |
| Primera ingesta conforme | 2 inserciones CWA, 0 asociaciones, 0 errores                  | Conforme             |
| Persistencia             | 2 referencias, 2 identificadores distintos                    | Conforme             |
| Duplicidad interna       | 0 duplicados por `source_event_id`                            | Conforme             |
| Reingesta sin cambios    | 0 inserciones, 0 actualizaciones, 0 asociaciones              | Conforme             |
| Prioridad Taiwan/Japon   | Un evento quedo con prioridad 40 por solapamiento regional    | Incidencia detectada |
| Correccion de prioridad  | Taiwan se evalua antes que Japon; refresco canónico ejecutado | Conforme             |
| Reingesta de correccion  | 1 actualizacion controlada                                    | Conforme             |
| Estado API               | CWA `success`; 12 fuentes configuradas                        | Conforme             |
| API y frontend           | HTTP 200                                                      | Conforme             |

La validacion del contrato externo mostro que `EarthquakeNo` no es una clave
estable en `E-A0016-002`; por ejemplo, varios eventos recientes compartian el
valor `115000`. La integracion no usa ese campo como identidad primaria y
extrae el slug unico de `Web`, con fallback hash cuando `Web` no exista.

Durante la primera corrida funcional, CWA inserto dos eventos canónicos. En la
reingesta inmediata, los conteos quedaron `0/0/0`, demostrando idempotencia.
Posteriormente se detecto un defecto de prioridad: una coordenada de Taiwan
entraba tambien en la envolvente de Japon, lo que dejaba un canónico CWA con
prioridad `40`. Se corrigio el orden de evaluacion regional y se permitio que
una referencia sin cambios refresque el canónico cuando la prioridad efectiva
cambia. La siguiente corrida registro `updated = 1` y dejo ambas referencias
CWA con prioridad `100`.

## Evidencia automatizada

| Comando                   | Resultado                                   |
| ------------------------- | ------------------------------------------- |
| `npm test -w apps/worker` | 20 pruebas aprobadas, 0 fallidas            |
| `npm run typecheck`       | API, worker y frontend sin errores de tipos |
| `npm run build`           | shared, API, worker y frontend compilados   |

Las pruebas nuevas cubren extraccion de identidad desde `Web`, fallback hash,
conversion `+08:00`, coordenadas, profundidad, intensidad maxima, conteo de
estaciones, descarte de datos invalidos y prioridad CWA incluso en la zona de
solapamiento con Japon.

## Trazabilidad de aceptacion

| Criterio SDD-007                          | Estado   |
| ----------------------------------------- | -------- |
| Endpoint oficial con estructura valida    | Conforme |
| CWA visible en estado de fuentes          | Conforme |
| Ingesta real en `success`                 | Conforme |
| Identidad estable sin depender de No.     | Conforme |
| Reingesta idempotente                     | Conforme |
| Prioridad regional Taiwan                 | Conforme |
| Sin duplicados por fuente e identificador | Conforme |
| Pruebas, typecheck y build                | Conforme |

## Limitaciones vigentes

1. El recurso requiere credencial emitida por CWA y no puede consultarse desde
   frontend.
2. La intensidad CWA se conserva como texto y no se transforma a MMI.
3. No se modelan las estaciones como entidades independientes.
4. El recurso no sustituye canales oficiales de tsunami.

## Conclusiones por rol

**Ingenieria de software:** el adaptador CWA cumple autenticacion segura,
normalizacion, identidad estable, prioridad regional correcta e idempotencia.

**Ingenieria de sistemas:** CWA queda operativa con consulta cada 120 segundos,
estado independiente y dependencia explicita de credencial institucional.
