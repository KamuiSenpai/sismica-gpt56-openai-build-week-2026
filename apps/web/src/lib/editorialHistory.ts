const MAX_EDITORIAL_LINES = 20;

type EditorialHistoryEntry = {
  canonical: string;
  text: string;
};

const editorialHistory: EditorialHistoryEntry[] = [];

function canonicalize(text: string): string {
  return text
    .toLocaleLowerCase("es")
    .replace(/[.,;:!?]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function rememberEditorialLine(text: string): void {
  const normalized = text.trim();
  if (!normalized) return;
  const canonical = canonicalize(normalized);
  if (!canonical) return;

  const last = editorialHistory[editorialHistory.length - 1];
  if (last?.canonical === canonical) return;

  editorialHistory.push({ canonical, text: normalized });
  while (editorialHistory.length > MAX_EDITORIAL_LINES) {
    editorialHistory.shift();
  }
}

export function getRecentEditorialLines(limit = 12): string[] {
  return editorialHistory.slice(-Math.max(1, limit)).map((entry) => entry.text);
}

export function clearEditorialHistory(): void {
  editorialHistory.length = 0;
}
