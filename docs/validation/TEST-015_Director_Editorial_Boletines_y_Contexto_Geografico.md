# TEST-015 Director Editorial, Boletines y Contexto Geografico

## Estado

Ejecutado y aprobado el 2 de julio de 2026 (America/Lima).

## Objetivo

Verificar el cumplimiento de `SDD-015` en tres capacidades:

1. Contexto geografico broadcast para voz y overlays.
2. Boletines automaticos por ventanas de 15, 30 y 60 minutos.
3. Pauta editorial con `cue` estructurado y ritmo de voz aplicado al TTS.

## Casos unitarios

| Id      | Caso                               | Resultado esperado                                      |
| ------- | ---------------------------------- | ------------------------------------------------------- |
| UT-1501 | `broadcastPlace` mar/adentro       | Convierte `Offshore` / `Off Coast` a lenguaje broadcast |
| UT-1502 | `broadcastPlace` sufijo ISO        | Convierte `Poland - PL` a `Polonia`                     |
| UT-1503 | Narracion de evento base           | Usa lugar broadcast y mantiene magnitud/profundidad     |
| UT-1504 | Narracion con cierre editorial     | Agrega remate sin alterar hechos                        |
| UT-1505 | Expresion hablada de kilometros    | Expande `km` a `kilometro(s)`                           |
| UT-1506 | Expresion hablada de EE. UU.       | Locuta `Estados Unidos`                                 |
| UT-1507 | Esquema de narracion editorial API | Acepta `normalizedPlace`, `country` y `mode`            |
| UT-1508 | Fallback editorial de narracion    | Devuelve `intro`, `closing` y `cue` locales             |
| UT-1509 | Esquema de segmento `boletin`      | Acepta ventana, conteos y areas activas                 |
| UT-1510 | Fallback de boletin                | Redacta `text + cue` local                              |

## Casos funcionales

| Id      | Caso                                 | Resultado esperado                                           |
| ------- | ------------------------------------ | ------------------------------------------------------------ |
| VF-1501 | Director frontend reconoce `boletin` | Overlay y contrato tipado aceptan el nuevo tipo              |
| VF-1502 | `/api/narration`                     | Responde `editorial` en vez de texto libre                   |
| VF-1503 | `/api/segment`                       | Responde `text + cue` para `resumen`, `educativo`, `boletin` |
| VF-1504 | Orquestador de voz                   | Mapea `cue` a `rate` / `playbackRate`                        |
| VF-1505 | TTS neural con cache                 | Reutiliza blobs y solo cambia velocidad de reproduccion      |

## Gates tecnicos

| Id      | Comando o verificacion          | Resultado esperado        |
| ------- | ------------------------------- | ------------------------- |
| VT-1501 | `npm run typecheck -w apps/api` | Sin errores               |
| VT-1502 | `npm run typecheck -w apps/web` | Sin errores               |
| VT-1503 | `npm run test -w apps/api`      | Sin fallas                |
| VT-1504 | `npm run test -w apps/web`      | Sin fallas                |
| VT-1505 | `npm run build -w apps/api`     | Sin errores               |
| VT-1506 | `npm run build -w apps/web`     | Sin errores               |
| VT-1507 | `git diff --check`              | Sin errores de whitespace |

## Evidencia requerida

1. Pruebas automatizadas actualizadas en `apps/api/test` y `apps/web/test`.
2. Typecheck y build exitosos en API y web.
3. Evidencia de que el contrato editorial deja los hechos duros del sismo en frontend.
4. Registro del fallback local para IA deshabilitada.
