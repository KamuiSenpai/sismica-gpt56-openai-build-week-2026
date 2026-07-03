# Microservicio TTS Chatterbox Multilingual

Motor de voz neural mas nuevo (Resemble AI, **licencia MIT**) como alternativa a XTTS-v2, con
clonacion zero-shot y mejor naturalidad. El API de Node le hace proxy en
`POST /api/tts?engine=chatterbox`; el frontend lo expone como una opcion mas en el selector MOTOR.

Reutiliza el MISMO manifiesto de voces que XTTS (`services/tts-xtts/voices/profiles.local.json`),
asi que las 6 voces clonadas funcionan sin re-clonar: el `speaker_wav` del perfil se pasa como
`audio_prompt_path`.

## Requisitos

- Python 3.10-3.11
- GPU NVIDIA (recomendado). Backbone ~500M; en `cpu` funciona pero lento.

## Instalacion

```powershell
cd services/tts-chatterbox
py -3.10 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
```

La primera ejecucion descarga los pesos del modelo (~GB) desde Hugging Face.

## Arranque

```powershell
python app.py
```

Escucha en `127.0.0.1:8091`. Verifica con `curl http://127.0.0.1:8091/health`.

## Endpoints

- `GET /health` -> `{ ok, model, device, sampleRate, defaultProfile, profiles }`
- `POST /synthesize` -> body `{ "text", "speaker"?, "language"?, "exaggeration"?, "cfg_weight"?, "temperature"? }` -> `audio/wav`

## Variables de entorno

| Variable                     | Default                      | Descripcion                    |
| ---------------------------- | ---------------------------- | ------------------------------ |
| `CHATTERBOX_DEVICE`          | auto                         | `cuda`, `cpu`, `mps` o `auto`. |
| `CHATTERBOX_HOST` / `PORT`   | `127.0.0.1` / `8091`         | Bind del servidor.             |
| `CHATTERBOX_VOICE_PROFILES`  | el de `XTTS_VOICE_PROFILES`  | Manifiesto de perfiles de voz. |
| `CHATTERBOX_DEFAULT_PROFILE` | el de `XTTS_DEFAULT_PROFILE` | Perfil por defecto.            |
| `CHATTERBOX_EXAGGERATION`    | `0.5`                        | Expresividad (0..1).           |
| `CHATTERBOX_CFG_WEIGHT`      | `0.5`                        | Guia de estilo (0..1).         |

Ademas, en el `.env` raiz agrega `CHATTERBOX_SERVICE_URL=http://127.0.0.1:8091` para que el API
Node lo enrute.

## Nota de VRAM

Correr XTTS (8090) y Chatterbox (8091) a la vez suma memoria de GPU. En equipos con poca VRAM,
conviene levantar solo uno a la vez, o correr Chatterbox en `cpu`.
