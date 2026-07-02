# SDD-016 Antirepeticion, Contexto Tectonico y Salida Multiformato

## Estado

Vigente para implementacion.

## Objetivo

Extender la capa editorial del canal sismico 24/7 con tres capacidades
adicionales:

1. Antirepeticion de locucion basada en historial reciente.
2. Contexto tectonico breve, util y no escolar por evento.
3. Salida multi-formato consistente para un mismo evento.

## Principio rector

> La IA puede variar el tono, el enfoque y los formatos, pero no debe alterar
> los hechos duros del sismo.

Esto implica:

1. `magnitud`, `profundidad`, `lugar normalizado`, `pais`, `source`,
   `latitude` y `longitude` siguen siendo deterministas.
2. DeepSeek recibe esos datos mas un historial reciente y devuelve solo capa
   editorial validada.
3. El contexto tectonico no se inventa libremente; debe derivar de una pista
   local o de una clasificacion determinista previa.

## Alcance

1. Enviar al backend editorial las ultimas `10-20` lineas emitidas.
2. Evitar repeticiones de aperturas y cierres en narraciones y segmentos.
3. Clasificar un contexto tectonico util por evento cuando haya confianza
   suficiente.
4. Devolver desde una sola llamada editorial:
   - `overlay`
   - `narration`
   - `ticker`
   - `cue`
5. Mostrar `overlay` y `ticker` en el lower-third del director.

## Exclusiones

1. Diagnosticar fallas geologicas especificas no verificadas.
2. Declarar replicas, danos, alertas, victimas, riesgo o evacuacion.
3. Reemplazar el feed operativo por una pieza social o promocional.

## Reglas funcionales

### RF-1601 Antirepeticion editorial

1. `POST /api/narration` debe aceptar `recentLines`.
2. `POST /api/segment` debe aceptar `recentLines`.
3. Las `recentLines` solo se usan para evitar repetir aperturas, remates y
   giros de estilo.
4. El historial local debe conservar como maximo 20 lineas emitidas.
5. El sistema debe evitar al menos la repeticion consecutiva exacta.

### RF-1602 Contexto tectonico breve

1. El sistema puede devolver `tectonicContext` solo si existe una pista
   tectonica local valida.
2. El contexto debe limitarse a una sola frase breve.
3. Debe priorizar formulaciones sobrias como:
   - `evento asociado al margen de subduccion del Pacifico`
   - `sismo continental superficial`
   - `sismo de foco intermedio`
4. Si no hay confianza suficiente, `tectonicContext` debe ser `null`.

### RF-1603 Salida multi-formato

1. `POST /api/narration` debe devolver formatos coherentes para un mismo evento:
   - `formats.overlay`
   - `formats.narration`
   - `formats.ticker`
2. `formats.overlay` debe ser mas corto que `formats.narration`.
3. `formats.ticker` debe ser apto para feed o crawl.
4. La web debe usar:
   - `overlay` en el texto principal del lower-third
   - `ticker` en la linea secundaria
   - `narration` para la voz

## Arquitectura objetivo

### 1. Historial editorial local

- Archivo objetivo: `apps/web/src/lib/editorialHistory.ts`
- Responsabilidad:
  - recordar lineas recientes
  - recortar a 20 entradas
  - exponer las ultimas lineas al orquestador editorial

### 2. Narracion enriquecida

- Archivo objetivo: `apps/api/src/services/narrationService.ts`
- Entradas nuevas:
  - `source`
  - `latitude`
  - `longitude`
  - `recentLines`
- Salida nueva:
  - `tectonicContext`
  - `formats.overlay`
  - `formats.narration`
  - `formats.ticker`

### 3. Director visual

- Archivo objetivo: `apps/web/src/lib/broadcastDirector.ts`
- Debe transportar `text`, `overlayText` y `tickerText`.

## Criterios de aceptacion

1. La API editorial acepta y usa `recentLines`.
2. La narracion fallback ya no repite siempre el mismo intro si el historial lo
   contiene.
3. Existe un `tectonicContext` breve y validado cuando hay pista suficiente.
4. La narracion editorial devuelve `overlay`, `narration` y `ticker`.
5. La web muestra `overlay` y `ticker` en el lower-third.
6. Hay pruebas automatizadas y `typecheck`, `tests` y `build` completan sin
   error.
