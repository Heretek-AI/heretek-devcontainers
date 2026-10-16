#!/usr/bin/env bash
# scripts/accept/wave-1.sh — Wave 1 acceptance gate.
# Exit 0 only when every Wave 1 deliverable exists and verifies green.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

fail() {
  echo "WAVE-1 ACCEPT FAIL: $1" >&2
  exit 1
}

echo "==> [wave-1] required files exist"
for f in \
  .env.example \
  docker-compose.yml \
  compose/core.yml \
  compose/bifrost.yaml \
  compose/agentgateway.yaml \
  scripts/verify-stack.ts \
  test/compose-contracts.test.ts \
  test/bifrost-config.test.ts \
; do
  [ -f "$f" ] || fail "missing required file: $f"
  echo "  ok: $f"
done

echo "==> [wave-1] .env.example carries CHANGEME_ template tokens"
grep -q "BIFROST_API_KEY=CHANGEME_" .env.example || fail ".env.example missing BIFROST_API_KEY template"
grep -q "OPENROUTER_API_KEY=CHANGEME_" .env.example || fail ".env.example missing OPENROUTER_API_KEY template"
grep -q "GHIDRA_MCP_AUTH_TOKEN=CHANGEME_" .env.example || fail ".env.example missing GHIDRA_MCP_AUTH_TOKEN template"
grep -q "SEARXNG_SECRET=CHANGEME_" .env.example || fail ".env.example missing SEARXNG_SECRET template"
grep -q "NATS_PASSWORD=CHANGEME_" .env.example || fail ".env.example missing NATS_PASSWORD template"

echo "==> [wave-1] root compose uses include:"
grep -q "include:" docker-compose.yml || fail "docker-compose.yml missing include:"

echo "==> [wave-1] core.yml defines 3 pinned services"
for svc in bifrost agentgateway nats; do
  grep -q "^  $svc:" compose/core.yml || fail "compose/core.yml missing service: $svc"
done
grep -q "ghcr.io/maximhq/bifrost:v2.3.0" compose/core.yml || fail "bifrost image not pinned"
grep -q "ghcr.io/agentgateway/agentgateway:v1.6.0" compose/core.yml || fail "agentgateway image not pinned"
grep -q "nats:2.15.1-alpine" compose/core.yml || fail "nats image not pinned"

echo "==> [wave-1] bifrost.yaml configures session affinity"
grep -q "session_affinity:" compose/bifrost.yaml || fail "bifrost.yaml missing session_affinity"
grep -q "enabled: true" compose/bifrost.yaml || fail "bifrost.yaml affinity not enabled"

echo "==> [wave-1] agentgateway config uses the real schema and command"
grep -q "^binds:" compose/agentgateway.yaml || fail "agentgateway.yaml missing top-level binds:"
grep -q "^version:" compose/agentgateway.yaml && fail "agentgateway.yaml carries the invalid top-level version: key"
grep -qF 'command: ["-f", "/etc/agentgateway.yaml"]' compose/core.yml || fail "agentgateway must run with -f /etc/agentgateway.yaml"

echo "==> [wave-1] static verifier passes (fail-closed)"
bun run scripts/verify-stack.ts || fail "verify-stack.ts exited non-zero"

echo "==> [wave-1] unit tests pass"
bun test || fail "bun test exited non-zero"

echo "WAVE-1 ACCEPT PASS"
