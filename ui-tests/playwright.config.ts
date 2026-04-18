import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

// load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../.env") });

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "html",
  timeout: 120_000, // 2 min per test — pipeline can be slow
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: "https://rhombusai.com",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
