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
import json
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
import torch

# Acepta la licencia del modelo de forma no interactiva (necesario en servidor).
os.environ.setdefault("COQUI_TOS_AGREED", "1")

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_root_env_defaults() -> None:
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        cleaned = value.strip().strip("'").strip('"')
        os.environ[key] = cleaned


def _resolve_repo_path(path_value: str) -> str:
    candidate = Path(path_value)
    return str(candidate if candidate.is_absolute() else (REPO_ROOT / candidate).resolve())


_load_root_env_defaults()

MODEL_NAME = os.environ.get("XTTS_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2")
DEFAULT_LANGUAGE = os.environ.get("XTTS_LANGUAGE", "es")
DEFAULT_SPEAKER = os.environ.get("XTTS_SPEAKER") or None
SPEAKER_WAV = os.environ.get("XTTS_SPEAKER_WAV") or None
VOICE_PROFILES_FILE = os.environ.get("XTTS_VOICE_PROFILES") or None
DEFAULT_PROFILE = os.environ.get("XTTS_DEFAULT_PROFILE") or None


def _float_env(name: str, default: float) -> float:
    try:
        raw = os.environ.get(name)
        return float(raw) if raw not in (None, "") else default
    except ValueError:
        return default


def _bool_env(name: str, default: bool) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return default


# Parametros de inferencia de XTTS (antes se usaban los defaults del modelo). Ajustan naturalidad
# y estabilidad; configurables por env y sobreescribibles por peticion.
# Default = preset "estable" (elegido por el usuario): tono parejo, sin artefactos.
INFERENCE_DEFAULTS = {
    "temperature": _float_env("XTTS_TEMPERATURE", 0.5),
    "repetition_penalty": _float_env("XTTS_REPETITION_PENALTY", 5.0),
    "top_p": _float_env("XTTS_TOP_P", 0.8),
    "top_k": int(_float_env("XTTS_TOP_K", 50)),
    "speed": _float_env("XTTS_SPEED", 1.0),
}
SPLIT_SENTENCES = _bool_env("XTTS_SPLIT_SENTENCES", True)

# Presets para comparar A/B sin re-desplegar (se pasan por el campo "preset" de /synthesize).
PRESETS: dict[str, dict[str, float]] = {
    "estable": {"temperature": 0.5, "repetition_penalty": 5.0, "top_p": 0.8, "speed": 1.0},
    "natural": {"temperature": 0.75, "repetition_penalty": 3.0, "top_p": 0.9, "speed": 1.0},
    "locutor": {"temperature": 0.7, "repetition_penalty": 4.0, "top_p": 0.85, "speed": 1.05},
}


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
    default_profile: str | None = None
    voice_profiles: dict[str, "VoiceProfile"] = {}


state = _State()
synthesis_lock = Lock()


@dataclass(frozen=True)
class VoiceProfile:
    profile_id: str
    speaker_wav: str
    speaker: str | None = None
    language: str | None = None
    label: str | None = None


def _load_voice_profiles() -> dict[str, VoiceProfile]:
    if not VOICE_PROFILES_FILE:
        return {}

    profile_path = Path(_resolve_repo_path(VOICE_PROFILES_FILE))
    if not profile_path.exists():
        raise RuntimeError(f"XTTS_VOICE_PROFILES no encontrado: {profile_path}")

    raw_payload = json.loads(profile_path.read_text(encoding="utf-8"))
    payload = raw_payload.get("profiles", raw_payload) if isinstance(raw_payload, dict) else raw_payload
    if not isinstance(payload, dict):
        raise RuntimeError("XTTS_VOICE_PROFILES debe ser un objeto JSON con ids de perfil")

    profiles: dict[str, VoiceProfile] = {}
    for profile_id, entry in payload.items():
        if not isinstance(entry, dict):
            raise RuntimeError(f"Perfil XTTS invalido: {profile_id}")
        speaker_wav = entry.get("speaker_wav")
        if not isinstance(speaker_wav, str) or not speaker_wav.strip():
            raise RuntimeError(f"Perfil XTTS sin speaker_wav: {profile_id}")
        resolved_wav = _resolve_repo_path(speaker_wav.strip())
        if not Path(resolved_wav).exists():
            raise RuntimeError(f"speaker_wav no encontrado para perfil {profile_id}: {resolved_wav}")
        profiles[profile_id] = VoiceProfile(
            profile_id=profile_id,
            speaker_wav=resolved_wav,
            speaker=entry.get("speaker") if isinstance(entry.get("speaker"), str) else None,
            language=entry.get("language") if isinstance(entry.get("language"), str) else None,
            label=entry.get("label") if isinstance(entry.get("label"), str) else None,
        )
    return profiles


def _profile_summary() -> list[str]:
    return sorted(state.voice_profiles.keys())


def _resolve_voice_request(requested_voice: str | None, requested_language: str | None) -> tuple[dict, str | None]:
    profile_id = requested_voice or state.default_profile
    profile = state.voice_profiles.get(profile_id) if profile_id else None
    language = requested_language or DEFAULT_LANGUAGE
    kwargs: dict = {"language": language}

    if profile:
        kwargs["speaker_wav"] = profile.speaker_wav
        kwargs["language"] = requested_language or profile.language or language
        if profile.speaker:
            kwargs["speaker"] = profile.speaker
        return kwargs, profile.label or profile.profile_id

    if SPEAKER_WAV:
        kwargs["speaker_wav"] = _resolve_repo_path(SPEAKER_WAV)
        return kwargs, Path(kwargs["speaker_wav"]).stem

    speaker = requested_voice or state.default_speaker
    if speaker:
        kwargs["speaker"] = speaker
    return kwargs, speaker


def _stabilize_cuda_inference(model) -> None:
    if state.device != "cuda":
        return

    # XTTS-v2 en GPUs de consumo (RTX 40) puede fallar con el kernel SDP "flash".
    # Desactivamos SOLO flash y dejamos "mem_efficient" activo: es estable y rapido
    # (forzar solo "math" funciona pero es varias veces mas lento).
    if hasattr(torch.backends, "cuda"):
        torch.backends.cuda.enable_flash_sdp(False)
        torch.backends.cuda.enable_mem_efficient_sdp(True)
        torch.backends.cuda.enable_math_sdp(True)

    # cuda_config = EfficientAttentionConfig(enable_flash, enable_math, enable_mem_efficient).
    for module in model.modules():
        if hasattr(module, "cuda_config") and hasattr(module, "config"):
            module.cuda_config = module.config(False, True, True)
        if hasattr(module, "use_flash"):
            module.use_flash = False


def _load_model() -> None:
    """Carga el modelo en GPU si no esta cargado (idempotente). Para conmutar de motor sin agotar
    la VRAM, el modelo se puede descargar con _unload_model y se recarga aqui bajo demanda."""
    if state.tts is not None:
        return
    from TTS.api import TTS

    state.device = _resolve_device()
    state.tts = TTS(MODEL_NAME).to(state.device)
    _stabilize_cuda_inference(state.tts.synthesizer.tts_model)

    synthesizer = getattr(state.tts, "synthesizer", None)
    if synthesizer is not None and getattr(synthesizer, "output_sample_rate", None):
        state.sample_rate = int(synthesizer.output_sample_rate)

    speakers = getattr(state.tts, "speakers", None) or []
    if DEFAULT_SPEAKER:
        state.default_speaker = DEFAULT_SPEAKER
    elif not SPEAKER_WAV and speakers:
        state.default_speaker = speakers[0]
    print(f"[xtts] modelo cargado en {state.device} (sr={state.sample_rate})")


def _unload_model() -> None:
    """Libera el modelo y la VRAM (para dejar espacio a otro motor)."""
    if state.tts is None:
        return
    state.tts = None
    try:
        import gc

        import torch

        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        pass
    print("[xtts] modelo descargado (VRAM liberada)")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    state.voice_profiles = _load_voice_profiles()
    if DEFAULT_PROFILE and DEFAULT_PROFILE in state.voice_profiles:
        state.default_profile = DEFAULT_PROFILE
    elif state.voice_profiles:
        state.default_profile = next(iter(state.voice_profiles.keys()))
    # XTTS es el motor por defecto: se carga al arrancar (queda listo).
    _load_model()
    print(f"[xtts] listo (default_profile={state.default_profile}, profiles={_profile_summary()})")
    yield
    _unload_model()


app = FastAPI(title="Sismica XTTS-v2", version="0.1.0", lifespan=lifespan)


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    speaker: str | None = None
    language: str | None = None
    # Ajustes de inferencia (opcionales): preset con nombre u overrides puntuales.
    preset: str | None = None
    temperature: float | None = None
    repetition_penalty: float | None = None
    top_p: float | None = None
    top_k: int | None = None
    speed: float | None = None
    split_sentences: bool | None = None


def _resolve_inference_params(request: SynthesizeRequest) -> tuple[dict, bool]:
    params = dict(INFERENCE_DEFAULTS)
    if request.preset and request.preset in PRESETS:
        params.update(PRESETS[request.preset])
    for key in ("temperature", "repetition_penalty", "top_p", "top_k", "speed"):
        value = getattr(request, key)
        if value is not None:
            params[key] = value
    split = SPLIT_SENTENCES if request.split_sentences is None else request.split_sentences
    return params, split


@app.get("/health")
def health() -> dict:
    # ok = servicio disponible (sintetiza bajo demanda aunque el modelo este descargado en VRAM).
    return {
        "ok": True,
        "loaded": state.tts is not None,
        "model": MODEL_NAME,
        "device": state.device,
        "sampleRate": state.sample_rate,
        "speaker": state.default_speaker,
        "defaultProfile": state.default_profile,
        "profiles": _profile_summary(),
    }


@app.post("/unload")
def unload() -> dict:
    """Descarga el modelo y libera VRAM (lo usa el API para conmutar de motor sin agotar la GPU)."""
    with synthesis_lock:
        _unload_model()
    return {"ok": True, "loaded": state.tts is not None}


@app.get("/voices")
def voices() -> dict:
    speakers = sorted(getattr(state.tts, "speakers", None) or [])
    profiles = [
        {
            "id": profile.profile_id,
            "label": profile.label or profile.profile_id,
            "speaker": profile.speaker,
            "language": profile.language or DEFAULT_LANGUAGE,
            "speakerWav": profile.speaker_wav,
        }
        for profile in state.voice_profiles.values()
    ]
    return {
        "defaultSpeaker": state.default_speaker,
        "defaultProfile": state.default_profile,
        "speakers": speakers,
        "profiles": profiles,
    }


@app.post("/synthesize")
def synthesize(request: SynthesizeRequest) -> Response:
    voice_kwargs, resolved_voice = _resolve_voice_request(request.speaker, request.language)
    inference, split_sentences = _resolve_inference_params(request)
    kwargs: dict = {"text": request.text, **voice_kwargs, **inference, "split_sentences": split_sentences}

    try:
        with synthesis_lock:
            _load_model()  # recarga bajo demanda si se descargo para ceder VRAM.
            waveform = state.tts.tts(**kwargs)
    except TypeError:
        # Un backend que no acepte algun parametro de inferencia no debe romper la sintesis:
        # reintenta solo con voz + idioma (comportamiento previo).
        with synthesis_lock:
            _load_model()
            waveform = state.tts.tts(text=request.text, **voice_kwargs)
    except Exception as error:  # noqa: BLE001 - devolvemos 500 con el detalle
        raise HTTPException(
            status_code=500,
            detail=f"Fallo la sintesis ({resolved_voice or 'default'}): {error}",
        ) from error

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
