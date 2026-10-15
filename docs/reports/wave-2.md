# Wave 2 Implementation Report — 4 Specialist Compose Profiles

- **Stage ID:** wave-2-specialist-profiles
- **Branch:** `wave-2-specialist-profiles`
- **Worktree:** `/home/john/Projects/Heretek-AI-Rebuild/heretek-devcontainers/worktrees/wave-2`
- **Date (UTC):** 2026-10-15
- **Spec:** `docs/prompts/SPEC.md` §2.2, `AGENTS.md` §§0.4–0.5

## Summary of deliverables

Implemented all 4 on-demand domain Compose profiles (12 services total) exactly
per SPEC §2.2, with per-service `profiles: ["<name>", "all"]` so each domain
loads on demand via `docker compose --profile <name> up`. Every service is
hardened fail-closed: pinned image, `127.0.0.1` loopback ports only,
`cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`, non-root
`1000:1000`, named volumes (or `:Z`-labelled bind mount for ghidra data), zero
socket mounts, zero banned AGPL/root-escape images. The untouched Wave 1
verifier (`scripts/verify-stack.ts`) passes over all 8 scanned files with no
modifications. Expanded `test/compose-contracts.test.ts` with 18 Wave 2 tests
(kept all Wave 1 tests; one Wave 1 assertion was narrowed, see §Self-audit).
Added `scripts/accept/wave-2.sh` gate (Wave 1 gate still green — no regression).

## Files created / modified

| File | Change |
|---|---|
| `compose/profile-appsec.yml` | NEW — `ghidra-mcp` (`bethington/ghidra-mcp-headless:v6.0.0`, `:8089`, mandatory `${GHIDRA_MCP_AUTH_TOKEN:?…}`, bind `./data/ghidra-mcp:/data:Z`), `radare2-mcp` (`ghcr.io/radareorg/radare2-mcp:1.8.8`, `["r2mcp","-H","0.0.0.0:8765","-r"]`, `:8765`), `rea-mcp` (`ghcr.io/morluto/rea:6.5.0`, `:8766`), `mdb-mcp` (`ghcr.io/smadi0x86/mdb-mcp:1.2.0`, `:8767`, sole documented `cap_add: [SYS_PTRACE]`) |
| `compose/profile-android.yml` | NEW — `android-kvm` (`budtmo/docker-android:emulator_14.0`, `devices: ["/dev/kvm:/dev/kvm"]`, `:6080` + `:5555`), `adb-mcp` (`ghcr.io/iksnerd/adb-mcp:v1.4.0`, `ANDROID_HOST=android-kvm`, `:8770`, `depends_on android-kvm`), `maestro-mcp` (`ghcr.io/mobile-dev-inc/maestro:v1.39.8`, `["maestro","mcp"]`, `:8771`) |
| `compose/profile-game.yml` | NEW — `godot-mcp` (`ghcr.io/tugcantopaloglu/godot-mcp:v3.1.0`, `GODOT_HEADLESS=1`, `:8780`), `blender-mcp` (`ghcr.io/sandraschi/blender-mcp:v1.2.0`, `["blender","--background"]`, `:8781`) |
| `compose/profile-research.yml` | NEW — `searxng` (`searxng/searxng:2026.10.14`, `127.0.0.1:8888:8080`, mandatory `${SEARXNG_SECRET:?…}`), `crawl4ai` (`unclecode/crawl4ai:0.9.5`, `:11235`, `shm_size: "1g"`), `computer-use-linux` (`ghcr.io/agent-sh/computer-use-linux:v0.9.4`, `WLR_BACKENDS=headless`, `:8790`) |
| `test/compose-contracts.test.ts` | EXTENDED — kept all Wave 1 tests; scoped one over-broad assertion (see §Self-audit); added `describe("wave 2 specialist profiles")` with 18 tests: file existence, spec services/images/ports per file, pinned tags, loopback ports, zero sock mounts, caps per service, `SYS_PTRACE` sole-exception, no banned images, per-service profile pairs, mandatory-token refs, `/dev/kvm`, `shm_size`, headless envs, non-root users |
| `scripts/accept/wave-2.sh` | NEW — executable gate: file existence, per-profile service/image/port greps, `/dev/kvm` + `shm_size` checks, root `include:` coverage, verifier exit 0, `bun test` exit 0, Wave 1 gate regression check |
| `docs/reports/wave-2.md` | NEW — this report |

NOT touched (Wave 3 scope): `devcontainers/**`, `quadlets/*`,
`scripts/heretek-exec.sh`, `scripts/heretek-box-ctl.sh`.
NOT modified: `compose/core.yml`, `compose/bifrost.yaml`,
`compose/agentgateway.yaml`, `scripts/verify-stack.ts`, `docker-compose.yml`
(root already `include:`s all 4 profiles from Wave 1).

## Test results (real output, inspected)

- `bun run scripts/verify-stack.ts` → `PASS: all security contracts hold across 8 scanned file(s).` (exit 0)
- `bun test` → `32 pass, 0 fail, 307 expect() calls, Ran 32 tests across 2 files` (exit 0)
- `bash scripts/accept/wave-2.sh` → `WAVE-2 ACCEPT PASS` (exit 0)
- `bash scripts/accept/wave-1.sh` (via wave-2 gate regression step) → `WAVE-1 ACCEPT PASS` (exit 0)
- `make check` → verifier PASS + `bun test` 32 pass (exit 0)

## Self-audit notes

1. **Narrowed Wave 1 assertion (documented, fail-closed preserved):** the Wave 1
   test `expect(readText(file)).not.toContain("0.0.0.0:")` scanned whole files,
   which false-positives on the SPEC §2.2-mandated container-internal listen
   address in `radare2-mcp`'s `command: ["r2mcp", "-H", "0.0.0.0:8765", "-r"]`
   (that address is never published — the published mapping is loopback-only
   `127.0.0.1:8765:8765`). The assertion now checks only lines under `ports:`
   blocks plus `host_ip:` values, which is the exact security invariant the
   verifier itself enforces (`LOOPBACK_PORTS_ONLY`). The verifier needed no
   changes: it already scopes port checks correctly and passed 8/8 files
   untouched. For Drift Guard: the single `0.0.0.0` occurrence in the tree is
   `compose/profile-appsec.yml` `radare2-mcp` `command` (container-internal
   listen), explicitly required by SPEC §2.2.
2. **Comment hygiene:** an explanatory comment in `profile-appsec.yml` initially
   contained the literal `cap_drop: [ALL]`, which a strict count-based test
   correctly flagged; reworded the comment to prose (no pattern literals in
   comments). Lesson applied to all 4 files: comments carry no
   `cap_drop: [ALL]`, `:latest`, or port literals.
3. **SELinux:** the only bind mount in Wave 2 is
   `./data/ghidra-mcp:/data:Z` (explicit `:Z` per task); all other services use
   named volumes, which the verifier correctly exempts. `devices: /dev/kvm` is
   a device mapping, not a mount — no label rule applies, verifier confirms.
4. **Zero stubs:** all 12 services declare complete image/user/ports/volumes/
   caps/security_opt/healthcheck; no `TODO`, no dummy values, no swallowed
   errors. `android-kvm` keeps `cap_drop: [ALL]` + `no-new-privileges:true`
   (KVM access comes from the `devices:` passthrough, not capabilities).
5. **Scope:** no Wave 3 files created; no Wave 1 production files modified —
   only additive test expansion in `test/compose-contracts.test.ts`.
