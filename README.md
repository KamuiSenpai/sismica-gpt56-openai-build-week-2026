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

El entorno local de Windows usa PostgreSQL/PostGIS portable en:

```text
E:\Proyecto\.runtime\pgsql-data-mvp
```

Esa carpeta contiene la base historica poblada. La aplicacion se conecta por
`DATABASE_URL=postgres://postgres:postgres@localhost:5433/sismica`.

Para iniciar siempre la base historica correcta:

```bash
npm run db:start
```

El script valida que el puerto `5433` este usando
`.runtime/pgsql-data-mvp`. Si otra carpeta de datos ocupa ese puerto, el
arranque falla para evitar operar con una base incompleta.

Para detenerla:

```bash
npm run db:stop
```

Las migraciones siguen disponibles con:

```bash
npm run db:migrate
```

## Comandos

```bash
npm install
npm run db:start
npm run build
npm run dev:api
npm run dev:web
npm run dev:worker
```

## Nota

En este MVP la fuente inicial obligatoria es `USGS`. El soporte de `EMSC`
queda documentado como evolucion posterior del worker.
