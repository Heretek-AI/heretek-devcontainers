# heretek-devcontainers

Infrastructure layer for Heretek AI (Goal 5): 5 modular Docker Compose
profiles, 3 declarative devcontainer/toolchain templates, systemd Podman
quadlets with socket activation, and the `heretek-box-ctl` operator CLI plus
the fail-closed static verifier (`scripts/verify-stack.ts`).

## Profiles

| Profile  | Services | Purpose |
|---|---|---|
| `core` | `bifrost` (internal `:8080`, not published), `agentgateway` (`:3000`), `nats` (`:4222`, `:8222`) | Always-loaded foundation: LLM gateway with 3-tier failover, agent gateway, message bus |
| `appsec` | `ghidra-mcp` (`:8089`), `radare2-mcp` (`:8765`), `rea-mcp` (`:8766`), `mdb-mcp` (`:8767`) | Reverse-engineering MCP bridges (on demand) |
| `android` | `android-kvm` (`:6080`, `:5555`), `adb-mcp` (`:8770`), `maestro-mcp` (`:8771`) | KVM emulator + mobile automation bridges (on demand) |
| `game` | `godot-mcp` (`:8780`), `blender-mcp` (`:8781`) | Headless game-engine MCP bridges (on demand) |
| `research` | `searxng` (`:8888`), `crawl4ai` (`:11235`), `computer-use-linux` (`:8790`) | Web research + headless desktop agent (on demand) |
| `all` | every specialist service | Everything at once |

All host ports bind `127.0.0.1` loopback only. Every image is pinned to an
exact version tag. The root `docker-compose.yml` orchestrates the five
fragments via `include:`.

### Images

Published images are pinned to tags that exist in their registry
(`make images` checks this). Upstreams that publish no usable image are
built locally from `images/<service>/Dockerfile` and tagged
`localhost/heretek/<service>:<upstream version>`; compose builds them
(`pull_policy: build`) and never pulls those names. Each Dockerfile starts
from a pinned base image and installs a pinned upstream release, verified by
SHA-256/SHA-512 or by checking out the exact upstream commit.

| Service | Image | Source |
|---|---|---|
| `bifrost` | `ghcr.io/maximhq/bifrost:v2.3.0` | published |
| `agentgateway` | `ghcr.io/agentgateway/agentgateway:v1.6.0` | published |
| `nats` | `nats:2.15.1-alpine` | published |
| `android-kvm` | `budtmo/docker-android:emulator_14.0_v3.8.0-p1` | published |
| `searxng` | `searxng/searxng:2026.10.16-0ce72dd2c` | published |
| `crawl4ai` | `unclecode/crawl4ai:0.9.5` | published |
| `ghidra-mcp` | `localhost/heretek/ghidra-mcp:6.0.0` | bethington/ghidra-mcp v6.0.0 + Ghidra 12.1.2 |
| `radare2-mcp` | `localhost/heretek/radare2-mcp:1.9.0` | r2mcp 1.9.0 + radare2 6.2.4 release .debs |
| `rea-mcp` | `localhost/heretek/rea-mcp:6.5.0` | npm `rea-agents@6.5.0` |
| `mdb-mcp` | `localhost/heretek/mdb-mcp:0.2.0-5d03b25` | smadi0x86/mdb-mcp commit 5d03b25 (upstream has no tags) |
| `adb-mcp` | `localhost/heretek/adb-mcp:0.23.0` | binary from `ghcr.io/iksnerd/adb-mcp:0.23.0` |
| `maestro-mcp` | `localhost/heretek/maestro-mcp:2.11.0` | Maestro CLI cli-2.11.0 release |
| `godot-mcp` | `localhost/heretek/godot-mcp:3.1.0` | tugcantopaloglu/godot-mcp v3.1.0 + Godot 4.3-stable |
| `blender-mcp` | `localhost/heretek/blender-mcp:0.11.1` | sandraschi/blender-mcp v0.11.1 + Blender 4.2.3 LTS |
| `computer-use-linux` | `localhost/heretek/computer-use-linux:0.7.17` | agent-sh/computer-use-linux v0.7.17 release binary |

Stdio-only MCP servers are wrapped with a pinned `mcp-proxy` (0.13.0) so every
MCP service speaks streamable HTTP at `/mcp` on its container port (crawl4ai:
SSE at `/mcp/sse`). Compose labels (`heretek.mcp.target`, `.transport`,
`.path`) declare those endpoints.

```sh
make images   # resolve every pinned remote image against Docker Hub / GHCR / MCR (network)
```

### LLM gateway

`compose/bifrost.config.json` is the Bifrost v2.3.0 `config.json`, bind-mounted
read-only at `/app/data/config.json` (Bifrost loads `$APP_DIR/config.json`;
`APP_DIR=/app/data` stays a writable volume for its SQLite stores). It declares
the `opencode-go` (host `:11434`), `openrouter` and `vllm` (host `:8000`)
providers and one global routing rule, `default-llm`, that targets
`opencode-go` and falls back to `openrouter/anthropic/claude-default` then
`vllm/hosted-llm`. Provider keys are `env.BIFROST_API_KEY` /
`env.OPENROUTER_API_KEY` references; no secret is written to the file.

Bifrost publishes no host port and sits only on the `llm` network it shares
with agentgateway. Inference requires the `agentgateway` virtual key
(`env.BIFROST_VIRTUAL_KEY`), which agentgateway's `/v1` route sends as
`x-bf-vk`; the management API and dashboard require
`BIFROST_ADMIN_USERNAME` / `BIFROST_ADMIN_PASSWORD`.

### Agent gateway

`compose/agentgateway.yaml` is an agentgateway v1.6.0 standalone config
(`agentgateway -f /etc/agentgateway.yaml`). It serves one route per MCP target
at `/mcp/<target>` (`ghidra`, `radare2`, `rea`, `mdb`, `adb`, `maestro`,
`godot`, `blender`, `crawl4ai`, `gui`), each holding exactly one target so
tool names are not prefixed, plus an OpenAI-compatible `/v1` route to Bifrost.
Every request needs `Authorization: Bearer <AGENTGATEWAY_ADMIN_KEY|AGENTGATEWAY_AGENT_KEY>`;
`mdb` and `gui` are admin-only. There is no `core` or `searxng` route yet:
no heretek-core MCP service exists here, and SearXNG is not an MCP server.

```sh
make validate-gateway AGENTGATEWAY=/path/to/agentgateway   # real binary, --validate-only
```

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
| `SELINUX_CONFINED` | a quadlet that disables SELinux confinement (`SecurityLabelType=spc`, `SecurityLabelDisable=true`, privileged) |
| `QUADLET_SOCKET_ACTIVATION` | a quadlet container that can start on its own or lacks its loopback `.socket` + idle-exiting proxy `.service` |

`NO_FLOATING_TAGS` also covers local builds (a `build:` service must tag
`localhost/<name>:<version>`) and Dockerfile `FROM` / `COPY --from=` images.
Each rule has a failing fixture tree under `test/fixtures/verify/`
(`bun run scripts/verify-stack.ts --root <dir>`), exercised by
`test/verify-stack.test.ts`.

```sh
bun run scripts/verify-stack.ts   # or: ./scripts/heretek-box-ctl.sh verify
make check                        # verifier + bun test
make accept                       # all three wave acceptance gates
make validate-compose             # docker compose config for every profile
make validate-units               # systemd-analyze verify on the quadlet sockets/proxies
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

Rootless Podman units for the heavy services, socket-activated so they use
no memory until something connects:

- `<name>-proxy.socket` owns the loopback port (the same one compose uses)
  and is the only unit you enable (`WantedBy=sockets.target`).
- `<name>-proxy.service` runs `systemd-socket-proxyd --exit-idle-time=15min`
  and `Requires=`/`After=` the container unit, so the first connection starts
  the container (`Notify=healthy` holds the proxy until it answers).
- `<name>.container` has `StopWhenUnneeded=true` and no `[Install]` section,
  so it never starts at login and stops once its proxy exits idle.

| Container unit | Image | Activation sockets |
|---|---|---|
| `heretek-android-kvm.container` | `budtmo/docker-android:emulator_14.0_v3.8.0-p1` (+ `AddDevice=/dev/kvm`) | `127.0.0.1:6080` (vnc), `127.0.0.1:5555` (adb) |
| `heretek-ghidra-mcp.container` | `localhost/heretek/ghidra-mcp:6.0.0` (token via `~/.config/heretek/ghidra-mcp.env`, mode 600) | `127.0.0.1:8089` |
| `heretek-blender-mcp.container` | `localhost/heretek/blender-mcp:0.11.1` | `127.0.0.1:8781` |

All containers keep the default `container_t` SELinux confinement. If an
enforcing host denies the emulator `/dev/kvm`, use
`setsebool -P container_use_devices=true` rather than disabling labels.

```sh
podman build -t localhost/heretek/ghidra-mcp:6.0.0 images/ghidra-mcp     # local images first
cp quadlets/*.container ~/.config/containers/systemd/
cp quadlets/*.socket quadlets/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now heretek-ghidra-mcp-proxy.socket
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
