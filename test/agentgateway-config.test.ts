/**
 * test/agentgateway-config.test.ts — compose/agentgateway.yaml routing contract.
 *
 * Every compose service labelled `heretek.mcp.target` must have a route at
 * /mcp/<target> holding exactly one MCP target of that name, pointed at the
 * service's compose DNS name, container port and labelled path (the
 * heretek-context-router `per-target` contract). The real binary's schema
 * validation runs in `make validate-gateway`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const PROFILES = [
  "compose/profile-appsec.yml",
  "compose/profile-android.yml",
  "compose/profile-game.yml",
  "compose/profile-research.yml",
];

interface McpService {
  service: string;
  target: string;
  transport: string;
  path: string;
  containerPort: string;
}

type Yaml = Record<string, unknown>;

function load(rel: string): Yaml {
  return Bun.YAML.parse(readFileSync(join(REPO_ROOT, rel), "utf8")) as Yaml;
}

function mcpServices(): McpService[] {
  const out: McpService[] = [];
  for (const rel of PROFILES) {
    const services = load(rel).services as Record<string, Yaml>;
    for (const [service, def] of Object.entries(services)) {
      const labels = (def.labels ?? {}) as Record<string, string>;
      if (!labels["heretek.mcp.target"]) continue;
      const ports = def.ports as string[];
      out.push({
        service,
        target: labels["heretek.mcp.target"],
        transport: labels["heretek.mcp.transport"],
        path: labels["heretek.mcp.path"],
        containerPort: ports[0].split(":").pop() as string,
      });
    }
  }
  return out;
}

interface Route {
  name: string;
  matches: Array<{ path: { pathPrefix: string } }>;
  policies?: Yaml;
  backends: Array<Yaml>;
}

function routes(): Route[] {
  const config = load("compose/agentgateway.yaml");
  const binds = config.binds as Array<{ port: number; listeners: Array<{ routes: Route[] }> }>;
  expect(binds.length).toBe(1);
  expect(binds[0].port).toBe(3000);
  return binds[0].listeners.flatMap((l) => l.routes);
}

describe("agentgateway routing contract", () => {
  test("the config uses the real standalone schema (no legacy top-level keys)", () => {
    const config = load("compose/agentgateway.yaml");
    for (const key of ["version", "listeners", "targets", "roles", "authentication"]) {
      expect(config).not.toHaveProperty(key);
    }
  });

  test("every labelled MCP service in the profiles has exactly one matching route", () => {
    const services = mcpServices();
    expect(services.map((s) => s.service).sort()).toEqual(
      [
        "adb-mcp",
        "blender-mcp",
        "computer-use-linux",
        "crawl4ai",
        "ghidra-mcp",
        "godot-mcp",
        "maestro-mcp",
        "mdb-mcp",
        "radare2-mcp",
        "rea-mcp",
      ].sort(),
    );
    const all = routes();
    for (const svc of services) {
      const matching = all.filter((r) => r.matches[0].path.pathPrefix === `/mcp/${svc.target}`);
      expect(matching.length).toBe(1);
      const route = matching[0];
      expect(route.name).toBe(svc.target);
      expect(route.backends.length).toBe(1);
      const targets = (route.backends[0].mcp as { targets: Array<Record<string, { host: string } | string>> }).targets;
      expect(targets.length).toBe(1);
      expect(targets[0].name).toBe(svc.target);
      const kind = svc.transport === "sse" ? "sse" : "mcp";
      expect((targets[0][kind] as { host: string }).host).toBe(`http://${svc.service}:${svc.containerPort}${svc.path}`);
    }
  });

  test("every MCP route maps back to a labelled service (no dangling targets)", () => {
    const targets = new Set(mcpServices().map((s) => s.target));
    const mcpRoutes = routes().filter((r) => r.matches[0].path.pathPrefix.startsWith("/mcp/"));
    expect(mcpRoutes.length).toBe(targets.size);
    for (const route of mcpRoutes) expect(targets.has(route.name)).toBe(true);
  });

  test("target names never contain an underscore", () => {
    for (const svc of mcpServices()) expect(svc.target).not.toContain("_");
  });

  test("the contract target names are used", () => {
    expect(mcpServices().map((s) => s.target).sort()).toEqual(
      ["adb", "blender", "crawl4ai", "ghidra", "godot", "gui", "maestro", "mdb", "radare2", "rea"].sort(),
    );
  });

  test("every route requires an API key; mdb and gui are admin-only", () => {
    for (const route of routes()) {
      const apiKey = route.policies?.apiKey as { mode: string; keys: Array<{ key: string }> };
      expect(apiKey.mode).toBe("strict");
      expect(apiKey.keys.map((k) => k.key).sort()).toEqual(["$AGENTGATEWAY_ADMIN_KEY", "$AGENTGATEWAY_AGENT_KEY"]);
      const rules = (route.policies?.mcpAuthorization as { rules: Array<{ allow: string }> } | undefined)?.rules;
      if (route.name === "mdb" || route.name === "gui") {
        expect(rules).toEqual([{ allow: 'apiKey.role == "admin"' }]);
      }
    }
  });

  test("the LLM route forwards to bifrost", () => {
    const llm = routes().find((r) => r.name === "llm-default");
    expect(llm?.matches[0].path.pathPrefix).toBe("/v1");
    const ai = llm?.backends[0].ai as { hostOverride: string; provider: Yaml };
    expect(ai.hostOverride).toBe("bifrost:8080");
    expect(ai.provider).toHaveProperty("openAI");
  });

  test("compose runs the gateway with -f on the mounted config", () => {
    const core = load("compose/core.yml").services as Record<string, Yaml>;
    expect(core.agentgateway.command).toEqual(["-f", "/etc/agentgateway.yaml"]);
    expect(core.agentgateway.volumes).toContain("./agentgateway.yaml:/etc/agentgateway.yaml:ro,Z");
  });
});
