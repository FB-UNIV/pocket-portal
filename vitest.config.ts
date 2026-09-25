import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "e2e/**",
      "**/*.integration.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // src/app is scoped to the paths that carry real logic (auth-gated
      // pages, admin actions, the shared header and the error/not-found
      // boundaries) — not layout.tsx (font/HTML boilerplate) or the two thin
      // route.ts re-exports, which stay exercised by e2e instead (see
      // e2e/metrics.spec.ts, the [...nextauth] catch-all).
      include: [
        "src/lib/**",
        // Ships inside the image and applies schema changes, so it is held
        // to the same bar as src/ despite living in scripts/.
        "scripts/migrate.mjs",
        "src/app/page.tsx",
        "src/app/error.tsx",
        "src/app/global-error.tsx",
        "src/app/not-found.tsx",
        "src/app/_components/**",
        "src/app/api/health/**",
        "src/app/api/ready/**",
        "src/app/my-access/**",
        "src/app/admin/**",
        "src/app/apps/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
