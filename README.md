# Plataforma de Visualizacion Sismica - MVP

Implementacion inicial del MVP definido en `docs/specs/SDD-001_MVP_Plataforma_Visualizacion_Sismica.md`.

## Arquitectura

```text
apps/api      -> API REST + SSE
apps/worker   -> ingesta USGS
apps/web      -> mapa Leaflet
packages/shared -> tipos y contratos comunes
db/migrations -> esquema PostgreSQL + PostGIS
```

## Requisitos

- Node.js 22+
- npm 11+
- PostgreSQL con extension PostGIS

## Variables de entorno

Copiar `.env.example` y ajustar valores segun el entorno.

## Base de datos

Ejecutar los scripts de `db/migrations` en orden.

## Comandos

```bash
npm install
npm run build
npm run dev:api
npm run dev:web
npm run dev:worker
```

## Nota

En este MVP la fuente inicial obligatoria es `USGS`. El soporte de `EMSC`
queda documentado como evolucion posterior del worker.

