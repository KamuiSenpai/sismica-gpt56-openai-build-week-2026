import { type SeismicEvent } from "@sismica/shared";

import { resolveCountryCode } from "../lib/countryGeocoder";

type CountryFlagProps = {
  event: SeismicEvent;
  className?: string;
};

// Imagen de bandera (flagcdn). Los emoji de bandera no se renderizan en Windows,
// por eso usamos una imagen. Si no se reconoce el pais, muestra un globo.
export function CountryFlag({ event, className }: CountryFlagProps) {
  const code = resolveCountryCode(event);
  if (!code) {
    return (
      <span className={className} aria-hidden="true">
        🌐
      </span>
    );
  }
  return (
    <img
      className={className ? `flag-img ${className}` : "flag-img"}
      src={`https://flagcdn.com/${code}.svg`}
      alt=""
      aria-hidden="true"
      loading="lazy"
    />
  );
}
