# VALIDATION-003 Integracion Multifuente y Deduplicacion Sismica

## Estado

Ejecutada satisfactoriamente el 30 de junio de 2026.

## Base documental

1. `docs/specs/SDD-003_Integracion_Multifuente_y_Deduplicacion_Sismica.md`
2. `docs/specs/SDD-002_Interfaz_Operativa_de_Monitoreo_Sismico.md`

## Entorno

- Windows
- Node.js y TypeScript
- PostgreSQL con PostGIS en `localhost:5433`
- API en `http://localhost:3000`
- Frontend en `http://localhost:5173`
- Navegador Chromium automatizado con Playwright CLI

## Resultados funcionales

| Caso                            | Resultado esperado                                        | Resultado obtenido                                                             | Estado   |
| ------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| VF-301 Migracion                | Crear modelo multi-fuente                                 | Cuatro migraciones aplicadas, incluida `004_multisource_event_model.sql`       | Conforme |
| VF-302 USGS                     | Ingestar catalogo global                                  | 261 referencias persistidas                                                    | Conforme |
| VF-303 EMSC                     | Ingestar y asociar catalogo                               | 804 referencias; 38 asociaciones cross-source                                  | Conforme |
| VF-304 IGP/CENSIS               | Ingestar fuente oficial de Peru                           | 10 eventos recientes persistidos en ventana de 72 h                            | Conforme |
| VF-305 FUNVISIS                 | Ingestar fuente oficial de Venezuela                      | 20 eventos recientes persistidos                                               | Conforme |
| VF-306 GDACS                    | Persistir contexto separado                               | 3 contextos persistidos sin duplicar sismos                                    | Conforme |
| VF-307 NOAA                     | Persistir CAP PTWC y NTWC                                 | 1 producto por centro persistido                                               | Conforme |
| VF-308 Deduplicacion            | No repetir eventos entre fuentes                          | 38 eventos multi-fuente, 0 pares cross-source pendientes bajo la regla vigente | Conforme |
| VF-309 Integridad por proveedor | No fusionar dos eventos de la misma fuente                | 0 colisiones de referencias de una misma fuente por evento canonico            | Conforme |
| VF-310 API                      | Exponer eventos, fuentes, GDACS y NOAA                    | Todos los endpoints respondieron HTTP 200                                      | Conforme |
| VF-311 CesiumJS                 | Mantener globo 3D e interaccion                           | Globo, placas, eventos y contextos GDACS renderizados                          | Conforme |
| VF-312 Panel tecnico            | Mostrar datos reales o N/D                                | USGS mostro estaciones, gap, dmin, RMS y significancia reales                  | Conforme |
| VF-313 Layout                   | Evitar colision entre feed, leyenda y pie                 | Area de solapamiento calculada: 0 px en 1366x768                               | Conforme |
| VF-314 Respuestas vacias        | No registrar como error una consulta valida sin productos | GDACS `204` y PTWC CAP sin `info` finalizaron con cero registros               | Conforme |

## Evidencia de base de datos

Ultima consulta de control:

```text
Eventos canonicos: EMSC 766, FUNVISIS 20, IGP 10, USGS 261
Referencias: EMSC 804, FUNVISIS 20, IGP 10, USGS 261
Eventos con mas de una fuente: 38
Colisiones dentro de una misma fuente: 0
Pares cross-source pendientes bajo umbrales: 0
Contextos GDACS: 3
Productos NOAA: 2
```

## Evidencia visual

- `output/playwright/sismica-1366.png`
- `output/playwright/sismica-1440x900.png`
- `output/playwright/sismica-1920x1080.png`
- `output/playwright/sismica-390x844.png`
- `output/playwright/sismica-usgs-detail.png`

En `1366x768` se midieron las siguientes areas:

```text
feed vs. leyenda: 0 px
feed vs. pie: 0 px
panel izquierdo vs. pie: 0 px
```

## Observaciones

1. IGP y FUNVISIS se encuentran aislados en adaptadores porque sus endpoints no publican una especificacion versionada.
2. GDACS y NOAA se muestran como contexto y producto oficial, no como eventos duplicados.
3. La disponibilidad de MMI, CDI, PAGER y otros parametros depende de cada evento y proveedor.

## Revalidacion del 18 de julio de 2026

Se reprodujeron los errores observados en operacion y se verificaron las
respuestas oficiales actuales:

- GDACS respondio HTTP `204` sin cuerpo; el adaptador corregido lo proceso como
  exito con cero contextos.
- PTWC respondio con una cabecera CAP valida sin bloque `info`; el adaptador la
  omitio como producto no presentable y termino con exito.
- NTWC conservo su producto CAP completo y procesable.
- INSIVUMEH devolvio 619 eventos, FUNVISIS 20 y SSN 15 en la consulta directa.
- GA respondio correctamente sin eventos para la ventana solicitada.

Un ciclo completo aislado, con YouTube deshabilitado solo para no depender de
una transmision activa, dejo `GDACS`, `NOAA_PTWC`, `NOAA_NTWC`, `INSIVUMEH`,
`FUNVISIS`, `SSN` y `GA` en estado `success` en `/api/sources/status`.
