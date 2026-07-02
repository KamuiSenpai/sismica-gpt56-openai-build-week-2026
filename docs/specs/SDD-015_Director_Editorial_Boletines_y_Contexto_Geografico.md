# SDD-015 Director Editorial, Boletines y Contexto Geografico

## Estado

Vigente para implementacion.

## Documentos fuente

Esta especificacion deriva de:

1. `output/doc/01_Informe_de_Alcance_y_Diseno_Funcional_de_la_Plataforma_de_Visualizacion_Sismica.docx`
2. `output/doc/02_Informe_Tecnico_de_Arquitectura_Desarrollo_y_Entorno_WSL2_de_la_Plataforma_de_Visualizacion_Sismica.docx`
3. `docs/specs/SDD-002_Interfaz_Operativa_de_Monitoreo_Sismico.md`
4. `docs/specs/SDD-006_Gobernanza_de_Normalizacion_de_Datos.md`

## Objetivo

Elevar el canal sismico 24/7 a una presentacion mas apta para YouTube en vivo,
con tres mejoras coordinadas:

1. Contexto geografico util y comprensible para audiencia general.
2. Boletines automaticos por ventanas de 15, 30 y 60 minutos.
3. Pauta editorial con ritmo de voz, tono y urgencia para evitar una locucion
   fria o plana.

## Alcance

1. Transformar lugares ya normalizados a lenguaje de broadcast cuando la forma
   cruda sea poco natural (`offshore`, `off coast of`, `NNW of`, etc.).
2. Generar boletines de 15, 30 y 60 minutos con datos ya normalizados del
   sistema.
3. Usar DeepSeek para devolver metadatos editoriales estructurados en JSON.
4. Aplicar esos metadatos a la locucion neural y al respaldo del navegador.
5. Mantener fallback determinista cuando DeepSeek falle o exceda limite.

## Exclusiones

1. Permitir que la IA cambie magnitud, profundidad, hora, fuente o pais.
2. Declarar daños, replicas, tsunami, alertas o evacuaciones no confirmadas.
3. Convertir el sistema en un emisor oficial de proteccion civil.
4. Sustituir los boletines oficiales de tsunami o autoridades nacionales.

## Principio rector

> La IA redacta y prioriza; los hechos duros siguen saliendo del dato
> normalizado y trazable.

Esto implica:

1. `magnitud`, `profundidad`, `eventTimeUtc`, `source` y banderas operativas
   siguen siendo deterministas.
2. DeepSeek solo puede intervenir en:
   - `intro`
   - `remate`
   - `urgency`
   - `rhythm`
   - `tone`
   - `texto editorial` de segmentos y boletines
3. El contexto geografico broadcast puede resolverse por reglas locales y usar
   DeepSeek solo como capa editorial alrededor de ese dato.

## Arquitectura objetivo

### 1. Capa geografica de broadcast

- Ubicacion base: `title` ya normalizado + `countryCode` / `countryNameEs`.
- Capa de presentacion: `apps/web/src/lib/presentation.ts`.
- Salida objetivo:
  - `Offshore Valparaiso, Chile` -> `Frente a la costa de Valparaiso, Chile`
  - `91 km S of Sand Point, Alaska` -> `91 km al sur de Sand Point, Alaska`
  - `Molucca Sea` -> `Mar de Molucas`

### 2. Capa editorial de narracion

- Endpoint: `POST /api/narration`
- Entrada: evento + contexto editorial (`mode`, `normalizedPlace`, `country`).
- Salida JSON:
  - `intro`
  - `closing`
  - `urgency`
  - `rhythm`
  - `tone`
- El frontend reconstruye el texto final con datos deterministas.

### 3. Capa editorial de segmentos

- Endpoint: `POST /api/segment`
- Entrada:
  - `educativo`
  - `resumen`
  - `boletin`
  - `recomendacion` legado
- Salida JSON:
  - `text`
  - `cue.urgency`
  - `cue.rhythm`
  - `cue.tone`

### 4. Capa de director 24/7

- `apps/web/src/lib/broadcastDirector.ts`
- Responsabilidades nuevas:
  1. Insertar boletin de 15 minutos si corresponde.
  2. Escalar a boletin de 30 minutos cuando esa ventana venza.
  3. Escalar a boletin de 60 minutos cuando esa ventana venza.
  4. Aplicar `cue` a la locucion y al tiempo minimo del overlay.

## Reglas funcionales

### RF-1501 Contexto geografico broadcast

1. Si la ubicacion cruda empieza con `Offshore`, debe locutarse como
   `frente a la costa de ...`.
2. Si la ubicacion cruda expresa `Off Coast of ...`, debe locutarse como
   `frente a la costa de ...`.
3. Si la ubicacion expresa `Near Coast of ...`, debe locutarse como
   `cerca de la costa de ...`.
4. Si la ubicacion termina en un pais o territorio en ingles, debe mostrarse y
   locutarse en espanol.
5. La salida no debe usar el separador visual `·` en la voz.

### RF-1502 Boletines por ventana

1. El sistema debe generar boletines rodantes de 15, 30 y 60 minutos.
2. Cada boletin debe usar:
   - total de sismos de la ventana actual
   - total de la ventana anterior equivalente
   - delta entre ambas
   - mayor magnitud de la ventana
   - lugar broadcast del mayor evento
   - zonas o paises mas activos
3. Cuando varias ventanas venzan al mismo tiempo, la prioridad es:
   `60 > 30 > 15`.
4. Un boletin de 60 minutos reinicia tambien el reloj editorial de 30 y 15
   minutos para evitar saturacion consecutiva.

### RF-1503 Pauta editorial y ritmo de voz

1. DeepSeek debe devolver `urgency`, `rhythm` y `tone` como JSON estructurado.
2. El sistema debe mapear esos valores a velocidad de locucion.
3. Los eventos `breaking` o `nuevo sismo detectado` deben tender a una locucion
   mas agil que los contextos.
4. Los contextos y educativos deben sonar mas sobrios y lentos.
5. Ante fallo de IA, el sistema debe usar un perfil editorial local por tipo de
   segmento.

## API

### `POST /api/narration`

Body:

```json
{
  "eventId": "USGS:abcd",
  "title": "M3.5 - Molucca Sea",
  "normalizedPlace": "Mar de Molucas",
  "country": "Indonesia",
  "magnitude": 3.5,
  "depthKm": 75,
  "mode": "breaking"
}
```

Response:

```json
{
  "editorial": {
    "intro": "Nuevo sismo detectado",
    "closing": "Seguimos monitoreando la zona.",
    "cue": {
      "urgency": "alta",
      "rhythm": "agil",
      "tone": "directo"
    }
  }
}
```

### `POST /api/segment`

Body boletin:

```json
{
  "kind": "boletin",
  "windowMinutes": 15,
  "currentCount": 8,
  "previousCount": 5,
  "biggestMagnitude": 4.8,
  "biggestPlace": "Frente a la costa de Taiwan",
  "activeAreas": ["Indonesia", "Chile", "Turquia"],
  "regionalFocus": "Indonesia"
}
```

Response:

```json
{
  "text": "Boletin de 15 minutos: ...",
  "cue": {
    "urgency": "media",
    "rhythm": "agil",
    "tone": "directo"
  }
}
```

## Trazabilidad

| Requisito | Implementacion objetivo                                            | Validacion                     |
| --------- | ------------------------------------------------------------------ | ------------------------------ |
| RF-1501   | `presentation.ts`, `seismicSpeech.ts`                              | pruebas web de lugar broadcast |
| RF-1502   | `broadcastDirector.ts`, `segmentService.ts`, `api.ts`              | tests API + build web          |
| RF-1503   | `narrationService.ts`, `seismicVoice.ts`, `seismicNeuralSpeech.ts` | tests + demo de voz            |

## Riesgos

1. Una redaccion IA demasiado libre puede sonar natural pero perder precision.
2. Un exceso de boletines puede saturar la emision si no se controla la
   prioridad.
3. Un `playbackRate` demasiado alto puede degradar inteligibilidad.

## Mitigaciones

1. Limitar la IA a JSON estructurado y validar con `zod`.
2. Mantener fallback local por tipo de segmento.
3. Aplicar velocidad dentro de un rango corto y controlado.

## Criterios de aceptacion

1. Existe un helper de lugar broadcast usable por voz y boletines.
2. El director puede emitir boletines de 15, 30 y 60 minutos sin romper el
   recorrido ni el relevo.
3. `POST /api/narration` y `POST /api/segment` exponen cue editorial
   estructurado.
4. La web aplica el cue editorial a la locucion neural y al respaldo del
   navegador.
5. Hay pruebas automatizadas para la logica critica.
6. `typecheck`, `tests` y `build` completan sin error.
