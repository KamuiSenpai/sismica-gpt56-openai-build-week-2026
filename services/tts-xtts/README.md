# Microservicio TTS XTTS-v2

Servicio Python (FastAPI + Coqui TTS) que sintetiza voz neural con `XTTS-v2` para la plataforma
sismica. El API de Node le hace proxy en `POST /api/tts?engine=xtts`, asi que el frontend solo
habla con el API.

Licencia: XTTS-v2 se distribuye bajo la Coqui Public Model License (CPML), de uso no comercial.
Revisa los terminos antes de un despliegue publico.

## Requisitos

- Python 3.10-3.11
- GPU NVIDIA con ~4 GB VRAM libres

## Instalacion

```powershell
cd services/tts-xtts
py -3.10 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
```

## Arranque

```powershell
python app.py
```

El servicio intenta cargar variables desde el `.env` raiz del repo si no estan presentes en el
entorno del proceso.

## Endpoints

- `GET /health` -> `{ ok, model, device, sampleRate, speaker, defaultProfile, profiles }`
- `GET /voices` -> voces integradas del modelo + perfiles clonados cargados
- `POST /synthesize` -> body `{ "text": "...", "speaker"?: "...", "language"?: "es" }` -> `audio/wav`

## Variables de entorno del servicio

| Variable                  | Default                                         | Descripcion                       |
| ------------------------- | ----------------------------------------------- | --------------------------------- |
| `XTTS_MODEL`              | `tts_models/multilingual/multi-dataset/xtts_v2` | Modelo Coqui a cargar.            |
| `XTTS_LANGUAGE`           | `es`                                            | Idioma por defecto.               |
| `XTTS_SPEAKER`            | auto                                            | Nombre de locutor incorporado.    |
| `XTTS_SPEAKER_WAV`        | vacio                                           | WAV global de clonacion.          |
| `XTTS_VOICE_PROFILES`     | vacio                                           | JSON con perfiles locales de voz. |
| `XTTS_DEFAULT_PROFILE`    | vacio                                           | Perfil local por defecto.         |
| `XTTS_DEVICE`             | `auto`                                          | `cuda`, `cpu` o `auto`.           |
| `XTTS_HOST` / `XTTS_PORT` | `127.0.0.1` / `8090`                            | Bind del servidor.                |

## Perfiles de voz clonada

Ejemplo de manifiesto:

```json
{
  "profiles": {
    "mx_claribel": {
      "label": "Claribel MX",
      "speaker_wav": ".runtime-logs/xtts-voices/mx_claribel_ref.wav",
      "language": "es"
    },
    "mx_andrew": {
      "label": "Andrew MX",
      "speaker_wav": ".runtime-logs/xtts-voices/mx_andrew_ref.wav",
      "language": "es"
    }
  }
}
```

Configuralo en el `.env` raiz:

```env
XTTS_SERVICE_URL=http://127.0.0.1:8090
XTTS_VOICE_PROFILES=services/tts-xtts/voices/profiles.local.json
XTTS_DEFAULT_PROFILE=mx_claribel
```

Si el servicio no esta levantado, `POST /api/tts?engine=xtts` responde `503` y el frontend cae al
respaldo del navegador.
