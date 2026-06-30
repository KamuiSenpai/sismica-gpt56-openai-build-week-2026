# Proceso de Entrega y Validacion

## Estado

Vigente.

## Objetivo

Definir la secuencia obligatoria de trabajo para este proyecto. A partir de este
documento, no se debe implementar codigo funcional nuevo sin que exista primero
una especificacion aprobada y trazable.

## Fuentes base obligatorias

Mientras exista documentacion matriz en formato Word, toda especificacion del
repo debe derivarse de esos documentos y no contradecirlos.

Documentos base vigentes:

1. `output/doc/01_Informe_de_Alcance_y_Diseno_Funcional_de_la_Plataforma_de_Visualizacion_Sismica.docx`
2. `output/doc/02_Informe_Tecnico_de_Arquitectura_Desarrollo_y_Entorno_WSL2_de_la_Plataforma_de_Visualizacion_Sismica.docx`

Si una decision no esta alineada con esos documentos, primero se corrige la base
documental y despues el `SDD`.

## Norma contractual de trabajo

La secuencia obligatoria es la siguiente:

1. `SDD`
2. `Codigo`
3. `Validacion funcional`
4. `Tests unitarios`

## Reglas operativas

1. Ningun modulo nuevo puede iniciar implementacion sin un `SDD` asociado.
2. Todo `SDD` debe definir alcance, exclusiones, arquitectura, modelo de datos,
   API, criterios de aceptacion, riesgos y trazabilidad.
3. El codigo debe implementarse solo contra requisitos ya escritos.
4. La validacion funcional debe ejecutarse sobre flujos reales de la plataforma.
5. Los tests unitarios deben cubrir la logica critica del modulo implementado.
6. Si un requisito cambia, primero se actualiza el `SDD` y despues el codigo.
7. Si no hay aprobacion del `SDD`, el estado permitido es solo analisis o
   preparacion documental.
8. Todo `SDD` debe mencionar explicitamente de que documento Word deriva.

## Artefactos minimos obligatorios por etapa

### SDD

- Documento de especificacion del modulo o fase.
- Matriz minima de trazabilidad requisito -> implementacion -> validacion.
- Criterios de aceptacion verificables.

### Codigo

- Estructura de carpetas coherente con la arquitectura definida.
- Configuracion de entorno.
- Implementacion alineada a la especificacion.

### Validacion funcional

- Casos de validacion por flujo.
- Resultado esperado.
- Evidencia de ejecucion o limitacion encontrada.

### Tests unitarios

- Cobertura de logica critica.
- Ejecucion automatizable.
- Resultado registrado.

## Convencion de documentos

- `docs/specs/SDD-###_<tema>.md`
- `docs/validation/VALIDATION-###_<tema>.md`
- `docs/validation/TEST-###_<tema>.md`

## Aplicacion inmediata

La plataforma funcional de visualizacion sismica queda sujeta a este proceso.
Desde este punto, la siguiente entrega tecnica obligatoria es:

- `docs/specs/SDD-001_Plataforma_Funcional_de_Visualizacion_Sismica.md`
