# TEST-001 Plataforma Funcional de Visualizacion Sismica

## Estado

Vigente. Ejecucion incremental por entrega funcional.

## Base documental

Este documento deriva de:

1. `docs/specs/SDD-001_Plataforma_Funcional_de_Visualizacion_Sismica.md`
2. `output/doc/02_Informe_Tecnico_de_Arquitectura_Desarrollo_y_Entorno_WSL2_de_la_Plataforma_de_Visualizacion_Sismica.docx`

## Cobertura unitaria minima

1. Normalizacion de eventos `USGS`.
2. Deteccion de evento existente por `source_event_id`.
3. Construccion de respuesta API desde entidad persistida.
4. Validacion de filtros de consulta.
5. Serializacion de eventos para `SSE`.
6. Construccion de geometria o mapeo de coordenadas a modelo persistente.

## Criterio de salida

Los tests unitarios se consideran suficientes para la entrega funcional si cubren la
logica de dominio critica y se pueden ejecutar por comando automatizado.
