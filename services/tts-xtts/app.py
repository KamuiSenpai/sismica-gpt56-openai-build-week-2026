"""Microservicio de TTS neural con XTTS-v2 (Coqui) para la plataforma sismica.

Expone dos endpoints:
  - GET  /health       -> estado del modelo y dispositivo.
  - POST /synthesize   -> { text, speaker?, language? } -> audio/wav (PCM 16 bits).

El modelo se carga UNA sola vez al arrancar. Pensado para correr en la RTX 4060 Ti
(~4 GB VRAM). El API de Node le hace proxy en /api/tts?engine=xtts.

Config por variables de entorno:
  XTTS_MODEL        modelo Coqui (default: tts_models/multilingual/multi-dataset/xtts_v2)
  XTTS_LANGUAGE     idioma por defecto (default: es)
  XTTS_SPEAKER      nombre de locutor incorporado (opcional)
  XTTS_SPEAKER_WAV  ruta a un wav de referencia para clonar voz (opcional)
  XTTS_DEVICE       cuda | cpu (default: auto)
  XTTS_HOST/PORT    bind del servidor (default: 127.0.0.1:8090)

Licencia: XTTS-v2 se distribuye bajo la Coqui Public Model License (CPML), de uso
NO comercial. Revisa los terminos antes de un despliegue publico.
"""

from __future__ import annotations

import io
import os
from contextlib import asynccontextmanager

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

# Acepta la licencia del modelo de forma no interactiva (necesario en servidor).
os.environ.setdefault("COQUI_TOS_AGREED", "1")

MODEL_NAME = os.environ.get("XTTS_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2")
DEFAULT_LANGUAGE = os.environ.get("XTTS_LANGUAGE", "es")
DEFAULT_SPEAKER = os.environ.get("XTTS_SPEAKER") or None
SPEAKER_WAV = os.environ.get("XTTS_SPEAKER_WAV") or None


def _resolve_device() -> str:
    requested = os.environ.get("XTTS_DEVICE", "auto").lower()
    if requested in ("cuda", "cpu"):
        return requested
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:  # noqa: BLE001 - si torch falla, caemos a CPU
        return "cpu"


class _State:
    tts = None
    device = "cpu"
    sample_rate = 24000
    default_speaker: str | None = None


state = _State()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from TTS.api import TTS

    state.device = _resolve_device()
    state.tts = TTS(MODEL_NAME).to(state.device)

    synthesizer = getattr(state.tts, "synthesizer", None)
    if synthesizer is not None and getattr(synthesizer, "output_sample_rate", None):
        state.sample_rate = int(synthesizer.output_sample_rate)

    # Si no se configuro un locutor y el modelo trae voces incorporadas, usa la primera.
    speakers = getattr(state.tts, "speakers", None) or []
    if DEFAULT_SPEAKER:
        state.default_speaker = DEFAULT_SPEAKER
    elif not SPEAKER_WAV and speakers:
        state.default_speaker = speakers[0]

    print(f"[xtts] modelo listo en {state.device} (sr={state.sample_rate}, speaker={state.default_speaker})")
    yield
    state.tts = None


app = FastAPI(title="Sismica XTTS-v2", version="0.1.0", lifespan=lifespan)


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    speaker: str | None = None
    language: str | None = None


@app.get("/health")
def health() -> dict:
    ready = state.tts is not None
    return {
        "ok": ready,
        "model": MODEL_NAME,
        "device": state.device,
        "sampleRate": state.sample_rate,
        "speaker": state.default_speaker,
    }


@app.post("/synthesize")
def synthesize(request: SynthesizeRequest) -> Response:
    if state.tts is None:
        raise HTTPException(status_code=503, detail="Modelo XTTS no cargado")

    speaker = request.speaker or state.default_speaker
    language = request.language or DEFAULT_LANGUAGE

    kwargs: dict = {"text": request.text, "language": language}
    if SPEAKER_WAV:
        kwargs["speaker_wav"] = SPEAKER_WAV
    elif speaker:
        kwargs["speaker"] = speaker

    try:
        waveform = state.tts.tts(**kwargs)
    except Exception as error:  # noqa: BLE001 - devolvemos 500 con el detalle
        raise HTTPException(status_code=500, detail=f"Fallo la sintesis: {error}") from error

    buffer = io.BytesIO()
    sf.write(buffer, np.asarray(waveform, dtype=np.float32), state.sample_rate, format="WAV", subtype="PCM_16")
    return Response(content=buffer.getvalue(), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host=os.environ.get("XTTS_HOST", "127.0.0.1"),
        port=int(os.environ.get("XTTS_PORT", "8090")),
        reload=False,
    )
