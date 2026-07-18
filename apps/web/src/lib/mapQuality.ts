export type MapRenderScale = {
  effectivePixelRatio: number;
  resolutionScale: number;
};

const MIN_EFFECTIVE_PIXEL_RATIO = 1.25;
const MAX_EFFECTIVE_PIXEL_RATIO = 2;
const MAX_DRAWING_BUFFER_PIXELS = 3840 * 2160;

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function resolveMapRenderScale(
  widthCss: number,
  heightCss: number,
  browserPixelRatio: number
): MapRenderScale {
  const width = finitePositive(widthCss, 1);
  const height = finitePositive(heightCss, 1);
  const deviceRatio = finitePositive(browserPixelRatio, 1);
  const budgetRatio = Math.sqrt(MAX_DRAWING_BUFFER_PIXELS / (width * height));
  const preferredRatio = Math.min(
    MAX_EFFECTIVE_PIXEL_RATIO,
    Math.max(MIN_EFFECTIVE_PIXEL_RATIO, deviceRatio)
  );
  const effectivePixelRatio = Math.max(1, Math.min(preferredRatio, budgetRatio));

  return {
    effectivePixelRatio,
    resolutionScale: effectivePixelRatio / deviceRatio
  };
}
