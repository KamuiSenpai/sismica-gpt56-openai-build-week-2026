# VALIDATION-018 - Explicador sismico GPT-5.6 para Build Week

## 1. Resumen

Validacion ejecutada el 17 de julio de 2026 sobre la rama `feat/build-week-gpt56`.

Resultado: implementacion local aprobada; llamada real a OpenAI pendiente hasta disponer de una clave habilitada con cuota util.

## 2. Entorno

- Sistema: Windows, PowerShell.
- Node.js: `v22.17.1`.
- Codex CLI: `0.144.5`.
- Sesion Codex: `019f71fa-c858-78a0-8d3f-d293510f8be8`.
- Modelo configurado: `gpt-5.6`.
- API key detectada durante la validacion: no.

## 3. Pruebas automatizadas

| Comando                   | Resultado                            |
| ------------------------- | ------------------------------------ |
| `npm run typecheck`       | Aprobado en todos los workspaces     |
| `npm run lint`            | Aprobado, 0 errores y 0 advertencias |
| `npm test -w apps/api`    | 51/51 aprobadas                      |
| `npm test -w apps/worker` | 52/52 aprobadas                      |
| `npm test -w apps/web`    | 109/109 aprobadas                    |
| `npm run build`           | Aprobado, 111 modulos web            |
| `npm run verify`          | Aprobado de extremo a extremo        |

La validacion final se ejecuto sin credenciales temporales. Las variables opcionales vacias se normalizan como ausentes, por lo que copiar `.env.example` no activa ni bloquea integraciones deshabilitadas.

## 4. Cobertura GPT-5.6

La cobertura confirma:

1. El contrato publico acepta solo `eventId` y rechaza hechos suministrados por el cliente.
2. Error controlado si OpenAI esta deshabilitado o falta la API key.
3. Uso de `POST /v1/responses`, `model: gpt-5.6`, `store: false` y JSON Schema estricto.
4. Conservacion de modelo, `response_id`, fecha y disclaimer.
5. Rechazo de salida vacia, fuera de esquema o negativa estructurada.
6. Seguridad de origen y cierre de operaciones cuando falta el token de operador.
7. Clasificacion determinista de presencia y posicion fija de estaciones.

## 5. Validacion de navegador

Se uso Playwright CLI contra Vite local y eventos actuales obtenidos desde el fallback publico de USGS.

| Vista            | Resolucion | Resultado                      |
| ---------------- | ---------- | ------------------------------ |
| Escritorio       | 1280 x 720 | Aprobado                       |
| Movil            | 390 x 844  | Aprobado                       |
| Escritorio final | 1440 x 900 | Aprobado, 0 errores de consola |

Artefactos locales:

- `output/playwright/build-week-gpt56-desktop.png`
- `output/playwright/build-week-gpt56-mobile.png`
- `output/playwright/security-openai-stations-1440x900.png`

La respuesta usada en estas capturas fue simulada mediante interceptacion de red. Sirve para validar UI, responsive design y metadatos, pero no constituye evidencia de consumo real de GPT-5.6.

## 6. Defectos encontrados y corregidos

### Evento cambiante durante el dialogo

El recorrido automatico podia avanzar mientras el usuario leia el panel. La franja del dialogo llegaba a mostrar el evento nuevo con la explicacion anterior. Se corrigio congelando el evento capturado al pulsar el boton hasta cerrar el panel.

Prueba posterior: el monitor avanzo de M4.2 a M5.0 despues de 18 segundos, mientras el dialogo conservo el evento M4.2 y su explicacion.

### Overlays por encima del dialogo

El modal estaba anidado bajo el contexto de apilamiento de la columna izquierda. El rótulo del director y una tarjeta del mapa podian aparecer por encima. Se corrigio renderizando el dialogo en `document.body` con un portal React.

### Estaciones que parecian desplazarse

Las 82 estaciones GEOFON activas no presentaban coordenadas duplicadas ni discrepancias PostGIS. El frontend reasignaba la posicion de todas las entidades con cada estado SSE. Ahora la coordenada de catalogo se fija durante la sesion, el simbolo se ancla al terreno y el worker no mueve una estacion existente durante la actualizacion diaria; solo cambian estado y fase.

### Analitica historica bloqueante

`/api/analytics/seismic-presence` cargaba 1.45 millones de titulos y los clasificaba dentro de cada solicitud. El resumen se materializo en PostgreSQL y se reconstruye por lotes con bloqueo asesor. Medicion local: aproximadamente 7.3 s antes y 13.5-13.9 ms despues.

### Politica de recursos de Helmet

La primera validacion segura bloqueo WAV entre `localhost:3000` y `localhost:5173`. Se ajusto exclusivamente `Cross-Origin-Resource-Policy` a `cross-origin`; el filtro de origen sigue devolviendo `403` a sitios no autorizados. La repeticion Playwright termino con 0 errores.

## 7. Matriz de aceptacion

| Criterio SDD-018                        | Estado            | Evidencia                    |
| --------------------------------------- | ----------------- | ---------------------------- |
| Deshabilitado responde error controlado | Aprobado          | Prueba de servicio           |
| Entrada invalida rechazada              | Aprobado          | Esquema Zod                  |
| Respuesta valida conserva metadatos     | Aprobado con mock | Prueba `resp_build_week_001` |
| Respuesta vacia o invalida bloqueada    | Aprobado          | Pruebas de error             |
| Panel no llama automaticamente          | Aprobado          | Flujo Playwright             |
| Cambio de evento no mezcla respuestas   | Aprobado          | Espera real de 18 segundos   |
| Desktop y movil                         | Aprobado          | Capturas locales             |
| Respuesta real OpenAI `resp_...`        | Pendiente         | Falta clave con cuota util   |
| Hechos cargados desde PostgreSQL        | Aprobado          | Cliente envia solo `eventId` |
| Auditoria y cache por version           | Aprobado          | Migracion 009                |
| Seguridad y rate limits                 | Aprobado          | Pruebas API                  |

## 8. Cierre pendiente

1. Configurar `OPENAI_API_KEY` en `.env` sin versionarla.
2. Iniciar API y ejecutar `node scripts/capture-build-week-evidence.mjs --session-id=<id>`.
3. Confirmar modelo `gpt-5.6...` y un `response_id` real con prefijo `resp_`.
4. Grabar el video con esa respuesta real.

La publicacion ya esta completa en [KamuiSenpai/sismica-gpt56-openai-build-week-2026](https://github.com/KamuiSenpai/sismica-gpt56-openai-build-week-2026), con `main` y `feat/build-week-gpt56` disponibles.
