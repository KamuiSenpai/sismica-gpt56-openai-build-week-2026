import { type SeismicEvent } from "@sismica/shared";

import { countryCode, countryNameEs, getEventPlace } from "./presentation";

const DEFAULT_SPEECH_LANG = "es-PE";
const SPEECH_DEDUP_WINDOW_MS = 4_000;
const VOICE_PREFERENCES = ["es-PE", "es-MX", "es-419", "es-ES", "es-US", "es"] as const;
const DEFAULT_NARRATION_INTRO = "Sismo detectado";
const NARRATION_DESCRIPTOR_PATTERN =
  /^(?:Sur|Norte|Este|Oeste|Centro|Region|Región|Cerca|Frente|Al|Sede|Prefectura)\b/u;

let voiceEnabled = false;
let lastSpeechKey = "";
let lastSpeechAt = 0;

function formatSpokenKilometers(value: number | string): string {
  const numericValue = typeof value === "number" ? value : Number.parseFloat(value.replace(",", "."));
  const label = numericValue === 1 ? "kilometro" : "kilometros";
  return `${value} ${label}`;
}

function getSpeechSynthesis(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  if (!("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

function pickPreferredVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  for (const lang of VOICE_PREFERENCES) {
    const exactMatch = voices.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase());
    if (exactMatch) return exactMatch;
  }

  for (const lang of VOICE_PREFERENCES) {
    const familyMatch = voices.find((voice) => voice.lang.toLowerCase().startsWith(lang.toLowerCase()));
    if (familyMatch) return familyMatch;
  }

  return voices.find((voice) => voice.default) ?? voices[0] ?? null;
}

function speechKey(event: SeismicEvent): string {
  return `${event.eventId}:${event.updatedAtUtc ?? event.eventTimeUtc}`;
}

export function isSeismicVoiceSupported(): boolean {
  return getSpeechSynthesis() !== null;
}

export function isSeismicNarrationActive(): boolean {
  const synth = getSpeechSynthesis();
  return synth ? synth.speaking || synth.pending : false;
}

export function primeSeismicVoices(): boolean {
  const synth = getSpeechSynthesis();
  if (!synth) return false;
  void synth.getVoices();
  return true;
}

// Corta la locucion del navegador en curso (sin deshabilitar la voz).
export function cancelSeismicNarration(): void {
  getSpeechSynthesis()?.cancel();
}

export function setSeismicVoiceEnabled(enabled: boolean): boolean {
  voiceEnabled = enabled;

  const synth = getSpeechSynthesis();
  if (!synth) return false;

  if (!enabled) {
    synth.cancel();
    return false;
  }

  void synth.getVoices();
  return true;
}

function normalizeNarrationPlace(place: string): string {
  const normalizedUnits = place.replace(/(\d+(?:[.,]\d+)?)\s*km\b/giu, (_match, rawDistance: string) =>
    formatSpokenKilometers(rawDistance)
  );
  if (!NARRATION_DESCRIPTOR_PATTERN.test(normalizedUnits)) return normalizedUnits;
  return normalizedUnits.replace(/^(\p{L})/u, (match) => match.toLocaleLowerCase("es"));
}

function resolveNarrationPlace(event: SeismicEvent): string {
  const place = normalizeNarrationPlace(getEventPlace(event.title).trim());
  if (!place) return "ubicacion no identificada";

  const inferredCountry = countryNameEs(countryCode(event));
  if (!inferredCountry) return place;
  if (place.toLocaleLowerCase("es").endsWith(inferredCountry.toLocaleLowerCase("es"))) return place;
  return `${place}, ${inferredCountry}`;
}

export function buildSeismicNarration(event: SeismicEvent, options: { intro?: string } = {}): string {
  const place = resolveNarrationPlace(event);
  const intro = options.intro?.trim() || DEFAULT_NARRATION_INTRO;
  const segments = [`${intro} en ${place}`];

  if (typeof event.magnitude === "number") {
    segments.push(`de magnitud ${event.magnitude.toFixed(1)}`);
  }

  if (typeof event.depthKm === "number") {
    segments.push(`a una profundidad de ${formatSpokenKilometers(Math.round(event.depthKm))}`);
  }

  return `${segments.join(", ")}.`;
}

export function speakSeismicNarration(
  event: SeismicEvent,
  enabled: boolean,
  options: { force?: boolean; intro?: string } = {}
): boolean {
  if (!enabled || !voiceEnabled) return false;

  const synth = getSpeechSynthesis();
  if (!synth) return false;

  const now = Date.now();
  const key = speechKey(event);
  if (!options.force && key === lastSpeechKey && now - lastSpeechAt < SPEECH_DEDUP_WINDOW_MS) {
    return false;
  }

  const utterance = new SpeechSynthesisUtterance(buildSeismicNarration(event, options));
  const voice = pickPreferredVoice(synth.getVoices());

  utterance.lang = voice?.lang ?? DEFAULT_SPEECH_LANG;
  if (voice) utterance.voice = voice;
  utterance.rate = 1.02;
  utterance.pitch = 1;
  utterance.volume = 1;

  lastSpeechKey = key;
  lastSpeechAt = now;

  synth.cancel();
  synth.speak(utterance);
  return true;
}
