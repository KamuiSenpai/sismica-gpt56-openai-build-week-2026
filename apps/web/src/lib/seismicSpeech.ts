import { type SeismicEvent } from "@sismica/shared";

import { broadcastPlace } from "./broadcastPlace";
import { normalizeSpanishText } from "./spanishText";

const DEFAULT_SPEECH_LANG = "es-PE";
const SPEECH_DEDUP_WINDOW_MS = 4_000;
const VOICE_PREFERENCES = ["es-PE", "es-MX", "es-419", "es-ES", "es-US", "es"] as const;
const DEFAULT_NARRATION_INTRO = "Sismo detectado";
const NARRATION_DESCRIPTOR_PATTERN =
  /^(?:Sur|Norte|Este|Oeste|Centro|Region|Región|Cerca|Frente|Al|Sede|Prefectura)\b/u;

let voiceEnabled = false;
let lastSpeechKey = "";
let lastSpeechAt = 0;

function expandSpokenAbbreviations(text: string): string {
  return text.replace(/\bEE\.?\s*UU\.?\b/gu, "Estados Unidos").replace(/\bEEUU\b/gu, "Estados Unidos");
}

export function normalizeSpokenText(text: string): string {
  return (
    normalizeSpanishText(expandSpokenAbbreviations(text))
      .replace(/\s*[\r\n]+\s*/gu, ", ")
      .replace(/…/gu, ", ")
      .replace(/\s*[;:!?]+\s*/gu, ", ")
      // Colapsa los puntos internos de siglas/abreviaturas para que no se deletreen con "punto":
      // "S.O." -> "SO", "U.S.A" -> "USA" (EE.UU ya se expande antes).
      .replace(/\b(\p{L})\.(?=\p{L})/gu, "$1")
      // Todo punto que NO sea decimal (entre digitos) es puntuacion: fin de frase o abreviatura.
      // Pasa a pausa y no se pronuncia como "punto"; el decimal de la magnitud (3.5) se conserva.
      .replace(/(?<!\d)\.|\.(?!\d)/gu, ", ")
      .replace(/\s+,/gu, ",")
      .replace(/,\s*,+/gu, ", ")
      .replace(/\s{2,}/gu, " ")
      .replace(/,\s*$/gu, "")
      .trim()
  );
}

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
  // De-puntea abreviaturas de direccion ("al S.O. de" -> "al SO de") para que la expansion
  // siguiente las convierta en palabra ("al suroeste de") y no se deletreen con "punto".
  const dedottedDirections = normalizedUnits.replace(
    /\bal\s+([NSEO](?:\s*\.?\s*[NSEO]){0,2})\s*\.?\s+de\b/giu,
    (_match, rawDirection: string) => `al ${rawDirection.replace(/[.\s]/gu, "").toUpperCase()} de`
  );
  const spokenDirections = dedottedDirections.replace(
    /\bal\s+(NNO|NNE|ENE|ESE|SSE|SSO|OSO|ONO|NO|NE|SO|SE|N|S|E|O)\s+de\b/giu,
    (_match, rawDirection: string) => {
      const labelMap: Record<string, string> = {
        N: "norte",
        S: "sur",
        E: "este",
        O: "oeste",
        NE: "noreste",
        NO: "noroeste",
        SE: "sureste",
        SO: "suroeste",
        NNE: "norte-noreste",
        ENE: "este-noreste",
        ESE: "este-sureste",
        SSE: "sur-sureste",
        SSO: "sur-suroeste",
        OSO: "oeste-suroeste",
        ONO: "oeste-noroeste",
        NNO: "norte-noroeste"
      };
      return `al ${labelMap[rawDirection.toUpperCase()] ?? rawDirection.toLowerCase()} de`;
    }
  );
  const spokenAbbreviations = expandSpokenAbbreviations(spokenDirections);
  if (!NARRATION_DESCRIPTOR_PATTERN.test(spokenAbbreviations)) return spokenAbbreviations;
  return spokenAbbreviations.replace(/^(\p{L})/u, (match) => match.toLocaleLowerCase("es"));
}

function resolveNarrationPlace(event: SeismicEvent): string {
  const place = normalizeNarrationPlace(broadcastPlace(event).trim());
  return place || "ubicacion no identificada";
}

export function buildSeismicNarration(
  event: SeismicEvent,
  options: { intro?: string; place?: string; closing?: string | null } = {}
): string {
  const place = options.place?.trim() ? normalizeNarrationPlace(options.place) : resolveNarrationPlace(event);
  const intro = options.intro?.trim() || DEFAULT_NARRATION_INTRO;
  const segments = [`${intro} en ${place}`];

  if (typeof event.magnitude === "number") {
    segments.push(`de magnitud ${event.magnitude.toFixed(1)}`);
  }

  if (typeof event.depthKm === "number") {
    segments.push(`a una profundidad de ${formatSpokenKilometers(Math.round(event.depthKm))}`);
  }

  const narration = `${segments.join(", ")}.`;
  const closing = options.closing?.trim().replace(/[.!,;:]+$/u, "") ?? "";
  return closing ? `${narration} ${closing}.` : narration;
}

export function speakSeismicNarration(
  event: SeismicEvent,
  enabled: boolean,
  options: { force?: boolean; intro?: string; text?: string; closing?: string | null; rate?: number } = {}
): boolean {
  if (!enabled || !voiceEnabled) return false;

  const synth = getSpeechSynthesis();
  if (!synth) return false;

  const now = Date.now();
  const key = speechKey(event);
  if (!options.force && key === lastSpeechKey && now - lastSpeechAt < SPEECH_DEDUP_WINDOW_MS) {
    return false;
  }

  // Texto explicito (p. ej. narracion IA) o la plantilla local.
  const narration = normalizeSpokenText(options.text?.trim() || buildSeismicNarration(event, options));
  const utterance = new SpeechSynthesisUtterance(narration);
  const voice = pickPreferredVoice(synth.getVoices());

  utterance.lang = voice?.lang ?? DEFAULT_SPEECH_LANG;
  if (voice) utterance.voice = voice;
  utterance.rate = options.rate ?? 1.02;
  utterance.pitch = 1;
  utterance.volume = 1;

  lastSpeechKey = key;
  lastSpeechAt = now;

  synth.cancel();
  synth.speak(utterance);
  return true;
}

// Locuta un texto arbitrario (segmentos del director) por la voz del navegador.
export function speakSeismicText(text: string, options: { rate?: number } = {}): boolean {
  if (!voiceEnabled) return false;
  const synth = getSpeechSynthesis();
  if (!synth) return false;
  const value = normalizeSpokenText(text.trim());
  if (!value) return false;

  const utterance = new SpeechSynthesisUtterance(value);
  const voice = pickPreferredVoice(synth.getVoices());
  utterance.lang = voice?.lang ?? DEFAULT_SPEECH_LANG;
  if (voice) utterance.voice = voice;
  utterance.rate = options.rate ?? 1.02;
  utterance.pitch = 1;
  utterance.volume = 1;

  synth.cancel();
  synth.speak(utterance);
  return true;
}
