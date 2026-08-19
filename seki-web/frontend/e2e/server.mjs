// Playwright webServer: build the frontend bundle, then run the Rust server
// against a fresh e2e database on port 3334 (clear of the dev server's 3333).
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(e2eDir, "..");
const root = path.resolve(frontendDir, "..", "..");

const dbPath = path.join(root, "seki-e2e.db");
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });

const build = spawnSync("node", ["build.mjs"], {
  cwd: frontendDir,
  stdio: "inherit",
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const server = spawn("cargo", ["run", "-p", "seki-web", "--bin", "seki-web"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: `sqlite://${dbPath}`,
    PORT: "3334",
    BASE_URL: "http://localhost:3334",
  },
});

for (const signal of ["SIGINT", "SIGTERM", "exit"]) {
  process.on(signal, () => server.kill());
}
