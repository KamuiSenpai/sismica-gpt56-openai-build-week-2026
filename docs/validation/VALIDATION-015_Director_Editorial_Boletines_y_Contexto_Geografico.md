# VALIDATION-015 Director Editorial, Boletines y Contexto Geografico

## Resultado

Validacion aprobada localmente el 2 de julio de 2026.

La entrega incorpora tres mejoras editoriales para el canal sismico 24/7:

1. Lugar broadcast en espanol para voz y overlays.
2. Boletines automaticos por ventanas de 15, 30 y 60 minutos.
3. Pauta editorial estructurada con `intro`, `closing` y `cue` para modular la voz.

## Evidencia tecnica

Comandos ejecutados:

```powershell
npm run typecheck -w apps/api
npm run typecheck -w apps/web
npm run test -w apps/api
npm run test -w apps/web
npm run build -w apps/api
npm run build -w apps/web
```

Resultado observado:

- `apps/api`: typecheck sin errores.
- `apps/web`: typecheck sin errores.
- `apps/api`: 17 pruebas aprobadas, 0 fallidas.
- `apps/web`: 16 pruebas aprobadas, 0 fallidas.
- `apps/api`: build sin errores.
- `apps/web`: build Vite sin errores.

## Evidencia funcional

### Contexto geografico broadcast

- `Molucca Sea` se locuta como `Mar de Molucas`.
- `Offshore Valparaiso, Chile` se convierte a `Frente a la costa de Valparaiso, Chile`.
- `Poland - PL` se normaliza a `Polonia`.
- `91 km al sur de Sand Point, Alaska - EE. UU.` se locuta como `... Alaska, Estados Unidos`.

Cobertura automatizada:

- `apps/web/test/seismicSpeech.test.ts`

### Pauta editorial estructurada

- `POST /api/narration` ya no devuelve texto libre; devuelve `editorial`.
- `editorial` contiene `intro`, `closing` y `cue`.
- El frontend recompone la narracion con `buildSeismicNarration`, preservando `magnitud`, `profundidad` y lugar normalizado.
- El orquestador de voz aplica `cue` a `SpeechSynthesisUtterance.rate` y `HTMLAudioElement.playbackRate`.

Cobertura automatizada:

- `apps/api/test/narration.test.ts`
- `apps/web/src/lib/seismicVoice.ts`
- `apps/web/src/lib/seismicNeuralSpeech.ts`

### Boletines automaticos

- El director incorpora `boletin` como nuevo tipo de segmento.
- Las ventanas se evalúan con prioridad `60 > 30 > 15`.
- Cada boletin usa:
  - conteo actual
  - conteo de ventana previa
  - mayor magnitud y lugar broadcast
  - areas mas activas
- La API de segmentos devuelve `text + cue` para `boletin`, `resumen` y `educativo`.

Cobertura automatizada:

- `apps/api/test/segment.test.ts`
- `apps/web/src/lib/broadcastDirector.ts`

## Estado de aceptacion

| Criterio                                                     | Estado   |
| ------------------------------------------------------------ | -------- |
| Existe helper de lugar broadcast usable por voz y overlays   | Aprobado |
| `/api/narration` expone pauta editorial estructurada         | Aprobado |
| `/api/segment` expone `text + cue` y soporta `boletin`       | Aprobado |
| El director agenda boletines 15/30/60 con prioridad correcta | Aprobado |
| La voz del navegador y la neural aplican ritmo segun `cue`   | Aprobado |
| Typecheck, tests y build completan sin errores               | Aprobado |

## Riesgo residual

1. La calidad final de la pauta editorial depende de la disponibilidad de DeepSeek; el sistema ya cae a fallback local controlado.
2. La validacion de esta corrida cubre logica, contratos y build; la mezcla exacta de ritmo en una emision larga depende todavia del gusto editorial en vivo.
