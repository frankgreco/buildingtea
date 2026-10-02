import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests cover the pure modules (address normalisation, status rules,
// translation, tokens). They run in Node, which has the same WebCrypto and
// fetch surface the Worker uses, so no Workers emulation is needed.
export default defineConfig({
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("./shared", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
