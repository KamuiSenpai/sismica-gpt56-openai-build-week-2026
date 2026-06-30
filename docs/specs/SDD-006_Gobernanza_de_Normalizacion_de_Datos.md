# SDD-006 — Gobernanza de Normalización de Datos

**Estado:** vigente · **Ámbito:** ingesta multifuente + capa de presentación
**Objetivo:** garantizar que los datos sísmicos de fuentes heterogéneas (idioma, formato,
escalas) se presenten de forma **consistente y trazable**.

## 1. Problema

Cada fuente entrega el texto y las escalas en su propio idioma/convención:

| Fuente         | Lugar (ejemplo)                                     | Idioma              |
| -------------- | --------------------------------------------------- | ------------------- |
| USGS           | "290 km SE of Calama, Chile"                        | inglés              |
| EMSC           | "OFFSHORE COQUIMBO, CHILE"                          | inglés (mayúsculas) |
| BMKG           | "Pusat gempa berada di darat 35 km timur laut Sigi" | indonesio           |
| JMA            | "Off the Coast of Iwate Prefecture"                 | inglés              |
| IGP / FUNVISIS | región de Perú / Venezuela                          | español             |

Sin gobernanza, las tarjetas mezclan idiomas y formatos.

## 2. Principio

> **Normalizar la estructura en la ingesta; normalizar la presentación en una capa única.**

- **Estructura (backend):** todas las fuentes se mapean al esquema canónico
  `SeismicEvent` (`packages/shared`). Tiempo siempre en **UTC (ISO 8601)**; coordenadas en
  **WGS84**; profundidad en **km**; magnitud numérica + `magnitudeType`.
- **Presentación (frontend):** una capa única (`apps/web/src/lib/presentation.ts` +
  `countryGeocoder.ts`) decide cómo se muestra. Ningún componente formatea por su cuenta.

## 3. Reglas

### 3.1 País

- Se determina por **geocodificación inversa de coordenadas** (point-in-polygon sobre
  `public/data/countries.geojson`, Natural Earth 110m) → `countryCodeAt(lat, lon)`.
- Respaldo para sismos **mar adentro** (sin polígono): deducción por **fuente** (redes
  nacionales) o por el **texto** del lugar → `countryCode(event)`.
- Resolución final: `resolveCountryCode(event) = countryCodeAt(...) ?? countryCode(event)`.
- El nombre del país se muestra **siempre en español** (`COUNTRY_NAMES_ES`).

### 3.2 Lugar

- Formato único: `«{descriptor de la fuente} · {País en español}»` (`normalizedPlace`).
- El descriptor de la fuente se conserva (no se traduce la prosa); el **país** es el
  ancla consistente e idioma-neutral.
- _Pendiente (mejora futura):_ descriptor 100% en español vía dataset de ciudades +
  rumbo/distancia ("a 35 km al NE de Sigi").

### 3.3 Intensidad

- Las escalas **no se mezclan** (son físicamente distintas):
  - `mmi` / `cdi` → **MMI** (Mercalli) en números romanos: `"MMI IV"`, `"MMI V (DYFI)"`.
  - `intensityText` (p. ej. **shindo** de la JMA) se muestra **etiquetado**: `"JMA 3"`.
  - Sin dato → `"Sin dato"`.
- Implementado en `normalizedIntensity(event)`.

### 3.4 Magnitud

- Texto `M{n.n}` (`formatMagnitude`); color por banda de magnitud (`magnitudeCssColor`,
  mismas clases que los puntos del globo). La magnitud **no** define la velocidad de las
  ondas (solo energía).

### 3.5 Tiempo

- Siempre **UTC** y formato `DD/MM/AAAA HH:MM:SS` (`formatUtcDateTime`).

## 4. Validación (gobernanza de entrada)

- **Zod** valida variables de entorno al arrancar (`config/env.ts`) y la **estructura** de
  cada respuesta externa antes de persistir (`providers/schemas.ts` + `assertShape`).
- Ver SDD de integración multifuente para el contrato `SeismicProvider`.

## 5. Cómo añadir una fuente (checklist)

1. Provider que mapee al esquema `SeismicEvent` (tiempo UTC, profundidad km, etc.).
2. Esquema Zod de su payload + `assertShape`.
3. Si es red nacional, registrar su país en `SOURCE_COUNTRY`.
4. No formatear lugar/intensidad en el provider: eso lo hace la capa de presentación.
5. `SourceCode` en `packages/shared` + intervalo en `SOURCE_INTERVALS_MS`.

## 6. Gobernanza de código

- TypeScript (contratos), ESLint + Prettier, hook de pre-commit (lint-staged).
