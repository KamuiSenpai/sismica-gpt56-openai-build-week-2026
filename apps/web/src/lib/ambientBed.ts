// Lecho ambiental generativo (Web Audio): un drone sub-grave + un pad en re menor/frigio que
// evoluciona segun la actividad sismica. Esta 100% sintetizado -> sin archivos ni licencias, y
// el loop no tiene costuras. Corre solo en el navegador; en un entorno sin AudioContext (tests,
// SSR) se degrada a no-op. La logica de mapeo (estado sismico -> parametros de audio) es PURA y
// esta cubierta por ambientBed.test.ts; el grafo de audio vive detras de un guard de window.

export type AmbientMode = "monitoreo" | "vivo" | "boletin" | "relevo";

export type AmbientDrivers = {
  // Mayor magnitud entre los sismos recientes (null si no hay dato numerico).
  biggestMagnitude: number | null;
  // Cantidad de sismos recientes en pantalla (densidad de actividad).
  recentCount: number;
  // Modo editorial en curso: eleva un piso de tension aunque la actividad sea baja.
  mode: AmbientMode;
};

export type AmbientTargets = {
  intensity: number; // 0..1: sintesis de magnitud, densidad y modo
  masterGain: number; // volumen lineal del lecho (sin ducking)
  filterHz: number; // corte del pasa-bajos del pad (mas brillo = mas tension)
  pulseGain: number; // pulso grave tipo "redaccion" (boletin / en vivo)
  tensionGain: number; // nota de tension (segunda menor frigia) que entra con la intensidad
  detuneCents: number; // batido/disonancia del pad
};

// Parametros musicales y de mezcla. El lecho se mantiene MUY por debajo de la voz.
const BED = {
  baseGain: 0.05, // ~ -26 dB en calma
  maxGain: 0.09, // ~ -21 dB en maxima tension
  duckFactor: 0.3, // atenuacion cuando habla el locutor (~ -10 dB bajo el lecho)
  minFilterHz: 180,
  maxFilterHz: 950,
  maxPulseGain: 0.06,
  maxTensionGain: 0.05,
  maxDetuneCents: 16,
  // Rampas (segundos): lentas para lo musical, rapida para agachar bajo la voz.
  paramRampSec: 2.5,
  duckDownSec: 0.18,
  duckUpSec: 0.9,
  fadeInSec: 3,
  fadeOutSec: 0.8
} as const;

// El modo eleva un piso de intensidad (breaking, boletin) sin borrar la actividad real.
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
  const masterGain = BED.baseGain + (BED.maxGain - BED.baseGain) * intensity;
  const filterHz = BED.minFilterHz + (BED.maxFilterHz - BED.minFilterHz) * intensity;

  // El pulso "redaccion" solo asoma en boletin/en vivo; en monitoreo queda casi mudo.
  const pulseBias = drivers.mode === "vivo" ? 0.9 : drivers.mode === "boletin" ? 0.6 : 0.12;
  const pulseGain =
    BED.maxPulseGain * clamp01(intensity * pulseBias + (drivers.mode === "boletin" ? 0.15 : 0));

  // La segunda menor (Eb sobre re) da el aire ominoso; entra sobre todo en vivo.
  const tensionBias = drivers.mode === "vivo" ? 1 : 0.35;
  const tensionGain = BED.maxTensionGain * intensity * tensionBias;

  const detuneCents = BED.maxDetuneCents * intensity * (drivers.mode === "vivo" ? 1 : 0.5);

  return { intensity, masterGain, filterHz, pulseGain, tensionGain, detuneCents };
}

// --- Grafo de audio (solo navegador) ------------------------------------------------------

// Re menor / frigio, en octavas graves. El drone ancla la profundidad tectonica; el pad da el
// color menor; la nota de tension (Eb) es la segunda menor frigia.
const NOTE = {
  D1: 36.708,
  D2: 73.416,
  F2: 87.307,
  A2: 110.0,
  D3: 146.832,
  Eb3: 155.563
} as const;

type BrowserWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

type AmbientGraph = {
  ctx: AudioContext;
  bedGain: GainNode; // volumen musical (rampas lentas)
  duckGain: GainNode; // atenuacion bajo la voz (rampas rapidas)
  lowpass: BiquadFilterNode;
  padGain: GainNode;
  droneGain: GainNode;
  tensionGain: GainNode;
  pulseGain: GainNode;
  pulseAmp: GainNode;
  pulseLfoGain: GainNode;
  pad: OscillatorNode[];
  drone: OscillatorNode[];
  tension: OscillatorNode;
  pulse: OscillatorNode;
  pulseLfo: OscillatorNode;
  oscillators: OscillatorNode[];
};

let graph: AmbientGraph | null = null;
let enabled = false;
let ducked = false;
let voiceProbe: (() => boolean) | null = null;
let tickTimer: number | null = null;
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

function makeOscillator(
  ctx: AudioContext,
  type: OscillatorType,
  frequency: number,
  destination: AudioNode,
  gain = 1
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = frequency;
  if (gain === 1) {
    osc.connect(destination);
  } else {
    const oscGain = ctx.createGain();
    oscGain.gain.value = gain;
    osc.connect(oscGain);
    oscGain.connect(destination);
  }
  return osc;
}

function buildGraph(ctx: AudioContext): AmbientGraph {
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.02;
  compressor.release.value = 0.4;
  compressor.connect(ctx.destination);

  const duckGain = ctx.createGain();
  duckGain.gain.value = 1;
  duckGain.connect(compressor);

  const bedGain = ctx.createGain();
  bedGain.gain.value = 0; // arranca en silencio y sube con el fade-in
  bedGain.connect(duckGain);

  // El drone sub y el pulso van directos al bus (no los filtra el pasa-bajos del pad).
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.5;
  droneGain.connect(bedGain);

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = BED.minFilterHz;
  lowpass.Q.value = 0.6;
  lowpass.connect(bedGain);

  const padGain = ctx.createGain();
  padGain.gain.value = 0.14;
  padGain.connect(lowpass);

  const tensionGain = ctx.createGain();
  tensionGain.gain.value = 0;
  tensionGain.connect(lowpass);

  // Pulso grave "latido de redaccion": la profundidad la mueve applyTargets en pulseGain, y un
  // LFO lento la modula en pulseAmp (nodo aparte, para no pelear con la rampa de pulseGain.gain).
  const pulseGain = ctx.createGain();
  pulseGain.gain.value = 0;
  pulseGain.connect(bedGain);
  const pulseAmp = ctx.createGain();
  pulseAmp.gain.value = 0.5; // centro de la oscilacion
  pulseAmp.connect(pulseGain);
  const pulse = makeOscillator(ctx, "sine", NOTE.D2, pulseAmp);
  const pulseLfo = ctx.createOscillator();
  pulseLfo.type = "sine";
  pulseLfo.frequency.value = 0.7;
  const pulseLfoGain = ctx.createGain();
  pulseLfoGain.gain.value = 0.5; // suma ±0.5 -> pulseAmp oscila 0..1
  pulseLfo.connect(pulseLfoGain);
  pulseLfoGain.connect(pulseAmp.gain);

  const drone = [
    makeOscillator(ctx, "sine", NOTE.D1, droneGain),
    makeOscillator(ctx, "sine", NOTE.D2, droneGain, 0.6)
  ];
  drone[1].detune.value = -6; // batido calido entre las dos capas del drone

  const pad = [
    makeOscillator(ctx, "triangle", NOTE.D2, padGain, 0.7),
    makeOscillator(ctx, "triangle", NOTE.F2, padGain, 0.6),
    makeOscillator(ctx, "sine", NOTE.A2, padGain, 0.6),
    makeOscillator(ctx, "sine", NOTE.D3, padGain, 0.35)
  ];

  const tension = makeOscillator(ctx, "triangle", NOTE.Eb3, tensionGain, 0.8);

  const oscillators = [...drone, ...pad, tension, pulse, pulseLfo];
  return {
    ctx,
    bedGain,
    duckGain,
    lowpass,
    padGain,
    droneGain,
    tensionGain,
    pulseGain,
    pulseAmp,
    pulseLfoGain,
    pad,
    drone,
    tension,
    pulse,
    pulseLfo,
    oscillators
  };
}

function applyTargets(): void {
  if (!graph) return;
  const now = graph.ctx.currentTime;
  const targets = computeAmbientTargets(drivers);

  ramp(graph.bedGain.gain, targets.masterGain, BED.paramRampSec, now);
  ramp(graph.lowpass.frequency, targets.filterHz, BED.paramRampSec, now);
  ramp(graph.pulseGain.gain, targets.pulseGain, BED.paramRampSec, now);
  ramp(graph.tensionGain.gain, targets.tensionGain, BED.paramRampSec, now);

  // Detune alterno entre las voces del pad -> batido/tension sin desafinar el conjunto.
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

function tick(): void {
  if (!graph) return;
  if (voiceProbe) setDuckedInternal(voiceProbe());
}

function teardown(previous: AmbientGraph): void {
  const stopAt = previous.ctx.currentTime + 0.05;
  for (const osc of previous.oscillators) {
    try {
      osc.stop(stopAt);
    } catch {
      // ya detenido
    }
  }
  window.setTimeout(() => {
    for (const osc of previous.oscillators) osc.disconnect();
    previous.padGain.disconnect();
    previous.droneGain.disconnect();
    previous.tensionGain.disconnect();
    previous.pulseGain.disconnect();
    previous.pulseAmp.disconnect();
    previous.pulseLfoGain.disconnect();
    previous.lowpass.disconnect();
    previous.bedGain.disconnect();
    previous.duckGain.disconnect();
  }, 200);
}

// --- API imperativa (la consume App.tsx) --------------------------------------------------

export function startAmbient(options: { voiceActivityProbe?: () => boolean } = {}): boolean {
  voiceProbe = options.voiceActivityProbe ?? null;
  if (graph) {
    enabled = true;
    void graph.ctx.resume().catch(() => undefined);
    return true;
  }

  const ctx = getAudioContext();
  if (!ctx) return false;

  const built = buildGraph(ctx);
  const startAt = ctx.currentTime + 0.02;
  for (const osc of built.oscillators) osc.start(startAt);
  graph = built;
  enabled = true;
  ducked = false;

  // Fade-in del lecho hasta el volumen objetivo (nada de arranques secos).
  ramp(built.bedGain.gain, computeAmbientTargets(drivers).masterGain, BED.fadeInSec, ctx.currentTime);
  applyTargets();
  void ctx.resume().catch(() => undefined);

  if (tickTimer === null) {
    tickTimer = window.setInterval(tick, 250);
  }
  return true;
}

export function stopAmbient(): void {
  enabled = false;
  if (tickTimer !== null) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
  const previous = graph;
  graph = null;
  if (!previous) return;
  // Fade-out para evitar el corte abrupto, luego desmonta el grafo.
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
    void graph.ctx.resume().catch(() => undefined);
  }
}

export function isAmbientActive(): boolean {
  return graph !== null && enabled;
}
