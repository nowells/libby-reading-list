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
      provider: "v8",
      include: ["app/**/*.{ts,tsx}"],
      exclude: [
        "app/**/*.test.{ts,tsx}",
        "app/test/**",
        "app/entry.client.tsx",
        "app/root.tsx",
        "app/routes.ts",
      ],
      thresholds: {
        lines: 55,
        functions: 48,
        branches: 50,
        statements: 53,
      },
      reporter: ["text", "lcov", "json-summary"],
    },
  },
});
