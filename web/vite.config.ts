import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: here,
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
  resolve: { alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) } },
  // `npm run dev:web` proxies API calls to `wrangler dev` on 8787.
  server: { proxy: { "/api": "http://localhost:8787" } },
});
