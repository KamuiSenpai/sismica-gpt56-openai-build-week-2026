# Catalogo de contexto sismico pregabado

Estado: propuesto
Fecha: 2026-07-04

## Objetivo

Definir una libreria corta de clips pregabados para cubrir el tiempo entre el cambio de foco del
mapa y la llegada de la locucion neural principal. Estos clips no deben decir lugar, magnitud,
hora ni profundidad exacta. Solo deben aportar contexto tectonico o continuidad editorial.

## Regla editorial

- Duracion ideal por clip: `1.2 s` a `2.8 s`
- Maximo por evento: `1` clip puente
- Uso: solo si la locucion principal aun no esta lista
- El clip debe callar en cuanto llegue la locucion principal
- No usar lenguaje de alerta, danos, replicas, monitoreo oficial ni frases de relleno obvio

## Capas de disparo

Orden recomendado de seleccion:

1. Familia tectonica especifica por zona
2. Contexto por profundidad si no hay familia especifica
3. Continuidad neutra si tampoco hay contexto claro

## Cobertura recomendada

### Fase 1: usable con la heuristica actual

El backend ya reconoce estas familias en `apps/api/src/services/narrationService.ts`:

- `subduccion_pacifico_superficial`
- `subduccion_pacifico_intermedio`
- `subduccion_pacifico_profundo`
- `colision_mediterraneo_asiatica`
- `continental_superficial`
- `marino_superficial`
- `foco_intermedio_generico`
- `foco_profundo_generico`
- `superficial_generico`
- `continuidad_neutra`

Conteo recomendado en Fase 1: `47 clips por locutor`

### Fase 1.5: expansion recomendada

Conviene agregar dos familias con mapeo nuevo por zona:

- `dorsal_oceanica`
- `transformante`

Conteo recomendado con esta expansion: `56 clips por locutor`

## Recomendacion de grabacion

- Arranque recomendado: `2 locutores`
  - `mx_carolina`
  - `mx_liam`
- Total inicial con heuristica actual: `94 clips`
- Total recomendado con expansion: `112 clips`
- Si luego quieres una capa didactica aparte: sumar `18 clips por locutor`

## Convencion de nombres

Formato sugerido:

`bridge_<voz>_<grupo>_<nn>.wav`

Ejemplos:

- `bridge_mx_carolina_subduccion_pacifico_superficial_01.wav`
- `bridge_mx_liam_continuidad_neutra_04.wav`

## Matriz de grupos

| Grupo                             | Estado    | Variantes | Uso principal                          | Zonas ejemplo                                                                |
| --------------------------------- | --------- | --------: | -------------------------------------- | ---------------------------------------------------------------------------- |
| `subduccion_pacifico_superficial` | actual    |         5 | Margen convergente superficial         | Chile, Peru, Ecuador, Colombia, Mexico Pacifico, Japon, Filipinas, Indonesia |
| `subduccion_pacifico_intermedio`  | actual    |         5 | Foco intermedio en subduccion          | Andes, Japon, Filipinas, Indonesia, Tonga                                    |
| `subduccion_pacifico_profundo`    | actual    |         5 | Foco profundo en placa subducida       | Peru, Bolivia, norte de Chile, Japon, Fiji, Tonga                            |
| `colision_mediterraneo_asiatica`  | actual    |         4 | Compresion regional                    | Italia, Grecia, Turquia, Iran, Chipre, Albania                               |
| `continental_superficial`         | actual    |         5 | Sismo cortical interior                | Polonia, Texas, Nevada, Utah, Mongolia, Kazajistan                           |
| `marino_superficial`              | actual    |         4 | Evento costa afuera sin pista mas fina | Mar abierto, frente a la costa, estrechos                                    |
| `foco_intermedio_generico`        | actual    |         4 | Profundidad media sin zona clara       | Cualquier region sin familia fuerte                                          |
| `foco_profundo_generico`          | actual    |         4 | Profundidad grande sin zona clara      | Cualquier region sin familia fuerte                                          |
| `superficial_generico`            | actual    |         5 | Evento somero sin zona clara           | Cualquier region sin familia fuerte                                          |
| `continuidad_neutra`              | actual    |         6 | Puente editorial puro                  | Todos                                                                        |
| `dorsal_oceanica`                 | expansion |         5 | Extension de fondo oceanico            | Reykjanes Ridge, Mid-Atlantic Ridge, Azores, dorsales del Pacifico           |
| `transformante`                   | expansion |         4 | Deslizamiento lateral                  | California, Caribe, Golfo de California, Anatolia norte                      |

## Guiones listos para grabar

### 1. `subduccion_pacifico_superficial` (5)

1. Zona de subduccion activa del Pacifico
2. Tramo costero con acople entre placas
3. Margen convergente de alta sismicidad
4. Segmento superficial del cinturon del Pacifico
5. Franja de subduccion cercana a la costa

### 2. `subduccion_pacifico_intermedio` (5)

1. Foco intermedio en margen de subduccion
2. Evento intermedio dentro de la placa descendente
3. Sismo de transicion bajo el arco del Pacifico
4. Energia liberada a profundidad intermedia
5. Tramo de subduccion con foco intermedio

### 3. `subduccion_pacifico_profundo` (5)

1. Foco profundo dentro de la placa subducida
2. Sismo profundo bajo el sistema de subduccion
3. Liberacion de energia a gran profundidad
4. Evento profundo en el interior de la placa
5. Tramo profundo del margen convergente

### 4. `colision_mediterraneo_asiatica` (4)

1. Franja de colision entre bloques continentales
2. Zona compresiva del Mediterraneo oriental
3. Regimen tectonico de colision regional
4. Ajuste cortical en el corredor mediterraneo asiatico

### 5. `continental_superficial` (5)

1. Sismo cortical en bloque continental
2. Ajuste superficial dentro de la corteza continental
3. Ruptura somera lejos del borde oceanico
4. Evento cortical de poca profundidad
5. Actividad superficial en interior continental

### 6. `marino_superficial` (4)

1. Evento marino de poca profundidad
2. Sismo superficial bajo el fondo oceanico
3. Ajuste somero en sector costa afuera
4. Energia liberada en plataforma o talud marino

### 7. `foco_intermedio_generico` (4)

1. Sismo de foco intermedio
2. Profundidad media dentro del sistema tectonico
3. Evento a profundidad intermedia
4. Liberacion sismica fuera del rango superficial

### 8. `foco_profundo_generico` (4)

1. Sismo profundo
2. Evento originado a gran profundidad
3. Liberacion sismica en niveles profundos
4. Foco profundo bajo la region

### 9. `superficial_generico` (5)

1. Sismo superficial
2. Evento de poca profundidad
3. Foco somero con energia cercana a superficie
4. Ajuste cortical superficial
5. Liberacion sismica en niveles someros

### 10. `continuidad_neutra` (6)

1. Seguimos el recorrido sismico global
2. Continuamos sobre el mapa activo
3. Pasamos al siguiente registro del planeta
4. Recorremos otra zona del tablero sismico
5. La secuencia continua sobre el mapa mundial
6. Vamos al siguiente punto del recorrido

### 11. `dorsal_oceanica` (5)

1. Actividad sobre una dorsal oceanica
2. Extension tectonica en corteza oceanica
3. Ajuste superficial en una cresta submarina
4. Ruptura asociada a expansion del fondo oceanico
5. Tramo oceanico de apertura entre placas

### 12. `transformante` (4)

1. Deslizamiento lateral entre bloques tectonicos
2. Ajuste en una falla de rumbo activa
3. Movimiento cortante en limite transformante
4. Evento asociado a desplazamiento horizontal

## Recomendacion final

- Si quieres avanzar ya sin tocar heuristicas: grabar `47 clips por locutor`
- Si quieres una biblioteca mas robusta y menos repetitiva: grabar `56 clips por locutor`
- Si quieres el mejor retorno inmediato: grabar primero `mx_carolina` y `mx_liam`
