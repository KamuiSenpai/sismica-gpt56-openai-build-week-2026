# SDD — Mejora de naturalidad de voces TTS

Estado: en implementacion · Autor: equipo directo · Fecha: 2026-07

## 1. Contexto y objetivo

Las voces del directo se sintetizan con **XTTS-v2** (servicio Python en `services/tts-xtts`, proxy
en `POST /api/tts?engine=xtts`). Hay 6 locutores clonados (Carolina, Liam, Valentina, Martin,
Sofia, Ninoska) desde grabaciones humanas en `Grabaciones/`.

Objetivo: **subir la naturalidad** por tres vias, de menor a mayor esfuerzo:

1. Afinar los parametros de inferencia de XTTS (hoy usa defaults).
2. Recortar/nivelar los audios de referencia a ~20 s limpios (clon mas estable).
3. Agregar un motor mas nuevo y natural como opcion seleccionable en la UI.

## 2. Alcance

| WS  | Que                          | Riesgo             | Reversible                          |
| --- | ---------------------------- | ------------------ | ----------------------------------- |
| 1   | Parametros XTTS + presets    | Bajo               | Si (env)                            |
| 2   | Referencias ~20 s            | Bajo               | Si (regenerar desde `Grabaciones/`) |
| 3   | Motor Chatterbox como opcion | Medio (infra/VRAM) | Si (motor gated por health)         |

## 3. WS1 — Parametros de inferencia XTTS

Hoy `app.py` llama `state.tts.tts(text, speaker_wav, language)` con los defaults del modelo.
XTTS expone perillas que afectan naturalidad/estabilidad:

- `temperature` — expresividad vs. estabilidad.
- `repetition_penalty` — evita muletillas/loops y monotonia.
- `top_p` / `top_k` — diversidad del muestreo.
- `speed` — cadencia.
- `split_sentences` (`enable_text_splitting`) — particiona por oracion; clave en narraciones
  largas (menos artefactos, mejor prosodia).

Diseno:

- Defaults configurables por env: `XTTS_TEMPERATURE`, `XTTS_REPETITION_PENALTY`, `XTTS_TOP_P`,
  `XTTS_TOP_K`, `XTTS_SPEED`, `XTTS_SPLIT_SENTENCES`.
- `/synthesize` acepta overrides opcionales y un `preset` con nombre para comparar sin re-desplegar.
- Presets iniciales para A/B:
  - `estable`: temperature 0.5, repetition_penalty 5.0, speed 1.0.
  - `natural`: temperature 0.75, repetition_penalty 3.0, speed 1.0.
  - `locutor`: temperature 0.7, repetition_penalty 4.0, speed 1.05.

Validacion: generar muestras con los 3 presets por voz; el usuario elige; se fija el `preset`/env
por defecto.

## 4. WS2 — Referencias a ~20 s

XTTS clona mas estable con ~15-25 s limpios que con 40 s. Procedimiento (ffmpeg, desde
`Grabaciones/<Nombre>.mp3` como fuente de verdad):

- `loudnorm` (nivel parejo) + recorte a ~20 s del tramo con voz + mono 24 kHz PCM16.
- Se sobrescriben los `.runtime-logs/xtts-voices/mx_*_ref.wav`. Reversible regenerando desde el mp3.

Validacion: reinicio del servicio, `GET /health` con los 6 perfiles, sintesis de prueba por voz.

## 5. WS3 — Motor nuevo: Chatterbox Multilingual (Resemble AI)

### 5.1 Eleccion

Requisitos: espanol + clonacion zero-shot (para reutilizar las 6 referencias) + self-hosted/gratis

- mas natural que XTTS-v2. Comparado con Fish Speech, F5-TTS, CosyVoice2, IndexTTS-2:

* **Chatterbox Multilingual** — licencia **MIT**, 23 idiomas (incl. `es`), clonacion zero-shot
  (`audio_prompt_path`), controles expresivos (`exaggeration`, `cfg_weight`), backbone ~500M.
  Reportado en 2026 como el primer local cuyo clonado "deja de sonar sintetico".

### 5.2 Arquitectura

Se replica el patron de XTTS: microservicio Python aislado + proxy del API Node. NO se toca XTTS.

- `services/tts-chatterbox/app.py` — FastAPI, carga `ChatterboxMultilingualTTS`, endpoints
  `GET /health` y `POST /synthesize` `{text, speaker?, language?}` -> `audio/wav`.
  Reutiliza `profiles.local.json` (mismos `speaker_wav` -> `audio_prompt_path`).
- Puerto propio `127.0.0.1:8091` (`CHATTERBOX_HOST`/`CHATTERBOX_PORT`).

### 5.3 Integracion

- API (`apps/api`): `ttsEngineSchema` suma `"chatterbox"`; `env.ts` suma `CHATTERBOX_SERVICE_URL`;
  `ttsService.ts` agrega `synthesizeChatterbox` (proxy) + `chatterboxHealth` en `getHealth`.
- Web: `VoiceEngine`/`NeuralEngine` suman `"chatterbox"`; `NEURAL_PRIORITY` lo pone primero (motor
  preferido); `VOICE_ENGINE_LABELS` etiqueta "Chatterbox"; el selector MOTOR lo muestra.
- **Health-gating**: si el servicio no esta arriba, el motor aparece como no disponible y la cascada
  cae a XTTS. Es aditivo y no rompe el flujo actual.

### 5.4 Riesgos

- VRAM: RTX 4060 Ti con ~4 GB libres; XTTS ya ocupa memoria. Mitigacion: no correr ambos a la vez,
  o `CPU`/cuantizado. La eleccion final de tener XTTS+Chatterbox simultaneos depende de VRAM real.
- Bring-up del modelo (pesos ~GB, deps) es un paso de infra separado. La validacion de calidad de
  audio requiere escucha humana.

## 6. Validacion global

- `typecheck` API + web en verde.
- Tests API + web en verde (incluye el gating del motor nuevo y los params XTTS).
- Sintesis en vivo: muestras XTTS con presets y (si el servicio Chatterbox esta arriba) muestra
  Chatterbox por voz.

## 7. Estado / pendientes

- WS1, WS2: aplicables y validables de inmediato.
- WS3: codigo + servicio + cableado listos; el **arranque del modelo Chatterbox** (instalar deps y
  descargar pesos) queda como paso de infra; el motor aparece deshabilitado hasta que el servicio
  responda `GET /health` ok.
