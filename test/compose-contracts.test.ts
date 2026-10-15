/**
 * test/compose-contracts.test.ts — Wave 1 compose security-contract tests.
 *
 * Reads the real compose files from disk and asserts the fail-closed
 * invariants: pinned images, loopback-only ports, zero socket mounts,
 * hardened capabilities, SELinux bind labels, and no banned AGPL images.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

function composeFiles(): string[] {
  const files: string[] = [];
  const root = join(REPO_ROOT, "docker-compose.yml");
  if (existsSync(root)) files.push(root);
  const dir = join(REPO_ROOT, "compose");
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir).sort()) {
      if (entry.endsWith(".yml")) files.push(join(dir, entry));
    }
  }
  return files;
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function shortName(path: string): string {
  return path.slice(REPO_ROOT.length + 1);
}

function extractImages(text: string): string[] {
  const images: string[] = [];
  for (const line of text.split("\n")) {
    const hash = line.indexOf("#");
    const code = hash === -1 ? line : line.slice(0, hash);
    const match = /image\s*:\s*(.+)/.exec(code);
    if (!match) continue;
    let value = match[1].trim().replace(/,+$/, "").trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (value !== "") images.push(value.trim());
  }
  return images;
}

function extractPortEntries(text: string): string[] {
  const entries: string[] = [];
  const lines = text.split("\n");
  let inPorts = false;
  let portsIndent = -1;
  const indentOf = (line: string): number => /^( *)/.exec(line)?.[1].length ?? 0;
  for (const line of lines) {
    const hash = line.indexOf("#");
    const code = (hash === -1 ? line : line.slice(0, hash)).replace(/\s+$/, "");
    if (!inPorts) {
      if (/^\s*ports\s*:\s*$/.test(code)) {
        inPorts = true;
        portsIndent = indentOf(code);
      }
      continue;
    }
    if (code.trim() === "") continue;
    if (indentOf(code) <= portsIndent) {
      inPorts = false;
      const keyMatch = /^\s*ports\s*:\s*$/.test(code);
      if (keyMatch) {
        inPorts = true;
        portsIndent = indentOf(code);
      }
      continue;
    }
    const entry = /^\s*-\s*(.+?)\s*$/.exec(code);
    if (!entry) continue;
    let value = entry[1].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (/^(target|host_ip|published|protocol|mode)\s*:/.test(value)) continue;
    entries.push(value);
  }
  return entries;
}

describe("compose contracts (real files on disk)", () => {
  test("at least root compose + core.yml are scanned", () => {
    const files = composeFiles();
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.some((f) => f.endsWith("docker-compose.yml"))).toBe(true);
    expect(files.some((f) => f.endsWith("compose/core.yml"))).toBe(true);
  });

  test("zero floating :latest tags — every image carries an explicit version", () => {
    const images: string[] = [];
    for (const file of composeFiles()) {
      for (const image of extractImages(readText(file))) {
        images.push(`${shortName(file)} -> ${image}`);
        const tagPart = image.slice(image.lastIndexOf("/") + 1);
        expect(tagPart.includes(":")).toBe(true);
        const tag = tagPart.slice(tagPart.lastIndexOf(":") + 1);
        expect(tag).not.toBe("latest");
        expect(tag.length).toBeGreaterThan(0);
      }
    }
    expect(images.length).toBeGreaterThan(0);
  });

  test("core images are pinned to the exact spec versions", () => {
    const core = readText(join(REPO_ROOT, "compose/core.yml"));
    expect(core).toContain("ghcr.io/maximhq/bifrost:v1.0.0");
    expect(core).toContain("ghcr.io/agentgateway/agentgateway:v1.6.0");
    expect(core).toContain("nats:2.15.1-alpine");
  });

  test("all published ports bind 127.0.0.1 loopback only", () => {
    let total = 0;
    for (const file of composeFiles()) {
      const text = readText(file);
      for (const port of extractPortEntries(text)) {
        total += 1;
        expect(port.startsWith("127.0.0.1:")).toBe(true);
      }
      // Scoped to published `ports:` entries only: a container-internal
      // listen address such as radare2-mcp's `-H 0.0.0.0:8765` (SPEC §2.2,
      // never published to the host — the published mapping above stays
      // loopback-only) must NOT trip this invariant.
      const lines = text.split("\n");
      let inPorts = false;
      let portsIndent = -1;
      const indentOf = (line: string): number => /^( *)/.exec(line)?.[1].length ?? 0;
      for (const line of lines) {
        const code = line.split("#")[0];
        if (!inPorts) {
          if (/^\s*ports\s*:\s*$/.test(code)) {
            inPorts = true;
            portsIndent = indentOf(code);
          }
          continue;
        }
        if (code.trim() === "") continue;
        if (indentOf(code) <= portsIndent) {
          inPorts = false;
          continue;
        }
        expect(code).not.toContain("0.0.0.0");
      }
      expect(text).not.toContain("host_ip: 0.0.0.0");
    }
    expect(total).toBeGreaterThan(0);
  });

  test("zero docker.sock / podman.sock mounts", () => {
    for (const file of composeFiles()) {
      const text = readText(file);
      expect(text).not.toContain("docker.sock");
      expect(text).not.toContain("podman.sock");
    }
  });

  test("every service sets cap_drop ALL and no-new-privileges", () => {
    const core = readText(join(REPO_ROOT, "compose/core.yml"));
    for (const service of ["bifrost", "agentgateway", "nats"]) {
      expect(core).toContain(service);
    }
    const capDrops = core.match(/cap_drop\s*:\s*\[ALL\]/g) ?? [];
    // Root compose declares no services; every core.yml service must harden.
    expect(capDrops.length).toBe(3);
    const noNewPrivs = core.match(/no-new-privileges:true/g) ?? [];
    expect(noNewPrivs.length).toBe(3);
  });

  test("every bind mount carries an SELinux label (:z/:Z/:ro,Z)", () => {
    for (const file of composeFiles()) {
      const lines = readText(file).split("\n");
      let inVolumes = false;
      let volumesIndent = -1;
      const indentOf = (line: string): number => /^( *)/.exec(line)?.[1].length ?? 0;
      for (const line of lines) {
        const code = line.split("#")[0];
        if (!inVolumes) {
          if (/^\s*volumes\s*:\s*$/.test(code)) {
            inVolumes = true;
            volumesIndent = indentOf(code);
          }
          continue;
        }
        if (code.trim() === "") continue;
        if (indentOf(code) <= volumesIndent) {
          inVolumes = false;
          continue;
        }
        const entry = /^\s*-\s*(.+?)\s*$/.exec(code);
        if (!entry) continue;
        let value = entry[1].trim();
        if (value.startsWith('"') || value.startsWith("'")) value = value.slice(1, -1);
        const host = value.split(":")[0].trim();
        const isBind =
          host.startsWith("./") || host.startsWith("../") || host.startsWith("/") || host === "." || host === "..";
        if (!isBind) continue;
        expect(/:(ro,)?[zZ]\b/.test(value)).toBe(true);
      }
    }
  });

  test("no banned AGPL/root-escape images", () => {
    const banned = ["firecrawl", "rfingadam", "bytebot", "0xflux", "pentagi"];
    for (const file of composeFiles()) {
      const lowered = readText(file).toLowerCase();
      for (const token of banned) {
        expect(lowered.includes(token)).toBe(false);
      }
    }
  });

  test("root compose orchestrates via include:", () => {
    const root = readText(join(REPO_ROOT, "docker-compose.yml"));
    expect(root).toContain("include:");
    for (const profile of [
      "compose/core.yml",
      "compose/profile-appsec.yml",
      "compose/profile-android.yml",
      "compose/profile-game.yml",
      "compose/profile-research.yml",
    ]) {
      expect(root).toContain(profile);
    }
  });
});

describe("wave 2 specialist profiles (real files on disk)", () => {
  const PROFILE_FILES = [
    "compose/profile-appsec.yml",
    "compose/profile-android.yml",
    "compose/profile-game.yml",
    "compose/profile-research.yml",
  ];

  const EXPECTED_SERVICES: Record<string, string[]> = {
    "compose/profile-appsec.yml": ["ghidra-mcp", "radare2-mcp", "rea-mcp", "mdb-mcp"],
    "compose/profile-android.yml": ["android-kvm", "adb-mcp", "maestro-mcp"],
    "compose/profile-game.yml": ["godot-mcp", "blender-mcp"],
    "compose/profile-research.yml": ["searxng", "crawl4ai", "computer-use-linux"],
  };

  const EXPECTED_IMAGES: Record<string, string> = {
    "ghidra-mcp": "bethington/ghidra-mcp-headless:v6.0.0",
    "radare2-mcp": "ghcr.io/radareorg/radare2-mcp:1.8.8",
    "rea-mcp": "ghcr.io/morluto/rea:6.5.0",
    "mdb-mcp": "ghcr.io/smadi0x86/mdb-mcp:1.2.0",
    "android-kvm": "budtmo/docker-android:emulator_14.0",
    "adb-mcp": "ghcr.io/iksnerd/adb-mcp:v1.4.0",
    "maestro-mcp": "ghcr.io/mobile-dev-inc/maestro:v1.39.8",
    "godot-mcp": "ghcr.io/tugcantopaloglu/godot-mcp:v3.1.0",
    "blender-mcp": "ghcr.io/sandraschi/blender-mcp:v1.2.0",
    searxng: "searxng/searxng:2026.10.14",
    crawl4ai: "unclecode/crawl4ai:0.9.5",
    "computer-use-linux": "ghcr.io/agent-sh/computer-use-linux:v0.9.4",
  };

  const EXPECTED_PORTS: Record<string, string[]> = {
    "ghidra-mcp": ["127.0.0.1:8089:8089"],
    "radare2-mcp": ["127.0.0.1:8765:8765"],
    "rea-mcp": ["127.0.0.1:8766:8766"],
    "mdb-mcp": ["127.0.0.1:8767:8767"],
    "android-kvm": ["127.0.0.1:6080:6080", "127.0.0.1:5555:5555"],
    "adb-mcp": ["127.0.0.1:8770:8770"],
    "maestro-mcp": ["127.0.0.1:8771:8771"],
    "godot-mcp": ["127.0.0.1:8780:8780"],
    "blender-mcp": ["127.0.0.1:8781:8781"],
    searxng: ["127.0.0.1:8888:8080"],
    crawl4ai: ["127.0.0.1:11235:11235"],
    "computer-use-linux": ["127.0.0.1:8790:8790"],
  };

  test("all 4 profile files exist", () => {
    for (const rel of PROFILE_FILES) {
      expect(existsSync(join(REPO_ROOT, rel))).toBe(true);
    }
  });

  test("every profile declares its spec-mandated services", () => {
    for (const [rel, services] of Object.entries(EXPECTED_SERVICES)) {
      const text = readText(join(REPO_ROOT, rel));
      for (const service of services) {
        expect(text).toContain(`  ${service}:`);
      }
    }
  });

  test("every wave-2 service image is pinned to its exact spec version", () => {
    let total = 0;
    for (const rel of PROFILE_FILES) {
      const text = readText(join(REPO_ROOT, rel));
      for (const service of EXPECTED_SERVICES[rel]) {
        const image = EXPECTED_IMAGES[service];
        expect(text).toContain(`image: ${image}`);
        total += 1;
      }
    }
    expect(total).toBe(12);
  });

  test("every wave-2 service publishes its exact spec loopback ports", () => {
    for (const rel of PROFILE_FILES) {
      const text = readText(join(REPO_ROOT, rel));
      for (const service of EXPECTED_SERVICES[rel]) {
        for (const port of EXPECTED_PORTS[service]) {
          expect(text).toContain(`"${port}"`);
        }
      }
    }
  });

  test("no floating :latest tags in any wave-2 profile", () => {
    for (const rel of PROFILE_FILES) {
      const text = readText(join(REPO_ROOT, rel));
      expect(text).not.toContain(":latest");
      for (const image of extractImages(text)) {
        const tagPart = image.slice(image.lastIndexOf("/") + 1);
        expect(tagPart.includes(":")).toBe(true);
        const tag = tagPart.slice(tagPart.lastIndexOf(":") + 1);
        expect(tag).not.toBe("latest");
        expect(tag.length).toBeGreaterThan(0);
      }
    }
  });

  test("zero docker.sock / podman.sock mounts in any wave-2 profile", () => {
    for (const rel of PROFILE_FILES) {
      const text = readText(join(REPO_ROOT, rel));
      expect(text).not.toContain("docker.sock");
      expect(text).not.toContain("podman.sock");
    }
  });

  test("every wave-2 service sets cap_drop ALL and no-new-privileges", () => {
    for (const rel of PROFILE_FILES) {
      const text = readText(join(REPO_ROOT, rel));
      const services = EXPECTED_SERVICES[rel];
      const capDrops = text.match(/cap_drop\s*:\s*\[ALL\]/g) ?? [];
      expect(capDrops.length).toBe(services.length);
      const noNewPrivs = text.match(/no-new-privileges:true/g) ?? [];
      expect(noNewPrivs.length).toBe(services.length);
    }
  });

  test("mdb-mcp keeps its sole documented SYS_PTRACE exception (and nothing else does)", () => {
    const appsec = readText(join(REPO_ROOT, "compose/profile-appsec.yml"));
    expect(appsec).toContain("cap_add: [SYS_PTRACE]");
    for (const rel of [
      "compose/profile-android.yml",
      "compose/profile-game.yml",
      "compose/profile-research.yml",
    ]) {
      expect(readText(join(REPO_ROOT, rel))).not.toContain("cap_add");
    }
  });

  test("no banned AGPL/root-escape images in any wave-2 profile", () => {
    const banned = ["firecrawl", "rfingadam", "bytebot", "0xflux", "pentagi"];
    for (const rel of PROFILE_FILES) {
      const lowered = readText(join(REPO_ROOT, rel)).toLowerCase();
      for (const token of banned) {
        expect(lowered.includes(token)).toBe(false);
      }
    }
  });

  test("every wave-2 service carries its on-demand profile pair", () => {
    const profileOf: Record<string, string> = {
      "compose/profile-appsec.yml": "appsec",
      "compose/profile-android.yml": "android",
      "compose/profile-game.yml": "game",
      "compose/profile-research.yml": "research",
    };
    for (const rel of PROFILE_FILES) {
      const text = readText(join(REPO_ROOT, rel));
      const name = profileOf[rel];
      const occurrences = text.match(new RegExp(`profiles:\\s*\\["${name}",\\s*"all"\\]`, "g")) ?? [];
      expect(occurrences.length).toBe(EXPECTED_SERVICES[rel].length);
    }
  });

  test("ghidra-mcp mandates GHIDRA_MCP_AUTH_TOKEN at runtime", () => {
    const appsec = readText(join(REPO_ROOT, "compose/profile-appsec.yml"));
    expect(appsec).toContain("GHIDRA_MCP_AUTH_TOKEN");
    expect(appsec).toContain("${GHIDRA_MCP_AUTH_TOKEN:");
  });

  test("radare2-mcp runs its spec read-only command", () => {
    const appsec = readText(join(REPO_ROOT, "compose/profile-appsec.yml"));
    expect(appsec).toContain('command: ["r2mcp", "-H", "0.0.0.0:8765", "-r"]');
  });

  test("android-kvm passes through /dev/kvm", () => {
    const android = readText(join(REPO_ROOT, "compose/profile-android.yml"));
    expect(android).toContain("/dev/kvm:/dev/kvm");
  });

  test("adb-mcp targets android-kvm:5555 and maestro-mcp runs its spec command", () => {
    const android = readText(join(REPO_ROOT, "compose/profile-android.yml"));
    expect(android).toContain("ANDROID_HOST: android-kvm");
    expect(android).toContain('command: ["maestro", "mcp"]');
    expect(android).toContain("depends_on:");
  });

  test("godot-mcp runs headless and blender-mcp runs background FastMCP", () => {
    const game = readText(join(REPO_ROOT, "compose/profile-game.yml"));
    expect(game).toContain("GODOT_HEADLESS");
    expect(game).toContain('command: ["blender", "--background"]');
  });

  test("crawl4ai reserves 1g shm and searxng mandates its secret", () => {
    const research = readText(join(REPO_ROOT, "compose/profile-research.yml"));
    expect(research).toContain('shm_size: "1g"');
    expect(research).toContain("${SEARXNG_SECRET:");
  });

  test("computer-use-linux declares headless Sway environment", () => {
    const research = readText(join(REPO_ROOT, "compose/profile-research.yml"));
    expect(research).toContain("WLR_BACKENDS: headless");
  });

  test("every wave-2 service runs as non-root 1000:1000", () => {
    for (const rel of PROFILE_FILES) {
      const text = readText(join(REPO_ROOT, rel));
      const users = text.match(/user:\s*"1000:1000"/g) ?? [];
      expect(users.length).toBe(EXPECTED_SERVICES[rel].length);
    }
  });
});
