import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Bundles the tool into one IIFE; build.mjs then inlines it into index.html.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  logLevel: "warn",
  build: {
    outDir: "build",
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL("./main.ts", import.meta.url)),
      name: "NeoCapesGif",
      formats: ["iife"],
      fileName: () => "app.js",
    },
  },
});
