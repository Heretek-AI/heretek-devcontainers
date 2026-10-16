/**
 * scripts/check-images.ts — resolve every pinned remote image against its registry.
 *
 * Collects every image reference in the tree (compose `image:`, quadlet
 * `Image=`, devcontainer `"image"`, Dockerfile `FROM` / `COPY --from=`), skips
 * local build tags (`localhost/...`, compose services with `build:`), and asks
 * the registry whether each tag (or digest) exists:
 *
 *   docker.io  — Docker Hub API  GET hub.docker.com/v2/repositories/<repo>/tags/<tag>
 *                (avoids the anonymous registry pull-rate limit)
 *   any other  — OCI distribution API  HEAD <registry>/v2/<repo>/manifests/<ref>,
 *                with an anonymous bearer token when the registry asks for one
 *                (ghcr.io, mcr.microsoft.com, ...)
 *
 * Exits 1 naming every missing or unresolvable reference (fail closed: a
 * registry that cannot be reached counts as a failure). Needs network access,
 * so it is NOT part of `bun test`; run it with `make images`.
 *
 * Usage: bun run scripts/check-images.ts [--root <dir>]
 */

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { collectImageRefs, isLocalImage, parseImageRef, type ImageRef } from "./lib/image-ref";

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

export type Verdict = { status: "exists" } | { status: "missing"; detail: string } | { status: "error"; detail: string };

/** The URL used to look a reference up (Docker Hub API for docker.io tags, OCI manifest endpoint otherwise). */
export function lookupUrl(ref: ImageRef): string {
  const reference = ref.digest ?? ref.tag;
  if (reference === null) throw new Error(`image has no tag or digest: ${ref.raw}`);
  if (ref.registry === "docker.io" && ref.digest === null) {
    return `https://hub.docker.com/v2/repositories/${ref.repository}/tags/${encodeURIComponent(reference)}`;
  }
  const host = ref.registry === "docker.io" ? "registry-1.docker.io" : ref.registry;
  return `https://${host}/v2/${ref.repository}/manifests/${reference}`;
}

/** Parse a `WWW-Authenticate: Bearer realm="...",service="...",scope="..."` challenge. */
export function parseBearerChallenge(header: string | null): Record<string, string> | null {
  if (!header || !/^Bearer\s/i.test(header)) return null;
  const params: Record<string, string> = {};
  for (const m of header.slice(7).matchAll(/([A-Za-z]+)="([^"]*)"/g)) params[m[1]] = m[2];
  return params.realm ? params : null;
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      if (res.status !== 429 && res.status < 500) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(1000 * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function resolveImage(ref: ImageRef): Promise<Verdict> {
  const url = lookupUrl(ref);
  try {
    if (url.startsWith("https://hub.docker.com/")) {
      const res = await fetchWithRetry(url, { method: "GET" });
      if (res.status === 200) return { status: "exists" };
      if (res.status === 404) return { status: "missing", detail: "tag not found on Docker Hub" };
      return { status: "error", detail: `Docker Hub answered HTTP ${res.status}` };
    }
    const headers: Record<string, string> = { Accept: MANIFEST_ACCEPT };
    let res = await fetchWithRetry(url, { method: "HEAD", headers });
    if (res.status === 401) {
      const challenge = parseBearerChallenge(res.headers.get("www-authenticate"));
      if (!challenge) return { status: "error", detail: "registry requires auth without a bearer challenge" };
      const tokenUrl = new URL(challenge.realm);
      if (challenge.service) tokenUrl.searchParams.set("service", challenge.service);
      tokenUrl.searchParams.set("scope", challenge.scope ?? `repository:${ref.repository}:pull`);
      const tokenRes = await fetchWithRetry(tokenUrl.toString(), { method: "GET" });
      if (tokenRes.status !== 200) return { status: "error", detail: `token endpoint answered HTTP ${tokenRes.status}` };
      const body = (await tokenRes.json()) as { token?: string; access_token?: string };
      const token = body.token ?? body.access_token;
      if (!token) return { status: "error", detail: "token endpoint returned no token" };
      res = await fetchWithRetry(url, { method: "HEAD", headers: { ...headers, Authorization: `Bearer ${token}` } });
    }
    if (res.status === 200) return { status: "exists" };
    if (res.status === 404) return { status: "missing", detail: "manifest not found" };
    // GHCR answers 401/403 (not 404) for repositories that do not exist.
    if (res.status === 401 || res.status === 403) {
      return { status: "missing", detail: `registry denied anonymous pull (HTTP ${res.status}); repository likely does not exist` };
    }
    return { status: "error", detail: `registry answered HTTP ${res.status}` };
  } catch (error) {
    return { status: "error", detail: error instanceof Error ? error.message : String(error) };
  }
}

function parseRoot(argv: string[]): string {
  let root = join(import.meta.dir, "..");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) {
      root = resolve(argv[i + 1]);
      i += 1;
    } else {
      console.error(`check-images: unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`check-images: --root is not a directory: ${root}`);
    process.exit(2);
  }
  return root;
}

async function main(): Promise<void> {
  const root = parseRoot(process.argv.slice(2));
  const found = collectImageRefs(root);
  const byRef = new Map<string, string[]>();
  let skipped = 0;
  let failures = 0;
  for (const item of found) {
    const where = `${item.file}:${item.line}`;
    if (item.kind === "compose-build") {
      skipped += 1;
      continue;
    }
    let ref: ImageRef;
    try {
      ref = parseImageRef(item.ref);
    } catch (error) {
      console.error(`FAIL ${where}: ${(error as Error).message}`);
      failures += 1;
      continue;
    }
    if (isLocalImage(ref)) {
      skipped += 1;
      continue;
    }
    if (ref.tag === null && ref.digest === null) {
      console.error(`FAIL ${where}: ${item.ref} has no tag or digest`);
      failures += 1;
      continue;
    }
    byRef.set(item.ref, [...(byRef.get(item.ref) ?? []), where]);
  }
  const refs = [...byRef.keys()].sort();
  const verdicts = await Promise.all(refs.map(async (raw) => [raw, await resolveImage(parseImageRef(raw))] as const));
  for (const [raw, verdict] of verdicts) {
    const where = (byRef.get(raw) ?? []).join(", ");
    if (verdict.status === "exists") {
      console.log(`ok      ${raw}  (${where})`);
    } else {
      failures += 1;
      console.error(`${verdict.status === "missing" ? "MISSING" : "ERROR  "} ${raw}  (${where}): ${verdict.detail}`);
    }
  }
  if (failures > 0) {
    console.error(`check-images: ${failures} image reference(s) failed — FAIL CLOSED`);
    process.exit(1);
  }
  console.log(`PASS: ${refs.length} remote image reference(s) resolved; ${skipped} local build reference(s) skipped.`);
}

if (import.meta.main) await main();
