import { defineConfig } from "@playwright/test";

/**
 * E2E suite. The webServer script builds the frontend bundle and runs the
 * Rust server against a fresh seki-e2e.db on port 3334 (kept clear of the
 * dev server's 3333).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:3334",
  },
  webServer: {
    command: "node e2e/server.mjs",
    url: "http://localhost:3334/up",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
