# VALIDATION-001 Plataforma Funcional de Visualizacion Sismica

## Estado

Vigente. Registro incremental de validaciones funcionales.

## Base documental

Este plan deriva de:

1. `docs/specs/SDD-001_Plataforma_Funcional_de_Visualizacion_Sismica.md`
2. `output/doc/01_Informe_de_Alcance_y_Diseno_Funcional_de_la_Plataforma_de_Visualizacion_Sismica.docx`
3. `output/doc/02_Informe_Tecnico_de_Arquitectura_Desarrollo_y_Entorno_WSL2_de_la_Plataforma_de_Visualizacion_Sismica.docx`

## Casos funcionales previstos

1. `VF-01`: carga inicial del mapa con eventos reales.
2. `VF-02`: filtro por magnitud minima.
3. `VF-03`: detalle de evento desde popup o panel.
4. `VF-04`: consulta de estado de fuente.
5. `VF-05`: recepcion de evento nuevo por `SSE`.
6. `VF-06`: visualizacion consistente de eventos persistidos en `PostgreSQL + PostGIS`.

## Evidencia requerida por caso

- fecha de ejecucion
- entorno
- resultado esperado
- resultado obtenido
- evidencia o incidencia
