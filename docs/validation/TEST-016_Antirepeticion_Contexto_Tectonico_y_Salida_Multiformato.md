# TEST-016 Antirepeticion, Contexto Tectonico y Salida Multiformato

## Estado

Ejecutado y aprobado el 2 de julio de 2026 (America/Lima).

## Objetivo

Verificar el cumplimiento de `SDD-016` sobre historial editorial, contexto
tectonico breve y salida multi-formato.

## Casos unitarios

| Id      | Caso                              | Resultado esperado                                   |
| ------- | --------------------------------- | ---------------------------------------------------- |
| UT-1601 | Esquema de narracion enriquecido  | Acepta `source`, coordenadas y `recentLines`         |
| UT-1602 | Fallback anti-repeticion          | No reutiliza el intro inmediato previo               |
| UT-1603 | Narracion multi-formato fallback  | Devuelve `overlay`, `narration` y `ticker`           |
| UT-1604 | Esquema de segmento con historial | Acepta `recentLines`                                 |
| UT-1605 | Lower-third director              | Acepta `overlayText` y `tickerText`                  |
| UT-1606 | Historial editorial local         | Conserva maximo 20 lineas y evita consecutivo exacto |

## Gates tecnicos

| Id      | Comando o verificacion          | Resultado esperado |
| ------- | ------------------------------- | ------------------ |
| VT-1601 | `npm run typecheck -w apps/api` | Sin errores        |
| VT-1602 | `npm run typecheck -w apps/web` | Sin errores        |
| VT-1603 | `npm run test -w apps/api`      | Sin fallas         |
| VT-1604 | `npm run test -w apps/web`      | Sin fallas         |
| VT-1605 | `npm run build -w apps/api`     | Sin errores        |
| VT-1606 | `npm run build -w apps/web`     | Sin errores        |

## Evidencia requerida

1. Pruebas API con `recentLines`.
2. Pruebas web con narrativa y lugar broadcast.
3. Build y typecheck en verde.
4. Evidencia visual del lower-third con linea secundaria lista para ticker.
