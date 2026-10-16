/**
 * test/scripts-ctl.test.ts — Wave 3 sandbox/CLI/toolchain contract tests.
 *
 * Exercises the real scripts on disk via `Bun.spawnSync` (heretek-exec.sh
 * `--dry-run` argument construction, heretek-box-ctl.sh subcommand parsing)
 * and asserts the real devcontainer/quadlet/toolchain files carry the
 * fail-closed security contracts (pinned images, loopback ports, SELinux
 * labels, non-root users). No stubs: every assertion inspects real output.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const EXEC_SH = join(REPO_ROOT, "scripts", "heretek-exec.sh");
const CTL_SH = join(REPO_ROOT, "scripts", "heretek-box-ctl.sh");
const VERIFY_TS = join(REPO_ROOT, "scripts", "verify-stack.ts");

interface RunResult {
  exit: number;
  out: string;
  err: string;
}

function run(argv: string[]): RunResult {
  const proc = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
  return {
    exit: proc.exitCode ?? 99,
    out: (proc.stdout ?? Buffer.alloc(0)).toString(),
    err: (proc.stderr ?? Buffer.alloc(0)).toString(),
  };
}

function bashExec(...args: string[]): RunResult {
  return run(["bash", EXEC_SH, ...args]);
}

function bashCtl(...args: string[]): RunResult {
  return run(["bash", CTL_SH, ...args]);
}

function readText(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

// ---------------------------------------------------------------------------
// heretek-exec.sh --dry-run argument construction
// ---------------------------------------------------------------------------

describe("heretek-exec.sh --dry-run (real script output)", () => {
  test("dry-run exits 0 and names all three sandbox stages", () => {
    const r = bashExec("--dry-run", "--", "echo", "hello");
    expect(r.exit).toBe(0);
    expect(r.out).toContain("bwrap");
    expect(r.out).toContain("landrun");
    expect(r.out).toContain("mise exec");
  });

  test("full chain orders bwrap before landrun before mise exec before payload", () => {
    const r = bashExec("--dry-run", "--", "echo", "hello");
    expect(r.exit).toBe(0);
    const full = r.out.split("\n").find((line) => line.startsWith("full:"));
    expect(full).toBeDefined();
    const ib = full!.indexOf("bwrap");
    const il = full!.indexOf("landrun");
    const im = full!.indexOf("mise exec");
    const ip = full!.indexOf("echo hello");
    expect(ib).toBeGreaterThanOrEqual(0);
    expect(il).toBeGreaterThan(ib);
    expect(im).toBeGreaterThan(il);
    expect(ip).toBeGreaterThan(im);
  });

  test("bwrap stage carries the exact isolation flags", () => {
    const r = bashExec("--dry-run", "--", "true");
    expect(r.exit).toBe(0);
    const bwrap = r.out.split("\n").find((line) => line.startsWith("bwrap:"));
    expect(bwrap).toBeDefined();
    for (const flag of [
      "--unshare-all",
      "--die-with-parent",
      "--new-session",
      "--ro-bind",
      "--proc",
      "--dev",
      "--tmpfs",
      "--chdir",
      "--setenv HERETEK_SANDBOX",
    ]) {
      expect(bwrap!).toContain(flag);
    }
  });

  test("payload command is carried verbatim into the full chain", () => {
    const r = bashExec("--dry-run", "--", "echo", "hello-world-42");
    expect(r.exit).toBe(0);
    expect(r.out).toContain("hello-world-42");
  });

  test("--kvm binds /dev/kvm; without it the node is absent", () => {
    const withKvm = bashExec("--dry-run", "--kvm", "--", "true");
    expect(withKvm.exit).toBe(0);
    expect(withKvm.out).toContain("kvm: enabled");
    expect(withKvm.out).toContain("/dev/kvm");
    expect(withKvm.out).toContain("--dev-bind");
    const withoutKvm = bashExec("--dry-run", "--", "true");
    expect(withoutKvm.exit).toBe(0);
    expect(withoutKvm.out).toContain("kvm: disabled");
    expect(withoutKvm.out).not.toContain("/dev/kvm");
  });

  test("--landrun-arg values land in the landrun stage before the payload split", () => {
    const r = bashExec("--dry-run", "--landrun-arg", "extra-policy-flag", "--", "true");
    expect(r.exit).toBe(0);
    const landrun = r.out.split("\n").find((line) => line.startsWith("landrun:"));
    expect(landrun).toBeDefined();
    expect(landrun!).toContain("extra-policy-flag");
  });

  test("--workdir pins the sandbox bind and chdir to that directory", () => {
    const r = bashExec("--dry-run", "--workdir", "compose", "--", "true");
    expect(r.exit).toBe(0);
    expect(r.out).toContain(join(REPO_ROOT, "compose"));
  });

  test("missing command fails closed with exit 2", () => {
    const r = bashExec("--dry-run");
    expect(r.exit).toBe(2);
    expect(r.err).toContain("no command given");
  });

  test("unknown option fails closed with exit 2", () => {
    const r = bashExec("--bogus-flag", "--", "true");
    expect(r.exit).toBe(2);
    expect(r.err).toContain("unknown option");
  });

  test("workdir escaping the repository fails closed with exit 2", () => {
    const r = bashExec("--dry-run", "--workdir", "/etc", "--", "true");
    expect(r.exit).toBe(2);
    expect(r.err).toContain("escapes the repository");
  });

  test("nonexistent workdir fails closed with exit 2", () => {
    const r = bashExec("--dry-run", "--workdir", "does-not-exist-zzz", "--", "true");
    expect(r.exit).toBe(2);
    expect(r.err).toContain("not a directory");
  });

  test("--help exits 0 and documents the sandbox chain", () => {
    const r = bashExec("--help");
    expect(r.exit).toBe(0);
    expect(r.out).toContain("bwrap");
    expect(r.out).toContain("landrun");
    expect(r.out).toContain("--dry-run");
    expect(r.out).toContain("--kvm");
  });
});

// ---------------------------------------------------------------------------
// heretek-box-ctl.sh subcommand parsing
// ---------------------------------------------------------------------------

describe("heretek-box-ctl.sh (real script output)", () => {
  test("list-profiles prints exactly the 6 loadable profiles", () => {
    const r = bashCtl("list-profiles");
    expect(r.exit).toBe(0);
    expect(r.out.split("\n").filter((line) => line.trim() !== "")).toEqual([
      "core",
      "appsec",
      "android",
      "game",
      "research",
      "all",
    ]);
  });

  test("unknown subcommand fails closed with exit 2", () => {
    const r = bashCtl("frobnicate");
    expect(r.exit).toBe(2);
    expect(r.err).toContain("unknown subcommand");
  });

  test("up with an unknown profile fails closed with exit 2", () => {
    const r = bashCtl("up", "windows");
    expect(r.exit).toBe(2);
    expect(r.err).toContain("unknown profile");
  });

  test("down with an unknown profile fails closed with exit 2", () => {
    const r = bashCtl("down", "windows");
    expect(r.exit).toBe(2);
    expect(r.err).toContain("unknown profile");
  });

  test("exec without task id and command fails closed with exit 2", () => {
    const r = bashCtl("exec");
    expect(r.exit).toBe(2);
    expect(r.err).toContain("exec requires a task id");
  });

  test("exec with a hostile task id fails closed with exit 2", () => {
    const r = bashCtl("exec", "evil;rm-rf", "echo", "hi");
    expect(r.exit).toBe(2);
    expect(r.err).toContain("invalid task id");
  });

  test("exec --dry-run delegates to heretek-exec dry-run with the payload", () => {
    const r = bashCtl("exec", "--dry-run", "task-42", "echo", "delegated-payload");
    expect(r.exit).toBe(0);
    expect(r.out).toContain("bwrap");
    expect(r.out).toContain("landrun");
    expect(r.out).toContain("mise exec");
    expect(r.out).toContain("delegated-payload");
  });

  test("verify runs the static verifier green on the clean tree", () => {
    const r = bashCtl("verify");
    expect(r.exit).toBe(0);
    expect(r.out).toContain("PASS");
  });

  test("--help exits 0 and lists every subcommand", () => {
    const r = bashCtl("--help");
    expect(r.exit).toBe(0);
    for (const sub of ["verify", "list-profiles", "up", "down", "status", "exec"]) {
      expect(r.out).toContain(sub);
    }
  });
});

// ---------------------------------------------------------------------------
// Devcontainer contracts
// ---------------------------------------------------------------------------

describe("devcontainer contracts (real files on disk)", () => {
  test("polyglot-dev devcontainer exists and parses as JSON", () => {
    const path = join(REPO_ROOT, "devcontainers", "polyglot-dev", ".devcontainer.json");
    expect(existsSync(path)).toBe(true);
    expect(() => JSON.parse(readText("devcontainers/polyglot-dev/.devcontainer.json"))).not.toThrow();
  });

  test("polyglot-dev runs as non-root agent with dropped caps and no socket", () => {
    const parsed = JSON.parse(readText("devcontainers/polyglot-dev/.devcontainer.json")) as Record<
      string,
      unknown
    >;
    expect(parsed["remoteUser"]).toBe("agent");
    expect(parsed["containerUser"]).toBe("agent");
    expect(parsed["capAdd"]).toEqual([]);
    expect(parsed["securityOpt"]).toContain("no-new-privileges:true");
    expect(JSON.stringify(parsed)).not.toContain("docker.sock");
    expect(JSON.stringify(parsed)).not.toContain("podman.sock");
  });

  test("polyglot-dev mounts the worktree with an SELinux label", () => {
    const parsed = JSON.parse(readText("devcontainers/polyglot-dev/.devcontainer.json")) as {
      mounts: string[];
    };
    expect(Array.isArray(parsed.mounts)).toBe(true);
    expect(parsed.mounts.length).toBeGreaterThan(0);
    for (const mount of parsed.mounts) {
      expect(mount).toContain("type=bind");
      expect(mount).toContain(",Z");
    }
  });

  test("ai-cuda-dev devcontainer exists, parses, and grants GPUs without sockets", () => {
    const raw = readText("devcontainers/ai-cuda-dev/.devcontainer.json");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["remoteUser"]).toBe("agent");
    expect(parsed["containerUser"]).toBe("agent");
    expect(parsed["capAdd"]).toEqual([]);
    expect(parsed["securityOpt"]).toContain("no-new-privileges:true");
    expect(raw).toContain("--gpus=all");
    expect(raw).not.toContain("docker.sock");
    expect(raw).not.toContain("podman.sock");
  });

  test("ai-cuda-dev mounts the worktree with an SELinux label", () => {
    const parsed = JSON.parse(readText("devcontainers/ai-cuda-dev/.devcontainer.json")) as {
      mounts: string[];
    };
    expect(parsed.mounts.length).toBeGreaterThan(0);
    for (const mount of parsed.mounts) {
      expect(mount).toContain("type=bind");
      expect(mount).toContain(",Z");
    }
  });

  test("both devcontainer images are pinned (no floating tags)", () => {
    for (const rel of [
      "devcontainers/polyglot-dev/.devcontainer.json",
      "devcontainers/ai-cuda-dev/.devcontainer.json",
    ]) {
      const parsed = JSON.parse(readText(rel)) as { image: string };
      expect(typeof parsed.image).toBe("string");
      const tagPart = parsed.image.slice(parsed.image.lastIndexOf("/") + 1);
      expect(tagPart.includes(":")).toBe(true);
      expect(parsed.image).not.toContain(":latest");
    }
  });
});

// ---------------------------------------------------------------------------
// Quadlet contracts
// ---------------------------------------------------------------------------

describe("quadlet contracts (real files on disk)", () => {
  const CONTAINERS: Record<string, { image: string; sockets: Record<string, [listen: string, inner: string]> }> = {
    "heretek-android-kvm": {
      image: "budtmo/docker-android:emulator_14.0_v3.8.0-p1",
      sockets: {
        "heretek-android-kvm-vnc-proxy": ["127.0.0.1:6080", "127.0.0.1:16080"],
        "heretek-android-kvm-adb-proxy": ["127.0.0.1:5555", "127.0.0.1:15555"],
      },
    },
    "heretek-ghidra-mcp": {
      image: "localhost/heretek/ghidra-mcp:6.0.0",
      sockets: { "heretek-ghidra-mcp-proxy": ["127.0.0.1:8089", "127.0.0.1:18089"] },
    },
    "heretek-blender-mcp": {
      image: "localhost/heretek/blender-mcp:0.11.1",
      sockets: { "heretek-blender-mcp-proxy": ["127.0.0.1:8781", "127.0.0.1:18781"] },
    },
  };

  test("every container unit stops when unneeded and never starts on its own", () => {
    for (const unit of Object.keys(CONTAINERS)) {
      const text = readText(`quadlets/${unit}.container`);
      expect(text).toContain("StopWhenUnneeded=true");
      expect(text).not.toMatch(/^\[Install\]/m);
      expect(text).not.toMatch(/^WantedBy=/m);
    }
  });

  test("every container unit pins the same image as compose", () => {
    for (const [unit, { image }] of Object.entries(CONTAINERS)) {
      expect(readText(`quadlets/${unit}.container`)).toContain(`Image=${image}`);
    }
  });

  test("each heavy service has a loopback .socket and a socket-proxyd .service that pulls it up", () => {
    for (const [unit, { sockets }] of Object.entries(CONTAINERS)) {
      for (const [proxy, [listen, inner]] of Object.entries(sockets)) {
        const socket = readText(`quadlets/${proxy}.socket`);
        expect(socket).toContain(`ListenStream=${listen}`);
        expect(socket).toContain("WantedBy=sockets.target");
        const service = readText(`quadlets/${proxy}.service`);
        expect(service).toMatch(new RegExp(`^Requires=.*\\b${unit}\\.service\\b`, "m"));
        expect(service).toMatch(new RegExp(`^After=.*\\b${unit}\\.service\\b`, "m"));
        expect(service).toContain("systemd-socket-proxyd --exit-idle-time=");
        expect(service).toContain(` ${inner}`);
        expect(readText(`quadlets/${unit}.container`)).toContain(`PublishPort=${inner}:`);
      }
    }
  });

  test("containers are confined: no spc_t / label disable, caps dropped, no privilege gain", () => {
    for (const unit of Object.keys(CONTAINERS)) {
      const text = readText(`quadlets/${unit}.container`);
      expect(text).not.toMatch(/^SecurityLabel(Type|Disable)=/m);
      expect(text).not.toMatch(/^Privileged=/m);
      expect(text).toContain("DropCapability=ALL");
      expect(text).toContain("NoNewPrivileges=true");
      expect(text).toMatch(/Volume=.*:Z/);
      expect(text).toContain("Notify=healthy");
      for (const line of text.split("\n")) {
        if (line.startsWith("PublishPort=")) expect(line.startsWith("PublishPort=127.0.0.1:")).toBe(true);
      }
    }
  });

  test("android quadlet adds only /dev/kvm; ghidra keeps its token out of the repo", () => {
    const android = readText("quadlets/heretek-android-kvm.container");
    expect(android).toContain("AddDevice=/dev/kvm");
    expect(android).not.toMatch(/^Device=/m);
    const ghidra = readText("quadlets/heretek-ghidra-mcp.container");
    expect(ghidra).toContain("EnvironmentFile=");
    expect(ghidra).toContain("GHIDRA_MCP_AUTH_TOKEN");
  });

  test("no floating tags or socket mounts in any quadlet unit", () => {
    for (const unit of Object.keys(CONTAINERS)) {
      const text = readText(`quadlets/${unit}.container`);
      expect(text).not.toContain(":latest");
      expect(text).not.toContain("docker.sock");
      expect(text).not.toContain("podman.sock");
    }
  });
});

// ---------------------------------------------------------------------------
// Toolchain templates + headless desktop
// ---------------------------------------------------------------------------

describe("toolchain templates (real files on disk)", () => {
  test("mise.toml pins the exact spec tool versions", () => {
    const text = readText("devcontainers/polyglot-dev/mise.toml");
    expect(text).toContain('node = "22.9.0"');
    expect(text).toContain('python = "3.12.7"');
    expect(text).toContain('rust = "1.80.0"');
    expect(text).toContain('go = "1.23.3"');
    expect(text).toContain('bun = "1.4.2"');
  });

  test("mise.toml includes the ast-grep and fallow tooling", () => {
    const text = readText("devcontainers/polyglot-dev/mise.toml");
    expect(text).toContain("@ast-grep/cli");
    expect(text).toContain("fallow");
  });

  test("pixi.toml uses conda-forge with the pinned CUDA/AI closure", () => {
    const text = readText("devcontainers/ai-cuda-dev/pixi.toml");
    expect(text).toContain("conda-forge");
    expect(text).toContain("pytorch");
    expect(text).toContain("2.4");
    expect(text).toContain("12.4");
    expect(text).toContain("cmake");
    expect(text).toContain("ninja");
    expect(text).toContain("opencv");
  });

  test("pixi.toml documents rattler hardlink deduplication", () => {
    const text = readText("devcontainers/ai-cuda-dev/pixi.toml");
    expect(text.toLowerCase()).toContain("rattler");
    expect(text.toLowerCase()).toContain("hardlink");
  });

  test("headless desktop Dockerfile uses a pinned Debian base with Sway + AT-SPI2 + ydotool", () => {
    const text = readText("devcontainers/headless-wayland-desktop/Dockerfile");
    expect(text).toMatch(/FROM debian:trixie[-\w]*/);
    expect(text).not.toContain(":latest");
    for (const pkg of ["sway", "at-spi2-core", "ydotool"]) {
      expect(text).toContain(pkg);
    }
    expect(text).toContain("localhost/heretek/computer-use-linux:0.7.17");
  });

  test("headless desktop Dockerfile runs as non-root with no socket mounts", () => {
    const text = readText("devcontainers/headless-wayland-desktop/Dockerfile");
    expect(text).toContain("USER 1000:1000");
    expect(text).not.toContain("docker.sock");
    expect(text).not.toContain("podman.sock");
  });
});

// ---------------------------------------------------------------------------
// Verifier fail-closed coverage
// ---------------------------------------------------------------------------

describe("verify-stack on the real tree", () => {
  test("verifier passes green on the clean tree", () => {
    const r = run(["bun", "run", VERIFY_TS]);
    expect(r.exit).toBe(0);
    expect(r.out).toContain("PASS");
  });
  // Per-rule fail-closed regression tests live in test/verify-stack.test.ts.
});
