import { createRequire } from "node:module";
import path from "node:path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";

// Cesium queda hoisteado en la raiz del monorepo; resolvemos su ruta real
// para que el plugin copie/sirva los assets (Workers, Assets, Widgets).
const require = createRequire(import.meta.url);
const cesiumRoot = path.dirname(require.resolve("cesium/package.json"));

export default defineConfig({
  plugins: [
    react(),
    cesium({
      cesiumBuildRootPath: path.join(cesiumRoot, "Build"),
      cesiumBuildPath: path.join(cesiumRoot, "Build", "Cesium"),
      devMinifyCesium: true
    })
  ],
  server: {
    port: 5173
  }
});
