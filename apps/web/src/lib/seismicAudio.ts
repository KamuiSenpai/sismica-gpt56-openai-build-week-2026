import { Howl, Howler } from "howler";
import { type SeismicEvent } from "@sismica/shared";

/**
 * Intenta usar un sample real via Howler. Si el sample no existe o no carga,
 * cae automaticamente a un sintetizador Web Audio para no romper el monitor.
 */

const SAMPLE_URL = "/audio/seismic-boom.wav";

type BrowserWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

let sound: Howl | null = null;
let audioEnabled = true;
let lastPlayedAt = 0;
let sampleUnavailable = false;
let fallbackAudioContext: AudioContext | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getFallbackAudioContext(create = true): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (fallbackAudioContext) return fallbackAudioContext;
  if (!create) return null;

  const browserWindow = window as BrowserWindow;
  const AudioContextCtor = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
  if (!AudioContextCtor) return null;

  fallbackAudioContext = new AudioContextCtor();
  return fallbackAudioContext;
}

function buildNoiseBuffer(context: AudioContext, durationSeconds: number): AudioBuffer {
  const sampleCount = Math.max(1, Math.floor(context.sampleRate * durationSeconds));
  const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const data = buffer.getChannelData(0);

  let lastOut = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02;
    data[index] = lastOut * 3.5;
  }

  return buffer;
}

function getSound(): Howl | null {
  if (typeof window === "undefined") return null;
  if (sound) return sound;

  sound = new Howl({
    src: [SAMPLE_URL],
    preload: true,
    html5: false,
    volume: 1,
    pool: 6,
    onloaderror: () => {
      sampleUnavailable = true;
    }
  });
  return sound;
}

export async function setSeismicAudioEnabled(enabled: boolean): Promise<boolean> {
  audioEnabled = enabled;

  if (!enabled) {
    Howler.mute(true);
    const fallbackContext = getFallbackAudioContext(false);
    if (fallbackContext?.state === "running") {
      await fallbackContext.suspend();
    }
    return false;
  }

  getSound();
  Howler.mute(false);

  const howlerContext = Howler.ctx;
  if (howlerContext && howlerContext.state === "suspended") {
    await howlerContext.resume();
  }

  const fallbackContext = getFallbackAudioContext();
  if (fallbackContext && fallbackContext.state === "suspended") {
    await fallbackContext.resume();
  }

  return (
    (howlerContext ? howlerContext.state === "running" : false) ||
    (fallbackContext ? fallbackContext.state === "running" : false)
  );
}

function tryPlayHowlerSample(event: SeismicEvent): boolean {
  if (sampleUnavailable) return false;

  const current = getSound();
  if (!current || current.state() !== "loaded") return false;

  const context = Howler.ctx;
  if (!context || context.state !== "running") return false;

  const magnitude = clamp(event.magnitude ?? 2.5, 0, 9);
  const intensity = clamp((magnitude - 2) / 5, 0, 1);
  const depthWeight = clamp((event.depthKm ?? 10) / 300, 0, 1);

  const rate = clamp(1.18 - intensity * 0.42 - depthWeight * 0.08, 0.6, 1.35);
  const volume = clamp(0.35 + intensity * 0.6, 0, 1);

  const id = current.play();
  current.rate(rate, id);
  current.volume(volume, id);
  return true;
}

function playSynthFallback(event: SeismicEvent): boolean {
  const context = getFallbackAudioContext(false);
  if (!context || context.state !== "running") return false;

  const magnitude = clamp(event.magnitude ?? 2.5, 0, 9);
  const intensity = clamp((magnitude - 2) / 5, 0, 1);
  const depthWeight = clamp((event.depthKm ?? 10) / 300, 0, 1);

  const duration = 1.4 + intensity * 2.2;
  const start = context.currentTime + 0.02;
  const end = start + duration;

  const master = context.createGain();
  master.gain.setValueAtTime(0.85, start);

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.setValueAtTime(-8, start);
  limiter.knee.setValueAtTime(6, start);
  limiter.ratio.setValueAtTime(12, start);
  limiter.attack.setValueAtTime(0.006, start);
  limiter.release.setValueAtTime(0.28, start);

  master.connect(limiter);
  limiter.connect(context.destination);

  const boomOsc = context.createOscillator();
  boomOsc.type = "sine";
  const boomFreq = 64 - depthWeight * 16 + intensity * 8;
  boomOsc.frequency.setValueAtTime(boomFreq, start);
  boomOsc.frequency.exponentialRampToValueAtTime(27, end);

  const boomGain = context.createGain();
  boomGain.gain.setValueAtTime(0.0001, start);
  boomGain.gain.exponentialRampToValueAtTime(0.5 + intensity * 0.35, start + 0.12);
  boomGain.gain.exponentialRampToValueAtTime(0.0001, end);

  boomOsc.connect(boomGain);
  boomGain.connect(master);
  boomOsc.start(start);
  boomOsc.stop(end + 0.05);

  const bodyEnd = start + duration * 0.7;
  const bodyOsc = context.createOscillator();
  bodyOsc.type = "triangle";
  bodyOsc.frequency.setValueAtTime(boomFreq * 1.5, start);
  bodyOsc.frequency.exponentialRampToValueAtTime(42, bodyEnd);

  const bodyGain = context.createGain();
  bodyGain.gain.setValueAtTime(0.0001, start);
  bodyGain.gain.exponentialRampToValueAtTime(0.16 + intensity * 0.12, start + 0.18);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, bodyEnd);

  bodyOsc.connect(bodyGain);
  bodyGain.connect(master);
  bodyOsc.start(start);
  bodyOsc.stop(bodyEnd + 0.05);

  const noiseSource = context.createBufferSource();
  noiseSource.buffer = buildNoiseBuffer(context, duration);

  const noiseFilter = context.createBiquadFilter();
  noiseFilter.type = "lowpass";
  noiseFilter.frequency.setValueAtTime(340 + intensity * 240 - depthWeight * 120, start);
  noiseFilter.frequency.exponentialRampToValueAtTime(90, end);
  noiseFilter.Q.setValueAtTime(0.7, start);

  const noiseGain = context.createGain();
  noiseGain.gain.setValueAtTime(0.0001, start);
  noiseGain.gain.exponentialRampToValueAtTime(0.1 + intensity * 0.12, start + 0.28);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, end);

  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(master);
  noiseSource.start(start);
  noiseSource.stop(end);

  const cueOsc = context.createOscillator();
  cueOsc.type = "sine";
  const cueFreq = 660 + intensity * 220;
  cueOsc.frequency.setValueAtTime(cueFreq, start);
  cueOsc.frequency.exponentialRampToValueAtTime(cueFreq * 0.82, start + 0.16);

  const cueGain = context.createGain();
  cueGain.gain.setValueAtTime(0.0001, start);
  cueGain.gain.exponentialRampToValueAtTime(0.05 + intensity * 0.05, start + 0.012);
  cueGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);

  cueOsc.connect(cueGain);
  cueGain.connect(master);
  cueOsc.start(start);
  cueOsc.stop(start + 0.4);

  window.setTimeout(
    () => {
      boomOsc.disconnect();
      boomGain.disconnect();
      bodyOsc.disconnect();
      bodyGain.disconnect();
      noiseSource.disconnect();
      noiseFilter.disconnect();
      noiseGain.disconnect();
      cueOsc.disconnect();
      cueGain.disconnect();
      master.disconnect();
      limiter.disconnect();
    },
    (duration + 1) * 1000
  );

  return true;
}

export function playSeismicWaveSound(event: SeismicEvent, enabled: boolean): void {
  if (!enabled || !audioEnabled) return;

  const nowMs = performance.now();
  if (nowMs - lastPlayedAt < 450) return;

  const played = tryPlayHowlerSample(event) || playSynthFallback(event);
  if (played) {
    lastPlayedAt = nowMs;
  }
}
