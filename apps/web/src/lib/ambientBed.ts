// Lecho musical generativo (Web Audio): un pad calido en re menor + bajo + un ritmo suave
// (bombo, hats y un arpegio tenue) que le da PULSO a la retransmision. Esta 100% sintetizado
// -> sin archivos ni licencias, y el loop no tiene costuras. Corre solo en el navegador; en un
// entorno sin AudioContext (tests, SSR) se degrada a no-op. La logica de mapeo (estado sismico
// -> parametros) es PURA y esta cubierta por ambientBed.test.ts; el grafo vive tras un guard.

export type AmbientMode = "monitoreo" | "vivo" | "boletin" | "relevo";

export type AmbientDrivers = {
  // Mayor magnitud entre los sismos recientes (null si no hay dato numerico).
  biggestMagnitude: number | null;
  // Cantidad de sismos recientes en pantalla (densidad de actividad).
  recentCount: number;
  // Modo editorial en curso: eleva un piso de energia aunque la actividad sea baja.
  mode: AmbientMode;
};

export type AmbientTargets = {
  intensity: number; // 0..1: sintesis de magnitud, densidad y modo
  padGain: number; // nivel del pad armonico
  filterHz: number; // brillo del pad (mas alto = mas presente/tenso)
  rhythmGain: number; // nivel del ritmo (bombo/hats/arpegio) -> SIEMPRE audible
  tempoBpm: number; // pulso del ritmo
  detuneCents: number; // batido/tension del pad
};

// Parametros musicales y de mezcla. El lecho es AUDIBLE pero se agacha bajo la voz (ducking).
const BED = {
  masterGain: 0.55, // volumen general del lecho antes del ducking
  duckFactor: 0.4, // baja a ~40% (~ -8 dB) cuando habla el locutor
  padBaseGain: 0.05,
  padMaxGain: 0.09,
  bassGain: 0.09,
  minFilterHz: 700, // en calma ya hay medios presentes (audible en parlantes chicos)
  maxFilterHz: 2200,
  rhythmBaseGain: 0.45, // el ritmo se oye siempre, no solo en breaking
  rhythmMaxGain: 0.85,
  baseTempo: 72, // BPM en calma
  maxTempo: 96, // BPM en maxima actividad
  maxDetuneCents: 14,
  // Rampas (segundos): lentas para lo musical, rapida para agachar bajo la voz.
  paramRampSec: 2.5,
  duckDownSec: 0.18,
  duckUpSec: 0.9,
  fadeInSec: 2.5,
  fadeOutSec: 0.7,
  tempoSlewBpmPerSec: 8
} as const;

// El modo eleva un piso de energia (breaking, boletin) sin borrar la actividad real.
export const AMBIENT_MODE_FLOOR: Record<AmbientMode, number> = {
  monitoreo: 0,
  boletin: 0.25,
  relevo: 0.35,
  vivo: 0.6
};

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// --- Logica pura (testable) ---------------------------------------------------------------

export function computeAmbientIntensity(drivers: AmbientDrivers): number {
  const magPart = drivers.biggestMagnitude === null ? 0 : clamp01((drivers.biggestMagnitude - 3) / 4);
  const countPart = clamp01(drivers.recentCount / 30);
  const activity = clamp01(magPart * 0.7 + countPart * 0.3);
  const floor = AMBIENT_MODE_FLOOR[drivers.mode];
  return clamp01(Math.max(activity, floor) + activity * floor * 0.4);
}

export function computeAmbientTargets(drivers: AmbientDrivers): AmbientTargets {
  const intensity = computeAmbientIntensity(drivers);
  return {
    intensity,
    padGain: BED.padBaseGain + (BED.padMaxGain - BED.padBaseGain) * intensity,
    filterHz: BED.minFilterHz + (BED.maxFilterHz - BED.minFilterHz) * intensity,
    rhythmGain: BED.rhythmBaseGain + (BED.rhythmMaxGain - BED.rhythmBaseGain) * intensity,
    tempoBpm: BED.baseTempo + (BED.maxTempo - BED.baseTempo) * intensity,
    detuneCents: BED.maxDetuneCents * intensity * (drivers.mode === "vivo" ? 1 : 0.5)
  };
}

export function slewTempo(current: number, target: number, elapsedMs: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return BED.baseTempo;
  if (elapsedMs <= 0) return current;
  const maxStep = (BED.tempoSlewBpmPerSec * elapsedMs) / 1000;
  const delta = target - current;
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

// --- Grafo de audio (solo navegador) ------------------------------------------------------

// Re menor en registro audible. Bajo (D2/A2), pad (D3/F3/A3) y arpegio (D4/F4/A4).
const NOTE = {
  D2: 73.416,
  F2: 87.307,
  A2: 110.0,
  D3: 146.832,
  F3: 174.614,
  A3: 220.0,
  D4: 293.665,
  F4: 349.228,
  A4: 440.0
} as const;

type BrowserWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

type AmbientGraph = {
  ctx: AudioContext;
  bedGain: GainNode; // volumen general (fade in/out)
  duckGain: GainNode; // atenuacion bajo la voz
  padGain: GainNode;
  padLowpass: BiquadFilterNode;
  bassGain: GainNode;
  rhythmBus: GainNode;
  noiseBuffer: AudioBuffer;
  pad: OscillatorNode[]; // osciladores continuos (pad + bajo)
};

let graph: AmbientGraph | null = null;
let enabled = false;
let ducked = false;
let voiceProbe: (() => boolean) | null = null;
let duckTimer: number | null = null;
let schedulerTimer: number | null = null;
let currentTempo: number = BED.baseTempo;
let targetTempo: number = BED.baseTempo;
let nextStepTime = 0;
let step16 = 0;
let lastSchedulerTickMs: number | null = null;
let drivers: AmbientDrivers = { biggestMagnitude: null, recentCount: 0, mode: "monitoreo" };

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const browserWindow = window as BrowserWindow;
  const AudioContextCtor = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
  if (!AudioContextCtor) return null;
  return new AudioContextCtor();
}

function ramp(param: AudioParam, value: number, seconds: number, now: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + seconds);
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function makeSustained(
  ctx: AudioContext,
  type: OscillatorType,
  frequency: number,
  destination: AudioNode,
  gain: number
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = frequency;
  const g = ctx.createGain();
  g.gain.value = gain;
  osc.connect(g);
  g.connect(destination);
  return osc;
}

function buildGraph(ctx: AudioContext): AmbientGraph {
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.02;
  compressor.release.value = 0.35;
  compressor.connect(ctx.destination);

  const duckGain = ctx.createGain();
  duckGain.gain.value = 1;
  duckGain.connect(compressor);

  const bedGain = ctx.createGain();
  bedGain.gain.value = 0; // arranca en silencio y sube con el fade-in
  bedGain.connect(duckGain);

  const bassGain = ctx.createGain();
  bassGain.gain.value = BED.bassGain;
  bassGain.connect(bedGain);

  const padLowpass = ctx.createBiquadFilter();
  padLowpass.type = "lowpass";
  padLowpass.frequency.value = BED.minFilterHz;
  padLowpass.Q.value = 0.7;
  padLowpass.connect(bedGain);

  const padGain = ctx.createGain();
  padGain.gain.value = BED.padBaseGain;
  padGain.connect(padLowpass);

  const rhythmBus = ctx.createGain();
  rhythmBus.gain.value = BED.rhythmBaseGain;
  rhythmBus.connect(bedGain);

  // Bajo sostenido (raiz) + pad (triada de re menor) continuos.
  const pad = [
    makeSustained(ctx, "sine", NOTE.D2, bassGain, 0.9),
    makeSustained(ctx, "triangle", NOTE.D3, padGain, 0.5),
    makeSustained(ctx, "triangle", NOTE.F3, padGain, 0.42),
    makeSustained(ctx, "sine", NOTE.A3, padGain, 0.42),
    makeSustained(ctx, "sine", NOTE.D4, padGain, 0.22)
  ];

  return {
    ctx,
    bedGain,
    duckGain,
    padGain,
    padLowpass,
    bassGain,
    rhythmBus,
    noiseBuffer: makeNoiseBuffer(ctx),
    pad
  };
}

// --- Voces percusivas/pluck (efimeras: se crean por golpe y se auto-detienen) --------------

function triggerKick(g: AmbientGraph, time: number, gain: number): void {
  const osc = g.ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, time);
  osc.frequency.exponentialRampToValueAtTime(48, time + 0.12);
  const env = g.ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.exponentialRampToValueAtTime(gain, time + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, time + 0.26);
  osc.connect(env);
  env.connect(g.rhythmBus);
  osc.start(time);
  osc.stop(time + 0.3);
}

function triggerHat(g: AmbientGraph, time: number, gain: number): void {
  const src = g.ctx.createBufferSource();
  src.buffer = g.noiseBuffer;
  const hp = g.ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7000;
  const env = g.ctx.createGain();
  env.gain.setValueAtTime(gain, time);
  env.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  src.connect(hp);
  hp.connect(env);
  env.connect(g.rhythmBus);
  src.start(time);
  src.stop(time + 0.06);
}

function triggerPluck(g: AmbientGraph, time: number, freq: number, gain: number, cutoff: number): void {
  const osc = g.ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;
  const lp = g.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = cutoff;
  const env = g.ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.exponentialRampToValueAtTime(gain, time + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, time + 0.38);
  osc.connect(lp);
  lp.connect(env);
  env.connect(g.rhythmBus);
  osc.start(time);
  osc.stop(time + 0.42);
}

const ARP_BY_STEP: Record<number, number> = { 0: NOTE.D4, 4: NOTE.A3, 8: NOTE.F4, 12: NOTE.A3 };

// Patron de 16 pasos (semicorcheas): bombo en 1 y 3, hats en las contras, bajo pulsado y un
// arpegio tenue. Suave y constante: da ritmo sin volverse una pista de baile.
function scheduleStep(g: AmbientGraph, step: number, time: number): void {
  if (step === 0 || step === 8) triggerKick(g, time, 0.9);
  if (step % 2 === 0) triggerHat(g, time, step % 4 === 0 ? 0.11 : 0.06);
  if (step === 0) triggerPluck(g, time, NOTE.D2, 0.55, 1400);
  if (step === 8) triggerPluck(g, time, NOTE.A2, 0.5, 1400);
  const arp = ARP_BY_STEP[step];
  if (arp) triggerPluck(g, time, arp, 0.22, 2600);
}

function scheduler(): void {
  if (!graph) return;
  const ctx = graph.ctx;
  const nowMs = performance.now();
  const elapsedMs = lastSchedulerTickMs === null ? 25 : Math.max(0, nowMs - lastSchedulerTickMs);
  lastSchedulerTickMs = nowMs;
  currentTempo = slewTempo(currentTempo, targetTempo, elapsedMs);
  // El reloj de audio solo avanza si el contexto corre; si esta suspendido, pina el proximo paso.
  if (ctx.state !== "running") {
    nextStepTime = ctx.currentTime;
    return;
  }
  while (nextStepTime < ctx.currentTime + 0.12) {
    scheduleStep(graph, step16, nextStepTime);
    nextStepTime += 60 / currentTempo / 4; // duracion de una semicorchea
    step16 = (step16 + 1) % 16;
  }
}

function applyTargets(): void {
  if (!graph) return;
  const now = graph.ctx.currentTime;
  const targets = computeAmbientTargets(drivers);

  ramp(graph.padGain.gain, targets.padGain, BED.paramRampSec, now);
  ramp(graph.padLowpass.frequency, targets.filterHz, BED.paramRampSec, now);
  ramp(graph.rhythmBus.gain, targets.rhythmGain, BED.paramRampSec, now);
  targetTempo = targets.tempoBpm;

  graph.pad.forEach((osc, index) => {
    const sign = index % 2 === 0 ? 1 : -1;
    ramp(osc.detune, targets.detuneCents * sign, BED.paramRampSec, now);
  });

  const duckTarget = ducked ? BED.duckFactor : 1;
  ramp(graph.duckGain.gain, duckTarget, ducked ? BED.duckDownSec : BED.duckUpSec, now);
}

function setDuckedInternal(next: boolean): void {
  if (next === ducked) return;
  ducked = next;
  applyTargets();
}

function duckTick(): void {
  if (!graph) return;
  if (voiceProbe) setDuckedInternal(voiceProbe());
}

function teardown(previous: AmbientGraph): void {
  const stopAt = previous.ctx.currentTime + 0.05;
  for (const osc of previous.pad) {
    try {
      osc.stop(stopAt);
    } catch {
      // ya detenido
    }
  }
  window.setTimeout(() => {
    for (const osc of previous.pad) osc.disconnect();
    previous.padGain.disconnect();
    previous.padLowpass.disconnect();
    previous.bassGain.disconnect();
    previous.rhythmBus.disconnect();
    previous.bedGain.disconnect();
    previous.duckGain.disconnect();
  }, 250);
}

// --- API imperativa (la consume App.tsx) --------------------------------------------------

export function startAmbient(options: { voiceActivityProbe?: () => boolean } = {}): boolean {
  voiceProbe = options.voiceActivityProbe ?? null;
  if (graph) {
    enabled = true;
    lastSchedulerTickMs = performance.now();
    void graph.ctx.resume().catch(() => undefined);
    return true;
  }

  const ctx = getAudioContext();
  if (!ctx) return false;

  const built = buildGraph(ctx);
  const startAt = ctx.currentTime + 0.02;
  for (const osc of built.pad) osc.start(startAt);
  graph = built;
  enabled = true;
  ducked = false;
  currentTempo = BED.baseTempo;
  targetTempo = BED.baseTempo;
  step16 = 0;
  nextStepTime = ctx.currentTime;
  lastSchedulerTickMs = performance.now();

  ramp(built.bedGain.gain, BED.masterGain, BED.fadeInSec, ctx.currentTime);
  applyTargets();
  void ctx.resume().catch(() => undefined);

  if (schedulerTimer === null) schedulerTimer = window.setInterval(scheduler, 25);
  if (duckTimer === null) duckTimer = window.setInterval(duckTick, 250);
  return true;
}

export function stopAmbient(): void {
  enabled = false;
  if (schedulerTimer !== null) {
    window.clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  if (duckTimer !== null) {
    window.clearInterval(duckTimer);
    duckTimer = null;
  }
  currentTempo = BED.baseTempo;
  targetTempo = BED.baseTempo;
  lastSchedulerTickMs = null;
  const previous = graph;
  graph = null;
  if (!previous) return;
  ramp(previous.bedGain.gain, 0, BED.fadeOutSec, previous.ctx.currentTime);
  window.setTimeout(() => teardown(previous), BED.fadeOutSec * 1000);
}

export function setAmbientEnabled(next: boolean, options?: { voiceActivityProbe?: () => boolean }): boolean {
  if (next) return startAmbient(options);
  stopAmbient();
  return false;
}

export function updateAmbientDrivers(next: Partial<AmbientDrivers>): void {
  drivers = { ...drivers, ...next };
  applyTargets();
}

export function setAmbientDucked(next: boolean): void {
  setDuckedInternal(next);
}

export function resumeAmbient(): void {
  if (graph && graph.ctx.state === "suspended") {
    lastSchedulerTickMs = performance.now();
    void graph.ctx.resume().catch(() => undefined);
  }
}

export function isAmbientActive(): boolean {
  return graph !== null && enabled;
}
