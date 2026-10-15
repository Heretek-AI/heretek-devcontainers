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
      for (const port of extractPortEntries(readText(file))) {
        total += 1;
        expect(port.startsWith("127.0.0.1:")).toBe(true);
      }
      expect(readText(file)).not.toContain("0.0.0.0:");
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
