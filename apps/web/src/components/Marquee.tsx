import { useEffect, useRef, useState } from "react";

type MarqueeProps = {
  text: string;
  className?: string;
  /** px por segundo del desplazamiento */
  speed?: number;
};

// Muestra `text` en una sola linea y lo desplaza horizontalmente (ping-pong)
// SOLO cuando no cabe en su contenedor. Si cabe, queda estatico. Mide el
// desborde real con ResizeObserver y respeta prefers-reduced-motion.
export function Marquee({ text, className, speed = 45 }: MarqueeProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0); // px a desplazar; 0 = cabe (sin animar)

  useEffect(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;

    const measure = () => {
      const overflow = inner.scrollWidth - container.clientWidth;
      setShift(overflow > 4 ? overflow : 0);
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [text]);

  const prefersReduced =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const animate = shift > 0 && !prefersReduced;

  return (
    <span ref={containerRef} className={className ? `marquee ${className}` : "marquee"}>
      <span
        // key por texto: cada evento reinicia el desplazamiento desde el inicio
        key={text}
        ref={innerRef}
        className={animate ? "marquee-inner is-scrolling" : "marquee-inner"}
        style={
          animate
            ? ({ "--shift": `-${shift}px`, "--dur": `${Math.max(3, shift / speed)}s` } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </span>
  );
}
