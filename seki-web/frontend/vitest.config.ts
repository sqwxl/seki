import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      // Stub WASM imports — tests don't need the actual engine
      "/static/wasm/go_engine_wasm.js": new URL(
        "src/__mocks__/wasm-stub.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
