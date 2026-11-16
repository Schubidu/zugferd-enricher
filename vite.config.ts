import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // CI-only second entry, never included in ordinary production output.
  build: process.env.VALIDATOR_WEBKIT_SMOKE === "1"
    ? {rollupOptions: {input: ["index.html","validation-smoke.html"]}}
    : undefined,
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
});
