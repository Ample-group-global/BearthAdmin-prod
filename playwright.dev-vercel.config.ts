// Lightweight config for the menu-sequence smoke test against the deployed
// DEV environment (bearth-admin-dev.vercel.app). No globalSetup/webServer --
// those exist only to bring up and log into the LOCAL dev stack, which this
// test never touches (it does its own login against the deployed site as
// its first step). Mirrors playwright.prod.config.ts's pattern.
import { defineConfig, devices } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: "./tests",
  testMatch: /(menu-sequence-dev-vercel|_scratch-.*)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600000,
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
