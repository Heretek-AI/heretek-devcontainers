# heretek-devcontainers

Infrastructure layer for Heretek AI (Goal 5): 5 modular Docker Compose
profiles, 3 declarative devcontainer/toolchain templates, systemd Podman
quadlets with socket activation, and the `heretek-box-ctl` operator CLI plus
the fail-closed static verifier (`scripts/verify-stack.ts`).

## Profiles

| Profile  | Services | Purpose |
|---|---|---|
| `core` | `bifrost` (`:8080`), `agentgateway` (`:3000`), `nats` (`:4222`, `:8222`) | Always-loaded foundation: LLM gateway with 3-tier failover, agent gateway, message bus |
| `appsec` | `ghidra-mcp` (`:8089`), `radare2-mcp` (`:8765`), `rea-mcp` (`:8766`), `mdb-mcp` (`:8767`) | Reverse-engineering MCP bridges (on demand) |
| `android` | `android-kvm` (`:6080`, `:5555`), `adb-mcp` (`:8770`), `maestro-mcp` (`:8771`) | KVM emulator + mobile automation bridges (on demand) |
| `game` | `godot-mcp` (`:8780`), `blender-mcp` (`:8781`) | Headless game-engine MCP bridges (on demand) |
| `research` | `searxng` (`:8888`), `crawl4ai` (`:11235`), `computer-use-linux` (`:8790`) | Web research + headless desktop agent (on demand) |
| `all` | every specialist service | Everything at once |

All host ports bind `127.0.0.1` loopback only. Every image is pinned to an
exact version tag. The root `docker-compose.yml` orchestrates the five
fragments via `include:`.

## Quickstart

```sh
# 1. Provide secrets (the template keeps placeholder tokens; a real .env
#    must not contain any — the verifier rejects it fail-closed).
cp .env.example .env
$EDITOR .env

# 2. Check the whole stack statically before starting anything.
./scripts/heretek-box-ctl.sh verify

# 3. Start the foundation, then any specialist profile on demand.
./scripts/heretek-box-ctl.sh up core
./scripts/heretek-box-ctl.sh up appsec
./scripts/heretek-box-ctl.sh status

# 4. Stop a profile when done.
./scripts/heretek-box-ctl.sh down appsec
```

`up`/`down` accept exactly one of `core appsec android game research all`
and reject anything else fail-closed. `list-profiles` prints the six names.

## Verifier

`scripts/verify-stack.ts` audits every compose file, devcontainer,
quadlet, and `.env` and exits 1 naming the exact `file:line` + rule on any
violation:

| Rule | Rejects |
|---|---|
| `NO_FLOATING_TAGS` | image references ending in a floating tag or lacking an explicit version |
| `NO_DOCKER_SOCK` | any container-socket mount reference |
| `LOOPBACK_PORTS_ONLY` | any published port not bound to `127.0.0.1` |
| `HARDENED_CAPS` | any service missing `cap_drop: [ALL]` or `no-new-privileges:true` (sole documented exception: `mdb-mcp` with narrow `cap_add: [SYS_PTRACE]`) |
| `SELINUX_VOLUME_LABELS` | any bind mount missing an SELinux label (`:z`, `:Z`, `:ro,Z`) |
| `NO_AGPL_IN_DEV_OR_GAME` | AGPL-licensed or root-escape images |
| `ENV_PLACEHOLDER_LEAK` | a real `.env` still carrying template placeholder tokens |

```sh
bun run scripts/verify-stack.ts   # or: ./scripts/heretek-box-ctl.sh verify
make check                        # verifier + bun test
make accept                       # all three wave acceptance gates
```

## Devcontainers

| Template | Toolchain file | Base |
|---|---|---|
| `devcontainers/polyglot-dev` | `mise.toml` — Node 22.9.0, Python 3.12.7, Rust 1.80.0, Go 1.23.3, Bun 1.4.2, ast-grep CLI, fallow | pinned base image |
| `devcontainers/ai-cuda-dev` | `pixi.toml` — conda-forge, PyTorch 2.4, CUDA 12.4, CMake, Ninja, OpenCV (rattler hardlink dedup) | pinned CUDA devel image |
| `devcontainers/headless-wayland-desktop` | `Dockerfile` + `sway-config` — headless Sway, AT-SPI2 bus, ydotool | `debian:trixie-slim` (pinned) |

Every template runs as the non-root `agent` user, declares no capabilities,
sets `no-new-privileges`, mounts the worktree with an SELinux label, mounts
no container socket, and (CUDA template) requests GPUs via `--gpus=all`
rather than privileged mode. Rebuild pins with `mise outdated` / `pixi update`
and commit the bumped pins.

## Quadlets

Rootless Podman units for the heavy services, all with
`StopWhenUnneeded=true` so they sit at 0 MB idle RAM until socket-activated:

| Unit | Image | Loopback ports |
|---|---|---|
| `quadlets/heretek-android-kvm.container` | `budtmo/docker-android:emulator_14.0` (+ `/dev/kvm` device grant) | `127.0.0.1:6080`, `127.0.0.1:5555` |
| `quadlets/heretek-ghidra-mcp.container` | `bethington/ghidra-mcp-headless:v6.0.0` (token via `~/.config/heretek/ghidra-mcp.env`, mode 600) | `127.0.0.1:8089` |
| `quadlets/heretek-blender-mcp.container` | `ghcr.io/sandraschi/blender-mcp:v1.2.0` | `127.0.0.1:8781` |

```sh
systemctl --user daemon-reload
systemctl --user enable --now heretek-blender-mcp.service
```

## heretek-exec and box-ctl exec

`scripts/heretek-exec.sh` runs any agent command inside the
`bwrap` + `landrun` + `mise exec` sandbox chain (Report 05a §7.2 Recipe 3):

```sh
# Inspect the exact argv first (hermetic — needs no runners installed).
./scripts/heretek-exec.sh --dry-run -- bun test

# Run a task sandboxed in the repo worktree.
./scripts/heretek-exec.sh -- bun test

# With KVM acceleration passed through (fails closed if /dev/kvm is absent).
./scripts/heretek-exec.sh --kvm -- adb devices

# Via the operator CLI (task ids are restricted to [A-Za-z0-9_.-]+).
./scripts/heretek-box-ctl.sh exec task-42 bun test
./scripts/heretek-box-ctl.sh exec --dry-run task-42 bun test
```

## Security invariants

Every layer upholds the same six contracts, enforced by
`scripts/verify-stack.ts` (exit 1 on violation, never warn-and-continue):

1. Pinned images only — no floating tags anywhere.
2. Zero container-socket mounts.
3. Loopback-only published ports.
4. `cap_drop: [ALL]` + `no-new-privileges:true` on every service
   (one documented `SYS_PTRACE` exception for `mdb-mcp`).
5. SELinux labels on every bind mount.
6. No AGPL-licensed or root-escape images.

Red-proof sabotage evidence lives in `docs/evidence/wave-<N>/red-proofs.log`;
per-wave verification verdicts live in `docs/reports/wave-<N>-verification.md`.
