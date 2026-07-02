import { useState } from "react";
import { type SeismicEvent } from "@sismica/shared";

import { resolveCountryCode } from "../lib/countryGeocoder";

type CountryFlagProps = {
  event?: SeismicEvent;
  code?: string | null; // codigo ISO2 explicito (tiene prioridad sobre la geo del evento)
  className?: string;
  style?: React.CSSProperties;
};

// Imagen de bandera (flagcdn). Los emoji de bandera no se renderizan en Windows,
// por eso usamos una imagen. Como contingencia, si la CDN falla, se muestra un globo.
export function CountryFlag({ event, code: codeOverride, className, style }: CountryFlagProps) {
  const [error, setError] = useState(false);
  const code = codeOverride ?? (event ? resolveCountryCode(event) : null);

  if (!code || error) {
    return (
      <span
        className={className}
        style={{
          ...style,
          fontSize: style?.height ?? "1rem",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center"
        }}
        aria-hidden="true"
      >
        🌐
      </span>
    );
  }

  return (
    <img
      className={className ? `flag-img ${className}` : "flag-img"}
      style={style}
      src={`/flags/${code}.svg`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setError(true)}
    />
  );
}
