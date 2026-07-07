# Revisión de arquitectura — Plataforma de visualización sísmica

Fecha: 2026-07 · Alcance: revisión técnica del sistema completo y backlog priorizado de mejoras.
Naturaleza: evaluación honesta de ingeniería, no auditoría formal. Las referencias a archivos son
orientativas (el código evoluciona rápido).

---

## 1. Resumen ejecutivo

El sistema es un **directo sísmico 24/7**: ingesta multi-fuente normalizada a Postgres, stream a una
web React con globo 3D (Cesium), y un "director" editorial por IA que conduce la emisión (recorrido,
boletines, resúmenes, educativos, relevos entre 6 voces clonadas) con TTS neural y música ambiental.

**Veredicto:** producto ambicioso y **funcional de punta a punta**, con muy buena _degradación
elegante_ (cascadas de fallback en IA y voz). El desbalance principal es que **la funcionalidad
crece más rápido que la infraestructura que la sostiene**: la mayoría de las incidencias operativas
recientes no fueron de lógica de negocio sino de _operación_ (servicios caídos, puertos zombie, el
worker que muere en silencio). Ahí está el mayor retorno de inversión.

## 2. Topología (estado actual)

| Componente                  | Ubicación                 | Puerto | Notas                                             |
| --------------------------- | ------------------------- | ------ | ------------------------------------------------- |
| Web (React + Vite + Cesium) | `apps/web`                | 5173   | SPA; consume SSE + REST del API                   |
| API (Node)                  | `apps/api`                | 3000   | REST + SSE; proxy de TTS; editorial IA (DeepSeek) |
| Worker (ingesta)            | `apps/worker`             | —      | Poll multi-fuente + motor sísmico                 |
| Postgres (embebido)         | `.runtime/pgsql16`        | 5433   | No dockerizado; arranca por `pg_ctl`              |
| TTS XTTS-v2                 | `services/tts-xtts`       | 8090   | Python/FastAPI + CUDA                             |
| TTS Chatterbox              | `services/tts-chatterbox` | 8091   | Python/FastAPI + CUDA (motor nuevo, MIT)          |
| Compartido                  | `packages/shared`         | —      | tipos/constantes; se compila a `dist/`            |

Dependencias externas: **DeepSeek** (editorial IA), fuentes sísmicas oficiales (USGS, IGN, SSN,
CSN, INGV, IGEPN, JMA, GDACS, NOAA…).

## 3. Fortalezas

- **Degradación elegante en todo el pipeline**: DeepSeek→plantilla local, neural→navegador,
  health-gating de motores, dedup y antirrepetición. El directo casi nunca "se queda mudo".
- **Normalización multi-fuente** (lugares, direcciones, países, tsunamis): problema intrínsecamente
  feo, resuelto con cuidado (`broadcastPlace`, expansión de direcciones, mapeo de países).
- **Separación en microservicios** (TTS aislado, worker de ingesta, `packages/shared`).
- **Orquestación de arranque ya madura** (`scripts/start-all.ps1`): orden de dependencias, esperas
  por health de puerto, exclusión de GPU y activación de motor vía `/api/tts/engine`.
- Foco real en **calidad percibida** (naturalidad de voz, puntuación hablada, tono editorial).

## 4. Backlog priorizado

Escala: Impacto (Alto/Medio/Bajo) · Esfuerzo (S=días, M=1-2 semanas, L=>2 semanas).

### P1 — Robustez operativa (Impacto Alto)

**P1.1 · Watchdog / reinicio automático ante caídas — Impacto Alto · Esfuerzo S**
`start-all.ps1` arranca en orden y espera por puerto, pero cada servicio queda en su ventana y **si
uno muere, nadie lo revive** (caso clásico: el worker sale si la DB no está y `tsx watch` no lo
resucita; o una ventana que crashea queda muerta). Falta un supervisor que vigile por _health_ (no
solo puerto abierto) y **reinicie** el que caiga.
Recomendación (ajustada a tu stack Windows + GPU + Postgres embebido — **no Docker**): un
`scripts/watchdog.ps1` aditivo que sondee `/health`/puertos y relance el servicio caído con su mismo
comando; readiness por HTTP, no solo TCP; limpieza de puertos zombie (5173-5175) al arrancar.

**P1.2 · Readiness real y limpieza de puertos — Impacto Medio · Esfuerzo S**
"Puerto abierto" ≠ "sano" (p. ej. API arriba pero sin DB). Sondear endpoints `/health` reales.
Añadir limpieza previa de sockets zombie (el incidente de 5173-5175 se repetirá sin esto).

**P1.3 · Observabilidad mínima — Impacto Alto · Esfuerzo M**
Hoy se diagnostica con `tail` de logs y `curl` manual. Para un 24/7 es volar a ciegas. Faltan
métricas de: latencia/errores de DeepSeek, latencia/fallos de síntesis TTS, **tasa de fallback de
motor**, lag de ingesta por fuente, salud del stream SSE. Empezar por logging estructurado + una
página/endpoint de estado (extendiendo la idea de `SourceStatusCard` a toda la tubería).

### P2 — Mantenibilidad del núcleo (Impacto Alto)

**P2.1 · Unificar la seguridad editorial (dejar el whack-a-mole) — Impacto Alto · Esfuerzo M**
Cada mejora editorial terminó en _otro regex_ (pausa, comercial, institucional, "nuevo sismo",
"información en desarrollo"…) y ese patrón vive **duplicado en 3 archivos**
([narrationService.ts](../apps/api/src/services/narrationService.ts),
[segmentService.ts](../apps/api/src/services/segmentService.ts),
[seismicVoice.ts](../apps/web/src/lib/seismicVoice.ts)) → deriva garantizada.
Recomendación: (a) **un único módulo validador editorial** compartido con su suite de frases-malas;
(b) mejor aún, **constreñir la salida de DeepSeek estructuralmente** (JSON schema con enums para
aperturas _y_ cierres; hacer que _elija_ de sets curados en vez de generar texto libre — ya iniciado
con los remates). Menos superficie que vigilar, más confianza.

**P2.2 · Extraer el orquestador del director a una FSM explícita — Impacto Alto · Esfuerzo M**
El director es hoy una máquina de estados _implícita_ sobre `setInterval(500ms)` + `busyRef` (mutex
manual) + varios `lastXAtRef` en [broadcastDirector.ts](../apps/web/src/lib/broadcastDirector.ts), y
App.tsx suma otro watcher a 400 ms. Es frágil (los bugs de "eco"/saltos costaron caro) y difícil de
testear. Recomendación: FSM en un **módulo TS puro**, disparada por el evento `ended` del audio (ya
existen las promesas), no por polling; el hook de React como adaptador fino.

**P2.3 · Cobertura de integración/contrato — Impacto Alto · Esfuerzo M**
Todo test es de función pura. Las partes que más rompen — director, cascada de voz, `/api/tts` +
health, stream SSE, swap de VRAM — tienen **cero cobertura automatizada**. Síntoma: los bugs de
eco/repetición/puntuación **los cazaron usuarios, no tests**. Añadir: test de contrato de la cascada
de motores, test del FSM del director (cuando exista) y un smoke end-to-end (Playwright).

### P3 — Higiene y sostenibilidad (Impacto Medio)

- **P3.1 · Data-layer del front en React Query** (ya es dependencia; App.tsx tiene mucho `ref`
  manual). Impacto Medio · Esfuerzo M.
- **P3.2 · Zod en todo el `env`** (parcial hoy; el backlog de endurecimiento ya lo contempla).
  Impacto Medio · Esfuerzo S.
- **P3.3 · Secretos**: rotar claves expuestas, sacar secretos de `.env` para prod (gestor de
  secretos). Impacto Medio · Esfuerzo S.
- **P3.4 · Costo/latencia de DeepSeek en 24/7**: hay caché (memoria+disco) y rate-limit — bien;
  monitorear gasto y pre-cachear más agresivo. Impacto Medio · Esfuerzo S.
- **P3.5 · TTS en GPU de escritorio**: 4 GB compartidos con apps; el swap de VRAM es un _hack_
  ingenioso pero frágil. A futuro, **host/GPU dedicado** para inferencia. Impacto Medio · Esfuerzo L.

## 5. Riesgos transversales

- **Confianza editorial**: producto público que informa sobre sismos. Los filtros anti-afirmaciones
  (daños, alertas, tsunami) van en la dirección correcta, pero son regex y podrían dejar pasar o
  recortar de más. Mantener el _disclaimer_ visible y considerar humano-en-el-loop para breaking de
  gran magnitud.
- **Punto único de GPU**: con XTTS deshabilitado y Chatterbox como único motor, si Chatterbox cae el
  respaldo salta a la voz del navegador. Aceptable, pero conviene decidirlo conscientemente.

## 6. Hoja de ruta sugerida

1. **P1.1 + P1.2** (watchdog + readiness/limpieza): quita el dolor operativo de inmediato. _Empezar aquí._
2. **P2.1** (validador editorial unificado): frena la deriva de regex antes de que crezca más.
3. **P2.3** (tests de contrato) en paralelo, para blindar lo que se toque.
4. **P2.2** (FSM del director): la refactor estructural mayor, detrás de los tests.
5. **P1.3** (observabilidad) para operar el 24/7 con datos.

**Meta:** pasar de "funciona cuando lo cuido a mano" a "funciona solo y no da miedo tocarlo".
