import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  esbuild: { jsx: "automatic" }, // match Next's automatic JSX runtime (no React import needed in components/tests)
  test: { environment: "node", include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"] },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
});
