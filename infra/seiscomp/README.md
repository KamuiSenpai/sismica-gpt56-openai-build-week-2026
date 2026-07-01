# Integracion experimental con SeisComP

## Proposito

Esta carpeta documenta el limite entre SeisComP y la plataforma TypeScript.
SeisComP procesa SeedLink, picks, asociaciones, localizaciones y magnitudes. La
plataforma recibe solamente resultados estructurados y los conserva fuera del
catalogo oficial.

## Entorno

Ejecutar SeisComP en Linux, Ubuntu sobre WSL2 o una maquina virtual Linux. No se
instala dentro del proceso Node.js ni se expone SeedLink al navegador.

Componentes previstos:

1. SeedLink como entrada de formas de onda autorizadas.
2. `scautopick` para picks automaticos.
3. `scautoloc` para origenes preliminares.
4. `scamp` y `scmag` para amplitudes y magnitudes.
5. Un exportador institucional que transforme la salida a los JSON versionados
   de esta carpeta.

La configuracion exacta de redes, streams y inventario depende de los permisos
del operador. No se debe declarar una red como conectada sin observar datos
recientes.

## Publicacion

Configurar en el backend:

```text
SEISMIC_ENGINE_TOKEN=<secreto-aleatorio-de-al-menos-24-caracteres>
STATION_STREAM_CHANNEL=seismic_station_states_channel
```

En el host del adaptador:

```text
SEISMIC_ENGINE_API_URL=http://localhost:3000
SEISMIC_ENGINE_TOKEN=<mismo-secreto>
```

Publicar un lote:

```bash
npm run seismic:publish -w apps/worker -- snapshot infra/seiscomp/examples/station-snapshot.json
npm run seismic:publish -w apps/worker -- origin infra/seiscomp/examples/experimental-origin.json
```

Los estados con secuencia antigua se ignoran. Los picks son idempotentes. Los
origenes quedan en `experimental_origins` y nunca se insertan automaticamente
en `seismic_events`.

## Evidencia operativa minima

Antes de usar telemetria real se debe conservar:

1. Fuente SeedLink y autorizacion de uso.
2. Version de SeisComP y modelo de velocidades.
3. Inventario cargado y redes habilitadas.
4. Latencia, continuidad y perdida de paquetes por estacion.
5. Casos de prueba con eventos oficiales ya revisados.
6. Tasa de falsos picks y origenes descartados.

Referencias oficiales:

- https://docs.gempa.de/seiscomp/current/apps/scautopick.html
- https://docs.gempa.de/seiscomp/current/apps/scautoloc.html
- https://docs.gempa.de/seiscomp/current/apps/scmag.html
- https://geofon.gfz.de/waveform/seedlink.php

## Modo operacional

Orden minimo de operacion:

1. Aplicar migraciones: `npm run db:migrate`
2. Levantar la API en `http://localhost:3000`
3. Ejecutar el worker con el motor habilitado
4. Verificar el endpoint publico de origenes experimentales
5. Verificar la capa `Epicentros exp.` en el frontend

Ejecucion de un ciclo puntual del motor:

```powershell
$env:RUN_ONCE='true'
$env:SEISMIC_ENGINE_ENABLED='true'
npx tsx apps/worker/src/index.ts
```

Consulta publica esperada:

```text
GET http://localhost:3000/api/experimental-origins?hours=72&limit=10
```

Comportamiento operacional actual:

1. Los origenes experimentales se consultan por REST y se visualizan en una
   capa independiente del feed oficial.
2. La capa web usa un marcador propio, toggle y leyenda explicita.
3. La interfaz mantiene separados los catalogos oficiales y experimentales.
4. Las ondas visibles del monitor son un replay visual de inspeccion y no una
   prediccion oficial de arribo.
5. Ningun origen experimental debe insertarse automaticamente en
   `seismic_events`.
