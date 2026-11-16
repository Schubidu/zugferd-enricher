// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Cloudflare same-origin WASM policy", () => {
  it("allows WebAssembly compilation while rejecting general JavaScript eval", async () => {
    const headers = await readFile("public/_headers", "utf8");
    const policy = headers.split("\n").find(line => line.includes("Content-Security-Policy:"));
    expect(policy).toBeDefined();
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval';");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("object-src 'none'");
  });
});
