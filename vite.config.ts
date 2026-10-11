import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("./src/index.ts", import.meta.url));
// The API client alone, with no WebGL dependencies, so it can be imported from Node.
const clientEntry = fileURLToPath(new URL("./src/client.ts", import.meta.url));
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const standalone = mode === "standalone";
  return {
    root,
    build: {
      outDir: "dist",
      emptyOutDir: !standalone,
      sourcemap: true,
      lib: {
        entry: standalone ? entry : { "neoskins-viewer": entry, "neoskins-client": clientEntry },
        name: "NeoSkins",
        formats: standalone ? ["iife"] : ["es"],
        fileName: (_format, name) => (standalone ? "neoskins-viewer.standalone.js" : `${name}.js`),
      },
      rollupOptions: standalone
        ? {}
        : { external: [/^three($|\/)/, "skinview3d", "skinview3d-blockbench", "gifuct-js"] },
    },
  };
});
