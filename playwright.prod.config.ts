// Lightweight config for tests that target the live production site directly
// (nft-studio-v1-prod-*.spec.ts). No globalSetup/webServer -- those exist
// only to bring up and log into the LOCAL dev stack, which these tests never
// touch (each spec does its own production login as its first test step).
// Skips ~30-40s of dead-weight local-only setup on every run.
import { defineConfig, devices } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: "./tests",
  testMatch: /nft-studio-v1-prod-.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 3600000,
  use: {
    actionTimeout: 10000,
    trace: "on",
    screenshot: "on",
    video: "on",
    headless: false,
  },
  outputDir: path.join("tests", "results"),
  projects: [
    {
      name: "Desktop Chrome",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--disable-dev-shm-usage",
            "--no-sandbox",
            "--js-flags=--max-old-space-size=4096",
          ],
        },
      },
    },
  ],
});
