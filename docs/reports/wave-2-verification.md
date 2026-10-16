# Wave 2 Drift Guard Verification Report — 4 Specialist Compose Profiles

- **Stage:** wave-2-specialist-profiles
- **Branch:** `wave-2-specialist-profiles`
- **Worktree:** `/home/john/Projects/Heretek-AI-Rebuild/heretek-devcontainers/worktrees/wave-2`
- **Auditor:** `agency-drift-guard` (Muse Spark 1.3 Contributor)
- **Date (UTC):** 2026-10-16
- **Spec:** `docs/prompts/SPEC.md` §2.2, `AGENTS.md` §§0.4–0.5, `docs/prompts/verify-stage.md` §2
- **Inputs read in full:** `AGENTS.md`, `docs/prompts/SPEC.md`, `docs/prompts/verify-stage.md`,
  `docs/reports/wave-2.md`, `docs/evidence/wave-2/red-proofs.log`,
  `compose/profile-appsec.yml`, `compose/profile-android.yml`, `compose/profile-game.yml`,
  `compose/profile-research.yml`, `docker-compose.yml`, `compose/core.yml`,
  `scripts/verify-stack.ts`, `test/compose-contracts.test.ts`
- **Constraint:** read-only audit; the ONLY file written by this auditor is this report. No commit, no push.

## 1. Scope audit (Wave 1+2 files only)

| Check | Result |
|---|---|
| No `devcontainers/` tree | PASS — `ls devcontainers` → no such file |
| No `quadlets/` tree | PASS — no such file |
| No `scripts/heretek-exec.sh` / `scripts/heretek-box-ctl.sh` | PASS — neither exists |
| No 57 language Dockerfiles | PASS — `find -iname Dockerfile*` → zero hits |
| No NixOS `flake.nix` | PASS — zero hits |
| No WebUI / agent state-machine code | PASS — `git diff main --stat` shows exactly 7 files, all in scope |
| `git diff main --stat` | PASS — `compose/profile-{appsec,android,game,research}.yml` (NEW), `docs/reports/wave-2.md`, `scripts/accept/wave-2.sh`, `test/compose-contracts.test.ts` only |
| Wave 1 files untouched | PASS — `git diff main -- scripts/verify-stack.ts compose/core.yml docker-compose.yml` → empty |

## 2. Spec fidelity audit (SPEC §2.2 exact pins)

| Service | Expected image | Found (line) | Port | Profiles | User | Extra | Result |
|---|---|---|---|---|---|---|---|
| `ghidra-mcp` | `bethington/ghidra-mcp-headless:v6.0.0` | `profile-appsec.yml:14` | `127.0.0.1:8089:8089` (:21) | `["appsec","all"]` (:17) | `1000:1000` (:15) | `${GHIDRA_MCP_AUTH_TOKEN:?…}` mandatory (:19) | PASS |
| `radare2-mcp` | `ghcr.io/radareorg/radare2-mcp:1.8.8` | `profile-appsec.yml:34` | `127.0.0.1:8765:8765` (:42) | `["appsec","all"]` (:37) | `1000:1000` (:35) | `command: ["r2mcp","-H","0.0.0.0:8765","-r"]` (:40) | PASS |
| `rea-mcp` | `ghcr.io/morluto/rea:6.5.0` | `profile-appsec.yml:55` | `127.0.0.1:8766:8766` (:60) | `["appsec","all"]` (:58) | `1000:1000` (:56) | — | PASS |
| `mdb-mcp` | `ghcr.io/smadi0x86/mdb-mcp:1.2.0` | `profile-appsec.yml:73` | `127.0.0.1:8767:8767` (:78) | `["appsec","all"]` (:76) | `1000:1000` (:74) | `cap_add: [SYS_PTRACE]` (:83, sole exception) | PASS |
| `android-kvm` | `budtmo/docker-android:emulator_14.0` | `profile-android.yml:13` | `127.0.0.1:6080:6080` + `127.0.0.1:5555:5555` (:20-21) | `["android","all"]` (:16) | `1000:1000` (:14) | `devices: ["/dev/kvm:/dev/kvm"]` (:18) | PASS |
| `adb-mcp` | `ghcr.io/iksnerd/adb-mcp:v1.4.0` | `profile-android.yml:34` | `127.0.0.1:8770:8770` (:45) | `["android","all"]` (:37) | `1000:1000` (:35) | `ANDROID_HOST: android-kvm`, `depends_on android-kvm` (:38-43) | PASS |
| `maestro-mcp` | `ghcr.io/mobile-dev-inc/maestro:v1.39.8` | `profile-android.yml:58` | `127.0.0.1:8771:8771` (:70) | `["android","all"]` (:61) | `1000:1000` (:59) | `command: ["maestro","mcp"]` (:65) | PASS |
| `godot-mcp` | `ghcr.io/tugcantopaloglu/godot-mcp:v3.1.0` | `profile-game.yml:10` | `127.0.0.1:8780:8780` (:17) | `["game","all"]` (:13) | `1000:1000` (:11) | `GODOT_HEADLESS: "1"` (:15) | PASS |
| `blender-mcp` | `ghcr.io/sandraschi/blender-mcp:v1.2.0` | `profile-game.yml:30` | `127.0.0.1:8781:8781` (:39) | `["game","all"]` (:33) | `1000:1000` (:31) | `command: ["blender","--background"]` (:35) | PASS |
| `searxng` | `searxng/searxng:2026.10.14` | `profile-research.yml:12` | `127.0.0.1:8888:8080` (:20) | `["research","all"]` (:15) | `1000:1000` (:13) | `${SEARXNG_SECRET:?…}` mandatory (:17) | PASS |
| `crawl4ai` | `unclecode/crawl4ai:0.9.5` | `profile-research.yml:33` | `127.0.0.1:11235:11235` (:39) | `["research","all"]` (:36) | `1000:1000` (:34) | `shm_size: "1g"` (:37) | PASS |
| `computer-use-linux` | `ghcr.io/agent-sh/computer-use-linux:v0.9.4` | `profile-research.yml:52` | `127.0.0.1:8790:8790` (:61) | `["research","all"]` (:55) | `1000:1000` (:53) | `WLR_BACKENDS: headless` (:58) | PASS |
| Root orchestrator | `include:` all 5 files | `docker-compose.yml:9-14` | n/a | n/a | n/a | core + 4 specialist profiles | PASS |

12/12 services byte-for-byte match SPEC §2.2.

## 3. Security grep results (adversarial, whole tree)

| Rule | Command | Result |
|---|---|---|
| `NO_FLOATING_TAGS` | `grep -rn ":latest" compose/ docker-compose.yml` | PASS — zero hits in YAML (only 2 hits inside `scripts/verify-stack.ts` logic itself, lines 368/391, which is the detector) |
| `NO_DOCKER_SOCK` | `grep -rn "docker.sock\|podman.sock" compose/ docker-compose.yml` | PASS — zero hits (grep exit 1) |
| Banned AGPL | `grep -rni "firecrawl\|RFingAdam\|bytebot\|0xflux\|pentagi" compose/ docker-compose.yml` | PASS — zero hits (grep exit 1) |
| `0.0.0.0` distinction | `grep -rn "0\.0\.0\.0" compose/ docker-compose.yml` | PASS — exactly ONE hit: `profile-appsec.yml:40` `command: ["r2mcp", "-H", "0.0.0.0:8765", "-r"]`. SPEC §2.2-mandated container-internal listen address, NOT a published host port. Published mapping for the same service is loopback-only `127.0.0.1:8765:8765` (:42). Verifier correctly distinguishes (green on clean tree proves it). NOT a violation. |
| `LOOPBACK_PORTS_ONLY` | All `ports:` entries enumerated | PASS — 13/13 Wave 2 mappings + 4 Wave 1 mappings start `127.0.0.1:`; `BASE_URL: http://127.0.0.1:8888/` is env text, not a port publish |
| `HARDENED_CAPS` | `cap_drop: [ALL]` per file: core 3, appsec 4, android 3, game 2, research 3; `no-new-privileges:true` counts identical | PASS — every service hardened |
| `cap_add` sole exception | `grep -rn "cap_add" compose/` | PASS — single hit `profile-appsec.yml:83` `[SYS_PTRACE]` on `mdb-mcp` only |
| `SELINUX_VOLUME_LABELS` | Only bind mounts in Wave 2: `./data/ghidra-mcp:/data:Z` (:23, labelled); all others named volumes (exempt); `devices: /dev/kvm` is a device mapping, not a mount | PASS — verifier confirms green |
| Non-root users | `user: "1000:1000"` ×12 across 4 profiles (4+3+2+3) | PASS |

## 4. Verifier integrity (no weakening for Wave 2)

| Check | Result |
|---|---|
| `scripts/verify-stack.ts` diff vs `main` | PASS — empty diff, byte-identical |
| All 6 rules present (`NO_FLOATING_TAGS`, `NO_DOCKER_SOCK`, `LOOPBACK_PORTS_ONLY`, `HARDENED_CAPS`, `SELINUX_VOLUME_LABELS`, `NO_AGPL_IN_DEV_OR_GAME`) + `ENV_PLACEHOLDER_LEAK` | PASS — confirmed lines 6-17, check functions intact |
| Port scoping precision (ports-block + `host_ip:` only, not whole-file substring) | PASS — matches the narrowed test assertion; Sabotage C log proves no false-positive on `BASE_URL` line |
| Independent run `bun run scripts/verify-stack.ts` | PASS — `PASS: all security contracts hold across 8 scanned file(s). EXIT:0` (observed by auditor) |

## 5. Test & stub audit (anti-stub scanner)

| Check | Result |
|---|---|
| `bun test` (auditor-observed, read-only) | PASS — `32 pass, 0 fail, 307 expect() calls, Ran 32 tests across 2 files` |
| Test expansion | PASS — 18 new Wave 2 tests in `describe("wave 2 specialist profiles")`; all Wave 1 tests kept |
| Narrowed Wave 1 `0.0.0.0` assertion | JUSTIFIED, not a weakening — now scans `ports:` blocks + `host_ip:` only (test file lines 125-160), which is exactly the verifier's `LOOPBACK_PORTS_ONLY` semantics. Documented in `wave-2.md` §Self-audit. The whole-file `not.toContain("0.0.0.0:")` would false-positive on the spec-mandated `r2mcp -H 0.0.0.0:8765` internal command. Fail-closed invariant preserved. |
| Stub scan `TODO\|FIXME\|XXX\|placeholder\|dummy\|not implemented` on profiles/tests/accept | PASS — no real stubs (only legitimate `CHANGEME_` prose in verifier and `echo` status lines in accept script) |
| Shortcut scan `cmd:"true"`, `echo "pass"`, `\|\| true`, `set +e`, empty `catch`, `exit 0` bypass | PASS — `scripts/accept/wave-2.sh` uses `set -euo pipefail` with `fail()` → `exit 1`; no `\|\| true`, no `set +e`; every check `|| fail "..."` is fail-closed |
| Vacuous assertions | PASS — tests assert exact images/ports/profiles/tokens per service (12-image × 13-port matrix), not `1===1` or process-existence |

## 6. QA red-proof cross-reference (`docs/evidence/wave-2/red-proofs.log`)

| Sabotage | Rule fired | Exit | Restore | Fail-closed? |
|---|---|---|---|---|
| Green path (`make check`, `wave-1.sh`, `wave-2.sh`, `bun test`, verifier) | — | 0, 32 pass, 8 files | n/a | YES |
| A: `docker.sock` mount injected in `profile-appsec.yml` | `NO_DOCKER_SOCK` (+ secondary `SELINUX_VOLUME_LABELS` on same line) `profile-appsec.yml:24` | 1 | `git checkout --`, grep 0, verifier 0 | YES, non-vacuous |
| B: `blender-mcp` image → `RFingAdam/mcp-blender:latest` | `NO_AGPL_IN_DEV_OR_GAME` + `NO_FLOATING_TAGS` `profile-game.yml:30` | 1 | `git checkout --`, pinned images back, verifier 0 | YES, non-vacuous |
| C: `127.0.0.1:8888:8080` → `0.0.0.0:8888:8080` | `LOOPBACK_PORTS_ONLY` `profile-research.yml:20`, no false-positive on `BASE_URL` line 18 | 1 | `git checkout --`, verifier 0 | YES, proves port-scope precision |
| Zero-stub scan + `0.0.0.0` distinction + final `git status` clean + verifier 0 | — | — | tree clean | YES |

Exceeds the Wave 2 mandate (which required only sabotage C): 3 sabotages covering 4 rules, each with exact file:line + rule name, each restored. (`git status --short` shows only the untracked `docs/evidence/wave-2/` dir itself — no dirty tracked files.)

## 7. Spec deviations (file:line)

None. Zero deviations found.

## 8. Binding verdict

All Wave 2 deliverables complete, zero stubs, zero scope drift, all 12 services spec-exact,
verifier unweakened and green over 8 files, `bun test` 32/32 green, QA red-proofs valid
(green + 3 fail-closed sabotages + clean restore).

VERDICT: PASS
