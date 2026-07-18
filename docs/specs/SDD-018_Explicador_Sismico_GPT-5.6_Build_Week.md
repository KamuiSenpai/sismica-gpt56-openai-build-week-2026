# SDD-018 - Explicador sismico con GPT-5.6 para Build Week

## 1. Objetivo

Agregar entre el 17 y el 21 de julio de 2026 una capacidad nueva y demostrable: explicar un evento sismico en lenguaje claro mediante OpenAI GPT-5.6, sin reemplazar los datos oficiales ni el director editorial existente.

La funcionalidad debe dejar evidencia tecnica de que:

- Codex participo en la especificacion, implementacion y validacion.
- La aplicacion llama a OpenAI Responses API con el modelo `gpt-5.6`.
- La salida usa JSON Schema estricto y conserva trazabilidad de modelo, respuesta y fecha.

## 2. Problema

La tarjeta operativa presenta magnitud, profundidad, coordenadas y metadatos tecnicos. Una persona no especializada puede ver esos datos sin comprender que significan ni cuales son sus limites. El explicador debe traducir los campos disponibles sin inventar impacto, danos, causalidad tectonica o alertas.

## 3. Alcance Build Week

### Incluido

- Endpoint `POST /api/ai/explain-event`.
- Integracion directa con `POST /v1/responses` de OpenAI.
- Modelo configurable con valor por defecto `gpt-5.6`.
- Structured Outputs mediante `text.format` y JSON Schema estricto.
- Panel web accionado por el usuario para el evento seleccionado.
- Metadatos visibles: proveedor, modelo, `response_id` y fecha de generacion.
- Grounding exclusivo desde PostgreSQL a partir de `eventId`.
- Cache por version del evento y auditoria de modelo, hash, tokens, latencia y estado.
- Rate limit dedicado para proteger cuota y costos.
- Pruebas sin consumo real de API mediante transporte simulado.
- Evidencia reproducible de commits, sesion de Codex, pruebas y llamada real.

### Excluido

- Reemplazar DeepSeek en narracion, segmentos o director del directo.
- Generar alertas oficiales, predicciones, evaluaciones de danos o recomendaciones locales de emergencia.
- Enviar a OpenAI claves, credenciales, datos personales o historiales de operadores.
- Ocultar un fallo de configuracion mediante una respuesta que parezca generada por GPT-5.6.

## 4. Contrato de entrada y grounding

El contrato publico acepta exactamente `{ "eventId": string }`. Cualquier hecho sismico adicional enviado por el navegador se rechaza por el esquema Zod estricto.

La API consulta `seismic_events` y `event_source_refs` para construir magnitud, profundidad, coordenadas, fecha, estado, indicador de tsunami y fuentes asociadas. La version se deriva de `updated_at_utc` o `ingested_at`, y la entrada se identifica con un hash SHA-256 que incluye la version del prompt.

## 5. Contrato de salida

La salida estructurada de GPT-5.6 contiene exactamente:

- `headline`: titulo corto y descriptivo.
- `overview`: explicacion simple de los hechos disponibles.
- `technicalReading`: lectura educativa de magnitud, profundidad y limites.
- `recommendedActions`: acciones generales y prudentes, nunca una orden oficial.
- `dataLimitations`: datos ausentes o conclusiones que no pueden obtenerse.

El backend agrega de forma determinista:

- `provider: "openai"`.
- `model`: modelo solicitado o confirmado por la API.
- `responseId`: identificador `resp_...` de OpenAI.
- `generatedAtUtc`: fecha local de recepcion.
- `disclaimer`: texto fijo que remite a autoridades y fuentes oficiales.
- `usage`: tokens de entrada, salida y total reportados por OpenAI.
- `cached`: indica si la explicacion ya existia para esa version del evento.
- `grounding`: `eventId`, version, cantidad de fuentes y hash SHA-256 de entrada.

## 6. Reglas de seguridad factual

El prompt de sistema debe prohibir:

1. Inventar danos, victimas, intensidad sentida o reportes ciudadanos.
2. Presentar el indicador `tsunami=true` como alerta o amenaza confirmada.
3. Predecir replicas, terremotos o evolucion del evento.
4. Afirmar un mecanismo tectonico que no forme parte de la entrada.
5. Recomendar ignorar o sustituir a una autoridad oficial.

La API valida de nuevo la salida con Zod. Una respuesta vacia, una negativa del modelo, JSON invalido o un esquema incompleto produce error controlado; no se presenta como explicacion valida.

## 7. Configuracion

```dotenv
OPENAI_ENABLED=false
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.6
OPENAI_TIMEOUT_MS=15000
API_AI_RATE_LIMIT_MAX=10
API_RATE_LIMIT_WINDOW_MS=60000
```

La clave solo vive en `.env`, archivo excluido por Git. El estado por defecto es deshabilitado para evitar costos o llamadas accidentales.

## 8. Criterios de aceptacion

1. Con OpenAI deshabilitado, el endpoint responde `503` y la interfaz explica que falta configuracion.
2. Una entrada incompleta o con hechos suministrados por el cliente responde `400`.
3. Una respuesta simulada valida conserva `response_id`, modelo y todos los campos estructurados.
4. Una respuesta vacia, rechazada o invalida no se muestra como contenido de GPT-5.6.
5. El panel se reinicia cuando cambia el evento seleccionado y no realiza llamadas automaticas.
6. `npm run typecheck`, pruebas API y build web finalizan correctamente.
7. Una prueba manual con API key registra el `response_id` sin registrar ni versionar la clave.
8. Una llamada repetida para la misma version usa cache y no vuelve a consumir OpenAI.
9. Cada exito o fallo deja auditoria sin persistir la clave ni el prompt completo.

## 9. Evidencia de entrega

La carpeta `docs/build-week/evidence/` debe contener:

- identificador y resumen sanitizado de la sesion Codex;
- salida de validaciones con fecha;
- solicitud de demo sin cabecera de autorizacion y respuesta con `response_id`;
- listado de commits creados del 17 al 21 de julio de 2026;
- capturas o enlaces que el participante revise antes de compartir.

No se versiona el transcript JSONL completo porque puede contener rutas locales, contexto privado o credenciales. El transcript original se conserva en `$CODEX_HOME/sessions` y se comparte solo despues de revisarlo.

## 10. Referencias oficiales

- Build Week: https://openai.com/build-week/
- Modelo GPT-5.6 Sol: https://developers.openai.com/api/docs/models/gpt-5.6-sol
- Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
