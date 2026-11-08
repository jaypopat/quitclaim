import { defineConfig } from "@playwright/test";
export default defineConfig({
  webServer: {
    command: "bun run --cwd apps/web dev --mode browser-test --port 3001",
    url: "http://localhost:3001/mint",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  testDir: "./apps/web/tests",
  testMatch: "**/*.pw.ts",
  workers: 1,
  use: {
    headless: true,
    actionTimeout: 45_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  expect: { timeout: 30_000 },
  reporter: "list",
});
