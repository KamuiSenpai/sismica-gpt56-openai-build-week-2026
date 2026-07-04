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
  CHATTERBOX_PRECISION       auto | fp32 | bf16 | fp16 (default: auto)
  CHATTERBOX_CACHE_CONDITIONING
                             true | false (default: true)
  CHATTERBOX_PROFILE_WARMUP  off | default | all (default: default)
  CHATTERBOX_COMPILE_MODE    off | reduce-overhead | max-autotune (default: off)
  CHATTERBOX_T3_MODEL        variante futura si el paquete la soporta
"""

from __future__ import annotations

import io
import importlib.util
import inspect
import json
import os
import time
from contextlib import asynccontextmanager, nullcontext
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
CONDITIONING_CACHE_ENABLED = _bool_env("CHATTERBOX_CACHE_CONDITIONING", True)


def _env_choice(name: str, default: str, allowed: set[str]) -> str:
    raw = (os.environ.get(name) or "").strip().lower()
    return raw if raw in allowed else default


PRECISION_MODE = _env_choice("CHATTERBOX_PRECISION", "auto", {"auto", "fp32", "bf16", "fp16"})
PROFILE_WARMUP = _env_choice("CHATTERBOX_PROFILE_WARMUP", "default", {"off", "default", "all"})
COMPILE_MODE = _env_choice(
    "CHATTERBOX_COMPILE_MODE",
    "off",
    {"off", "reduce-overhead", "max-autotune"},
)
REQUESTED_T3_MODEL = (os.environ.get("CHATTERBOX_T3_MODEL") or "").strip()


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
    model_label = "chatterbox-multilingual"
    device = "cpu"
    precision = "fp32"
    compile_mode = "off"
    sample_rate = 24000
    default_profile: str | None = None
    voice_profiles: dict[str, VoiceProfile] = {}
    conditionals_cache: dict[tuple[str, float], object] = {}


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


def _resolve_precision(device: str) -> str:
    if device != "cuda":
        return "fp32"
    if PRECISION_MODE != "auto":
        return PRECISION_MODE
    try:
        import torch

        bf16_supported = getattr(torch.cuda, "is_bf16_supported", lambda: False)()
        return "bf16" if bf16_supported else "fp32"
    except Exception:  # noqa: BLE001
        return "fp32"


def _configure_torch_runtime(device: str) -> None:
    try:
        import torch

        if device == "cuda":
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            torch.backends.cudnn.benchmark = True
        if COMPILE_MODE != "off":
            torch._dynamo.config.suppress_errors = True
    except Exception:  # noqa: BLE001
        pass


def _autocast_context():
    if state.device != "cuda" or state.precision == "fp32":
        return nullcontext()
    try:
        import torch

        dtype = {
            "bf16": torch.bfloat16,
            "fp16": torch.float16,
        }.get(state.precision)
        if dtype is None:
            return nullcontext()
        return torch.autocast(device_type="cuda", dtype=dtype)
    except Exception:  # noqa: BLE001
        return nullcontext()


def _conditioning_cache_key(profile_id: str, exaggeration: float) -> tuple[str, float]:
    return profile_id, round(float(exaggeration), 4)


def _clone_conditionals(conds):
    try:
        return conds.to(state.device)
    except Exception:  # noqa: BLE001
        return conds


def _load_model_kwargs() -> tuple[dict, str]:
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    kwargs = {"device": _resolve_device()}
    model_label = "chatterbox-multilingual"
    if not REQUESTED_T3_MODEL:
        return kwargs, model_label

    try:
        signature = inspect.signature(ChatterboxMultilingualTTS.from_pretrained)
        if "t3_model" in signature.parameters:
            kwargs["t3_model"] = REQUESTED_T3_MODEL
            model_label = f"{model_label}-{REQUESTED_T3_MODEL}"
        else:
            print(
                f"[chatterbox] CHATTERBOX_T3_MODEL={REQUESTED_T3_MODEL} ignorado: "
                "la version instalada no expone ese parametro"
            )
    except Exception as error:  # noqa: BLE001
        print(f"[chatterbox] no se pudo inspeccionar from_pretrained: {error}")
    return kwargs, model_label


def _compile_enabled() -> bool:
    return COMPILE_MODE != "off"


def _maybe_compile_model() -> None:
    if not _compile_enabled():
        state.compile_mode = "off"
        return
    if importlib.util.find_spec("triton") is None:
        state.compile_mode = "off"
        print("[chatterbox] torch.compile omitido: Triton no esta disponible en este entorno")
        return

    try:
        import torch

        state.model.t3.tfmr = torch.compile(
            state.model.t3.tfmr,
            mode=COMPILE_MODE,
            fullgraph=False,
        )
        state.compile_mode = COMPILE_MODE
        print(f"[chatterbox] torch.compile habilitado (mode={COMPILE_MODE})")
    except Exception as error:  # noqa: BLE001
        state.compile_mode = "off"
        print(f"[chatterbox] torch.compile fallo y se desactivo: {error}")


def _prime_profile_conditionals(profile_id: str, exaggeration: float) -> bool:
    if not CONDITIONING_CACHE_ENABLED or state.model is None:
        return False
    profile = state.voice_profiles.get(profile_id)
    if profile is None:
        return False

    cache_key = _conditioning_cache_key(profile_id, exaggeration)
    if cache_key in state.conditionals_cache:
        return True

    state.model.prepare_conditionals(profile.speaker_wav, exaggeration=exaggeration)
    state.conditionals_cache[cache_key] = _clone_conditionals(state.model.conds)
    return True


def _warmup_conditioning_profiles(exaggeration: float) -> None:
    if not CONDITIONING_CACHE_ENABLED or state.model is None or PROFILE_WARMUP == "off":
        return

    profile_ids: list[str] = []
    if PROFILE_WARMUP == "all":
        profile_ids = sorted(state.voice_profiles.keys())
    elif state.default_profile:
        profile_ids = [state.default_profile]

    warmed = 0
    started_at = time.perf_counter()
    for profile_id in profile_ids:
        try:
            warmed += int(_prime_profile_conditionals(profile_id, exaggeration))
        except Exception as error:  # noqa: BLE001
            print(f"[chatterbox] warmup omitido para {profile_id}: {error}")
    if warmed:
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        print(f"[chatterbox] warmup de conditioning: {warmed} perfil(es) en {elapsed_ms:.1f} ms")


def _try_use_conditionals_cache(profile_id: str | None, exaggeration: float) -> bool:
    if not CONDITIONING_CACHE_ENABLED or state.model is None or not profile_id:
        return False

    cache_key = _conditioning_cache_key(profile_id, exaggeration)
    cached = state.conditionals_cache.get(cache_key)
    if cached is None:
        return False

    state.model.conds = _clone_conditionals(cached)
    return True


def _load_model() -> None:
    """Carga el modelo en GPU si no esta cargado (idempotente). Carga perezosa: solo ocupa VRAM
    cuando este motor se usa; el API descarga el otro motor antes para no agotar la GPU."""
    if state.model is not None:
        return
    _ensure_watermarker()
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    load_kwargs, state.model_label = _load_model_kwargs()
    state.device = load_kwargs["device"]
    state.precision = _resolve_precision(state.device)
    _configure_torch_runtime(state.device)
    state.model = ChatterboxMultilingualTTS.from_pretrained(**load_kwargs)
    state.sample_rate = int(getattr(state.model, "sr", 24000))
    _maybe_compile_model()
    _warmup_conditioning_profiles(EXAGGERATION)
    print(
        f"[chatterbox] modelo cargado en {state.device} "
        f"(sr={state.sample_rate}, precision={state.precision}, compile={state.compile_mode})"
    )


def _unload_model() -> None:
    """Libera el modelo y la VRAM (para dejar espacio a otro motor)."""
    if state.model is None:
        return
    state.model = None
    state.conditionals_cache = {}
    state.compile_mode = "off"
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
    state.precision = _resolve_precision(state.device)
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
        "model": state.model_label,
        "device": state.device,
        "precision": state.precision,
        "compileMode": state.compile_mode,
        "sampleRate": state.sample_rate,
        "speaker": None,
        "defaultProfile": state.default_profile,
        "profiles": _profile_summary(),
        "cachedProfiles": sorted({profile_id for profile_id, _ in state.conditionals_cache.keys()}),
        "conditioningCacheEntries": len(state.conditionals_cache),
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
    return {
        "ok": True,
        "loaded": state.model is not None,
        "device": state.device,
        "precision": state.precision,
        "compileMode": state.compile_mode,
    }


def _resolve_reference(requested_voice: str | None) -> tuple[str | None, str | None, str, str | None]:
    profile_id = requested_voice or state.default_profile
    profile = state.voice_profiles.get(profile_id) if profile_id else None
    if profile:
        return (
            profile.profile_id,
            profile.speaker_wav,
            profile.language or DEFAULT_LANGUAGE,
            profile.label or profile.profile_id,
        )
    return None, None, DEFAULT_LANGUAGE, requested_voice


@app.post("/synthesize")
def synthesize(request: SynthesizeRequest) -> Response:
    profile_id, audio_prompt, profile_language, resolved_voice = _resolve_reference(request.speaker)
    language = request.language or profile_language
    exaggeration = request.exaggeration if request.exaggeration is not None else EXAGGERATION
    kwargs: dict = {
        "language_id": language,
        "exaggeration": exaggeration,
        "cfg_weight": request.cfg_weight if request.cfg_weight is not None else CFG_WEIGHT,
    }
    if request.temperature is not None:
        kwargs["temperature"] = request.temperature

    try:
        with synthesis_lock:
            request_started_at = time.perf_counter()
            _load_model()  # carga perezosa / recarga bajo demanda.
            cache_status = "hit" if _try_use_conditionals_cache(profile_id, exaggeration) else "miss"
            if cache_status == "miss" and profile_id:
                _prime_profile_conditionals(profile_id, exaggeration)
                if _try_use_conditionals_cache(profile_id, exaggeration):
                    cache_status = "primed"
                elif audio_prompt:
                    kwargs["audio_prompt_path"] = audio_prompt
            elif cache_status == "miss" and audio_prompt:
                kwargs["audio_prompt_path"] = audio_prompt
            generate_started_at = time.perf_counter()
            with _autocast_context():
                wav = state.model.generate(request.text, **kwargs)
            total_ms = (time.perf_counter() - request_started_at) * 1000
            infer_ms = (time.perf_counter() - generate_started_at) * 1000
            print(
                f"[chatterbox] synth voice={resolved_voice or 'default'} lang={language} "
                f"cache={cache_status} precision={state.precision} "
                f"infer={infer_ms:.1f} ms total={total_ms:.1f} ms"
            )
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
