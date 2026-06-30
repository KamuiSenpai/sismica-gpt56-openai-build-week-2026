# TEST-007 Integracion Oficial CWA Taiwan

## Objetivo

Definir las pruebas funcionales y automatizadas requeridas para aceptar la
integracion de CWA conforme a `SDD-007_Integracion_Oficial_CWA_Taiwan.md`.

## Precondiciones

1. PostgreSQL/PostGIS operativo y migraciones aplicadas.
2. API y frontend disponibles localmente.
3. Acceso HTTPS al dominio `opendata.cwa.gov.tw`.
4. `CWA_AUTHORIZATION` configurada en backend.
5. `CWA_EARTHQUAKE_URL` configurada o usando el valor oficial predeterminado.
6. Ventana de consulta configurada en 72 horas.

## Casos funcionales

| ID     | Caso                                    | Resultado esperado                                   |
| ------ | --------------------------------------- | ---------------------------------------------------- |
| VF-701 | Consultar endpoint oficial con header   | HTTP 200 y JSON no vacio                             |
| VF-702 | Ejecutar primera ingesta conforme       | CWA finaliza en `success`                            |
| VF-703 | Revisar persistencia                    | Referencias con `source = CWA` y claves unicas       |
| VF-704 | Revisar identidad estable               | `sourceEventId` proviene del slug de `Web`           |
| VF-705 | Revisar fallback de identidad           | Hash estable si falta `Web`                          |
| VF-706 | Revisar prioridad en Taiwan             | CWA supera a USGS y prevalece como fuente oficial    |
| VF-707 | Revisar prioridad fuera de Taiwan       | USGS supera a CWA fuera de la region                 |
| VF-708 | Repetir ingesta sin cambios             | Conteos `inserted`, `updated` y `associated` en cero |
| VF-709 | Corregir prioridad con referencia igual | Una reingesta puede refrescar el canónico            |
| VF-710 | Consultar estado API                    | CWA visible en el catalogo de fuentes                |
| VF-711 | Consultar salud y frontend              | Respuesta HTTP 200                                   |

## Pruebas unitarias

1. Extrae `sourceEventId` desde `Web`.
2. Genera fallback estable cuando falta `Web`.
3. Convierte fechas `+08:00` a UTC.
4. Normaliza coordenadas, profundidad, magnitud y `MagnitudeType`.
5. Conserva la intensidad maxima de CWA como texto.
6. Cuenta estaciones unicas del reporte.
7. Rechaza coordenadas o magnitud invalidas.
8. Aplica prioridad regional dentro y fuera de Taiwan.

## Pruebas de regresion

1. Ejecutar la suite completa del worker.
2. Ejecutar `npm run typecheck` desde la raiz.
3. Ejecutar `npm run build` desde la raiz.
4. Confirmar que las fuentes existentes mantienen estado independiente.

## Criterio de salida

La entrega se acepta cuando todos los casos aplicables son conformes, no hay
duplicados por `(source, source_event_id)`, la reingesta es idempotente, la
prioridad regional CWA es correcta y las pruebas automatizadas finalizan sin
errores.
