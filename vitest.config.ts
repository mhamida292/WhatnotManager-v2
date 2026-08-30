import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  // Match Next's automatic JSX runtime (no React import needed in components/tests).
  // Vitest 4 transforms with oxc/rolldown, not esbuild, so the JSX runtime is set here.
  oxc: { jsx: { runtime: "automatic" } },
  test: { environment: "node", include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"] },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
});
