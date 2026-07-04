"""Microservicio TTS con Chatterbox Multilingual (Resemble AI, licencia MIT) para la plataforma
sismica. Motor mas nuevo que XTTS-v2, con clonacion zero-shot desde un wav de referencia.

Reutiliza el MISMO manifiesto de perfiles que XTTS (`XTTS_VOICE_PROFILES`), de modo que las 6
voces clonadas (Carolina, Liam, Valentina, Martin, Sofia, Ninoska) funcionan sin re-clonar: el
`speaker_wav` del perfil se pasa como `audio_prompt_path`.

Endpoints:
  - GET  /health      -> estado del modelo y perfiles.
  - POST /load        -> carga el modelo en el dispositivo configurado.
  - POST /unload      -> descarga el modelo y libera VRAM.
  - POST /synthesize  -> { text, speaker?, language?, exaggeration?, cfg_weight?, temperature? } -> audio/wav

El API de Node le hace proxy en /api/tts?engine=chatterbox. Corre en 127.0.0.1:8091 por defecto.

Config por env:
  CHATTERBOX_DEVICE          cuda | cpu | mps (default: auto)
  CHATTERBOX_HOST/PORT       bind (default: 127.0.0.1:8091)
  CHATTERBOX_VOICE_PROFILES  manifiesto de perfiles (default: el de XTTS_VOICE_PROFILES)
  CHATTERBOX_DEFAULT_PROFILE perfil por defecto (default: el de XTTS_DEFAULT_PROFILE)
  CHATTERBOX_LANGUAGE        idioma por defecto (default: es)
  CHATTERBOX_EXAGGERATION    expresividad 0..1 (default: 0.5)
  CHATTERBOX_CFG_WEIGHT      guia de estilo 0..1 (default: 0.5)
  CHATTERBOX_EAGER_LOAD      true | false (default: false)
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
        os.environ[key] = value.strip().strip("'").strip('"')


def _resolve_repo_path(path_value: str) -> str:
    candidate = Path(path_value)
    return str(candidate if candidate.is_absolute() else (REPO_ROOT / candidate).resolve())


_load_root_env_defaults()

DEFAULT_LANGUAGE = os.environ.get("CHATTERBOX_LANGUAGE", "es")
# Comparte el manifiesto de perfiles con XTTS para reutilizar las mismas voces clonadas.
VOICE_PROFILES_FILE = os.environ.get("CHATTERBOX_VOICE_PROFILES") or os.environ.get("XTTS_VOICE_PROFILES")
DEFAULT_PROFILE = os.environ.get("CHATTERBOX_DEFAULT_PROFILE") or os.environ.get("XTTS_DEFAULT_PROFILE")


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


EXAGGERATION = _float_env("CHATTERBOX_EXAGGERATION", 0.5)
CFG_WEIGHT = _float_env("CHATTERBOX_CFG_WEIGHT", 0.5)
EAGER_LOAD = _bool_env("CHATTERBOX_EAGER_LOAD", False)


def _resolve_device() -> str:
    requested = os.environ.get("CHATTERBOX_DEVICE", "auto").lower()
    if requested in ("cuda", "cpu", "mps"):
        return requested
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:  # noqa: BLE001
        pass
    return "cpu"


@dataclass(frozen=True)
class VoiceProfile:
    profile_id: str
    speaker_wav: str
    language: str | None = None
    label: str | None = None


class _State:
    model = None
    device = "cpu"
    sample_rate = 24000
    default_profile: str | None = None
    voice_profiles: dict[str, VoiceProfile] = {}


state = _State()
synthesis_lock = Lock()


def _load_voice_profiles() -> dict[str, VoiceProfile]:
    if not VOICE_PROFILES_FILE:
        return {}
    profile_path = Path(_resolve_repo_path(VOICE_PROFILES_FILE))
    if not profile_path.exists():
        raise RuntimeError(f"CHATTERBOX_VOICE_PROFILES no encontrado: {profile_path}")

    raw_payload = json.loads(profile_path.read_text(encoding="utf-8"))
    payload = raw_payload.get("profiles", raw_payload) if isinstance(raw_payload, dict) else raw_payload
    if not isinstance(payload, dict):
        raise RuntimeError("El manifiesto de perfiles debe ser un objeto JSON con ids de perfil")

    profiles: dict[str, VoiceProfile] = {}
    for profile_id, entry in payload.items():
        if not isinstance(entry, dict):
            continue
        speaker_wav = entry.get("speaker_wav")
        if not isinstance(speaker_wav, str) or not speaker_wav.strip():
            continue
        resolved_wav = _resolve_repo_path(speaker_wav.strip())
        if not Path(resolved_wav).exists():
            raise RuntimeError(f"speaker_wav no encontrado para perfil {profile_id}: {resolved_wav}")
        profiles[profile_id] = VoiceProfile(
            profile_id=profile_id,
            speaker_wav=resolved_wav,
            language=entry.get("language") if isinstance(entry.get("language"), str) else None,
            label=entry.get("label") if isinstance(entry.get("label"), str) else None,
        )
    return profiles


def _profile_summary() -> list[str]:
    return sorted(state.voice_profiles.keys())


def _ensure_watermarker() -> None:
    """resemble-perth queda roto en algunos Windows (PerthImplicitWatermarker=None) y revienta la
    construccion del modelo. El marca-de-agua es opcional para uso interno: si falta, lo sustituye
    por un no-op para que el modelo cargue."""
    try:
        import perth

        if getattr(perth, "PerthImplicitWatermarker", None) is None:

            class _NoopWatermarker:
                def apply_watermark(self, wav, sample_rate=None, **_kwargs):  # noqa: ANN001
                    return wav

            perth.PerthImplicitWatermarker = _NoopWatermarker
    except Exception:  # noqa: BLE001
        pass


def _load_model() -> None:
    """Carga el modelo en GPU si no esta cargado (idempotente). Carga perezosa: solo ocupa VRAM
    cuando este motor se usa; el API descarga el otro motor antes para no agotar la GPU."""
    if state.model is not None:
        return
    _ensure_watermarker()
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    state.device = _resolve_device()
    state.model = ChatterboxMultilingualTTS.from_pretrained(device=state.device)
    state.sample_rate = int(getattr(state.model, "sr", 24000))
    print(f"[chatterbox] modelo cargado en {state.device} (sr={state.sample_rate})")


def _unload_model() -> None:
    """Libera el modelo y la VRAM (para dejar espacio a otro motor)."""
    if state.model is None:
        return
    state.model = None
    try:
        import gc

        import torch

        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        pass
    print("[chatterbox] modelo descargado (VRAM liberada)")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    state.device = _resolve_device()
    state.voice_profiles = _load_voice_profiles()
    if DEFAULT_PROFILE and DEFAULT_PROFILE in state.voice_profiles:
        state.default_profile = DEFAULT_PROFILE
    elif state.voice_profiles:
        state.default_profile = next(iter(state.voice_profiles.keys()))
    if EAGER_LOAD:
        _load_model()
    print(
        f"[chatterbox] servicio listo (device={state.device}, "
        f"default_profile={state.default_profile}, profiles={_profile_summary()}, eager={EAGER_LOAD})"
    )
    yield
    _unload_model()


app = FastAPI(title="Sismica Chatterbox", version="0.1.0", lifespan=lifespan)


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    speaker: str | None = None
    language: str | None = None
    exaggeration: float | None = None
    cfg_weight: float | None = None
    temperature: float | None = None


@app.get("/health")
def health() -> dict:
    # ok = servicio disponible (sintetiza bajo demanda aunque el modelo este descargado en VRAM).
    return {
        "ok": True,
        "loaded": state.model is not None,
        "model": "chatterbox-multilingual",
        "device": state.device,
        "sampleRate": state.sample_rate,
        "speaker": None,
        "defaultProfile": state.default_profile,
        "profiles": _profile_summary(),
    }


@app.post("/unload")
def unload() -> dict:
    """Descarga el modelo y libera VRAM (lo usa el API para conmutar de motor sin agotar la GPU)."""
    with synthesis_lock:
        _unload_model()
    return {"ok": True, "loaded": state.model is not None}


@app.post("/load")
def load() -> dict:
    """Carga el modelo y solo responde cuando esta listo para sintetizar."""
    with synthesis_lock:
        _load_model()
    return {"ok": True, "loaded": state.model is not None, "device": state.device}


def _resolve_reference(requested_voice: str | None) -> tuple[str | None, str, str | None]:
    profile_id = requested_voice or state.default_profile
    profile = state.voice_profiles.get(profile_id) if profile_id else None
    if profile:
        return profile.speaker_wav, profile.language or DEFAULT_LANGUAGE, profile.label or profile.profile_id
    return None, DEFAULT_LANGUAGE, requested_voice


@app.post("/synthesize")
def synthesize(request: SynthesizeRequest) -> Response:
    audio_prompt, profile_language, resolved_voice = _resolve_reference(request.speaker)
    language = request.language or profile_language
    kwargs: dict = {
        "language_id": language,
        "exaggeration": request.exaggeration if request.exaggeration is not None else EXAGGERATION,
        "cfg_weight": request.cfg_weight if request.cfg_weight is not None else CFG_WEIGHT,
    }
    if audio_prompt:
        kwargs["audio_prompt_path"] = audio_prompt
    if request.temperature is not None:
        kwargs["temperature"] = request.temperature

    try:
        with synthesis_lock:
            _load_model()  # carga perezosa / recarga bajo demanda.
            wav = state.model.generate(request.text, **kwargs)
    except Exception as error:  # noqa: BLE001
        raise HTTPException(
            status_code=500,
            detail=f"Fallo la sintesis ({resolved_voice or 'default'}): {error}",
        ) from error

    samples = np.asarray(getattr(wav, "cpu", lambda: wav)().squeeze(), dtype=np.float32)
    buffer = io.BytesIO()
    sf.write(buffer, samples, state.sample_rate, format="WAV", subtype="PCM_16")
    return Response(content=buffer.getvalue(), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host=os.environ.get("CHATTERBOX_HOST", "127.0.0.1"),
        port=int(os.environ.get("CHATTERBOX_PORT", "8091")),
        reload=False,
    )
