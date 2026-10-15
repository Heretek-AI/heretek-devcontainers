/**
 * test/bifrost-config.test.ts — Wave 1 Bifrost 3-tier failover config tests.
 *
 * Reads compose/bifrost.yaml from disk and asserts session affinity plus
 * the opencode -> openrouter -> local-vllm fallback chain with retry policy.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BIFROST_PATH = join(import.meta.dir, "..", "compose", "bifrost.yaml");

function config(): string {
  return readFileSync(BIFROST_PATH, "utf8");
}

describe("bifrost 3-tier failover config (real file on disk)", () => {
  test("session affinity is enabled with ttl 3600s and x-session-id header", () => {
    const text = config();
    expect(text).toMatch(/session_affinity\s*:/);
    expect(text).toMatch(/enabled\s*:\s*true/);
    expect(text).toMatch(/ttl\s*:\s*["']?3600s["']?/);
    expect(text).toMatch(/header\s*:\s*["']?x-session-id["']?/);
  });

  test("all three providers are declared", () => {
    const text = config();
    const providersBlock = /providers\s*:\s*\n((?:[ \t]+.*\n?)+)/.exec(text);
    expect(providersBlock).not.toBeNull();
    for (const provider of ["opencode", "openrouter", "local-vllm"]) {
      expect(text).toMatch(new RegExp(`^\\s{2}${provider}\\s*:`, "m"));
    }
  });

  test("fallback chain is exactly opencode -> openrouter -> local-vllm", () => {
    const text = config();
    expect(text).toMatch(/primary\s*:\s*opencode/);
    const fallbacksMatch = /fallbacks\s*:\s*\n((?:[ \t]*-[^\n]*\n?)+)/.exec(text);
    expect(fallbacksMatch).not.toBeNull();
    const entries = fallbacksMatch?.[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.slice(1).trim());
    expect(entries).toEqual(["openrouter", "local-vllm"]);
    // Full chain length (primary + 2 fallbacks) is 3 tiers.
    expect(["opencode", ...(entries ?? [])]).toEqual(["opencode", "openrouter", "local-vllm"]);
  });

  test("retry policy parses Retry-After with a 300s clamp", () => {
    const text = config();
    expect(text).toMatch(/parse_retry_after\s*:\s*true/);
    expect(text).toMatch(/max_retry_after_clamp\s*:\s*["']?300s["']?/);
  });

  test("config references the required secret environment variables", () => {
    const text = config();
    expect(text).toContain("OPENROUTER_API_KEY");
    expect(text).toContain("BIFROST_API_KEY");
  });
});
