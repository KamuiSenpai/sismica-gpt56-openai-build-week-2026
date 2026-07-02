# Voz neural local (Piper + XTTS-v2) — Guía de setup

La narración de sismos puede usar tres motores, elegibles desde el **selector "MOTOR"** en la
barra superior de la web:

1. **Piper** — TTS neural local rápido (binario + modelo ONNX). Ideal para alertas en vivo.
2. **XTTS-v2** — voz premium más natural (microservicio Python con GPU). Ver
   [services/tts-xtts/README.md](../services/tts-xtts/README.md).
3. **Navegador** — voz del sistema (`speechSynthesis`). Es el **respaldo** y siempre está disponible.

El frontend solo habla con el API (`/api/tts`), que enruta a Piper (binario local) o hace **proxy**
a XTTS. Si el motor neural elegido falla o no está configurado, la web **cae automáticamente** a la
voz del navegador. Con `TTS_ENABLED=false` todo funciona igual usando solo el navegador.

## Arquitectura

```
Web (selector) → /api/tts?engine=piper|xtts (Express)
                    ├─ piper → binario local (child_process)  → WAV
                    └─ xtts  → proxy → services/tts-xtts (FastAPI, GPU) → WAV
Fallback: cualquier fallo → voz del navegador (seismicSpeech.ts)
```

## Setup de Piper (Windows)

1. Descarga el binario de Piper para Windows desde
   [rhasspy/piper releases](https://github.com/rhasspy/piper/releases) y descomprímelo, p. ej. en
   `models/piper/` (esa carpeta está en `.gitignore`).
2. Descarga una voz en español (`.onnx` + `.onnx.json`) desde
   [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices/tree/main/es), p. ej.
   `es_MX-claude-high`, y colócala junto al binario.
3. Configura el `.env` de la raíz:
   ```
   TTS_ENABLED=true
   PIPER_BINARY_PATH=models/piper/piper.exe
   PIPER_VOICE_MODEL=models/piper/es_MX-claude-high.onnx
   PIPER_USE_CUDA=false        # true si instalaste onnxruntime-gpu
   TTS_CACHE_DIR=.tts-cache    # cache de audios sintetizados (opcional)
   ```
4. Reinicia el API (`npm run dev:api`). Comprueba:
   ```
   GET http://localhost:3000/api/tts/health
   → { "enabled": true, "engines": { "piper": { "ok": true, "voice": "es_MX-claude-high" }, ... } }
   ```

## Setup de XTTS-v2

Ver [services/tts-xtts/README.md](../services/tts-xtts/README.md). En resumen: crear venv Python,
instalar `torch` (CUDA) + `requirements.txt`, arrancar `python app.py`, y en el `.env` raíz:

```
XTTS_SERVICE_URL=http://127.0.0.1:8090
```

## Variables de entorno (API)

| Variable              | Default | Descripción                                             |
| --------------------- | ------- | ------------------------------------------------------- |
| `TTS_ENABLED`         | `false` | Activa `/api/tts` y `/api/tts/health`.                  |
| `PIPER_BINARY_PATH`   | —       | Ruta al binario de Piper.                               |
| `PIPER_VOICE_MODEL`   | —       | Ruta al modelo `.onnx` de voz.                          |
| `PIPER_USE_CUDA`      | `false` | Usa la GPU vía onnxruntime-gpu.                         |
| `XTTS_SERVICE_URL`    | —       | URL del microservicio XTTS. Vacío = XTTS deshabilitado. |
| `TTS_CACHE_DIR`       | —       | Carpeta de cache en disco de WAV sintetizados.          |
| `TTS_MAX_TEXT_LENGTH` | `600`   | Longitud máxima de texto por petición.                  |

## Cómo funciona el selector

- El selector se puebla con `/api/tts/health`; los motores no disponibles aparecen deshabilitados.
- La elección se persiste en `localStorage` (`sismica.voiceEngine`).
- Si el usuario no eligió motor y hay uno neural disponible, se selecciona automáticamente (Piper
  primero, luego XTTS).

## Endpoints

- `GET /api/tts/health` → estado por motor.
- `POST /api/tts?engine=piper|xtts` → body `{ "text": "...", "voice"?: "..." }` → `audio/wav`
  (cabecera `X-TTS-Cache: hit|miss`).
