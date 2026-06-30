# TEST-006 Integracion Oficial JMA Japon

## Objetivo

Definir las pruebas funcionales y automatizadas requeridas para aceptar la
integracion de JMA conforme a `SDD-006_Integracion_Oficial_JMA_Japon.md`.

## Precondiciones

1. PostgreSQL/PostGIS operativo y migraciones aplicadas.
2. API y frontend disponibles localmente.
3. Acceso HTTPS al dominio `www.jma.go.jp`.
4. `JMA_LIST_URL` configurada o usando el valor oficial predeterminado.
5. Ventana de consulta configurada en 72 horas.

## Casos funcionales

| ID     | Caso                               | Resultado esperado                                   |
| ------ | ---------------------------------- | ---------------------------------------------------- |
| VF-601 | Consultar `list.json` oficial      | HTTP 200 y arreglo JSON no vacio                     |
| VF-602 | Ejecutar primera ingesta conforme  | JMA finaliza en `success`                            |
| VF-603 | Revisar persistencia               | Referencias con `source = JMA` y `eid` unico         |
| VF-604 | Revisar consolidacion              | Varios reportes de un `eid` producen una referencia  |
| VF-605 | Revisar asociacion                 | Coincidencias se enlazan sin duplicidad visible      |
| VF-606 | Repetir ingesta sin cambios        | Conteos `inserted`, `updated` y `associated` en cero |
| VF-607 | Consultar estado API               | JMA visible en el catalogo de fuentes                |
| VF-608 | Consultar salud y frontend         | Respuesta HTTP 200                                   |
| VF-609 | Verificar prioridad en Japon       | JMA supera a USGS dentro de la region                |
| VF-610 | Verificar prioridad fuera de Japon | USGS supera a JMA en Peru                            |

## Pruebas unitarias

1. Convierte una fecha JMA `+09:00` a UTC.
2. Interpreta coordenadas y profundidad ISO 6709.
3. Conserva la intensidad Shindo como texto sin convertirla a MMI.
4. Rechaza fecha o coordenadas invalidas.
5. Consolida reportes por `eid` y conserva la intensidad disponible.
6. Aplica prioridad regional dentro y fuera de Japon.

## Pruebas de regresion

1. Ejecutar la suite completa del worker.
2. Ejecutar `npm run typecheck` desde la raiz.
3. Ejecutar `npm run build` desde la raiz.
4. Confirmar que las fuentes existentes mantienen estado independiente.

## Criterio de salida

La entrega se acepta cuando todos los casos aplicables son conformes, no hay
duplicados por `(source, source_event_id)`, la reingesta es idempotente y las
pruebas automatizadas finalizan sin errores.
