# TEST-005 Integracion Oficial BMKG Indonesia

## Objetivo

Verificar la implementacion de `SDD-005`, incluyendo consulta de los dos feeds
oficiales, normalizacion, fusion, prioridad regional, persistencia e
idempotencia.

## Entorno

- Windows con Node.js 22 y npm workspaces.
- PostgreSQL 16 con PostGIS 3.6 en `localhost:5433`.
- API en `localhost:3000`.
- Frontend en `localhost:5173`.
- Fecha: 30 de junio de 2026.

## Casos funcionales

| ID     | Caso                            | Resultado esperado                               |
| ------ | ------------------------------- | ------------------------------------------------ |
| VF-501 | Consultar `gempaterkini.json`   | contenedor BMKG valido                           |
| VF-502 | Consultar `gempadirasakan.json` | contenedor BMKG valido                           |
| VF-503 | Ejecutar primera ingesta        | estado `success` y referencias persistidas       |
| VF-504 | Fusionar feeds                  | una referencia por identidad BMKG                |
| VF-505 | Asociar con catalogo existente  | referencias compatibles comparten canonico       |
| VF-506 | Aplicar prioridad Indonesia     | BMKG puede ser fuente preferida regional         |
| VF-507 | Repetir ingesta                 | cero nuevas operaciones para payload sin cambios |
| VF-508 | Consultar estado API            | BMKG visible en el catalogo de fuentes           |
| VF-509 | Verificar continuidad           | API y frontend responden HTTP 200                |

## Casos unitarios

1. Fecha ISO y coordenadas BMKG.
2. Magnitud y profundidad numericas.
3. Intensidad textual sentida.
4. Negacion de potencial de tsunami.
5. Potencial positivo de tsunami.
6. Identificador determinista.
7. Fusion de feeds sin perdida de campos.
8. Prioridad dentro y fuera de Indonesia.
9. Regresion de adaptadores y deduplicacion existentes.

## Comandos

```text
RUN_ONCE=true npm run start:worker
npm test -w apps/worker
npm run typecheck
npm run build
```

## Criterio de aprobacion

BMKG debe finalizar en estado correcto, la segunda ingesta debe ser idempotente,
no deben existir claves duplicadas y todas las verificaciones automatizadas
deben finalizar sin error.
