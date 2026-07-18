# Guia de evidencia - OpenAI Build Week 2026

## Estado al 17 de julio

| Evidencia                     | Estado    | Referencia                                         |
| ----------------------------- | --------- | -------------------------------------------------- |
| Commits dentro de la ventana  | Completo  | `5f15320`, `471cc1d`, `6a98924`, `27c3cda`         |
| Sesion Codex identificada     | Completo  | `evidence/CODEX_SESSION_2026-07-17.md`             |
| Integracion GPT-5.6 en codigo | Completo  | `POST /api/ai/explain-event`                       |
| Pruebas automatizadas         | Completo  | 51 API, 52 worker y 109 web                        |
| Validacion visual             | Completo  | Escritorio y movil con respuesta simulada          |
| Respuesta real `resp_...`     | Pendiente | Requiere clave habilitada y cuota util             |
| Video de demo                 | Pendiente | Grabar despues de la llamada real                  |
| Repositorio remoto            | Completo  | `KamuiSenpai/sismica-gpt56-openai-build-week-2026` |

## 1. Configurar la llamada real

Editar el `.env` local, que esta excluido de Git:

```dotenv
OPENAI_ENABLED=true
OPENAI_API_KEY=su_clave_real
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.6
OPENAI_TIMEOUT_MS=15000
```

No pegar la clave en capturas, comandos, documentos ni issues.

## 2. Iniciar API y web

En terminales separadas:

```powershell
npm run dev:api
npm run dev:web
```

La API no imprime la cabecera `Authorization`. El panel web muestra solamente proveedor, modelo, `response_id` y fecha.

## 3. Capturar evidencia verificable

Con la API activa y configurada:

```powershell
node scripts/capture-build-week-evidence.mjs --session-id=019f71fa-c858-78a0-8d3f-d293510f8be8
```

El comando selecciona un evento canonico reciente, envia solamente su `eventId` y crea bajo `output/build-week/`:

- `manifest.json`: sesion, commits y estado de verificacion.
- `commits.json`: hashes y fechas dentro de la ventana.
- `openai-response.json`: `eventId`, grounding/hash y respuesta real sin credenciales.

La carpeta esta ignorada por Git. Revisar los archivos antes de adjuntarlos o mover una version sanitizada a `docs/build-week/evidence/`.

Para comprobar solo commits y sesion sin consumir API:

```powershell
node scripts/capture-build-week-evidence.mjs --skip-api --session-id=019f71fa-c858-78a0-8d3f-d293510f8be8
```

## 4. Captura y video

1. Abrir el monitor y pausar el recorrido para mantener un evento estable.
2. Mostrar la tarjeta del evento y pulsar `GPT-5.6 - Explicar este evento`.
3. Esperar la respuesta real.
4. Mostrar en el mismo plano el modelo `gpt-5.6...` y el `response_id` con prefijo `resp_`.
5. Explicar que la salida distingue lectura, acciones prudentes y limites de los datos.
6. Mostrar brevemente los commits fechados del 17 al 21 de julio.
7. No presentar las capturas simuladas de Playwright como prueba de una llamada real.

## 5. Evidencia Codex

El transcript completo se conserva localmente bajo `$CODEX_HOME/sessions`. Antes de compartirlo:

1. Revisar mensajes, rutas, archivos referenciados y salidas de herramientas.
2. Confirmar que no aparezcan secretos ni contenido privado ajeno al proyecto.
3. Usar la accion `Share` de la aplicacion cuando este disponible, o presentar la ficha sanitizada y los commits.
4. No versionar el JSONL completo en el repositorio.

## 6. Publicacion

Repositorio publico: [KamuiSenpai/sismica-gpt56-openai-build-week-2026](https://github.com/KamuiSenpai/sismica-gpt56-openai-build-week-2026).

- `main`: rama principal para evaluacion.
- `feat/build-week-gpt56`: rama trazable del trabajo Build Week.
- El historial conserva las fechas y los commits separados de especificacion, backend, interfaz, evidencia y preparacion publica.
