import { useEffect, useMemo, useRef, useState } from "react";

type MosaicSwapProps = {
  swapKey: string;
  children: React.ReactNode;
  className?: string;
  tileSize?: number;
  coverMs?: number;
  spreadMs?: number;
};

type Anim = { node: React.ReactNode; delays: number[]; cols: number };

// Transicion "mosaico" en UNA sola pasada, sin frame en blanco:
//  - El contenido NUEVO queda de base (define el alto, dinamico).
//  - El contenido VIEJO se dibuja encima y se "borra" de izquierda a derecha
//    (clip-path), revelando el nuevo por debajo.
//  - Una banda de cuadraditos viaja sobre ese borde para dar el efecto de
//    disgregacion y tapar el corte duro del wipe.
//
// Todo es animacion CSS de compositor (opacity/transform/clip-path). Las filas
// del mosaico son de alto FIJO en px (no 1fr), asi los cuadraditos siguen
// cuadrados aunque la tarjeta cambie de alto entre eventos. Respeta
// prefers-reduced-motion.
export function MosaicSwap({
  swapKey,
  children,
  className,
  tileSize = 20,
  coverMs = 420,
  spreadMs = 650
}: MosaicSwapProps) {
  const [shown, setShown] = useState<React.ReactNode>(children);
  const [anim, setAnim] = useState<Anim | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const childrenRef = useRef(children);
  const shownRef = useRef(shown);
  const prevKey = useRef(swapKey);

  childrenRef.current = children;
  shownRef.current = shown;

  useEffect(() => {
    if (prevKey.current === swapKey) return;
    prevKey.current = swapKey;

    const el = containerRef.current;
    const prefersReduced =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const oldNode = shownRef.current; // lo que se estaba mostrando pasa a ser la capa saliente
    const nextNode = childrenRef.current;
    shownRef.current = nextNode;
    setShown(nextNode); // el contenido nuevo queda de base

    if (!el || prefersReduced) {
      setAnim(null);
      return;
    }

    const cols = Math.max(1, Math.ceil(el.clientWidth / tileSize));
    const rows = Math.max(1, Math.ceil(el.clientHeight / tileSize) + 1);
    // Retardo por columna -> banda continua de un extremo al otro.
    const delays = Array.from({ length: cols * rows }, (_, i) => {
      const col = i % cols;
      return Math.round((col / Math.max(1, cols - 1)) * spreadMs + Math.random() * 40);
    });

    setAnim({ node: oldNode, delays, cols });

    const wave = coverMs + spreadMs;
    const done = window.setTimeout(() => setAnim(null), wave + 140);

    return () => window.clearTimeout(done);
  }, [swapKey, tileSize, coverMs, spreadMs]);

  const wave = coverMs + spreadMs;

  const tiles = useMemo(() => {
    if (!anim) return null;
    return anim.delays.map((delay, i) => (
      <span key={i} className="mosaic-tile" style={{ "--d": `${delay}ms` } as React.CSSProperties} />
    ));
  }, [anim]);

  return (
    <div ref={containerRef} className={className} style={{ position: "relative" }}>
      {shown}
      {anim ? (
        <>
          <div className="mosaic-old" style={{ "--wave": `${wave}ms` } as React.CSSProperties}>
            {anim.node}
          </div>
          <div
            className="mosaic-tiles"
            aria-hidden="true"
            style={
              {
                "--cover": `${coverMs}ms`,
                gridTemplateColumns: `repeat(${anim.cols}, 1fr)`,
                gridAutoRows: `${tileSize}px`
              } as React.CSSProperties
            }
          >
            {tiles}
          </div>
        </>
      ) : null}
    </div>
  );
}
