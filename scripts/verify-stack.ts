/**
 * scripts/verify-stack.ts — Deterministic static contract verifier (Wave 1).
 *
 * Audits every in-scope file and FAILS CLOSED (exit 1, exact `file:line` +
 * rule name) when any security/pinning invariant is broken:
 *
 *   NO_FLOATING_TAGS       — `image:` ending in `:latest` or lacking a `:tag`.
 *   NO_DOCKER_SOCK         — any volume/mount referencing docker.sock/podman.sock.
 *   LOOPBACK_PORTS_ONLY    — any published `ports:` entry not starting `127.0.0.1:`.
 *   HARDENED_CAPS          — any compose service missing `cap_drop: [ALL]` or
 *                            `no-new-privileges:true`.
 *   SELINUX_VOLUME_LABELS  — any bind mount (`./…` or `/…` host path) in compose
 *                            or devcontainer files missing `:z`, `:Z` or `:ro,Z`.
 *   NO_AGPL_IN_DEV_OR_GAME — any image referencing firecrawl,
 *                            RFingAdam/mcp-blender, bytebot, 0xflux/ghidra-mcp
 *                            or pentagi (case-insensitive).
 *   ENV_PLACEHOLDER_LEAK   — a real `.env` containing a `CHANGEME_` token.
 *                            (`.env.example` is the template and MUST keep them.)
 *
 * Scanned roots (each skipped gracefully when absent — Wave 1 has no
 * devcontainers/quadlets yet, Wave 2/3 add them):
 *   docker-compose.yml, compose/*.yml,
 *   devcontainers slash-star .devcontainer.json, quadlets/*.container,
 *   .env (placeholder check only).
 *
 * Zero dependencies beyond the Bun/Node standard library.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

interface Violation {
  file: string;
  line: number;
  rule: string;
  message: string;
}

const REPO_ROOT = join(import.meta.dir, "..");
const violations: Violation[] = [];
let filesScanned = 0;

function repoRel(path: string): string {
  return relative(REPO_ROOT, path) || path;
}

function fail(file: string, line: number, rule: string, message: string): void {
  violations.push({ file, line, rule, message });
}

function readLines(path: string): string[] {
  return readFileSync(path, "utf8").split("\n");
}

function indentOf(line: string): number {
  const match = /^( *)/.exec(line);
  return match ? match[1].length : 0;
}

function stripComment(line: string): string {
  // Cut trailing `# comment`, but keep `#` inside quotes (image digests never
  // contain `#`, URLs may contain fragments — only cut ` #` outside quotes).
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquote(value: string): string {
  const t = value.trim().replace(/,+$/, "").trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Compose-file checks (docker-compose.yml + compose/*.yml files that declare
// `services:`). Non-service YAML (bifrost.yaml, agentgateway.yaml) still gets
// the generic substring rules via checkGenericContent.
// ---------------------------------------------------------------------------

const BANNED_IMAGE_TOKENS = ["firecrawl", "rfingadam", "bytebot", "0xflux", "pentagi"];

function checkGenericContent(path: string, lines: string[]): void {
  const display = repoRel(path);
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const lowered = raw.toLowerCase();
    if (lowered.includes("docker.sock") || lowered.includes("podman.sock")) {
      fail(display, lineNo, "NO_DOCKER_SOCK", `socket mount reference forbidden: ${raw.trim()}`);
    }
    const imageMatch = /image\s*:\s*(.+)/.exec(stripComment(raw));
    if (imageMatch) {
      const image = unquote(imageMatch[1]);
      if (BANNED_IMAGE_TOKENS.some((token) => image.toLowerCase().includes(token))) {
        fail(display, lineNo, "NO_AGPL_IN_DEV_OR_GAME", `banned AGPL/root-escape image: ${image}`);
      }
    } else if (
      BANNED_IMAGE_TOKENS.some((token) => lowered.includes(token)) &&
      /image|from\s|container/i.test(raw)
    ) {
      fail(display, lineNo, "NO_AGPL_IN_DEV_OR_GAME", `banned token in image context: ${raw.trim()}`);
    }
  });
}

interface ServiceBlock {
  name: string;
  startLine: number;
  lines: Array<{ text: string; lineNo: number }>;
}

function splitServices(lines: string[]): ServiceBlock[] {
  const servicesIdx = lines.findIndex((l) => /^services\s*:\s*(#.*)?$/.test(l));
  if (servicesIdx === -1) return [];
  const blocks: ServiceBlock[] = [];
  let current: ServiceBlock | null = null;
  let inServices = true;
  for (let i = servicesIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || stripComment(line).trim() === "") continue;
    // A new top-level section (e.g. `volumes:`, `networks:`) ends `services:`.
    // Its nested keys (e.g. `  nats-data:`) are NOT services — stop parsing.
    if (/^[A-Za-z0-9_.-]+\s*:\s*(#.*)?$/.test(line) && indentOf(line) === 0) {
      inServices = false;
      current = null;
      continue;
    }
    if (!inServices) continue;
    const serviceHead = /^  ([A-Za-z0-9_.-]+)\s*:\s*(#.*)?$/.exec(line);
    if (serviceHead && indentOf(line) === 2) {
      current = { name: serviceHead[1], startLine: i + 1, lines: [] };
      blocks.push(current);
      continue;
    }
    if (/^\S/.test(line)) {
      // Back to top level — services section ended.
      current = null;
      inServices = false;
      continue;
    }
    if (current) current.lines.push({ text: line, lineNo: i + 1 });
  }
  return blocks;
}

function checkFloatingTags(display: string, lines: string[]): void {
  lines.forEach((raw, idx) => {
    const match = /image\s*:\s*(.+)/.exec(stripComment(raw));
    if (!match) return;
    const image = unquote(match[1]).trim();
    if (image === "") {
      fail(display, idx + 1, "NO_FLOATING_TAGS", "empty image reference");
      return;
    }
    // Registry ports (ghcr.io:443/…) contain a colon before the first slash;
    // the tag is whatever follows the LAST colon after the last slash.
    const lastSlash = image.lastIndexOf("/");
    const tagPart = image.slice(lastSlash + 1);
    if (!tagPart.includes(":")) {
      fail(display, idx + 1, "NO_FLOATING_TAGS", `image missing explicit version tag: ${image}`);
      return;
    }
    const tag = tagPart.slice(tagPart.lastIndexOf(":") + 1);
    if (tag === "latest" || tag === "") {
      fail(display, idx + 1, "NO_FLOATING_TAGS", `floating/empty image tag forbidden: ${image}`);
    }
  });
}

function checkLoopbackPorts(display: string, block: ServiceBlock): void {
  let inPorts = false;
  let portsIndent = -1;
  for (const { text, lineNo } of block.lines) {
    const code = stripComment(text);
    if (!inPorts) {
      const keyMatch = /^(\s*)ports\s*:\s*(#.*)?$/.exec(code);
      if (keyMatch) {
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
    const entry = /^\s*-\s*(.+?)\s*$/.exec(code);
    if (!entry) continue; // long-syntax keys handled below; short entries only here
    const value = unquote(entry[1].trim());
    // Long-syntax mapping continuation lines (`target:`, `host_ip:`) are not
    // list entries with a dash — but a dash entry could still be long syntax
    // start (`- target: 8080`). Require explicit host_ip loopback then.
    if (/^(target|host_ip|published|protocol|mode)\s*:/.test(value)) {
      continue;
    }
    if (!value.startsWith("127.0.0.1:")) {
      fail(
        display,
        lineNo,
        "LOOPBACK_PORTS_ONLY",
        `service "${block.name}" port must bind 127.0.0.1:<host>:<container>, got: ${value}`,
      );
    }
  }
  // Long-syntax host_ip check: any host_ip that is not 127.0.0.1 fails.
  for (const { text, lineNo } of block.lines) {
    const m = /host_ip\s*:\s*(.+)/.exec(stripComment(text));
    if (!m) continue;
    const ip = unquote(m[1]).trim();
    if (ip !== "127.0.0.1") {
      fail(display, lineNo, "LOOPBACK_PORTS_ONLY", `service "${block.name}" host_ip must be 127.0.0.1, got: ${ip}`);
    }
  }
}

function checkHardenedCaps(display: string, block: ServiceBlock): void {
  const codeLines = block.lines.map((l) => stripComment(l.text));
  const body = codeLines.join("\n");
  // Accept both inline (`cap_drop: [ALL]`) and block-list (`cap_drop:\n  - ALL`) forms.
  const inlineDrop = /cap_drop\s*:\s*\[[^\]]*ALL[^\]]*\]/.test(body);
  let blockDrop = false;
  for (let i = 0; i < codeLines.length; i++) {
    if (/^\s*cap_drop\s*:\s*$/.test(codeLines[i])) {
      const keyIndent = indentOf(codeLines[i]);
      for (let j = i + 1; j < codeLines.length; j++) {
        if (codeLines[j].trim() === "") continue;
        if (indentOf(codeLines[j]) <= keyIndent) break;
        if (/^\s*-\s*ALL\s*$/.test(codeLines[j])) blockDrop = true;
      }
    }
  }
  if (!inlineDrop && !blockDrop) {
    fail(display, block.startLine, "HARDENED_CAPS", `service "${block.name}" missing cap_drop: [ALL]`);
  }
  if (!/no-new-privileges\s*:?\s*true/.test(body)) {
    fail(
      display,
      block.startLine,
      "HARDENED_CAPS",
      `service "${block.name}" missing security_opt no-new-privileges:true`,
    );
  }
}

function checkSelinuxLabels(display: string, block: ServiceBlock): void {
  let inVolumes = false;
  let volumesIndent = -1;
  for (const { text, lineNo } of block.lines) {
    const code = stripComment(text);
    if (!inVolumes) {
      const keyMatch = /^(\s*)volumes\s*:\s*(#.*)?$/.exec(code);
      if (keyMatch) {
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
    const value = unquote(entry[1].trim());
    if (value.startsWith("type:") || value.startsWith("source:") || value.startsWith("target:")) continue;
    const hostPart = value.split(":")[0].trim();
    const isBind = hostPart.startsWith("./") || hostPart.startsWith("../") || hostPart.startsWith("/") || hostPart === "." || hostPart === "..";
    if (!isBind) continue; // named volume (e.g. nats-data:/data) — no label needed
    if (!/:ro,[zZ]\b/.test(value) && !/:[zZ]\b/.test(value)) {
      fail(
        display,
        lineNo,
        "SELINUX_VOLUME_LABELS",
        `service "${block.name}" bind mount missing :z/:Z/:ro,Z SELinux label: ${value}`,
      );
    }
  }
}

function checkComposeFile(path: string): void {
  const display = repoRel(path);
  const lines = readLines(path);
  filesScanned += 1;
  checkGenericContent(path, lines);
  checkFloatingTags(display, lines);
  const services = splitServices(lines);
  for (const block of services) {
    checkLoopbackPorts(display, block);
    checkHardenedCaps(display, block);
    checkSelinuxLabels(display, block);
  }
}

// ---------------------------------------------------------------------------
// Devcontainer / quadlet / env checks
// ---------------------------------------------------------------------------

function checkDevcontainerFile(path: string): void {
  const display = repoRel(path);
  filesScanned += 1;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    fail(display, 1, "NO_DOCKER_SOCK", "unreadable devcontainer file (fail closed)");
    return;
  }
  const lines = raw.split("\n");
  checkGenericContent(path, lines);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(display, 1, "NO_DOCKER_SOCK", "devcontainer JSON does not parse (fail closed)");
    return;
  }
  const text = JSON.stringify(parsed);
  const lowered = text.toLowerCase();
  if (lowered.includes("docker.sock") || lowered.includes("podman.sock")) {
    fail(display, 1, "NO_DOCKER_SOCK", "devcontainer mounts a container socket");
  }
  // Bind-mount SELinux labels: inspect mount strings in runArgs/mounts.
  const mountStrings: string[] = [];
  const collect = (node: unknown): void => {
    if (typeof node === "string") {
      if (node.includes(":/") || node.startsWith("./") || node.startsWith("/")) mountStrings.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) collect(item);
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const value of Object.values(node as Record<string, unknown>)) collect(value);
    }
  };
  collect(parsed);
  mountStrings.forEach((mount) => {
    const hostPart = mount.split(":")[0];
    const isBind =
      hostPart.startsWith("./") || hostPart.startsWith("../") || hostPart.startsWith("/") || mount.includes("type=bind");
    if (isBind && !/:ro,[zZ]\b/.test(mount) && !/:[zZ]\b/.test(mount) && !/,Z\b/.test(mount) && !/,z\b/.test(mount)) {
      fail(display, 1, "SELINUX_VOLUME_LABELS", `devcontainer bind mount missing SELinux label: ${mount}`);
    }
  });
  // Pinned-image check for devcontainer `image` fields.
  const checkImage = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) checkImage(item);
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === "image" && typeof value === "string") {
          const image = value.trim();
          const tagPart = image.slice(image.lastIndexOf("/") + 1);
          if (!tagPart.includes(":") || tagPart.endsWith(":latest")) {
            fail(display, 1, "NO_FLOATING_TAGS", `devcontainer image not pinned: ${image}`);
          }
        } else {
          checkImage(value);
        }
      }
    }
  };
  checkImage(parsed);
}

function checkQuadletFile(path: string): void {
  const display = repoRel(path);
  const lines = readLines(path);
  filesScanned += 1;
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const code = stripComment(raw).trim();
    const imageMatch = /^Image\s*=\s*(.+?)\s*$/.exec(code);
    if (imageMatch) {
      const image = imageMatch[1].trim();
      const tagPart = image.slice(image.lastIndexOf("/") + 1);
      if (!tagPart.includes(":") || tagPart.endsWith(":latest")) {
        fail(display, lineNo, "NO_FLOATING_TAGS", `quadlet image not pinned: ${image}`);
      }
      if (BANNED_IMAGE_TOKENS.some((token) => image.toLowerCase().includes(token))) {
        fail(display, lineNo, "NO_AGPL_IN_DEV_OR_GAME", `banned AGPL/root-escape image: ${image}`);
      }
    }
    const lowered = raw.toLowerCase();
    if (lowered.includes("docker.sock") || lowered.includes("podman.sock")) {
      fail(display, lineNo, "NO_DOCKER_SOCK", `socket reference forbidden: ${raw.trim()}`);
    }
  });
}

function checkRealEnv(path: string): void {
  const display = repoRel(path);
  if (!existsSync(path)) return;
  filesScanned += 1;
  readLines(path).forEach((raw, idx) => {
    if (raw.includes("CHANGEME_")) {
      fail(display, idx + 1, "ENV_PLACEHOLDER_LEAK", "real .env still contains a CHANGEME_ placeholder token");
    }
  });
}

function collectFiles(dir: string, suffix: string, out: string[]): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectFiles(full, suffix, out);
    } else if (entry.endsWith(suffix)) {
      out.push(full);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const composeFiles: string[] = [];
  const rootCompose = join(REPO_ROOT, "docker-compose.yml");
  if (existsSync(rootCompose)) composeFiles.push(rootCompose);
  collectFiles(join(REPO_ROOT, "compose"), ".yml", composeFiles);

  // Non-service YAML configs (bifrost.yaml, agentgateway.yaml) get generic
  // substring rules only — they declare no services/images/ports.
  const genericYaml: string[] = [];
  collectFiles(join(REPO_ROOT, "compose"), ".yaml", genericYaml);

  const devcontainers: string[] = [];
  collectFiles(join(REPO_ROOT, "devcontainers"), ".devcontainer.json", devcontainers);
  // Also catch plain .json devcontainer fragments if the tree uses them.
  const devJson: string[] = [];
  collectFiles(join(REPO_ROOT, "devcontainers"), ".json", devJson);
  for (const f of devJson) {
    if (!devcontainers.includes(f)) devcontainers.push(f);
  }

  const quadlets: string[] = [];
  collectFiles(join(REPO_ROOT, "quadlets"), ".container", quadlets);

  for (const file of composeFiles.sort()) checkComposeFile(file);
  for (const file of genericYaml.sort()) {
    filesScanned += 1;
    checkGenericContent(file, readLines(file));
  }
  for (const file of devcontainers.sort()) checkDevcontainerFile(file);
  for (const file of quadlets.sort()) checkQuadletFile(file);
  checkRealEnv(join(REPO_ROOT, ".env"));

  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`FAIL [${v.rule}] ${v.file}:${v.line}: ${v.message}`);
    }
    console.error(`verify-stack: ${violations.length} violation(s) in ${filesScanned} file(s) — FAIL CLOSED`);
    process.exit(1);
  }
  console.log(`PASS: all security contracts hold across ${filesScanned} scanned file(s).`);
}

main();
