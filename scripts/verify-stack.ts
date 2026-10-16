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
 *   SELINUX_CONFINED       — a quadlet that opts out of SELinux confinement
 *                            (`SecurityLabelType=spc_t`/`spc`, `SecurityLabelDisable=true`)
 *                            or runs privileged.
 *   QUADLET_SOCKET_ACTIVATION — a quadlet container that can start on its own
 *                            (`[Install]`/`WantedBy=`, no `StopWhenUnneeded=true`) or
 *                            lacks a loopback `.socket` + systemd-socket-proxyd
 *                            `.service` pair that Requires=/After= it and exits idle.
 *
 * Local builds: a compose service with `build:` must tag its image as
 * `localhost/<name>:<version>` (NO_FLOATING_TAGS); Dockerfile `FROM` and
 * `COPY --from=` images must carry an explicit version tag.
 *
 * Scanned roots (each skipped gracefully when absent):
 *   docker-compose.yml, compose/*.yml (+ compose/*.yaml, *.json generic rules),
 *   devcontainers/** (.json + Dockerfile), images/** /Dockerfile,
 *   quadlets/*.container, quadlets/*.socket, quadlets/*.service,
 *   .env (placeholder check only).
 *
 * Usage: bun run scripts/verify-stack.ts [--root <dir>]
 *   --root defaults to the repository root; tests point it at fixture trees.
 *
 * Zero dependencies beyond the Bun/Node standard library.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { dockerfileImages, isLocalImage, isPinned, parseImageRef } from "./lib/image-ref";

interface Violation {
  file: string;
  line: number;
  rule: string;
  message: string;
}

function parseRoot(argv: string[]): string {
  let root = join(import.meta.dir, "..");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      const value = argv[i + 1];
      if (!value) {
        console.error("verify-stack: --root requires a directory");
        process.exit(2);
      }
      root = resolve(value);
      i += 1;
    } else {
      console.error(`verify-stack: unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`verify-stack: --root is not a directory: ${root}`);
    process.exit(2);
  }
  return root;
}

const REPO_ROOT = parseRoot(process.argv.slice(2));
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
// `services:`). Non-service configs (bifrost.config.json, agentgateway.yaml)
// still get the generic substring rules via checkGenericContent.
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

function checkLocalBuild(display: string, block: ServiceBlock): void {
  const build = block.lines.find((l) => /^ {4}build\s*:/.test(stripComment(l.text)));
  if (!build) return;
  const imageLine = block.lines.find((l) => /^ {4}image\s*:/.test(stripComment(l.text)));
  if (!imageLine) {
    fail(display, block.startLine, "NO_FLOATING_TAGS", `service "${block.name}" builds an image without a versioned image: tag`);
    return;
  }
  const image = unquote(stripComment(imageLine.text).replace(/^\s*image\s*:/, ""));
  let local = false;
  try {
    const ref = parseImageRef(image);
    local = isLocalImage(ref) && isPinned(ref) && ref.digest === null;
  } catch {
    local = false;
  }
  if (!local) {
    fail(
      display,
      imageLine.lineNo,
      "NO_FLOATING_TAGS",
      `service "${block.name}" builds locally; its image must be localhost/<name>:<version>, got: ${image}`,
    );
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
    checkLocalBuild(display, block);
  }
}

function checkDockerfile(path: string): void {
  const display = repoRel(path);
  filesScanned += 1;
  checkGenericContent(path, readLines(path));
  for (const found of dockerfileImages(path, REPO_ROOT)) {
    let pinned = false;
    try {
      pinned = isPinned(parseImageRef(found.ref));
    } catch {
      pinned = false;
    }
    if (!pinned) {
      fail(display, found.line, "NO_FLOATING_TAGS", `Dockerfile base image not pinned to a version: ${found.ref}`);
    }
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

interface UnitEntry {
  section: string;
  key: string;
  value: string;
  lineNo: number;
}

function parseUnit(path: string): UnitEntry[] {
  const entries: UnitEntry[] = [];
  let section = "";
  readLines(path).forEach((raw, idx) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) return;
    const head = /^\[([^\]]+)\]$/.exec(line);
    if (head) {
      section = head[1];
      return;
    }
    const kv = /^([A-Za-z0-9]+)\s*=\s*(.*)$/.exec(line);
    if (kv) entries.push({ section, key: kv[1], value: kv[2].trim(), lineNo: idx + 1 });
  });
  return entries;
}

function unitValues(entries: UnitEntry[], key: string): string[] {
  return entries
    .filter((e) => e.key === key)
    .flatMap((e) => e.value.split(/\s+/))
    .filter((v) => v !== "");
}

function checkUnitGeneric(path: string): void {
  const display = repoRel(path);
  readLines(path).forEach((raw, idx) => {
    const lowered = raw.toLowerCase();
    if (lowered.includes("docker.sock") || lowered.includes("podman.sock")) {
      fail(display, idx + 1, "NO_DOCKER_SOCK", `socket reference forbidden: ${raw.trim()}`);
    }
  });
}

function checkQuadletFile(path: string, sockets: string[], services: string[]): void {
  const display = repoRel(path);
  filesScanned += 1;
  checkUnitGeneric(path);
  const entries = parseUnit(path);
  const unitName = `${basename(path, ".container")}.service`;
  for (const e of entries) {
    if (e.key === "Image") {
      const image = e.value;
      if (!/\.(build|image)$/.test(image)) {
        let pinned = false;
        try {
          pinned = isPinned(parseImageRef(image));
        } catch {
          pinned = false;
        }
        if (!pinned) fail(display, e.lineNo, "NO_FLOATING_TAGS", `quadlet image not pinned: ${image}`);
      }
      if (BANNED_IMAGE_TOKENS.some((token) => image.toLowerCase().includes(token))) {
        fail(display, e.lineNo, "NO_AGPL_IN_DEV_OR_GAME", `banned AGPL/root-escape image: ${image}`);
      }
    }
    if (e.key === "PublishPort" && !e.value.startsWith("127.0.0.1:")) {
      fail(display, e.lineNo, "LOOPBACK_PORTS_ONLY", `quadlet PublishPort must bind 127.0.0.1, got: ${e.value}`);
    }
    if (e.key === "Volume") {
      const host = e.value.split(":")[0];
      const isBind = host.startsWith("/") || host.startsWith("./") || host.startsWith("%");
      if (isBind && !/:([^:]*,)?[zZ](,|$)/.test(e.value)) {
        fail(display, e.lineNo, "SELINUX_VOLUME_LABELS", `quadlet bind mount missing :z/:Z label: ${e.value}`);
      }
    }
    if (e.key === "SecurityLabelType" && /^spc(_t)?$/.test(e.value)) {
      fail(display, e.lineNo, "SELINUX_CONFINED", `SecurityLabelType=${e.value} disables SELinux confinement`);
    }
    if ((e.key === "SecurityLabelDisable" || e.key === "Privileged") && /^(true|yes|1)$/i.test(e.value)) {
      fail(display, e.lineNo, "SELINUX_CONFINED", `${e.key}=${e.value} disables container confinement`);
    }
    if (e.key === "PodmanArgs" && /--privileged|label=disable|label=type:spc_t/.test(e.value)) {
      fail(display, e.lineNo, "SELINUX_CONFINED", `PodmanArgs opts out of confinement: ${e.value}`);
    }
    if (e.section === "Install") {
      fail(
        display,
        e.lineNo,
        "QUADLET_SOCKET_ACTIVATION",
        `[Install] ${e.key}= starts the container on its own; only its .socket may be enabled`,
      );
    }
  }
  if (!unitValues(entries, "DropCapability").includes("ALL")) {
    fail(display, 1, "HARDENED_CAPS", "quadlet missing DropCapability=ALL");
  }
  if (!entries.some((e) => e.key === "NoNewPrivileges" && /^(true|yes|1)$/i.test(e.value))) {
    fail(display, 1, "HARDENED_CAPS", "quadlet missing NoNewPrivileges=true");
  }
  if (!entries.some((e) => e.section === "Unit" && e.key === "StopWhenUnneeded" && /^(true|yes|1)$/i.test(e.value))) {
    fail(display, 1, "QUADLET_SOCKET_ACTIVATION", "quadlet missing [Unit] StopWhenUnneeded=true");
  }
  // At least one proxy .service (paired with a .socket of the same name) must
  // Requires= and After= this container unit.
  const pulledBy = services.filter((svc) => {
    const svcEntries = parseUnit(svc);
    return (
      unitValues(svcEntries, "Requires").includes(unitName) &&
      unitValues(svcEntries, "After").includes(unitName) &&
      sockets.some((sock) => basename(sock, ".socket") === basename(svc, ".service"))
    );
  });
  if (pulledBy.length === 0) {
    fail(
      display,
      1,
      "QUADLET_SOCKET_ACTIVATION",
      `no quadlets/*.socket + proxy .service pair Requires=/After= ${unitName} (container is never socket-activated)`,
    );
  }
}

function checkSocketFile(path: string, services: string[]): void {
  const display = repoRel(path);
  filesScanned += 1;
  checkUnitGeneric(path);
  const entries = parseUnit(path);
  const listens = entries.filter((e) => e.section === "Socket" && /^Listen(Stream|Datagram)$/.test(e.key));
  if (listens.length === 0) {
    fail(display, 1, "QUADLET_SOCKET_ACTIVATION", "socket unit has no ListenStream=");
  }
  for (const e of listens) {
    if (!e.value.startsWith("127.0.0.1:")) {
      fail(display, e.lineNo, "LOOPBACK_PORTS_ONLY", `socket must listen on 127.0.0.1:<port>, got: ${e.value}`);
    }
  }
  const twin = `${basename(path, ".socket")}.service`;
  if (!services.some((svc) => basename(svc) === twin)) {
    fail(display, 1, "QUADLET_SOCKET_ACTIVATION", `socket has no matching ${twin} proxy unit`);
  }
}

function checkProxyServiceFile(path: string): void {
  const display = repoRel(path);
  filesScanned += 1;
  checkUnitGeneric(path);
  const entries = parseUnit(path);
  const exec = entries.find((e) => e.section === "Service" && e.key === "ExecStart");
  if (!exec || !/systemd-socket-proxyd\s/.test(exec.value)) {
    fail(display, exec?.lineNo ?? 1, "QUADLET_SOCKET_ACTIVATION", "proxy unit must ExecStart systemd-socket-proxyd");
    return;
  }
  if (!/--exit-idle-time=\S+/.test(exec.value)) {
    fail(display, exec.lineNo, "QUADLET_SOCKET_ACTIVATION", "systemd-socket-proxyd needs --exit-idle-time= so the container can stop when idle");
  }
  const target = exec.value.trim().split(/\s+/).pop() ?? "";
  if (!target.startsWith("127.0.0.1:")) {
    fail(display, exec.lineNo, "LOOPBACK_PORTS_ONLY", `proxy must forward to 127.0.0.1:<port>, got: ${target}`);
  }
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

  // Non-service configs (agentgateway.yaml, bifrost.config.json) get generic
  // substring rules only — they declare no services/images/ports.
  const genericYaml: string[] = [];
  collectFiles(join(REPO_ROOT, "compose"), ".yaml", genericYaml);
  collectFiles(join(REPO_ROOT, "compose"), ".json", genericYaml);

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
  const sockets: string[] = [];
  collectFiles(join(REPO_ROOT, "quadlets"), ".socket", sockets);
  const proxyServices: string[] = [];
  collectFiles(join(REPO_ROOT, "quadlets"), ".service", proxyServices);

  const dockerfiles: string[] = [];
  collectFiles(join(REPO_ROOT, "images"), "Dockerfile", dockerfiles);
  collectFiles(join(REPO_ROOT, "devcontainers"), "Dockerfile", dockerfiles);

  for (const file of composeFiles.sort()) checkComposeFile(file);
  for (const file of genericYaml.sort()) {
    filesScanned += 1;
    checkGenericContent(file, readLines(file));
  }
  for (const file of devcontainers.sort()) checkDevcontainerFile(file);
  for (const file of dockerfiles.sort()) checkDockerfile(file);
  for (const file of quadlets.sort()) checkQuadletFile(file, sockets, proxyServices);
  for (const file of sockets.sort()) checkSocketFile(file, proxyServices);
  for (const file of proxyServices.sort()) checkProxyServiceFile(file);
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
