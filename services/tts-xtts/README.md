# Microservicio TTS XTTS-v2

Servicio Python (FastAPI + [Coqui TTS](https://github.com/idiap/coqui-ai-TTS)) que sintetiza voz
neural con **XTTS-v2** para la plataforma sísmica. El API de Node le hace proxy en
`POST /api/tts?engine=xtts`, así que el frontend solo habla con el API.

> **Licencia:** XTTS-v2 se distribuye bajo la **Coqui Public Model License (CPML)**, de uso **no
> comercial**. Revisa los términos antes de un despliegue público.

## Requisitos

- **Python 3.10–3.11** (Coqui TTS no soporta 3.12+).
- GPU NVIDIA con ~4 GB VRAM libres (RTX 4060 Ti sobra). También corre en CPU (más lento).

## Instalación (Windows / PowerShell)

```powershell
cd services/tts-xtts
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1

# 1) Instala torch con el wheel de tu CUDA (ejemplo CUDA 12.1):
pip install torch --index-url https://download.pytorch.org/whl/cu121

# 2) Instala el resto de dependencias:
pip install -r requirements.txt
```

## Arranque

```powershell
# La primera vez descarga el modelo XTTS-v2 (~1.8 GB) a la cache de Coqui.
python app.py
# -> escucha en http://127.0.0.1:8090
```

## Endpoints

- `GET /health` → `{ ok, model, device, sampleRate, speaker }`.
- `POST /synthesize` → body `{ "text": "...", "speaker"?: "...", "language"?: "es" }` → `audio/wav`.

## Conectar con el API de Node

En el `.env` de la raíz del proyecto:

```
TTS_ENABLED=true
XTTS_SERVICE_URL=http://127.0.0.1:8090
```

## Variables de entorno del servicio

| Variable                  | Default                                         | Descripción                                                                                 |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `XTTS_MODEL`              | `tts_models/multilingual/multi-dataset/xtts_v2` | Modelo Coqui a cargar.                                                                      |
| `XTTS_LANGUAGE`           | `es`                                            | Idioma por defecto.                                                                         |
| `XTTS_SPEAKER`            | (auto)                                          | Nombre de locutor incorporado. Si se omite, usa el primero disponible.                      |
| `XTTS_SPEAKER_WAV`        | —                                               | Ruta a un WAV de referencia para **clonar** una voz (tiene prioridad sobre `XTTS_SPEAKER`). |
| `XTTS_DEVICE`             | `auto`                                          | `cuda` \| `cpu` \| `auto`.                                                                  |
| `XTTS_HOST` / `XTTS_PORT` | `127.0.0.1` / `8090`                            | Bind del servidor.                                                                          |

Si el servicio no está levantado, `POST /api/tts?engine=xtts` responde `503` y el frontend cae
automáticamente al respaldo (voz del navegador).
