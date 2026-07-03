const ACCENTED_WORDS: Record<string, string> = {
  actualizacion: "actualización",
  automatico: "automático",
  boletin: "boletín",
  carino: "cariño",
  conduccion: "conducción",
  contexto: "contexto",
  cobertura: "cobertura",
  energia: "energía",
  especifico: "específico",
  geologico: "geológico",
  informacion: "información",
  intensidad: "intensidad",
  logaritmica: "logarítmica",
  mas: "más",
  narracion: "narración",
  oceanoografico: "oceanográfico",
  oceanografico: "oceanográfico",
  pais: "país",
  periodo: "período",
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
  tectonica: "tectónica",
  tectonico: "tectónico",
  ultima: "última",
  ultimas: "últimas",
  ultimo: "último",
  ultimos: "últimos",
  ubicacion: "ubicación"
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
  return text.replace(/\b([\p{L}\p{M}]+)\b/gu, (word) => {
    const lookup = word
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLocaleLowerCase("es");
    const replacement = ACCENTED_WORDS[lookup];
    return replacement ? applyCasePattern(word, replacement) : word;
  });
}
