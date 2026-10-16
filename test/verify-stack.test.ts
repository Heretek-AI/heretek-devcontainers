/**
 * test/verify-stack.test.ts — regression tests for scripts/verify-stack.ts.
 *
 * Runs the real verifier against fixture trees under test/fixtures/verify/
 * via `--root`. Every bad fixture breaks exactly one rule; the test asserts
 * the verifier exits 1 and reports that rule and no other, so neutering any
 * rule (or `fail()` itself) turns these tests red.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const VERIFY_TS = join(REPO_ROOT, "scripts", "verify-stack.ts");
const FIXTURES = join(import.meta.dir, "fixtures", "verify");

function verify(...args: string[]): { exit: number; out: string; err: string; rules: string[] } {
  const proc = Bun.spawnSync(["bun", "run", VERIFY_TS, ...args], { stdout: "pipe", stderr: "pipe" });
  const err = proc.stderr.toString();
  const rules = [...new Set([...err.matchAll(/^FAIL \[([A-Z_]+)\]/gm)].map((m) => m[1]))].sort();
  return { exit: proc.exitCode ?? 99, out: proc.stdout.toString(), err, rules };
}

const BAD_FIXTURES: Array<[fixture: string, rule: string]> = [
  ["no-floating-tags", "NO_FLOATING_TAGS"],
  ["no-floating-tags-local-build", "NO_FLOATING_TAGS"],
  ["no-floating-tags-dockerfile", "NO_FLOATING_TAGS"],
  ["no-docker-sock", "NO_DOCKER_SOCK"],
  ["loopback-ports-only", "LOOPBACK_PORTS_ONLY"],
  ["hardened-caps", "HARDENED_CAPS"],
  ["selinux-volume-labels", "SELINUX_VOLUME_LABELS"],
  ["no-agpl-in-dev-or-game", "NO_AGPL_IN_DEV_OR_GAME"],
  ["env-placeholder-leak", "ENV_PLACEHOLDER_LEAK"],
  ["selinux-confined", "SELINUX_CONFINED"],
  ["quadlet-socket-activation", "QUADLET_SOCKET_ACTIVATION"],
  ["quadlet-no-socket", "QUADLET_SOCKET_ACTIVATION"],
  ["quadlet-proxy-idle", "QUADLET_SOCKET_ACTIVATION"],
  ["quadlet-loopback-socket", "LOOPBACK_PORTS_ONLY"],
];

describe("verify-stack fixtures (real verifier, --root)", () => {
  test("the clean fixture tree passes", () => {
    const r = verify("--root", join(FIXTURES, "clean"));
    expect(r.err).toBe("");
    expect(r.exit).toBe(0);
    expect(r.out).toContain("PASS");
  });

  test("the repository itself passes", () => {
    const r = verify();
    expect(r.err).toBe("");
    expect(r.exit).toBe(0);
    expect(r.out).toContain("PASS");
  });

  for (const [fixture, rule] of BAD_FIXTURES) {
    test(`${fixture} fails closed with exactly ${rule}`, () => {
      const r = verify("--root", join(FIXTURES, fixture));
      expect(r.exit).toBe(1);
      expect(r.rules).toEqual([rule]);
      expect(r.err).toContain("FAIL CLOSED");
    });
  }

  test("every documented rule has a failing fixture", () => {
    const covered = new Set(BAD_FIXTURES.map(([, rule]) => rule));
    for (const rule of [
      "NO_FLOATING_TAGS",
      "NO_DOCKER_SOCK",
      "LOOPBACK_PORTS_ONLY",
      "HARDENED_CAPS",
      "SELINUX_VOLUME_LABELS",
      "NO_AGPL_IN_DEV_OR_GAME",
      "ENV_PLACEHOLDER_LEAK",
      "SELINUX_CONFINED",
      "QUADLET_SOCKET_ACTIVATION",
    ]) {
      expect(covered.has(rule)).toBe(true);
    }
  });

  test("--root rejects a missing directory with exit 2", () => {
    const r = verify("--root", join(FIXTURES, "does-not-exist"));
    expect(r.exit).toBe(2);
  });

  test("unknown arguments fail with exit 2", () => {
    const r = verify("--bogus");
    expect(r.exit).toBe(2);
  });
});
