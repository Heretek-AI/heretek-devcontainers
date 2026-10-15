#!/usr/bin/env bash
# scripts/accept/wave-2.sh — Wave 2 acceptance gate.
# Exit 0 only when every Wave 2 deliverable exists and verifies green,
# with no regression in the Wave 1 gate.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

fail() {
  echo "WAVE-2 ACCEPT FAIL: $1" >&2
  exit 1
}

echo "==> [wave-2] required profile files exist"
for f in \
  compose/profile-appsec.yml \
  compose/profile-android.yml \
  compose/profile-game.yml \
  compose/profile-research.yml \
  test/compose-contracts.test.ts \
; do
  [ -f "$f" ] || fail "missing required file: $f"
  echo "  ok: $f"
done

echo "==> [wave-2] appsec profile defines 4 pinned services"
for svc in ghidra-mcp radare2-mcp rea-mcp mdb-mcp; do
  grep -q "^  $svc:" compose/profile-appsec.yml || fail "profile-appsec.yml missing service: $svc"
done
grep -q "bethington/ghidra-mcp-headless:v6.0.0" compose/profile-appsec.yml || fail "ghidra-mcp image not pinned"
grep -q "ghcr.io/radareorg/radare2-mcp:1.8.8" compose/profile-appsec.yml || fail "radare2-mcp image not pinned"
grep -q "ghcr.io/morluto/rea:6.5.0" compose/profile-appsec.yml || fail "rea-mcp image not pinned"
grep -q "ghcr.io/smadi0x86/mdb-mcp:1.2.0" compose/profile-appsec.yml || fail "mdb-mcp image not pinned"
grep -q "127.0.0.1:8089:8089" compose/profile-appsec.yml || fail "ghidra-mcp port not loopback"
grep -q "127.0.0.1:8765:8765" compose/profile-appsec.yml || fail "radare2-mcp port not loopback"
grep -q "127.0.0.1:8766:8766" compose/profile-appsec.yml || fail "rea-mcp port not loopback"
grep -q "127.0.0.1:8767:8767" compose/profile-appsec.yml || fail "mdb-mcp port not loopback"
grep -q 'GHIDRA_MCP_AUTH_TOKEN' compose/profile-appsec.yml || fail "ghidra-mcp missing mandatory auth token"
grep -q 'cap_add: \[SYS_PTRACE\]' compose/profile-appsec.yml || fail "mdb-mcp missing documented SYS_PTRACE exception"

echo "==> [wave-2] android profile defines 3 pinned services"
for svc in android-kvm adb-mcp maestro-mcp; do
  grep -q "^  $svc:" compose/profile-android.yml || fail "profile-android.yml missing service: $svc"
done
grep -q "budtmo/docker-android:emulator_14.0" compose/profile-android.yml || fail "android-kvm image not pinned"
grep -q "ghcr.io/iksnerd/adb-mcp:v1.4.0" compose/profile-android.yml || fail "adb-mcp image not pinned"
grep -q "ghcr.io/mobile-dev-inc/maestro:v1.39.8" compose/profile-android.yml || fail "maestro-mcp image not pinned"
grep -q "/dev/kvm:/dev/kvm" compose/profile-android.yml || fail "android-kvm missing /dev/kvm passthrough"
grep -q "127.0.0.1:6080:6080" compose/profile-android.yml || fail "android-kvm VNC port not loopback"
grep -q "127.0.0.1:5555:5555" compose/profile-android.yml || fail "android-kvm ADB port not loopback"
grep -q "127.0.0.1:8770:8770" compose/profile-android.yml || fail "adb-mcp port not loopback"
grep -q "127.0.0.1:8771:8771" compose/profile-android.yml || fail "maestro-mcp port not loopback"

echo "==> [wave-2] game profile defines 2 pinned services"
for svc in godot-mcp blender-mcp; do
  grep -q "^  $svc:" compose/profile-game.yml || fail "profile-game.yml missing service: $svc"
done
grep -q "ghcr.io/tugcantopaloglu/godot-mcp:v3.1.0" compose/profile-game.yml || fail "godot-mcp image not pinned"
grep -q "ghcr.io/sandraschi/blender-mcp:v1.2.0" compose/profile-game.yml || fail "blender-mcp image not pinned"
grep -q "127.0.0.1:8780:8780" compose/profile-game.yml || fail "godot-mcp port not loopback"
grep -q "127.0.0.1:8781:8781" compose/profile-game.yml || fail "blender-mcp port not loopback"

echo "==> [wave-2] research profile defines 3 pinned services"
for svc in searxng crawl4ai computer-use-linux; do
  grep -q "^  $svc:" compose/profile-research.yml || fail "profile-research.yml missing service: $svc"
done
grep -q "searxng/searxng:2026.10.14" compose/profile-research.yml || fail "searxng image not pinned"
grep -q "unclecode/crawl4ai:0.9.5" compose/profile-research.yml || fail "crawl4ai image not pinned"
grep -q "ghcr.io/agent-sh/computer-use-linux:v0.9.4" compose/profile-research.yml || fail "computer-use-linux image not pinned"
grep -q "127.0.0.1:8888:8080" compose/profile-research.yml || fail "searxng port not loopback"
grep -q "127.0.0.1:11235:11235" compose/profile-research.yml || fail "crawl4ai port not loopback"
grep -q "127.0.0.1:8790:8790" compose/profile-research.yml || fail "computer-use-linux port not loopback"
grep -q 'shm_size: "1g"' compose/profile-research.yml || fail "crawl4ai missing shm_size 1g"

echo "==> [wave-2] root compose includes all 4 specialist profiles"
for p in profile-appsec.yml profile-android.yml profile-game.yml profile-research.yml; do
  grep -q "compose/$p" docker-compose.yml || fail "docker-compose.yml missing include: compose/$p"
done

echo "==> [wave-2] static verifier passes (fail-closed, 8 files)"
bun run scripts/verify-stack.ts || fail "verify-stack.ts exited non-zero"

echo "==> [wave-2] unit tests pass"
bun test || fail "bun test exited non-zero"

echo "==> [wave-2] wave-1 gate still green (no regression)"
bash scripts/accept/wave-1.sh || fail "wave-1.sh regressed"

echo "WAVE-2 ACCEPT PASS"
