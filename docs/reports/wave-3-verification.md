# Wave 3 Drift Guard Verification Report — Devcontainers, Quadlets, heretek-exec & box-ctl

- **Stage ID:** wave-3-devcontainers-ctl
- **Branch:** `wave-3-devcontainers-ctl`
- **Worktree:** `/home/john/Projects/Heretek-AI-Rebuild/heretek-devcontainers/worktrees/wave-3`
- **Date (UTC):** 2026-10-16
- **Role:** agency-drift-guard (Independent Adversarial Auditor)
- **Spec:** `docs/prompts/SPEC.md` §2.3, `AGENTS.md` §§0.4–0.5, `docs/prompts/verify-stage.md` §2
- **Inputs read in full from disk:** `AGENTS.md`, `docs/prompts/SPEC.md`,
  `docs/prompts/verify-stage.md`, `docs/reports/wave-3.md`,
  `docs/evidence/wave-3/red-proofs.log`, all 14 Wave 3 deliverable files,
  `scripts/verify-stack.ts`, `scripts/accept/wave-3.sh`, `README.md`
- **Mode:** READ-ONLY audit (verifier + tests + greps observed, zero source
  mutations; this report is the sole file written, per mandate)

## 1. Scope audit (AGENTS.md §0.4 — forbidden work)

| Forbidden class | Sweep | Result |
|---|---|---|
| 57 separate language Dockerfiles | `glob **/Dockerfile*` → exactly 1 hit (`devcontainers/headless-wayland-desktop/Dockerfile`, the SPEC §2.3-mandated headless desktop) | CLEAN |
| NixOS VM flakes | `glob **/*.nix` → no files; no `flake.*` hits | CLEAN |
| WebUI / agent state-machine code | Branch diff vs `main` = 15 files, all Wave 3 deliverables (`devcontainers/**`, `quadlets/**`, `heretek-exec.sh`, `heretek-box-ctl.sh`, `scripts-ctl.test.ts`, `wave-3.sh`, `README.md`, `wave-3.md`); no UI/state-machine files | CLEAN |
| Out-of-scope production edits | `git diff main --stat -- scripts/verify-stack.ts compose/ docker-compose.yml Makefile package.json` → EMPTY (verifier, all compose files, build files untouched) | CLEAN |

No refusal-triggering content present. Scope is strictly the infrastructure
layer (3 devcontainer templates, 3 quadlets, box-ctl + exec wrapper, verifier
reuse, tests, docs).

## 2. Spec fidelity audit (SPEC §2.3 — exact pins)

| Requirement | Observed (byte-verified) | Result |
|---|---|---|
| mise Node 22.9.0 | `devcontainers/polyglot-dev/mise.toml:11` `node = "22.9.0"` | MATCH |
| mise Python 3.12.7 | `mise.toml:12` `python = "3.12.7"` | MATCH |
| mise Rust 1.80.0 | `mise.toml:13` `rust = "1.80.0"` | MATCH |
| mise Go 1.23.3 | `mise.toml:14` `go = "1.23.3"` | MATCH |
| mise Bun 1.4.2 | `mise.toml:15` `bun = "1.4.2"` | MATCH |
| mise `@ast-grep/cli` + `fallow` | `mise.toml:16-17` both present | MATCH |
| pixi conda-forge + PyTorch 2.4 / CUDA 12.4 / CMake / Ninja / OpenCV | `devcontainers/ai-cuda-dev/pixi.toml:13,25-30` all present; `cuda = "12.4"` system-requirement | MATCH |
| pixi rattler hardlink dedup documented | `pixi.toml:32-35` rattler/hardlink note | MATCH |
| Dockerfile base pinned trixie-slim | `devcontainers/headless-wayland-desktop/Dockerfile:16` `FROM debian:trixie-slim` | MATCH |
| Dockerfile Sway + at-spi2-core + ydotool | `Dockerfile:26-29` all three in apt install | MATCH |
| Dockerfile non-root `agent` 1000:1000 | `Dockerfile:36,42` `useradd -u 1000`, `USER 1000:1000` | MATCH |
| Dockerfile computer-use peer v0.9.4 | `Dockerfile:10` `ghcr.io/agent-sh/computer-use-linux:v0.9.4` (comment peer note; runtime service lives in Wave 2 research profile) | MATCH |
| Quadlet android image | `quadlets/heretek-android-kvm.container:22` `Image=budtmo/docker-android:emulator_14.0` | MATCH |
| Quadlet ghidra image | `quadlets/heretek-ghidra-mcp.container:23` `Image=bethington/ghidra-mcp-headless:v6.0.0` | MATCH |
| Quadlet blender image (MIT, not AGPL) | `quadlets/heretek-blender-mcp.container:20` `Image=ghcr.io/sandraschi/blender-mcp:v1.2.0` | MATCH |
| All quadlets `StopWhenUnneeded=true` (0 MB idle) | `[Unit]` section of all 3 files (auditor-observed; `grep -c` = 2/file = 1 header comment + 1 binding `[Unit]` occurrence) | MATCH |
| `heretek-exec.sh` `--dry-run` prints bwrap + landrun + mise argv | Observed live: `bwrap:` / `landrun:` / `mise:` / `payload:` / `full:` lines, exit 0 | MATCH |
| `heretek-exec.sh` `/dev/kvm` + SELinux support | `--kvm` → `--dev-bind /dev/kvm /dev/kvm`; workdir jailed to repo (`escapes the repository` fail-closed, exit 2) | MATCH |
| `box-ctl` verify / list-profiles / up / down / exec | All present (`heretek-box-ctl.sh:70-136`); `verify` delegates to verifier, `list-profiles` prints exactly the 6 names, `up`/`down` reject unknown profiles exit 2, `exec` enforces `[A-Za-z0-9_.-]+` task-id | MATCH |

Zero spec deviations. No `file:line` deviation list — there is nothing to list.

## 3. Security grep audit (whole tree)

| Check | Result |
|---|---|
| `:latest` in Wave 3 prod files (`devcontainers/`, `quadlets/`, both scripts) | ZERO hits |
| `docker.sock` / `podman.sock` in `devcontainers/` + `quadlets/` | ZERO hits |
| Banned AGPL/root-escape tokens (`firecrawl`, `RFingAdam`, `bytebot`, `0xflux`, `pentagi`) in Wave 3 prod files | ZERO hits; tree-wide hits exist ONLY in `scripts/verify-stack.ts` (the Wave 1 verifier's own banned-token rule list) and `test/compose-contracts.test.ts` absence-assertions — both permitted fixture/rule-list occurrences per protocol |
| `0.0.0.0` in `compose/` + `devcontainers/` + `quadlets/` | Single hit: `compose/profile-appsec.yml:40` container-internal `r2mcp -H 0.0.0.0:8765` listen arg — SPEC §2.2-mandated, Wave 2–passed precedent; its published port is loopback `127.0.0.1:8765:8765`. No new wildcard in Wave 3 |
| Quadlet `PublishPort=` loopback-only | All 4 lines `127.0.0.1:`-prefixed; images pinned; `DropCapability=ALL` + `NoNewPrivileges=true` in all 3; `Volume=…:Z` in all 3 |
| Devcontainer hardening | Both JSONs: `remoteUser`/`containerUser` = `agent`, `capAdd: []`, `no-new-privileges:true`, `,Z` bind mounts, pinned `image`, zero sockets |
| Anti-stub scan (`\|\| true`, `set +e`, `cmd:true`, `echo pass`, TODO/FIXME) | One `|| true` at `scripts/accept/wave-3.sh:76` — reviewed: it guards the EXPECTED non-zero exit of the `up bogus-profile` negative assertion under `set -e` (`… && fail … \|\| true`); the `fail` arm still exits 1 on false-accept, so the assertion is genuinely fail-closed, not vacuous. One `echo …pass…` substring is `heretek-exec.sh:178` status text "not passed through". No TODO/FIXME/stub/dummy values anywhere |

## 4. Verifier + test integrity (Rule: change no code, assume stubbed until proven)

- `scripts/verify-stack.ts` is byte-unmodified vs `main` (empty diff) and still
  enforces all 6 contract rules plus `ENV_PLACEHOLDER_LEAK` across 13 scanned
  files (8 compose + 2 devcontainers + 3 quadlets) — auditor-observed live:
  `PASS: all security contracts hold across 13 scanned file(s).`, exit 0.
- `bun test`: 75 pass, 0 fail, 483 expect() calls across 3 files, exit 0
  (43 new Wave 3 tests assert REAL script output via `Bun.spawnSync`, not
  vacuous `1 === 1` checks — auditor read all 470 lines).
- `bash scripts/accept/wave-3.sh`: `WAVE-3 ACCEPT PASS` (plus `WAVE-1`/`WAVE-2`
  regression PASS), exit 0. `box-ctl verify`: PASS, exit 0.
- Independent fail-closed spot-checks by auditor: `--dry-run` output contains
  `bwrap` → `landrun` → `mise exec` → payload in order; `list-profiles`
  prints exactly `core appsec android game research all`; tree has no
  uncommitted mutations (`git status --short` shows only untracked
  `docs/evidence/wave-3/`).

## 5. Sabotage evidence cross-reference (`docs/evidence/wave-3/red-proofs.log`)

| Proof | Claimed | Auditor assessment |
|---|---|---|
| Green path (`make check`, `make accept`, `bun test`, verifier) | All exit 0, 75 tests, 13 files | CORROBORATED — auditor re-ran verifier, `bun test`, exec dry-run, box-ctl, accept gate; all match |
| Sabotage A (`NO_FLOATING_TAGS`, quadlet `:latest`, exit 1 with `file:line`) | `FAIL [NO_FLOATING_TAGS] quadlets/heretek-ghidra-mcp.container:23`, restored, verifier green | CREDIBLE — exact rule + location + restore + re-green all logged; rule logic confirmed against verifier source (`checkQuadletFile`) |
| Sabotage B (`NO_DOCKER_SOCK`, devcontainer sock mount, exit 1) | Two `NO_DOCKER_SOCK` violations, restored, verifier green | CREDIBLE — exact rule + restore + re-green logged; rule logic confirmed against verifier source (`checkDevcontainerFile`) |
| Sabotage C (functional KVM on/off, no mutation) | Without `--kvm`: 0× `/dev/kvm`; with `--kvm`: 3× + enabled status | CREDIBLE — auditor re-ran `--dry-run` and confirmed the disabled-status line and absent node; the `--kvm` argv path is in the read source (`BWRAP_ARGS+=(--dev-bind …)`) |
| Final tree clean | `git status --short` clean of sabotaged files, verifier PASS post-restore | CORROBORATED — auditor's own `git status` shows no dirty tracked files |

Note: QA proved two mutation-based fail-closed rules on Wave 3-native files
(quadlet + devcontainer) plus the functional KVM distinction, satisfying the
binding Wave 3 requirement (2 sabotages with correct rule + exit 1, KVM
functional proof, clean restore). Wave 1 compose sabotages were not re-run;
given the verifier is byte-identical to the Wave 1/2–passed copy and both
regression gates are green, this substitution strengthens rather than weakens
Wave 3 coverage. Not a finding.

## 6. Findings

No findings. Numbered deviation list is empty by design — every seam, pin,
port, label, capability flag, CLI subcommand, and test count matches SPEC §2.3.

VERDICT: PASS
