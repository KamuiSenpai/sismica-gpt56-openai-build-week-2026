# SDD-017 Automatizacion de Chat de YouTube para Sismos Nuevos

## Estado

Aprobado.

## Documentos fuente

Esta especificacion deriva de:

1. `output/doc/01_Informe_de_Alcance_y_Diseno_Funcional_de_la_Plataforma_de_Visualizacion_Sismica.docx`
2. `output/doc/02_Informe_Tecnico_de_Arquitectura_Desarrollo_y_Entorno_WSL2_de_la_Plataforma_de_Visualizacion_Sismica.docx`
3. `docs/specs/SDD-001_Plataforma_Funcional_de_Visualizacion_Sismica.md`
4. `docs/specs/SDD-002_Interfaz_Operativa_de_Monitoreo_Sismico.md`
5. `docs/specs/SDD-003_Integracion_Multifuente_y_Deduplicacion_Sismica.md`
6. `docs/specs/SDD-006_Gobernanza_de_Normalizacion_de_Datos.md`
7. `docs/specs/SDD-015_Director_Editorial_Boletines_y_Contexto_Geografico.md`
8. `docs/specs/SDD-016_Antirepeticion_Contexto_Tectonico_y_Salida_Multiformato.md`

## Objetivo

Agregar un modulo server-side que publique en el chat del directo de YouTube
mensajes automaticos solo para sismos realmente nuevos detectados por la
plataforma, sin repetir actualizaciones del mismo evento, sin emitir contexto
editorial largo y sin depender del navegador, OBS ni acciones manuales.

## Alcance

1. Detectar la primera aparicion operativa de un sismo ya deduplicado por la
   plataforma.
2. Generar un mensaje breve y determinista para chat con magnitud, lugar,
   profundidad, fuente y un tratamiento visual sobrio para YouTube 24/7.
3. Publicar ese mensaje en el `liveChatId` del directo activo usando la API
   oficial de YouTube.
4. Persistir una cola de salida y el estado de publicacion para trazabilidad y
   antirepeticion.
5. Exponer estado operativo y herramientas minimas de prueba para el operador.
6. Aplicar limites de frecuencia, frescura y saturacion para evitar spam.
7. Permitir modos `off`, `dry-run` y `live`.
8. Permitir mensajes promocionales de bajo peso para pedir `like` sin romper la
   prioridad de sismo nuevo.

## Exclusiones

1. Publicar mensajes educativos o de continuidad editorial.
2. Publicar transcripciones de Chatterbox o contenido del Director IA.
3. Moderar mensajes de usuarios o responder en el chat.
4. Crear, terminar, editar o programar transmisiones de YouTube.
5. Buscar noticias externas o redactar boletines periodisticos en el chat.
6. Publicar actualizaciones del mismo sismo despues del primer mensaje.
7. Ejecutar la integracion desde frontend, browser source u OBS.

## Principio rector

> El chat anuncia novedad operacional. La narracion editorial sigue viviendo en
> Director IA y Chatterbox.

Esto implica:

1. Un mensaje de chat representa una sola alta nueva del evento canonico.
2. El texto del chat se arma con datos deterministas ya normalizados.
3. Si el chat no esta disponible, el sistema falla en silencio y registra la
   causa; no improvisa rutas alternativas.
4. El operador puede configurar YouTube para que solo el bot escriba, pero esa
   restriccion pertenece a YouTube Studio y no al producto.

## Dependencias operativas

1. La transmision debe tener `chat en directo` habilitado.
2. La transmision no debe estar marcada como `creado para ninos`.
3. Debe existir una cuenta autorizada del canal con `OAuth refresh token`
   valido para publicar en el chat.
4. Si se desea modo "solo bot", el operador debe usar `usuarios aprobados` en
   YouTube y aprobar la cuenta del bot.

## Arquitectura objetivo

### 1. Detector de novedad en `worker`

- Ubicacion prevista: `apps/worker/src/services`.
- El `worker` ya observa la ingesta real y es el lugar correcto para detectar
  que un evento entra por primera vez en el flujo vivo.
- La deteccion debe usar el identificador canonico deduplicado por la
  plataforma, no el identificador crudo del proveedor.

### 2. Outbox persistente de chat

- Ubicacion prevista: `apps/worker/src/db` y `apps/api/src/services`.
- El detector no publica directamente contra YouTube.
- Primero escribe una fila en una cola persistente para desacoplar:
  - deteccion de novedad
  - politica de ritmo
  - entrega externa a YouTube
- La cola debe sobrevivir reinicios de procesos.

### 3. Publicador de YouTube

- Ubicacion prevista: `apps/worker/src/services/youtubeChatPublisher.ts`.
- Un lazo operativo toma items `pending`, resuelve el `liveChatId` del directo
  activo, publica y marca el resultado.
- El `liveChatId` puede cachearse por una ventana corta para reducir trafico a
  la API, pero debe invalidarse si YouTube responde que el chat ya no existe.

### 4. API operativa

- Ubicacion prevista: `apps/api/src/app.ts` y `apps/api/src/routes`.
- Debe exponer estado, ultimos mensajes y prueba manual sin credenciales en el
  navegador.
- El frontend solo consulta estado; nunca debe contener `client_secret`,
  `refresh_token` ni logica de publicacion.

### 5. Configuracion de entorno

- Ubicacion prevista: `apps/api/src/config/env.ts` y `apps/worker/src/config`.
- Variables minimas previstas:
  - `YOUTUBE_CHAT_ENABLED`
  - `YOUTUBE_CHAT_MODE`
  - `YOUTUBE_CHAT_CLIENT_ID`
  - `YOUTUBE_CHAT_CLIENT_SECRET`
  - `YOUTUBE_CHAT_REFRESH_TOKEN`
  - `YOUTUBE_CHAT_CHANNEL_ID`
  - `YOUTUBE_CHAT_MIN_INTERVAL_MS`
  - `YOUTUBE_CHAT_MAX_EVENT_AGE_MINUTES`
  - `YOUTUBE_CHAT_MAX_QUEUE_SIZE`
  - `YOUTUBE_CHAT_STALE_QUEUE_MS`
  - `YOUTUBE_CHAT_PROMOTIONAL_ENABLED`
  - `YOUTUBE_CHAT_PROMOTIONAL_MIN_INTERVAL_MS`

## Modelo de datos

Se agrega una tabla operativa:

### `youtube_chat_messages`

Campos minimos:

1. `id`
2. `canonical_event_id`
3. `provider_event_id`
4. `message_text`
5. `message_kind`
6. `status`
7. `skip_reason`
8. `attempts`
9. `event_time_utc`
10. `first_seen_at_utc`
11. `enqueued_at_utc`
12. `posted_at_utc`
13. `last_attempt_at_utc`
14. `youtube_broadcast_id`
15. `youtube_live_chat_id`
16. `youtube_message_id`
17. `payload_json`

Restricciones:

1. `canonical_event_id` debe ser unico para `message_kind='new_event'`.
2. `message_kind` permitido:
   - `new_event`
   - `manual_test`
   - `promotional_like`
3. `status` permitido:
   - `pending`
   - `posted`
   - `skipped`
   - `failed`
4. `skip_reason` permitido:
   - `duplicate_event`
   - `stale_event`
   - `stale_queue`
   - `no_active_broadcast`
   - `chat_disabled`
   - `rate_limited`
   - `queue_overflow`
   - `manual_off`
   - `api_error`

## Reglas funcionales

### RF-1701 Deteccion de sismo nuevo

1. El modulo solo debe publicar un mensaje cuando el evento canonico entra por
   primera vez al flujo vivo del sistema.
2. Una actualizacion posterior del mismo evento no debe generar un segundo
   mensaje.
3. Un duplicado multifuente reconciliado al mismo evento canonico no debe
   generar un segundo mensaje.
4. Eventos historicos o demasiado antiguos al momento de ser vistos por primera
   vez deben omitirse.
5. El limite inicial de frescura debe ser configurable y por defecto de
   `20 minutos`.

### RF-1702 Formato del mensaje

1. El mensaje debe ser breve, serio y determinista.
2. El mensaje no debe exceder `180 caracteres` salvo que YouTube exija un
   ajuste distinto.
3. El lugar debe usar la capa de presentacion broadcast ya definida por el
   sistema.
4. El mensaje no debe declarar danos, replicas, tsunami, alertas, evacuaciones
   ni contexto no verificado.
5. Plantilla base para sismo nuevo:

```text
🌎🇲🇽 [NUEVO SISMO] M4.0 | Puerto Escondido, Oaxaca, Mexico | 28 km | Fuente: SSN
```

6. Regla de terremoto:

```text
🚨🌎🇨🇱 [TERREMOTO] M6.4 | Norte de Chile | 42 km | Fuente: CSN
```

7. Si falta profundidad o fuente, el mensaje puede omitir ese fragmento, pero
   no inventarlo.
8. La bandera del pais es opcional y solo se usa cuando el pais es claro.

### RF-1703 Cola y ritmo

1. El sistema debe respetar un intervalo minimo entre mensajes consecutivos.
2. El valor inicial recomendado es `12000 ms`.
3. Si entran varios sismos dentro de la ventana de enfriamiento, deben quedar
   en cola.
4. La cola debe deduplicar por `canonical_event_id`.
5. Si la cola supera su capacidad maxima, deben descartarse primero los items
   mas antiguos y dejar trazabilidad del descarte.
6. Si un item permanece demasiado tiempo en cola y pierde oportunidad
   operacional, debe marcarse `stale_queue` y no publicarse.
7. Los mensajes `new_event` tienen prioridad dura sobre `manual_test` y
   `promotional_like`.
8. Los mensajes `promotional_like` solo pueden entrar cuando no hay backlog de
   sismos nuevos y deben espaciarse por una ventana mucho mayor que la de
   enfriamiento general.

### RF-1704 Resolucion del chat activo

1. El publicador debe resolver el `broadcast` activo del canal y su
   `liveChatId` antes de publicar.
2. Si no existe directo activo, el item puede esperar mientras siga fresco.
3. Si el chat esta deshabilitado, el item debe marcarse `chat_disabled`.
4. Las credenciales de YouTube solo pueden vivir en procesos server-side.

### RF-1705 Modos operativos

1. `off`: no se encola ni publica; solo se registra `manual_off`.
2. `dry-run`: se encola, formatea y registra, pero no llama a la API de
   YouTube.
3. `live`: se encola y publica realmente.

### RF-1705A Promocion de bajo peso

1. El sistema puede publicar mensajes `promotional_like` para invitar a dejar
   `like` en la transmision.
2. El peso operativo debe ser bajo y no competir con sismos nuevos.
3. Deben rotar entre variantes cortas y no repetirse de forma inmediata.
4. El intervalo inicial recomendado es `20 minutos`.
5. Si existe backlog `pending` de sismos nuevos, la promocion no debe entrar.

### RF-1706 API operativa

Se deben exponer al menos estos endpoints:

#### `GET /api/youtube/chat/status`

Respuesta:

```json
{
  "enabled": true,
  "mode": "live",
  "promotionalEnabled": true,
  "promotionalMinIntervalMs": 1200000,
  "connected": true,
  "channelId": "UCxxxx",
  "activeBroadcastId": "abc123",
  "liveChatId": "Cg0KC2xpdmVDaGF0SWRY",
  "queueDepth": 0,
  "lastPostedAtUtc": "2026-07-06T20:24:00.000Z"
}
```

#### `GET /api/youtube/chat/messages?limit=50`

Respuesta:

```json
{
  "items": [
    {
      "canonicalEventId": "USGS:abcd",
      "status": "posted",
      "messageText": "[NUEVO SISMO] M4.0 | Puerto Escondido, Oaxaca, Mexico | 28 km | Fuente: SSN",
      "postedAtUtc": "2026-07-06T20:24:00.000Z"
    }
  ]
}
```

#### `POST /api/youtube/chat/test`

Body:

```json
{
  "text": "[PRUEBA] Mensaje de verificacion del bot de chat."
}
```

Reglas:

1. Solo disponible para operador.
2. Respeta `mode`; en `dry-run` no publica externamente.
3. No debe reutilizar la ruta de eventos reales para evitar contaminar
   antirepeticion.

## Trazabilidad

| Requisito | Implementacion objetivo                                          | Validacion                             |
| --------- | ---------------------------------------------------------------- | -------------------------------------- |
| RF-1701   | `ingestionService`, `youtubeChatRepository`, detector de novedad | tests de deduplicacion y frescura      |
| RF-1702   | formateador de chat + capa de presentacion broadcast             | tests unitarios de plantilla           |
| RF-1703   | cola persistente + publicador con pacing                         | tests de cola y monitoreo real         |
| RF-1704   | cliente YouTube + cache de `liveChatId`                          | prueba funcional contra directo activo |
| RF-1705   | config `env` + estado runtime                                    | tests de modos                         |
| RF-1706   | rutas API + repositorio de estado                                | tests API                              |

## Riesgos

1. Un enjambre sismico puede saturar el chat y volverlo ruido.
2. Un error de deduplicacion puede publicar dos veces el mismo evento.
3. Un `refresh_token` vencido puede romper la publicacion sin afectar el resto
   de la plataforma.
4. Un directo mal configurado en YouTube puede dejar el chat deshabilitado.
5. Un evento historico reinyectado al reiniciar servicios puede generar spam si
   no se controla la frescura.

## Mitigaciones

1. Limitar frecuencia, tamano de cola y ventana de frescura.
2. Hacer unica la publicacion por `canonical_event_id`.
3. Separar deteccion, outbox y entrega externa.
4. Exponer telemetria y estado legible para el operador.
5. Mantener `dry-run` como paso obligatorio antes del modo `live`.

## Rollout

1. Implementar primero en `dry-run`.
2. Verificar durante un directo real que:
   - solo entren sismos nuevos
   - no entren updates
   - no aparezcan historicos viejos al reiniciar
3. Activar `live` con intervalo conservador.
4. Ajustar YouTube Studio a `usuarios aprobados` si se desea chat exclusivo del
   bot.

## Criterios de aceptacion

1. Un sismo nuevo y fresco genera exactamente un item de chat.
2. Una actualizacion del mismo sismo no genera un segundo item.
3. Un duplicado multifuente reconciliado no genera un segundo item.
4. Un evento viejo al arrancar servicios no se publica.
5. El mensaje publicado usa solo datos normalizados y plantilla breve.
6. Las credenciales de YouTube no aparecen en frontend ni en el browser source.
7. Existe `status` operativo y endpoint de prueba.
8. `dry-run` registra sin publicar; `live` publica realmente.
9. El modulo no interfiere con Director IA, Chatterbox ni OBS.
10. La implementacion queda cubierta por tests de logica critica y validacion
    funcional sobre un directo real.
