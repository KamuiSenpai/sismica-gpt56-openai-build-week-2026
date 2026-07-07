# Director IA V2 - Software Design Document

Estado: implementacion inicial  
Version: 2.0  
Destino: transmision SISMICA 24 en vivo 24/7

## 1. Objetivo

Director IA V2 coordina la continuidad editorial, la prioridad de sismos, las
locuciones Chatterbox, las pautas grabadas y el foco visual sin superponer audio.

La palabra "IA" describe la generacion editorial de las locuciones. Las
decisiones criticas de temporizacion, prioridad y reproduccion son
deterministas y auditables.

## 2. Alcance de esta entrega

Incluye:

- Politica determinista V2 y pruebas unitarias.
- Activacion reversible desde el selector del director.
- Continuidad natural con musica ambiente durante silencios cortos.
- Pautas oficiales auditadas por clase para esperas largas.
- Maximo de una pauta normal; una segunda solo en esperas excepcionales.
- Prioridad para sismos nuevos sin cortar audio iniciado.
- Contrato de manifiesto con duracion y aprobacion.
- Catalogos separados `trial` y `official`.
- Telemetria para observar decisiones y tiempos.

No incluye:

- Redaccion de las pautas oficiales.
- Generacion o aprobacion de nuevos WAV.
- Sustitucion de los catalogos actuales.

## 3. Principios

1. Ningun audio puede superponerse con otro audio hablado.
2. Una pauta que comenzo debe terminar antes de Chatterbox.
3. Un sismo nuevo ocupa el siguiente turno disponible.
4. El director no usa temporizadores para cortar una locucion Chatterbox.
5. La rotacion de las seis voces Chatterbox sigue siendo de cinco minutos.
6. Las voces grabadas rotan en un ciclo independiente.
7. El sistema falla en silencio seguro: musica ambiente, nunca un clip no
   aprobado o demasiado largo.
8. V1 permanece disponible para rollback inmediato.

## 4. Estados de continuidad

```text
AMBIENT_ONLY
  | espera >= 1.5 s y Chatterbox aun no esta listo
  v
GUIDE_PLAYING
  | la pauta termina
  v
AMBIENT_WAIT
  | Chatterbox listo
  v
HANDOFF_300_MS
  |
  v
CHATTERBOX_PLAYING
  |
  v
IDLE
```

Una segunda pauta solo puede comenzar si:

- han transcurrido al menos 20 segundos desde el inicio de la espera;
- Chatterbox aun no esta listo;
- no existe un sismo nuevo pendiente;
- la locucion actual no es un sismo nuevo;
- solo se ha reproducido una pauta.

## 5. Politica temporal

| Regla                                   |              Valor |
| --------------------------------------- | -----------------: |
| Silencio corto cubierto solo por musica |          0-1500 ms |
| Inicio minimo de primera pauta          |            1500 ms |
| Filtro generico de duracion (`trial`)   |      5000-10000 ms |
| Pausa entre pautas                      |      650 ms minimo |
| Segunda pauta excepcional               |     desde 20000 ms |
| Pausa pauta -> Chatterbox               |             300 ms |
| Pautas maximas en sismo nuevo           |                  1 |
| Pautas maximas en contenido rutinario   |                  2 |
| Repeticion del mismo WAV                | no antes de 60 min |

Los valores temporales globales viven en `DIRECTOR_V2_POLICY`; cambiar un valor
exige actualizar sus pruebas y este documento. La ventana generica de
`5000-10000 ms` se conserva como resguardo para catalogos `trial`. En
`official`, la duracion objetivo depende de la clase aprobada y se audita en el
catalogo.

## 6. Prioridad editorial

Orden de seleccion del siguiente turno:

1. Sismo nuevo en cola.
2. Boletin vencido de 60, 30 o 15 minutos.
3. Resumen horario vencido.
4. Segmento educativo vencido.
5. Recorrido por un sismo no emitido recientemente.
6. Espera en musica ambiente.

Un sismo que llega durante una locucion no la interrumpe. Se conserva en cola y
se emite al terminar. Si llega mientras se prepara una segunda pauta, esa pauta
se cancela y el sistema espera el siguiente turno.

## 7. Separacion V1/V2

El tipo `DirectorMode` conserva:

- `off`: recorrido sin director.
- `rules`: Director V1 por reglas.
- `ai`: Director IA V1.
- `v2`: Director IA V2.

V2 reutiliza obtencion de eventos, cola en vivo, generacion editorial, voz,
camara y overlays. Solo reemplaza la politica de seleccion y continuidad.

## 8. Catalogos de pautas

```text
Grabaciones/
  pautas-informativas/                 # trial
  pautas-educativas/                   # trial
  produccion/
    pautas-informativas/               # official
      manifest-current.json
      station_identity/
        mx_carolina/
        mx_liam/
        ...
      data_transparency/
        mx_carolina/
        mx_liam/
        ...
    pautas-educativas/                 # official
      manifest-current.json
    pautas-promocionales/              # official, voces promocionales aprobadas
      manifest-current.json
      promotional_channel/
        mx_ninoska/
        mx_valentina/
    remates-continuidad/               # official, no entra como pauta de espera
      manifest-current.json
```

Configuracion web:

```text
VITE_DIRECTOR_V2_GUIDE_SET=trial|official
```

Durante el desarrollo el valor por defecto es `trial`. El paso a `official`
solo se realiza despues de aprobar textos, voces y audios.

## 9. Contrato editorial de pautas oficiales

El catalogo oficial se divide por funcion, no solo por carpeta. Una pauta de
espera no cumple el mismo rol que un remate corto. Mezclarlas rompe la
naturalidad y puede retrasar sismos nuevos.

### 9.1 Clases permitidas

| Clase                  | `classId`               | Duracion objetivo | Rol          | Uso                                                                |
| ---------------------- | ----------------------- | ----------------: | ------------ | ------------------------------------------------------------------ |
| Identidad del canal    | `station_identity`      |             5-8 s | `guide`      | Esperas cortas cuando Chatterbox no esta listo.                    |
| Transparencia de datos | `data_transparency`     |             5-7 s | `guide`      | Avisar que los datos pueden actualizarse.                          |
| Lectura de datos       | `data_literacy`         |             6-8 s | `guide`      | Explicar magnitud, profundidad, epicentro, hora o fuente.          |
| Educativa breve        | `education_brief`       |            7-10 s | `guide`      | Conceptos sismicos generales, sin depender del evento actual.      |
| Tectonica verificada   | `verified_tectonics`    |           10-12 s | `guide`      | Conceptos tectonicos generales o regionales previamente validados. |
| Promocional del canal  | `promotional_channel`   |             6-9 s | `guide`      | Invitacion suave a suscribirse, compartir o volver al directo.     |
| Remate de continuidad  | `continuity_transition` |             3-5 s | `transition` | Cierres como "Seguimos con el recorrido por el planeta".           |

### 9.2 Reglas por rol

`guide`:

- Se usa para llenar esperas mientras Chatterbox genera audio.
- En `trial`, se filtra con ventana generica de 5 a 10 segundos.
- En `official`, la duracion se controla en la auditoria del paquete aprobado;
  V2 no descarta un WAV ya aprobado por usar una ventana distinta a la generica.
- Puede entrar despues de 1.5 segundos de espera.
- Debe terminar completa antes de Chatterbox.
- No puede reproducirse si hay un sismo nuevo esperando turno, salvo la primera
  pauta ya iniciada.

`promotional_channel`:

- Es una pauta `guide`, pero solo puede usar voces promocionales aprobadas:
  `mx_ninoska` y `mx_valentina`.
- Debe sonar mas calida y atractiva que una locucion informativa normal.
- No debe sonar como publicidad agresiva ni prometer alertas oficiales.
- No puede reproducirse si existe un sismo nuevo pendiente.
- Debe tener baja rotacion: maximo 10% del total de pautas emitidas.

`transition`:

- Se usa como cierre o puente editorial, no como relleno de espera.
- Debe durar entre 3 y 5 segundos.
- Debe ser pregrabada, no sintetizada en vivo por Chatterbox.
- No debe entrar si existe un sismo nuevo pendiente.
- No participa en el selector de espera V2.

### 9.3 Inventario minimo para produccion

| Paquete                      | Cantidad minima | Cantidad recomendada | Voces                    |
| ---------------------------- | --------------: | -------------------: | ------------------------ |
| Pautas `guide`               |          60 WAV |              120 WAV | 10-20 textos por 6 voces |
| Pautas `promotional_channel` |   6 WAV por voz |       12 WAV por voz | Ninoska y Valentina      |
| Remates `transition`         |          18 WAV |               24 WAV | 3-4 textos por 6 voces   |

Cada texto oficial debe existir en las seis voces: Carolina, Liam, Valentina,
Martin, Sofia y Ninoska. Si una voz falta, el manifiesto debe marcar el item
como `pending` y V2 no debe usarlo en catalogos `official`.

Excepcion: `promotional_channel` existe solo en voces promocionales aprobadas:
`mx_ninoska` y `mx_valentina`. Estas voces no participan en la rotacion normal
de seis voces; son firmas promocionales del canal.

### 9.4 Distribucion editorial recomendada

| Clase                 | Peso recomendado |
| --------------------- | ---------------: |
| `station_identity`    |              20% |
| `data_transparency`   |              20% |
| `data_literacy`       |              20% |
| `education_brief`     |              20% |
| `verified_tectonics`  |              10% |
| `promotional_channel` |              10% |

Los remates `continuity_transition` se rotan por oportunidad editorial, no por
porcentaje de espera.

La distribucion se ejecuta como un ciclo determinista de diez posiciones. La
posicion promocional se omite en `breaking` o si existe un sismo nuevo pendiente;
no se recupera despues, por lo que el 10% es un limite maximo y no una cuota.

### 9.5 Textos ejemplo por clase

`station_identity`:

- "Sismica 24 monitorea la actividad sismica en tiempo real."
- "La Tierra se mantiene en observacion permanente."

`data_transparency`:

- "Los datos sismicos pueden actualizarse conforme las agencias revisan el evento."
- "La informacion inicial puede cambiar cuando se procesa nueva senal."

`data_literacy`:

- "La magnitud mide energia liberada; la intensidad describe efectos observados."
- "La profundidad ayuda a interpretar como se percibe un movimiento."

`education_brief`:

- "Los sismos superficiales suelen sentirse con mayor fuerza cerca del epicentro."
- "Una replica es un reajuste posterior dentro de la misma zona activa."

`verified_tectonics`:

- "Muchos sismos se concentran en bordes de placas donde la corteza libera energia acumulada."
- "En zonas de subduccion, una placa desciende bajo otra y genera actividad sismica frecuente."
- "El cinturon de fuego del Pacifico reune algunas de las regiones sismicas mas activas del planeta."
- "Las fallas activas liberan tension cuando las rocas ya no soportan mas esfuerzo acumulado."
- "La interaccion entre placas puede producir sismos superficiales, intermedios o profundos."
- "La sismicidad regional depende del tipo de borde tectonico y de su historia geologica."

`promotional_channel`:

- "Si este monitoreo te resulta util, puedes suscribirte a Sismica veinticuatro."
- "Comparte esta transmision con quienes siguen la actividad sismica en tiempo real."
- "Puedes volver a esta senal cuando quieras revisar la actividad sismica reciente."
- "Si esta transmision te resulta util, deja tu like y ayuda a mantener activa esta senal en vivo."
- "Tu like ayuda a que mas personas encuentren Sismica veinticuatro y sigan esta transmision en vivo."

`continuity_transition`:

- "Seguimos con el recorrido por el planeta."
- "Continuamos monitoreando la actividad sismica."
- "Volvemos al mapa en tiempo real."
- "La vigilancia sismica sigue activa."
- "Retomamos el monitoreo global."
- "Seguimos atentos a la Tierra."

## 10. Contrato de manifiesto

### 10.1 Estructura fisica obligatoria

Cada clase oficial debe conservar su propia carpeta y, dentro de ella, una
carpeta por voz. Esta estructura es obligatoria para trazabilidad, auditoria y
regeneracion selectiva.

Formato:

```text
Grabaciones/produccion/<biblioteca>/<classId>/<voice>/<classId>_<voice>_<variant>.wav
```

Ejemplos:

```text
Grabaciones/produccion/pautas-informativas/station_identity/mx_carolina/station_identity_mx_carolina_01.wav
Grabaciones/produccion/pautas-informativas/data_transparency/mx_liam/data_transparency_mx_liam_02.wav
Grabaciones/produccion/pautas-promocionales/promotional_channel/mx_valentina/promotional_channel_mx_valentina_08.wav
```

No se deben mezclar WAV de clases distintas dentro de una misma carpeta de voz
directamente bajo la biblioteca. La carpeta directa por voz, por ejemplo
`pautas-informativas/mx_carolina/`, queda prohibida para nuevos paquetes
oficiales. La ruta del manifiesto (`outputPath`) debe apuntar siempre a la
ubicacion canonica por `classId` y `voice`.

Cada item debe exponer:

```json
{
  "voice": "mx_carolina",
  "classId": "station_identity",
  "playbackRole": "guide",
  "groupId": "station_identity",
  "variant": "01",
  "text": "Texto aprobado.",
  "spokenText": "Texto opcional para sintesis si requiere pronunciacion fonetica.",
  "outputPath": "ruta/al/audio.wav",
  "bytes": 240000,
  "durationMs": 7500,
  "approvalStatus": "approved",
  "keywords": ["prevencion"]
}
```

`approvalStatus` admite:

- `pending`
- `approved`
- `rejected`

Para catalogos `official`, V2 solo reproduce `approved`. Para catalogos
`trial`, el estado puede estar ausente. El API calcula `durationMs` desde el
WAV como compatibilidad con manifiestos antiguos, pero la generacion oficial
debe escribirlo.

`classId` y `playbackRole` son obligatorios en catalogos oficiales nuevos. Los
catalogos antiguos pueden no tenerlos, pero no deben usarse para la fase
`official`.

`spokenText` es opcional. Solo se usa cuando el texto editorial necesita una
pronunciacion controlada en TTS, por ejemplo palabras prestadas como "like".
El manifiesto debe conservar `text` como frase aprobada y registrar
`spokenText` si el audio se genero con una forma fonetica.

## 11. Seleccion de pauta

1. Elegir biblioteca educativa, informativa o promocional segun el plan.
2. Mantener solo items con `playbackRole=guide`.
3. En `official`, mantener solo `classId` permitidos para espera:
   `station_identity`, `data_transparency`, `data_literacy`,
   `education_brief`, `verified_tectonics` y `promotional_channel`.
4. En `official`, eliminar items no aprobados.
5. En `trial`, eliminar items fuera de 5-10 segundos.
6. Si `classId=promotional_channel`, mantener solo voces promocionales aprobadas:
   `mx_ninoska` y `mx_valentina`.
7. En `official`, respetar estrictamente el `classId` elegido; no ampliar a otra
   clase como fallback.
8. Aplicar coincidencia contextual por palabras clave dentro de la clase.
9. Rotar las voces disponibles antes de reutilizar una; los ciclos informativo y
   promocional son independientes.
10. Excluir WAV emitidos durante la ultima hora.
11. Si no hay candidato, continuar solo con musica ambiente.

Los remates `transition` tienen selector propio. En el puente hacia Chatterbox
solo pueden programarse como remate terminal cuando Chatterbox ya esta listo y
ya sono al menos una pauta de espera. Despues de un `continuity_transition`
debe entrar Chatterbox; no puede seguir otra pauta. No se usan para cubrir la
espera de Chatterbox.

## 12. Telemetria

Eventos minimos:

- `bridge_started`
- `bridge_ended`
- `bridge_skipped_ready`
- `bridge_skipped_priority`
- `bridge_skipped_ineligible`
- `bridge_budget_reached`
- `neural_blob_ready`
- `neural_started`
- `neural_ended`
- `narration_finished`

Los eventos de pauta incluyen biblioteca, voz, variante, duracion declarada,
cantidad reproducida y modo de continuidad.

## 13. Rollout

1. Ejecutar V2 con `guide_set=trial` en monitoreo.
2. Observar al menos 24 horas de telemetria.
3. Aprobar guiones oficiales por clase.
4. Generar WAV oficiales por seis voces sin reemplazar los trial, excepto
   `promotional_channel`, que solo se genera con voces promocionales aprobadas.
5. Auditar duracion, pronunciacion, colas y volumen.
6. Marcar audios aprobados.
7. Cambiar `VITE_DIRECTOR_V2_GUIDE_SET=official`.
8. Mantener V1 disponible durante al menos siete dias.

## 14. Criterios de aceptacion

- Chatterbox listo antes de 1.5 segundos entra sin pauta.
- En `trial`, las pautas de espera duran entre 5 y 10 segundos.
- En `official`, V2 solo reproduce items `approved` con `playbackRole=guide` y
  `classId` permitido; la duracion objetivo se valida en el catalogo aprobado.
- Chatterbox nunca corta una pauta iniciada.
- Existe una pausa de 300 ms antes de Chatterbox.
- Un sismo nuevo bloquea la segunda pauta.
- Un sismo nuevo es el siguiente segmento despues del audio activo.
- Nunca se reproducen mas de dos pautas por espera.
- Un sismo nuevo nunca reproduce mas de una pauta.
- Las seis voces Chatterbox rotan cada cinco minutos.
- V1 y V2 pueden seleccionarse sin reiniciar servicios.
- El catalogo `official` no reproduce items sin aprobacion.
- El paquete `official` excluye `safety_prevention`, porque el canal monitorea
  e informa, pero no actua como agencia oficial de prevencion o respuesta.
- Los remates `transition` duran entre 3 y 5 segundos.
- Los remates `transition` no se usan como pautas de espera.
- Las pautas `promotional_channel` duran entre 6 y 9 segundos.
- Las pautas `promotional_channel` solo usan voces promocionales aprobadas.
- Las pautas `promotional_channel` no superan el 10% del total de pautas
  emitidas.
- Las pautas `promotional_channel` no se usan cuando existe un sismo nuevo
  pendiente.
- Las pautas `promotional_channel` no se usan durante la espera de una locucion
  `breaking` de sismo nuevo.
