# VALIDATION-016 Antirepeticion, Contexto Tectonico y Salida Multiformato

## Resultado

Validacion aprobada localmente el 2 de julio de 2026.

La entrega amplifica la capa editorial del canal en tres frentes:

1. Antirepeticion basada en historial reciente.
2. Contexto tectonico breve cuando existe una pista local suficientemente
   segura.
3. Salida multi-formato por evento para `overlay`, `narration` y `ticker`.

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
- `apps/web`: 18 pruebas aprobadas, 0 fallidas.
- `apps/api`: build sin errores.
- `apps/web`: build Vite sin errores.

## Evidencia funcional

### Antirepeticion

- `recentLines` se envian desde web a `/api/narration` y `/api/segment`.
- El fallback local de narracion selecciona aperturas alternativas si la ultima
  linea reciente coincide con `Nuevo sismo detectado`.
- El historial local conserva como maximo 20 lineas y evita repeticion
  consecutiva exacta.

### Contexto tectonico

- `narrationService` deriva una pista tectonica local a partir de:
  - lugar normalizado
  - pais
  - profundidad
  - coordenadas
- Solo devuelve una frase breve o `null`.
- La frase se integra en `formats.narration` y puede aparecer tambien en
  `formats.overlay` cuando aporta.

### Salida multi-formato

- `/api/narration` devuelve:
  - `formats.overlay`
  - `formats.narration`
  - `formats.ticker`
- El director visual usa:
  - `overlayText` como texto principal
  - `tickerText` como linea secundaria del lower-third
  - `text` para la locucion

## Estado de aceptacion

| Criterio                                          | Estado   |
| ------------------------------------------------- | -------- |
| Historial editorial local operativo               | Aprobado |
| `recentLines` integradas a narracion y segmentos  | Aprobado |
| Contexto tectonico breve y opcional por evento    | Aprobado |
| Respuesta multi-formato desde narracion editorial | Aprobado |
| Lower-third consume `overlay` y `ticker`          | Aprobado |
| Typecheck, tests y build completan sin errores    | Aprobado |
