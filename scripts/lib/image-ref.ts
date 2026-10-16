/**
 * scripts/lib/image-ref.ts — shared container image reference helpers.
 *
 * Used by scripts/verify-stack.ts (pinning rules) and scripts/check-images.ts
 * (registry existence check). Zero dependencies beyond the Bun/Node stdlib.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface ImageRef {
  /** The reference exactly as written in the source file. */
  raw: string;
  /** Registry host, e.g. `docker.io`, `ghcr.io`, `mcr.microsoft.com`, `localhost`. */
  registry: string;
  /** Repository path within the registry, e.g. `library/nats`, `maximhq/bifrost`. */
  repository: string;
  /** Tag, or null when the reference has none. */
  tag: string | null;
  /** `sha256:...` digest, or null when the reference has none. */
  digest: string | null;
}

/**
 * Parse an image reference the way docker/podman resolve it:
 * `nats:2.15.1-alpine` -> docker.io/library/nats:2.15.1-alpine,
 * `ghcr.io/o/r:v1` -> ghcr.io/o/r:v1, `localhost/heretek/x:1.0` -> local.
 * The first path component is a registry only when it contains `.` or `:`
 * or is exactly `localhost`. Throws on an empty or malformed reference.
 */
export function parseImageRef(raw: string): ImageRef {
  const ref = raw.trim();
  if (ref === "" || /\s/.test(ref)) throw new Error(`invalid image reference: "${raw}"`);
  let rest = ref;
  let digest: string | null = null;
  const at = rest.indexOf("@");
  if (at !== -1) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
    if (!/^[a-z0-9]+:[a-f0-9]{32,}$/.test(digest)) throw new Error(`invalid image digest: "${raw}"`);
  }
  let tag: string | null = null;
  const lastSlash = rest.lastIndexOf("/");
  const lastColon = rest.lastIndexOf(":");
  if (lastColon > lastSlash) {
    tag = rest.slice(lastColon + 1);
    rest = rest.slice(0, lastColon);
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) throw new Error(`invalid image tag: "${raw}"`);
  }
  const parts = rest.split("/");
  let registry = "docker.io";
  if (parts.length > 1 && (parts[0].includes(".") || parts[0].includes(":") || parts[0] === "localhost")) {
    registry = parts.shift() as string;
  }
  if (registry === "index.docker.io" || registry === "registry-1.docker.io") registry = "docker.io";
  // Each path component: lowercase alphanumerics with single . _ - separators
  // inside (checked without nested quantifiers to keep matching linear).
  const validComponent = (c: string): boolean =>
    /^[a-z0-9][a-z0-9._-]*$/.test(c) && /[a-z0-9]$/.test(c) && !/[._-]{2}/.test(c.replace(/__/g, "_"));
  if (parts.length === 0 || !parts.every(validComponent)) {
    throw new Error(`invalid image repository: "${raw}"`);
  }
  let repository = parts.join("/");
  if (registry === "docker.io" && !repository.includes("/")) repository = `library/${repository}`;
  return { raw: ref, registry, repository, tag, digest };
}

/** True for images built locally (never pulled), i.e. `localhost/...`. */
export function isLocalImage(ref: ImageRef): boolean {
  return ref.registry === "localhost";
}

/** True when the reference pins an explicit, non-floating version. */
export function isPinned(ref: ImageRef): boolean {
  if (ref.digest) return true;
  return ref.tag !== null && ref.tag !== "latest";
}

export interface FoundImage {
  /** Repo-relative path of the file that references the image. */
  file: string;
  line: number;
  ref: string;
  /** Where it was found: compose `image:`, quadlet `Image=`, devcontainer `image`, Dockerfile `FROM`/`COPY --from`. */
  kind: "compose" | "compose-build" | "quadlet" | "devcontainer" | "dockerfile";
}

function walk(dir: string, accept: (name: string) => boolean, out: string[]): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, accept, out);
    else if (accept(entry)) out.push(full);
  }
}

function stripYamlComment(line: string): string {
  const idx = line.search(/(^|\s)#/);
  return idx === -1 ? line : line.slice(0, idx);
}

function unquote(value: string): string {
  const t = value.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Compose `image:` references, flagged `compose-build` when the service also has `build:`. */
export function composeImages(path: string, root: string): FoundImage[] {
  const lines = readFileSync(path, "utf8").split("\n");
  const found: FoundImage[] = [];
  let service: { image?: FoundImage; build: boolean } | null = null;
  const flush = (): void => {
    if (service?.image) {
      if (service.build) service.image.kind = "compose-build";
      found.push(service.image);
    }
  };
  lines.forEach((raw, idx) => {
    const code = stripYamlComment(raw);
    if (/^ {2}[A-Za-z0-9_.-]+\s*:\s*$/.test(code) || /^\S/.test(code)) {
      flush();
      service = /^ {2}\S/.test(code) ? { build: false } : null;
      return;
    }
    if (!service) return;
    const image = /^ {4}image\s*:\s*(.+?)\s*$/.exec(code);
    if (image) {
      service.image = { file: relative(root, path), line: idx + 1, ref: unquote(image[1]), kind: "compose" };
    }
    if (/^ {4}build\s*:/.test(code)) service.build = true;
  });
  flush();
  return found;
}

/** Dockerfile `FROM` and `COPY --from=` image references (stage names and `scratch` excluded). */
export function dockerfileImages(path: string, root: string): FoundImage[] {
  const lines = readFileSync(path, "utf8").split("\n");
  const stages = new Set<string>();
  const found: FoundImage[] = [];
  lines.forEach((raw, idx) => {
    const from = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(raw);
    if (from) {
      const ref = from[1];
      if (ref.toLowerCase() !== "scratch" && !stages.has(ref.toLowerCase())) {
        found.push({ file: relative(root, path), line: idx + 1, ref, kind: "dockerfile" });
      }
      if (from[2]) stages.add(from[2].toLowerCase());
      return;
    }
    const copy = /^\s*COPY\s+.*--from=(\S+)/i.exec(raw);
    if (copy && !stages.has(copy[1].toLowerCase()) && !/^\d+$/.test(copy[1])) {
      found.push({ file: relative(root, path), line: idx + 1, ref: copy[1], kind: "dockerfile" });
    }
  });
  return found;
}

/** Quadlet `Image=` references (`.build`/`.image` unit references excluded). */
export function quadletImages(path: string, root: string): FoundImage[] {
  const found: FoundImage[] = [];
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((raw, idx) => {
      const m = /^\s*Image\s*=\s*(\S+)\s*$/.exec(raw);
      if (m && !/\.(build|image)$/.test(m[1])) {
        found.push({ file: relative(root, path), line: idx + 1, ref: m[1], kind: "quadlet" });
      }
    });
  return found;
}

/** Devcontainer JSON `"image"` references. */
export function devcontainerImages(path: string, root: string): FoundImage[] {
  const found: FoundImage[] = [];
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((raw, idx) => {
      const m = /"image"\s*:\s*"([^"]+)"/.exec(raw);
      if (m) found.push({ file: relative(root, path), line: idx + 1, ref: m[1], kind: "devcontainer" });
    });
  return found;
}

/** Every image reference in the tree rooted at `root`, in a stable order. */
export function collectImageRefs(root: string): FoundImage[] {
  const compose: string[] = [];
  if (existsSync(join(root, "docker-compose.yml"))) compose.push(join(root, "docker-compose.yml"));
  walk(join(root, "compose"), (n) => n.endsWith(".yml"), compose);
  const dockerfiles: string[] = [];
  walk(join(root, "images"), (n) => n === "Dockerfile", dockerfiles);
  walk(join(root, "devcontainers"), (n) => n === "Dockerfile", dockerfiles);
  const quadlets: string[] = [];
  walk(join(root, "quadlets"), (n) => n.endsWith(".container"), quadlets);
  const devcontainers: string[] = [];
  walk(join(root, "devcontainers"), (n) => n.endsWith(".json"), devcontainers);
  return [
    ...compose.flatMap((f) => composeImages(f, root)),
    ...dockerfiles.flatMap((f) => dockerfileImages(f, root)),
    ...quadlets.flatMap((f) => quadletImages(f, root)),
    ...devcontainers.flatMap((f) => devcontainerImages(f, root)),
  ];
}
