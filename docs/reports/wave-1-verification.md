# Wave 1 Drift Guard Verification Report — Root Compose, Core Profile & Static Verifier

- Stage ID: wave-1-core-verifier
- Branch: `wave-1-core-verifier`
- Worktree: `/home/john/Projects/Heretek-AI-Rebuild/heretek-devcontainers/worktrees/wave-1`
- Audit date (UTC): 2026-10-15
- Auditor role: `agency-drift-guard` (Independent Adversarial Drift Guard Auditor)
- Spec sources read in full from disk: `AGENTS.md`, `docs/prompts/SPEC.md`, `docs/prompts/verify-stage.md`, `MASTER_BUILD_PROMPT.md`, `docs/reports/wave-1.md`, `docs/evidence/wave-1/red-proofs.log`
- Constraint observed: strictly read-only to production code; this report is the single file written by the auditor. No commits made.

## 1. Files audited

| File | Status |
|---|---|
| `docker-compose.yml` (14 lines) | Audited |
| `compose/core.yml` (74 lines) | Audited |
| `compose/bifrost.yaml` (49 lines) | Audited |
| `compose/agentgateway.yaml` (63 lines) | Audited |
| `scripts/verify-stack.ts` (474 lines) | Audited in full |
| `.env.example` (29 lines) | Audited |
| `test/compose-contracts.test.ts` (213 lines) | Audited |
| `test/bifrost-config.test.ts` (61 lines) | Audited |
| `scripts/accept/wave-1.sh` (57 lines) | Audited |
| `docs/reports/wave-1.md` (41 lines) | Audited (programmer report) |
| `docs/evidence/wave-1/red-proofs.log` (140 lines) | Audited (QA evidence) |
| `Makefile`, `package.json`, `tsconfig.json` | Baseline scaffolding confirmed |

## 2. Scope audit — PASS

- Full tree listing (glob `**/*`, 16 files) contains ONLY Wave 1 deliverables plus Step-0 baseline (`AGENTS.md`, `Makefile`, `package.json`, `tsconfig.json`, `MASTER_BUILD_PROMPT.md`, `docs/prompts/*`, `bun.lock`, `.gitignore`).
- Confirmed ABSENT (no drift into future waves or forbidden territory):
  - No `compose/profile-*.yml` (Wave 2 correctly not started).
  - No `devcontainers/`, no `quadlets/`, no `scripts/heretek-exec.sh`, no `scripts/heretek-box-ctl.sh` (Wave 3 correctly not started).
  - No 57 language Dockerfiles, no Nix flakes (`*.nix`/`flake.*`), no WebUI / agent state-machine code.
  - No leftover `env.example.tmp`, no real `.env` in tree (correct — template only).
- Root `docker-compose.yml` references the 4 Wave-2 profile paths via `include:` — this is SPEC-MANDATED (§2.1: root references all 5 profiles) and is NOT scope drift. The referenced files do not exist yet; the verifier skips absent files gracefully and the accept script does not require them to exist. Not a finding.
- Refusal boundary: nothing to refuse; no forbidden content present.

**Scope verdict: PASS**

## 3. Security invariants table — all PASS

All greps below were run independently by the auditor against the worktree.

| # | Invariant | Evidence | Result |
|---|---|---|---|
| S1 | Zero `:latest` / all images pinned | `grep -rn "image:" compose/ docker-compose.yml` returns exactly 3 hits: `ghcr.io/maximhq/bifrost:v1.0.0` (core.yml:10), `ghcr.io/agentgateway/agentgateway:v1.6.0` (core.yml:31), `nats:2.15.1-alpine` (core.yml:54). Tree-wide `:latest` grep hits are ONLY in docs/verifier logic/test names/sabotage recipes (AGENTS.md, SPEC.md, verify-stage.md, MASTER_BUILD_PROMPT.md, verify-stack.ts tag-rejection logic, test name) — zero occurrences in any `image:` field. | PASS |
| S2 | Zero `docker.sock` / `podman.sock` mounts | Tree-wide grep hits are ONLY in verifier enforcement code (`verify-stack.ts` lines 8, 97, 330, 399), test assertions (`compose-contracts.test.ts` 137–141), docs, and the Wave-2 sabotage recipe. Zero hits in `compose/*.yml`, `docker-compose.yml`, `.env.example`. Independent verifier run confirms no `NO_DOCKER_SOCK` violation. | PASS |
| S3 | Loopback-only ports | `compose/core.yml` publishes exactly `127.0.0.1:8080:8080` (:18), `127.0.0.1:3000:3000` (:41), `127.0.0.1:4222:4222` + `127.0.0.1:8222:8222` (:59–60). No `0.0.0.0:` in any compose file (only in `r2mcp -H 0.0.0.0:8765` Wave-2 SPEC text in AGENTS.md:199 / MASTER_BUILD_PROMPT.md:109, which is a container-internal listen address for a future wave, and in QA sabotage recipes — not a published port). Healthcheck `wget` URLs use `127.0.0.1` correctly. | PASS |
| S4 | Hardened caps (`cap_drop: [ALL]` + `no-new-privileges:true`) | All 3 services (`bifrost`, `agentgateway`, `nats`) declare `cap_drop: [ALL]` and `security_opt: ["no-new-privileges:true"]`. `grep -c` confirms presence; `bun test` asserts exactly 3 code occurrences of each. No `cap_add` anywhere (the `mdb-mcp` SYS_PTRACE exception belongs to Wave 2, correctly absent). | PASS |
| S5 | SELinux volume labels | Bind mounts `./bifrost.yaml:/app/config.yaml:ro,Z` (:20) and `./agentgateway.yaml:/etc/agentgateway.yaml:ro,Z` (:43) carry `:ro,Z`. `nats-data:/data` is a named volume (correctly label-free). No bare `./...` or `/...` bind without a label. | PASS |
| S6 | No banned AGPL/root-escape images | Tree-wide grep for `firecrawl\|RFingAdam\|bytebot\|0xflux\|pentagi` (case-insensitive set) hits ONLY: verifier token list + comments, test token list, and SPEC/docs prose (including the `vxcontrol/pentagi` vuln-class reference). Zero hits in any `image:` field. `pentagi` appears solely in the vulnerability-class narrative, never as an image. | PASS |
| S7 | Exact pinned versions | `bifrost` = `ghcr.io/maximhq/bifrost:v1.0.0` ✓; `agentgateway` = `ghcr.io/agentgateway/agentgateway:v1.6.0` ✓; `nats` = `nats:2.15.1-alpine` with `command: ["-js", "-sd", "/data", "-m", "8222"]` ✓ (core.yml:57). Non-root `user: "1000:1000"` on all 3 services ✓. | PASS |

## 4. Spec fidelity (SPEC §2.1) — PASS

- `docker-compose.yml`: `name: heretek-devcontainers` + `include:` of `compose/core.yml` and all 4 Wave-2 profiles ✓.
- `compose/core.yml`: 3 services with exact images, ports, nats command, hardening, labels, healthchecks ✓ (see S7).
- `compose/bifrost.yaml`: `session_affinity: { enabled: true, ttl: "3600s", header: "x-session-id" }` ✓ (lines 14–17); providers `opencode` / `openrouter` / `local-vllm` ✓ (lines 20–38); route `primary: opencode` with fallbacks `[openrouter, local-vllm]` in exact order ✓ (lines 40–45); `retry: { parse_retry_after: true, max_retry_after_clamp: "300s" }` ✓ (lines 47–49). `server.listen: ":8080"` is port-only form with no wildcard-IP string in the tree (comment explicitly documents host binding lives in core.yml) ✓.
- `compose/agentgateway.yaml`: `admin` full-allow role + `agent` limited `mcp.invoke`/`mcp.list` allow with `admin.*`/`mcp.delete`/`route.*` deny via CEL conditions ✓; targets `bifrost → http://bifrost:8080` and `nats → nats://nats:4222` over compose DNS ✓; routes `/bifrost/`, `/events/`, admin-only `/admin/` ✓.
- `.env.example`: all 5 `CHANGEME_` template tokens present (`BIFROST_API_KEY`, `OPENROUTER_API_KEY`, `GHIDRA_MCP_AUTH_TOKEN`, `SEARXNG_SECRET`, `NATS_PASSWORD`) ✓. No real `.env` in tree, so no `ENV_PLACEHOLDER_LEAK` ✓.

## 5. Verifier completeness (all 6 rules + env rule) — PASS

`scripts/verify-stack.ts` (474 lines) read in full. All rules implemented with fail-closed `process.exit(1)` and `FAIL [RULE] file:line` diagnostics:

1. `NO_FLOATING_TAGS` — `checkFloatingTags` (lines 155–177): rejects `nats:latest`, empty refs, missing tags; registry-port aware (`ghcr.io:443/…` handled via last-slash logic). Also enforced for devcontainer `image` fields and quadlet `Image=` (lines 357–377, 380–403).
2. `NO_DOCKER_SOCK` — `checkGenericContent` (lines 92–113) applied to EVERY scanned file incl. non-service YAML, plus devcontainer JSON semantic check (lines 329–332) and quadlet check (lines 398–402). Unreadable/unparseable devcontainer JSON fails closed (lines 314–327).
3. `LOOPBACK_PORTS_ONLY` — `checkLoopbackPorts` (lines 179–224): short-syntax `127.0.0.1:` prefix enforcement plus long-syntax `host_ip` check.
4. `HARDENED_CAPS` — `checkHardenedCaps` (lines 226–253): accepts inline and block-list `cap_drop` forms; requires `no-new-privileges:true`.
5. `SELINUX_VOLUME_LABELS` — `checkSelinuxLabels` (lines 255–289) for compose + devcontainer mount collection (lines 335–356); named volumes correctly exempted.
6. `NO_AGPL_IN_DEV_OR_GAME` — `BANNED_IMAGE_TOKENS` (line 90) checked in generic content, image fields, and quadlets (case-insensitive).
7. `ENV_PLACEHOLDER_LEAK` (bonus, beyond the 6): `checkRealEnv` (lines 405–414) rejects a real `.env` containing `CHANGEME_` while `.env.example` is exempt — matches the `.env.example` contract comment.

Service-block parser (`splitServices`, lines 121–153) correctly terminates at top-level `volumes:` so `nats-data:` is not misparsed as a service. `main()` (lines 432–474) scans `docker-compose.yml` + `compose/*.yml` + `compose/*.yaml` (generic rules) + devcontainers + quadlets, prints `PASS`/`FAIL CLOSED` with counts.

## 6. Stub / shortcut scan — PASS (zero stubs)

- `grep` for `TODO|FIXME|dummy|return true|exit 0|echo "pass"|\|\| true` in `compose/core.yml`: no matches.
- `grep` for `TODO|FIXME|cmd.*true|exit 0|echo "pass"` in `scripts/verify-stack.ts`: no matches.
- QA's zero-stub audit (red-proofs.log §ZERO-STUBS AUDIT) independently confirms: no `TODO|FIXME|placeholder|dummy` in `compose/`; the 2 `placeholder` hits in the verifier are a doc comment + the active `ENV_PLACEHOLDER_LEAK` enforcement (not stubs); no `expect(true)` vacuous assertions in `test/`.
- Tests assert against real files on disk (`readFileSync`), with quantitative guards (`images.length > 0`, `total ports > 0`, exact counts of 3× `cap_drop`/`no-new-privileges`). `scripts/accept/wave-1.sh` uses `set -euo pipefail` with a `fail()` helper — no `|| true` / `set +e` / `cmd: "true"` shortcuts anywhere.

## 7. Independent sample verification (auditor-run, read-only) — PASS

Run by the auditor in the worktree (no mutations made):

- `bun run scripts/verify-stack.ts` → `PASS: all security contracts hold across 4 scanned file(s).` EXIT:0 ✓
- `bun test` → `14 pass, 0 fail, 66 expect() calls, Ran 14 tests across 2 files` ✓
- `make check` → verifier PASS + `bun test` 14/14 ✓
- NOTE on count discrepancy: programmer report claims 13 tests; actual tree runs 14/14 green. This is a harmless superset (stale count in prose), not a failure — recorded here for accuracy.

Fail-closed sampling (NOT re-executed by the auditor per instructions — QA already proved it; cross-referenced from `docs/evidence/wave-1/red-proofs.log`):

- Sabotage 1 (`nats:latest`): `FAIL [NO_FLOATING_TAGS] compose/core.yml:54` exit 1 ✓ correct rule, clean restore (`git checkout --`, verifier back to exit 0).
- Sabotage 2 (`0.0.0.0:8080:8080`): `FAIL [LOOPBACK_PORTS_ONLY] compose/core.yml:18` exit 1 ✓ correct rule, clean restore.
- Sabotage 3 (injected `/var/run/docker.sock` mount): `FAIL [NO_DOCKER_SOCK]` (+ secondary `SELINUX_VOLUME_LABELS` on the same injected line) exit 1 ✓ correct primary rule, clean restore.
- All 3 sabotages exceed the mandated minimum of 2; each shows exact verifier output + exit code + restore proof. At least 2 key assertions are thus proven truly fail-closed by independent QA evidence, corroborated by the auditor's code reading of the corresponding verifier functions.

## 8. QA evidence & git verdict — PASS (with one advisory)

- `docs/evidence/wave-1/red-proofs.log` EXISTS on disk (140 lines): green-path section (make check / accept / bun test / verifier all exit 0 with pasted output), 3 sabotage sections in the mandated `COMMAND / OBSERVED / RESTORED` format, zero-stub audit, final tree state. `QA VERDICT: PASS` is recorded with the correct gate logic.
- `git log`: programmer commit `793de7e feat(wave-1): root compose, core.yml, bifrost/agentgateway configs and verify-stack verifier` on top of `69d6cc7` baseline ✓. Branch is `wave-1-core-verifier` ✓.
- ADVISORY (not a FAIL, no rework required): `red-proofs.log` is currently git-ignored by `.gitignore:4:*.log` (`git check-ignore` confirms) and is therefore NOT in the programmer commit (`git log --stat -1` lists 10 files, log file absent; `git status --short` is clean because the file is ignored). The evidence is verifiable on disk in this worktree, satisfying the audit, but the COORDINATOR must `git add -f docs/evidence/wave-1/red-proofs.log docs/reports/wave-1-verification.md` (or amend the ignore rule) before/at merge, otherwise the binding QA evidence will not survive the merge to `main`. Flagged for the coordinator; not charged against the programmer or QA.

## 9. Findings requiring rework

None. Zero numbered defects. No `VERDICT: FAIL` conditions met.

## 10. Binding verdict

All Wave 1 deliverables are complete and match SPEC §2.1 byte-for-byte in meaning. All 7 security invariants hold. The verifier implements all 6 fail-closed rules (+ env rule) with no stubs. QA red-proof evidence proves 3/3 sabotages fail closed with correct rules and clean restoration. Scope is clean with no forbidden content. The single advisory (log-file gitignore) is a coordinator merge-step concern, not a deliverable defect.

VERDICT: PASS
