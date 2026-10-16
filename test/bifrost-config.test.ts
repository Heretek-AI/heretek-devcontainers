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
  client?: { enforce_auth_on_inference?: boolean };
  providers: Record<string, Provider>;
  governance: {
    auth_config?: { is_enabled?: boolean; admin_username?: string; admin_password?: string };
    virtual_keys?: Array<{ id: string; value?: string; is_active?: boolean; allow_all_providers?: boolean }>;
    routing_rules: RoutingRule[];
  };
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
    expect(rule.fallbacks).toEqual(["openrouter/anthropic/claude-default", "vllm/hosted-llm"]);
    // Each fallback names a model its provider key allows.
    const { providers } = config();
    for (const fallback of rule.fallbacks ?? []) {
      const slash = fallback.indexOf("/");
      const provider = fallback.slice(0, slash);
      const model = fallback.slice(slash + 1);
      expect(providers[provider].keys.some((k) => k.models?.includes(model))).toBe(true);
    }
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

  test("inference and management auth are enforced with env-referenced credentials", () => {
    const { client, governance } = config();
    expect(client?.enforce_auth_on_inference).toBe(true);
    expect(governance.auth_config).toEqual({
      is_enabled: true,
      admin_username: "env.BIFROST_ADMIN_USERNAME",
      admin_password: "env.BIFROST_ADMIN_PASSWORD",
    });
    expect(governance.virtual_keys).toHaveLength(1);
    const [vk] = governance.virtual_keys ?? [];
    expect(vk.id).toBe("agentgateway");
    expect(vk.value).toBe("env.BIFROST_VIRTUAL_KEY");
    expect(vk.is_active).toBe(true);
  });

  test("bifrost publishes no port and shares only the llm network with agentgateway", () => {
    const core = readFileSync(join(REPO_ROOT, "compose", "core.yml"), "utf8");
    const bifrost = core.slice(core.indexOf("  bifrost:"), core.indexOf("  agentgateway:"));
    expect(bifrost).not.toMatch(/^\s*ports\s*:/m);
    expect(bifrost).toContain("networks: [llm]");
    expect(core).toContain("networks: [default, llm]");
  });
});
