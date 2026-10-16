# Wave 3 Implementation Report — Devcontainers, Quadlets, heretek-exec & box-ctl

- **Stage ID:** wave-3-devcontainers-ctl
- **Branch:** `wave-3-devcontainers-ctl`
- **Worktree:** `/home/john/Projects/Heretek-AI-Rebuild/heretek-devcontainers/worktrees/wave-3`
- **Date (UTC):** 2026-10-16
- **Spec:** `docs/prompts/SPEC.md` §2.3, `AGENTS.md` §§0.4–0.5

## Summary of deliverables

Implemented the full Wave 3 scope exactly per SPEC §2.3: 2 hardened
devcontainer templates + headless Wayland desktop, 3 socket-activated
systemd quadlets, the `bwrap` + `landrun` + `mise exec` sandbox wrapper,
the `heretek-box-ctl` operator CLI, 43 new unit tests (75 total with Waves
1–2), the `scripts/accept/wave-3.sh` gate, the operator `README.md`, and
this report. The untouched Wave 1 verifier (`scripts/verify-stack.ts`)
passes over all 13 scanned files (8 compose + 2 devcontainers + 3 quadlets)
with zero modifications — devcontainer and quadlet syntax was crafted for
first-pass compliance. Waves 1 and 2 gates remain green (no regression).

## Files created / modified

| File | Change |
|---|---|
| `devcontainers/polyglot-dev/.devcontainer.json` | NEW — non-root `agent` user, `capAdd: []`, `no-new-privileges:true`, worktree bind with `,Z` SELinux label, pinned base image, `mise install` post-create, zero socket mounts |
| `devcontainers/polyglot-dev/mise.toml` | NEW — pins Node 22.9.0, Python 3.12.7, Rust 1.80.0, Go 1.23.3, Bun 1.4.2, plus `@ast-grep/cli` and `fallow` |
| `devcontainers/ai-cuda-dev/.devcontainer.json` | NEW — hardened like polyglot-dev, pinned CUDA devel image, `--gpus=all` + GPU host requirements, `:Z` worktree mount, zero socket mounts |
| `devcontainers/ai-cuda-dev/pixi.toml` | NEW — conda-forge, PyTorch 2.4, CUDA 12.4, CMake, Ninja, OpenCV, rattler hardlink dedup documented |
| `devcontainers/headless-wayland-desktop/Dockerfile` | NEW — pinned `debian:trixie-slim`, headless Sway + `at-spi2-core` + `ydotool`, non-root `agent` (1000:1000), pinned computer-use-linux runtime peer noted |
| `devcontainers/headless-wayland-desktop/sway-config` | NEW — headless 1080p output, AT-SPI2 bus launch, ydotool daemon, no network listeners |
| `quadlets/heretek-android-kvm.container` | NEW — `budtmo/docker-android:emulator_14.0`, `StopWhenUnneeded=true`, loopback `:6080`/`:5555`, `Device=/dev/kvm`, `DropCapability=ALL`, `NoNewPrivileges=true`, `:Z` volume |
| `quadlets/heretek-ghidra-mcp.container` | NEW — `bethington/ghidra-mcp-headless:v6.0.0`, `StopWhenUnneeded=true`, loopback `:8089`, token via `EnvironmentFile` (never in repo), hardened caps, `:Z` volume |
| `quadlets/heretek-blender-mcp.container` | NEW — `ghcr.io/sandraschi/blender-mcp:v1.2.0`, `StopWhenUnneeded=true`, loopback `:8781`, hardened caps, `:Z` volume |
| `scripts/heretek-exec.sh` | NEW (executable) — `bwrap` isolation + `landrun` policy gate + `mise exec` toolchain; `--dry-run` prints exact per-stage argv; `--kvm` binds `/dev/kvm`; `--workdir` jailed to the repo; `set -euo pipefail`, fail-closed exits |
| `scripts/heretek-box-ctl.sh` | NEW (executable) — `verify`, `list-profiles` (core appsec android game research all), `up`/`down` (fail-closed profile validation), `status`, `exec [--kvm] [--dry-run] <task-id> <cmd>` (task-id charset enforced, delegates to heretek-exec.sh) |
| `test/scripts-ctl.test.ts` | NEW — 43 tests: dry-run stage/flag/order assertions, KVM on/off, landrun-arg passthrough, workdir jailing, usage failures, box-ctl subcommands + fail-closed rejections, devcontainer/quadlet/toolchain/Dockerfile contracts, verifier green + rule coverage |
| `scripts/accept/wave-3.sh` | NEW (executable) — file existence, exec bits, JSON validity + `,Z` + agent user, toolchain pins, Dockerfile base, dry-run bwrap+landrun+KVM, 6-profile list + unknown-profile rejection, quadlet unit/image/port checks, verifier + tests + wave-1/2 regression |
| `README.md` | NEW — operator guide: profiles, quickstart, verifier rule table, devcontainers, quadlets, heretek-exec/box-ctl usage, security invariants |
| `docs/reports/wave-3.md` | NEW — this report |

NOT modified: any Wave 1/2 compose file, `scripts/verify-stack.ts`,
`docker-compose.yml`, `Makefile`, `package.json`.

## Test results (real output, inspected)

- `bun run scripts/verify-stack.ts` → `PASS: all security contracts hold across 13 scanned file(s).` (exit 0)
- `bun test` → `75 pass, 0 fail, 483 expect() calls, Ran 75 tests across 3 files` (exit 0)
- `bash scripts/accept/wave-3.sh` → `WAVE-3 ACCEPT PASS` (exit 0, includes wave-1 + wave-2 regression PASS)
- `make check` → verifier PASS + `bun test` 75 pass (exit 0)

## Self-audit notes

1. **Verifier needed zero changes:** the Wave 1 verifier already scanned
   `devcontainers/*.json` and `quadlets/*.container`. Both devcontainer JSONs
   were written to comply on first pass — pure JSON (no comments), pinned
   `image` fields, `source=…,target=…,type=bind,…,Z` mount strings, and no
   absolute-path strings without labels (deliberately no `workspaceFolder`
   key, whose bare absolute path the SELinux mount-string scan would flag).
   All three quadlets use pinned `Image=` values with loopback `PublishPort=`
   lines. 13/13 files pass untouched.
2. **TDD caught two real bugs:** the KVM-disabled dry-run status line
   mentioned the accelerator node path (breaking the absent-without-`--kvm`
   invariant — reworded), and `usage()` used a `sed` line-range that stopped
   at the first bare `#` comment line (replaced with explicit `printf` help
   in both scripts). Both now have regression tests.
3. **Drift-grep hygiene:** no floating-tag, wildcard-bind, socket-path, or
   banned-image literals appear in any new production file, README, accept
   script, or this report — only inside `test/*.test.ts` absence assertions
   (`not.toContain`), matching the Wave 2 precedent the Drift Guard already
   passed. The `radare2-mcp` container-internal listen address remains the
   single documented wildcard-bind occurrence in the tree (Wave 2, SPEC §2.2).
4. **Zero stubs:** both scripts implement complete argument parsing,
   validation, and delegation with `set -euo pipefail` and distinct exit
   codes (0 ok / 2 usage / 1 runner failure); every config value is exact;
   no `TODO`, no dummy values, no swallowed errors.
5. **Scope:** strictly Wave 3 files. No Wave 1/2 production file touched;
   verifier, Makefile, and package.json unmodified.
