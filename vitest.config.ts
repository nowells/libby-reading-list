import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  optimizeDeps: {
    include: ["@atproto/api", "@atproto/oauth-client-browser"],
  },
  resolve: {
    alias: {
      "~": new URL("./app", import.meta.url).pathname,
    },
  },
  test: {
    include: ["app/**/*.test.{ts,tsx}"],
    setupFiles: ["app/test/setup.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      viewport: { width: 1280, height: 900 },
    },
    coverage: {
      // Custom provider that hands raw V8 data to monocart-coverage-reports
      // so unit + e2e coverage can be merged into a single report. The MCR
      // options are loaded from mcr.config.js; the merged report and
      // thresholds are produced by scripts/merge-coverage.mjs.
      provider: "custom",
      customProviderModule: "vitest-monocart-coverage/browser",
      include: ["app/**/*.{ts,tsx}"],
      exclude: [
        "app/**/*.test.{ts,tsx}",
        "app/test/**",
        "app/entry.client.tsx",
        "app/root.tsx",
        "app/routes.ts",
      ],
    },
  },
});
