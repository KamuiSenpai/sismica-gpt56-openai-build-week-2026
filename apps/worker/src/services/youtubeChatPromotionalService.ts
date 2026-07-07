const PROMOTIONAL_LIKE_MESSAGES = [
  "👍 Si este monitoreo te aporta valor, deja tu like para apoyar la transmision en vivo de SISMICA 24.",
  "🌎 Tu like ayuda a que mas personas encuentren este seguimiento sismico 24/7 en tiempo real.",
  "📡 Si te sirve este monitoreo continuo, apoya la transmision con tu like en SISMICA 24."
] as const;

export function getPromotionalLikeMessages(): readonly string[] {
  return PROMOTIONAL_LIKE_MESSAGES;
}

export function pickNextPromotionalLikeMessageIndex(lastIndex: number | null): number {
  if (lastIndex === null || lastIndex < 0) return 0;
  return (lastIndex + 1) % PROMOTIONAL_LIKE_MESSAGES.length;
}

export function buildPromotionalLikeYoutubeChatMessage(lastIndex: number | null): {
  text: string;
  variantIndex: number;
} {
  const variantIndex = pickNextPromotionalLikeMessageIndex(lastIndex);
  return {
    text: PROMOTIONAL_LIKE_MESSAGES[variantIndex],
    variantIndex
  };
}
