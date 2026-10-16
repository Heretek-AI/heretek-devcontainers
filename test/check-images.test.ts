/**
 * test/check-images.test.ts — offline unit tests for the image-existence check.
 *
 * Covers image-reference parsing, the registry lookup URL, bearer-challenge
 * parsing, and reference collection from the real tree. The network lookups
 * themselves run only in `make images` (scripts/check-images.ts).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { lookupUrl, parseBearerChallenge } from "../scripts/check-images";
import { collectImageRefs, isLocalImage, isPinned, parseImageRef } from "../scripts/lib/image-ref";

const REPO_ROOT = join(import.meta.dir, "..");

describe("parseImageRef", () => {
  test("official Docker Hub image gains docker.io/library", () => {
    expect(parseImageRef("nats:2.15.1-alpine")).toEqual({
      raw: "nats:2.15.1-alpine",
      registry: "docker.io",
      repository: "library/nats",
      tag: "2.15.1-alpine",
      digest: null,
    });
  });

  test("namespaced Docker Hub image", () => {
    const ref = parseImageRef("searxng/searxng:2026.10.16-0ce72dd2c");
    expect(ref.registry).toBe("docker.io");
    expect(ref.repository).toBe("searxng/searxng");
    expect(ref.tag).toBe("2026.10.16-0ce72dd2c");
  });

  test("GHCR image with a v-prefixed tag", () => {
    const ref = parseImageRef("ghcr.io/maximhq/bifrost:v2.3.0");
    expect(ref.registry).toBe("ghcr.io");
    expect(ref.repository).toBe("maximhq/bifrost");
    expect(ref.tag).toBe("v2.3.0");
  });

  test("registry with a port is not mistaken for a tag", () => {
    const ref = parseImageRef("registry.local:5000/team/app:1.2");
    expect(ref.registry).toBe("registry.local:5000");
    expect(ref.repository).toBe("team/app");
    expect(ref.tag).toBe("1.2");
  });

  test("untagged reference has a null tag and is not pinned", () => {
    const ref = parseImageRef("debian");
    expect(ref.tag).toBeNull();
    expect(isPinned(ref)).toBe(false);
  });

  test(":latest is not pinned; a digest is", () => {
    expect(isPinned(parseImageRef("nats:latest"))).toBe(false);
    const digest = `sha256:${"a".repeat(64)}`;
    const ref = parseImageRef(`nats@${digest}`);
    expect(ref.digest).toBe(digest);
    expect(isPinned(ref)).toBe(true);
  });

  test("localhost images are local builds", () => {
    const ref = parseImageRef("localhost/heretek/ghidra-mcp:6.0.0");
    expect(ref.registry).toBe("localhost");
    expect(ref.repository).toBe("heretek/ghidra-mcp");
    expect(isLocalImage(ref)).toBe(true);
    expect(isLocalImage(parseImageRef("ghcr.io/iksnerd/adb-mcp:0.23.0"))).toBe(false);
  });

  test("malformed references throw", () => {
    for (const bad of ["", "Upper/Case:1", "a b:1", "nats:", "nats:-bad", "repo//x:1", "x-:1"]) {
      expect(() => parseImageRef(bad)).toThrow();
    }
  });
});

describe("registry lookup helpers", () => {
  test("Docker Hub tags use the Hub API", () => {
    expect(lookupUrl(parseImageRef("nats:2.15.1-alpine"))).toBe(
      "https://hub.docker.com/v2/repositories/library/nats/tags/2.15.1-alpine",
    );
  });

  test("other registries use the OCI manifest endpoint", () => {
    expect(lookupUrl(parseImageRef("ghcr.io/agentgateway/agentgateway:v1.6.0"))).toBe(
      "https://ghcr.io/v2/agentgateway/agentgateway/manifests/v1.6.0",
    );
  });

  test("bearer challenge parsing", () => {
    expect(
      parseBearerChallenge('Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:a/b:pull"'),
    ).toEqual({ realm: "https://ghcr.io/token", service: "ghcr.io", scope: "repository:a/b:pull" });
    expect(parseBearerChallenge('Basic realm="x"')).toBeNull();
    expect(parseBearerChallenge(null)).toBeNull();
  });
});

describe("image collection (real tree)", () => {
  const found = collectImageRefs(REPO_ROOT);

  test("every reference parses and is pinned", () => {
    expect(found.length).toBeGreaterThan(10);
    for (const item of found) {
      expect(isPinned(parseImageRef(item.ref))).toBe(true);
    }
  });

  test("compose build services are tagged as local images and skipped by the check", () => {
    const builds = found.filter((f) => f.kind === "compose-build");
    expect(builds.length).toBe(9);
    for (const item of builds) {
      expect(isLocalImage(parseImageRef(item.ref))).toBe(true);
    }
  });

  test("Dockerfile stage names are not treated as images", () => {
    const fromDockerfiles = found.filter((f) => f.kind === "dockerfile").map((f) => f.ref);
    for (const stage of ["src", "build", "ghidra", "upstream"]) {
      expect(fromDockerfiles).not.toContain(stage);
    }
    expect(fromDockerfiles).toContain("ghcr.io/iksnerd/adb-mcp:0.23.0");
  });
});
