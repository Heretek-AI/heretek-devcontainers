#!/usr/bin/env bash
# scripts/accept/wave-3.sh — Wave 3 acceptance gate.
# Exit 0 only when every Wave 3 deliverable exists and verifies green,
# with no regression in the Wave 1 / Wave 2 gates.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

fail() {
  echo "WAVE-3 ACCEPT FAIL: $1" >&2
  exit 1
}

echo "==> [wave-3] required files exist"
for f in \
  devcontainers/polyglot-dev/.devcontainer.json \
  devcontainers/polyglot-dev/mise.toml \
  devcontainers/ai-cuda-dev/.devcontainer.json \
  devcontainers/ai-cuda-dev/pixi.toml \
  devcontainers/headless-wayland-desktop/Dockerfile \
  devcontainers/headless-wayland-desktop/sway-config \
  quadlets/heretek-android-kvm.container \
  quadlets/heretek-ghidra-mcp.container \
  quadlets/heretek-blender-mcp.container \
  scripts/heretek-exec.sh \
  scripts/heretek-box-ctl.sh \
  test/scripts-ctl.test.ts \
  README.md \
  docs/reports/wave-3.md \
; do
  [ -f "$f" ] || fail "missing required file: $f"
  echo "  ok: $f"
done

echo "==> [wave-3] operator scripts are executable"
for f in scripts/heretek-exec.sh scripts/heretek-box-ctl.sh scripts/accept/wave-3.sh; do
  [ -x "$f" ] || fail "not executable: $f"
  echo "  ok (+x): $f"
done

echo "==> [wave-3] devcontainer JSON parses and carries SELinux labels"
for f in devcontainers/polyglot-dev/.devcontainer.json devcontainers/ai-cuda-dev/.devcontainer.json; do
  bun -e "const t = await Bun.file('$f').text(); JSON.parse(t);" || fail "$f is not valid JSON"
  grep -q ",Z" "$f" || fail "$f missing SELinux ,Z worktree mount label"
  grep -q '"remoteUser": "agent"' "$f" || fail "$f missing non-root agent user"
  echo "  ok: $f"
done

echo "==> [wave-3] mise/pixi toolchains pin their spec versions"
grep -q 'node = "22.9.0"' devcontainers/polyglot-dev/mise.toml || fail "mise.toml missing Node 22.9.0 pin"
grep -q 'python = "3.12.7"' devcontainers/polyglot-dev/mise.toml || fail "mise.toml missing Python 3.12.7 pin"
grep -q 'bun = "1.4.2"' devcontainers/polyglot-dev/mise.toml || fail "mise.toml missing Bun 1.4.2 pin"
grep -q "conda-forge" devcontainers/ai-cuda-dev/pixi.toml || fail "pixi.toml missing conda-forge channel"
grep -q "12.4" devcontainers/ai-cuda-dev/pixi.toml || fail "pixi.toml missing CUDA 12.4 pin"

echo "==> [wave-3] headless desktop uses a pinned Debian base"
grep -q "FROM debian:trixie" devcontainers/headless-wayland-desktop/Dockerfile || fail "Dockerfile base not pinned to trixie"
grep -q "at-spi2-core" devcontainers/headless-wayland-desktop/Dockerfile || fail "Dockerfile missing at-spi2-core"

echo "==> [wave-3] heretek-exec --dry-run exposes the bwrap+landrun+mise chain"
bash scripts/heretek-exec.sh --dry-run -- echo hello > /tmp/opencode/heretek-exec-dry.txt || fail "heretek-exec --dry-run exited non-zero"
grep -q "bwrap" /tmp/opencode/heretek-exec-dry.txt || fail "dry-run missing bwrap stage"
grep -q "landrun" /tmp/opencode/heretek-exec-dry.txt || fail "dry-run missing landrun stage"
grep -q "mise exec" /tmp/opencode/heretek-exec-dry.txt || fail "dry-run missing mise exec stage"
bash scripts/heretek-exec.sh --dry-run --kvm -- true > /tmp/opencode/heretek-exec-kvm.txt || fail "heretek-exec --dry-run --kvm exited non-zero"
grep -q "/dev/kvm" /tmp/opencode/heretek-exec-kvm.txt || fail "dry-run --kvm missing /dev/kvm bind"

echo "==> [wave-3] box-ctl lists all 6 profiles"
profiles="$(bash scripts/heretek-box-ctl.sh list-profiles)" || fail "box-ctl list-profiles exited non-zero"
echo "$profiles"
[ "$(printf '%s\n' "$profiles" | wc -l)" -eq 6 ] || fail "list-profiles must print exactly 6 lines"
for p in core appsec android game research all; do
  printf '%s\n' "$profiles" | grep -qx "$p" || fail "list-profiles missing profile: $p"
done
bash scripts/heretek-box-ctl.sh up bogus-profile >/dev/null 2>&1 && fail "box-ctl up accepted an unknown profile" || true

echo "==> [wave-3] quadlets socket-activate with pinned images on loopback ports"
for f in quadlets/*.container; do
  grep -q "StopWhenUnneeded=true" "$f" || fail "$f missing StopWhenUnneeded=true"
  grep -qE "^Image=.*:.+" "$f" || fail "$f has an unpinned Image="
  grep -q "PublishPort=127.0.0.1:" "$f" || fail "$f missing loopback PublishPort="
  echo "  ok: $f"
done
grep -q "Image=budtmo/docker-android:emulator_14.0" quadlets/heretek-android-kvm.container || fail "android quadlet image drifted"
grep -q "Image=bethington/ghidra-mcp-headless:v6.0.0" quadlets/heretek-ghidra-mcp.container || fail "ghidra quadlet image drifted"
grep -q "Image=ghcr.io/sandraschi/blender-mcp:v1.2.0" quadlets/heretek-blender-mcp.container || fail "blender quadlet image drifted"

echo "==> [wave-3] static verifier passes (fail-closed)"
bun run scripts/verify-stack.ts || fail "verify-stack.ts exited non-zero"

echo "==> [wave-3] unit tests pass"
bun test || fail "bun test exited non-zero"

echo "==> [wave-3] wave-1 and wave-2 gates still green (no regression)"
bash scripts/accept/wave-1.sh || fail "wave-1.sh regressed"
bash scripts/accept/wave-2.sh || fail "wave-2.sh regressed"

echo "WAVE-3 ACCEPT PASS"
