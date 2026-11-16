import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // libxml2-wasm uses top-level await; its dedicated browser Worker must
  // be emitted as a module, not Vite's default IIFE format.
  worker: {format: "es"},
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
