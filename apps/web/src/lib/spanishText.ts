const ACCENTED_WORDS: Record<string, string> = {
  acompanando: "acompañando",
  actualizacion: "actualización",
  agachese: "agáchese",
  alejese: "aléjese",
  automatico: "automático",
  boletin: "boletín",
  carino: "cariño",
  cubrase: "cúbrase",
  cuidalos: "cuídalos",
  conduccion: "conducción",
  contexto: "contexto",
  cobertura: "cobertura",
  despues: "después",
  disposicion: "disposición",
  energia: "energía",
  especifico: "específico",
  geologico: "geológico",
  informacion: "información",
  intensidad: "intensidad",
  japon: "japón",
  logaritmica: "logarítmica",
  mantengase: "manténgase",
  mas: "más",
  mexico: "México",
  narracion: "narración",
  oceanoografico: "oceanográfico",
  oceanografico: "oceanográfico",
  orillese: "oríllese",
  pais: "país",
  periodo: "período",
  pacifico: "pacífico",
  publico: "público",
  recien: "recién",
  region: "región",
  sintesis: "síntesis",
  sismica: "sísmica",
  sismico: "sísmico",
  sismologicas: "sismológicas",
  sismologicos: "sismológicos",
  sismologica: "sismológica",
  sismologico: "sismológico",
  subduccion: "subducción",
  sudamerica: "sudamérica",
  sujetese: "sujétese",
  tectonica: "tectónica",
  tectonico: "tectónico",
  turquia: "turquía",
  ultima: "última",
  ultimas: "últimas",
  ultimo: "último",
  ultimos: "últimos",
  ubicacion: "ubicación",
  vehiculo: "vehículo"
};

function applyCasePattern(source: string, replacement: string): string {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  const first = source.charAt(0);
  const rest = source.slice(1);
  if (first === first.toUpperCase() && rest === rest.toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

export function normalizeSpanishText(text: string): string {
  const withoutStutter = text.replace(/\bde,\s*de\b/giu, "de").replace(/\bde\s+de\b/giu, "de");

  return withoutStutter.replace(/\b([\p{L}\p{M}]+)\b/gu, (word) => {
    const lookup = word
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLocaleLowerCase("es");
    const replacement = ACCENTED_WORDS[lookup];
    return replacement ? applyCasePattern(word, replacement) : word;
  });
}

// --- Deletreo de numeros en espanol (para el TTS) -----------------------------------------
// Los motores TTS convierten los digitos a palabras de forma inconsistente (Chatterbox lee
// "148" como "catorce ocho"). Deletrearlos aqui, en la app, lo hace correcto e independiente
// del motor. Sin acentos, en linea con el resto de las cadenas del proyecto.
const NUM_0_29 = [
  "cero",
  "uno",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciseis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
  "veinte",
  "veintiuno",
  "veintidos",
  "veintitres",
  "veinticuatro",
  "veinticinco",
  "veintiseis",
  "veintisiete",
  "veintiocho",
  "veintinueve"
] as const;
const TENS = [
  "",
  "",
  "",
  "treinta",
  "cuarenta",
  "cincuenta",
  "sesenta",
  "setenta",
  "ochenta",
  "noventa"
] as const;
const HUNDREDS = [
  "",
  "ciento",
  "doscientos",
  "trescientos",
  "cuatrocientos",
  "quinientos",
  "seiscientos",
  "setecientos",
  "ochocientos",
  "novecientos"
] as const;

function spellInteger(n: number): string {
  if (n < 30) return NUM_0_29[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    return u === 0 ? TENS[t] : `${TENS[t]} y ${NUM_0_29[u]}`;
  }
  if (n === 100) return "cien";
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return r === 0 ? HUNDREDS[h] : `${HUNDREDS[h]} ${spellInteger(r)}`;
  }
  if (n < 1000000) {
    const th = Math.floor(n / 1000);
    const r = n % 1000;
    const thWords = th === 1 ? "mil" : `${spellInteger(th)} mil`;
    return r === 0 ? thWords : `${thWords} ${spellInteger(r)}`;
  }
  return String(n);
}

export function spellSpanishNumbers(text: string): string {
  return text.replace(/\d+(?:[.,]\d+)?/g, (match) => {
    if (/[.,]/.test(match)) {
      const [intPart, decPart] = match.split(/[.,]/);
      const intWords = spellInteger(Number.parseInt(intPart, 10));
      const decWords = decPart
        .split("")
        .map((digit) => NUM_0_29[Number.parseInt(digit, 10)])
        .join(" ");
      return `${intWords} punto ${decWords}`;
    }
    const value = Number.parseInt(match, 10);
    return Number.isFinite(value) ? spellInteger(value) : match;
  });
}
