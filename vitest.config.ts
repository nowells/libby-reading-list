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
      // Built-in V8 coverage; writes coverage-final.json under
      // ./coverage/unit/ for scripts/merge-coverage.mjs to combine with the
      // e2e raws.
      provider: "v8",
      reportsDirectory: "./coverage/unit",
      reporter: ["json"],
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
