/**
 * test/bifrost-config.test.ts — Wave 1 Bifrost 3-tier failover config tests.
 *
 * Bifrost v2 (ghcr.io/maximhq/bifrost:v2.3.0) loads $APP_DIR/config.json
 * (APP_DIR=/app/data) at startup. These tests parse compose/bifrost.config.json
 * from disk and assert the three providers, the
 * opencode-go -> openrouter -> vllm failover routing rule, env-referenced
 * keys, and that compose/core.yml mounts the file where Bifrost reads it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const BIFROST_PATH = join(REPO_ROOT, "compose", "bifrost.config.json");

interface Key {
  name: string;
  value: string;
  models?: string[];
  weight: number;
  vllm_key_config?: { url: string; model_name: string };
}
interface Provider {
  keys: Key[];
  network_config?: { base_url?: string; allow_private_network?: boolean };
}
interface RoutingRule {
  id: string;
  enabled?: boolean;
  cel_expression?: string;
  targets: Array<{ provider?: string; model?: string; weight: number }>;
  fallbacks?: string[];
}
interface BifrostConfig {
  providers: Record<string, Provider>;
  governance: { routing_rules: RoutingRule[] };
}

function config(): BifrostConfig {
  return JSON.parse(readFileSync(BIFROST_PATH, "utf8")) as BifrostConfig;
}

describe("bifrost 3-tier failover config.json (real file on disk)", () => {
  test("core.yml mounts it read-only at /app/data/config.json", () => {
    const core = readFileSync(join(REPO_ROOT, "compose", "core.yml"), "utf8");
    expect(core).toContain("- ./bifrost.config.json:/app/data/config.json:ro,Z");
    expect(core).toContain("- bifrost-data:/app/data");
  });

  test("all three providers are declared", () => {
    expect(Object.keys(config().providers).sort()).toEqual(["opencode-go", "openrouter", "vllm"]);
  });

  test("local providers point at the host with no /v1 suffix", () => {
    const { providers } = config();
    expect(providers["opencode-go"].network_config?.base_url).toBe("http://host.docker.internal:11434");
    expect(providers.vllm.keys[0].vllm_key_config).toEqual({
      url: "http://host.docker.internal:8000",
      model_name: "hosted-llm",
    });
  });

  test("fallback chain is exactly opencode-go -> openrouter -> vllm", () => {
    const rules = config().governance.routing_rules;
    expect(rules).toHaveLength(1);
    const [rule] = rules;
    expect(rule.id).toBe("default-llm");
    expect(rule.enabled).toBe(true);
    expect(rule.cel_expression).toBe("true");
    expect(rule.targets).toEqual([{ provider: "opencode-go", weight: 1.0 }]);
    expect(rule.fallbacks).toEqual(["openrouter/", "vllm/hosted-llm"]);
  });

  test("provider keys reference env vars, never literal secrets", () => {
    const { providers } = config();
    expect(providers["opencode-go"].keys[0].value).toBe("env.BIFROST_API_KEY");
    expect(providers.openrouter.keys[0].value).toBe("env.OPENROUTER_API_KEY");
    // vLLM on-box is key-less: an empty value makes Bifrost omit the header.
    expect(providers.vllm.keys[0].value).toBe("");
    for (const provider of Object.values(providers)) {
      for (const key of provider.keys) {
        expect(key.value === "" || key.value.startsWith("env.")).toBe(true);
      }
    }
  });
});
