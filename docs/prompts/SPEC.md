# SPEC.md — `heretek-devcontainers` Full Specification (Sections 0–3)

> Source of truth transcribed from `MASTER_BUILD_PROMPT.md` for Waves 0–3.
> Every subagent MUST `read` this file and `AGENTS.md` directly from disk in full
> before implementing anything. This file contains ZERO stubs by design.

**Target Repository:** `/home/john/Projects/Heretek-AI-Rebuild/heretek-devcontainers`
**GitHub Remote:** `https://github.com/Heretek-AI/heretek-devcontainers`
**Primary Session Agent:** `agency-coordinator` (`opencode-go/muse-spark-1.3-contributor`)
**Required Triad Subagents:** `agency-programmer`, `agency-qa`, `agency-drift-guard`

---

## 0. CRITICAL MUSE 1.3 HARNESS SUPPLEMENT (READ FIRST — NON-NEGOTIABLE)

You are running on `opencode-go/muse-spark-1.3-contributor`. Obey these six rules on every turn:

1. **ZERO PROMPT SUMMARIZATION WHEN CALLING SUBAGENTS:**
   - In Wave 0, write this entire specification into `docs/prompts/SPEC.md` and `AGENTS.md`. Every subagent call MUST instruct the subagent to `read` `AGENTS.md` and `docs/prompts/SPEC.md` directly from disk.
2. **EXPLICIT SUBAGENT ROLES:**
   - Always pass `"agent": "agency-programmer"`, `"agent": "agency-qa"`, or `"agent": "agency-drift-guard"` when calling `subagent`.
3. **VANILLA `read` / `edit` / `write` HYGIENE:**
   - Use native `read`, `write`, `edit`, `glob`, and `grep` — never `cat` or `sed`. Never include `read` line numbers (`12: `) in `edit` `oldString`/`newString`. Fix `<diagnostics>` immediately.
4. **STRICT SCOPE & REFUSAL BOUNDARY FOR `heretek-devcontainers`:**
   - This repository is **ONLY** the infrastructure layer for Goal 5:
     1. The **5 Modular Docker Compose Profiles** (`core`, `appsec`, `android`, `game`, `research`) orchestrated via root `docker-compose.yml` (`include:`),
     2. The **3 Declarative Devcontainer & Zero-Image Toolchain Templates** (`polyglot-dev` with `mise.toml`, `ai-cuda-dev` with `pixi.toml`, `security-re` with `bwrap`/`landrun`),
     3. The **Systemd Podman Quadlets** (`quadlets/*.container` with `StopWhenUnneeded=true` for 0 MB idle RAM socket activation), and
     4. The **`heretek-box-ctl` CLI & Static Verifier** (`scripts/heretek-exec.sh` + `scripts/verify-stack.ts`) that enforces fail-closed security contracts (no floating `:latest` tags, no `/var/run/docker.sock` root mounts, `127.0.0.1` loopback port bindings, `cap_drop: [ALL]`, `no-new-privileges:true`, `:Z` SELinux volume labels on Fedora).
   - **FORBIDDEN IN THIS REPO:** Do NOT create 57 separate language Dockerfiles, do NOT write NixOS VM flakes, and do NOT write WebUI or agent state-machine code here.
5. **NON-NEGOTIABLE SECURITY & LICENSING INVARIANTS (FROM REPORTS `05a` & `05b`):**
   - **Zero `docker.sock` Mounts:** No service in any Compose file or Devcontainer may ever mount `/var/run/docker.sock` (preventing the `vxcontrol/pentagi` root escape vulnerability).
   - **Zero Floating `:latest` Tags:** Every `image:` in `compose/*.yml` and `quadlets/*.container` MUST be pinned to an exact version tag (e.g., `nats:2.15.1-alpine`, `unclecode/crawl4ai:0.9.5`, `bethington/ghidra-mcp-headless:v6.0.0`).
   - **Loopback-Only Host Ports:** Every published port in `compose/*.yml` MUST bind strictly to `127.0.0.1:<host>:<container>` — never `0.0.0.0` or bare `<host>:<container>`.
   - **Non-AGPL Core Scraping:** Use `unclecode/crawl4ai:0.9.5` (Apache-2.0) + `D4Vinci/Scrapling` (BSD-3-Clause) instead of Firecrawl; keep `searxng` isolated behind HTTP JSON REST. Use `sandraschi/blender-mcp` (MIT) instead of `RFingAdam/mcp-blender` (AGPL-3.0).
6. **BINDING TRIAD GATE:**
   - Every wave requires `agency-qa` Red-Proof Sabotage (`docs/evidence/wave-<N>/red-proofs.log`) and `agency-drift-guard` `VERDICT: PASS` (`docs/reports/wave-<N>-verification.md`) before merging to `main`.

---

## 1. TARGET REPOSITORY ARCHITECTURE & FILE TREE

```text
/home/john/Projects/Heretek-AI-Rebuild/heretek-devcontainers/
├── AGENTS.md
├── Makefile
├── .env.example                    # Required secrets template (CHANGEME_ tokens rejected by verify-stack.ts)
├── package.json                    # For bun test & verify-stack.ts static contract validator
├── tsconfig.json
├── docker-compose.yml              # Root compose using `include:` for compose/core.yml + 4 specialist profiles
├── compose/
│   ├── core.yml                    # Profile `core`: maximhq/bifrost:v1.0.0 (:8080), agentgateway:v1.6.0 (:3000), nats:2.15.1-alpine (:4222)
│   ├── bifrost.yaml                # 3-Tier LLM Failover config (OpenCode Go -> OpenRouter -> Local Ollama/vLLM) + Session Affinity
│   ├── agentgateway.yaml           # CEL RBAC rules & MCP target routing
│   ├── profile-appsec.yml          # Profile `appsec`: bethington/ghidra-mcp-headless:v6.0.0, radareorg/radare2-mcp:1.8.8, morluto/rea:6.5.0, mdb-mcp:1.2.0
│   ├── profile-android.yml         # Profile `android`: budtmo/docker-android:emulator_14.0 (/dev/kvm), iksnerd/adb-mcp:v1.4.0, maestro-mcp:v1.39.8
│   ├── profile-game.yml            # Profile `game`: tugcantopaloglu/godot-mcp:v3.1.0, sandraschi/blender-mcp:v1.2.0
│   └── profile-research.yml        # Profile `research`: searxng/searxng:2026.10.14, unclecode/crawl4ai:0.9.5, computer-use-linux:v0.9.4 (headless Sway + AT-SPI2)
├── devcontainers/
│   ├── polyglot-dev/
│   │   ├── .devcontainer.json      # Non-root `agent` user, cap_drop ALL, mounts worktree with :Z SELinux label
│   │   └── mise.toml               # Node 22.9.0, Python 3.12.7, Rust 1.80.0, Go 1.23.3, Bun 1.4.2, @ast-grep/cli, fallow
│   ├── ai-cuda-dev/
│   │   ├── .devcontainer.json
│   │   └── pixi.toml               # Conda-forge/PyTorch 2.4/CUDA 12.4/CMake/Ninja/OpenCV deduplicated via rattler hardlinks
│   └── headless-wayland-desktop/
│       └── Dockerfile              # Debian trixie-slim + headless Sway + at-spi2-core + ydotool + agent-sh/computer-use-linux:v0.9.4
├── quadlets/                       # Systemd rootless Podman Quadlets (`StopWhenUnneeded=true` -> 0 MB idle RAM)
│   ├── heretek-android-kvm.container
│   ├── heretek-ghidra-mcp.container
│   └── heretek-blender-mcp.container
├── scripts/
│   ├── heretek-exec.sh             # Sub-5ms local worktree wrapper: bwrap + landrun + mise exec (with /dev/kvm & SELinux support)
│   ├── heretek-box-ctl.sh          # Operator CLI: `up <profile>`, `down <profile>`, `status`, `verify`, `exec <task-id> <cmd>`
│   ├── verify-stack.ts             # Deterministic static contract verifier auditing all Compose/Devcontainer/Quadlet/Env files
│   └── accept/
│       ├── wave-1.sh
│       ├── wave-2.sh
│       └── wave-3.sh
└── test/
    ├── compose-contracts.test.ts   # Tests zero `:latest` tags, 127.0.0.1 port bindings, zero docker.sock mounts, cap_drop: [ALL]
    ├── bifrost-config.test.ts      # Tests 3-tier failover config & session affinity settings
    └── scripts-ctl.test.ts         # Tests heretek-exec.sh argument construction, verify-stack.ts fail-closed detections
```

---

## 2. EXACT MODULE SPECIFICATIONS

### 2.1 Wave 1 Specification: Root Compose, `core.yml`, `bifrost.yaml`, and Fail-Closed Static Verifier (`scripts/verify-stack.ts`)

1. **`docker-compose.yml` & `compose/core.yml`:**
   - Root `docker-compose.yml` uses `include:` to reference `compose/core.yml`, `compose/profile-appsec.yml`, `compose/profile-android.yml`, `compose/profile-game.yml`, and `compose/profile-research.yml`.
   - `compose/core.yml` defines:
     - `bifrost` (`ghcr.io/maximhq/bifrost:v1.0.0`, port `127.0.0.1:8080:8080`, `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`, `:Z` on volume mounts).
     - `agentgateway` (`ghcr.io/agentgateway/agentgateway:v1.6.0`, port `127.0.0.1:3000:3000`, `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`).
     - `nats` (`nats:2.15.1-alpine`, command `["-js", "-sd", "/data", "-m", "8222"]`, ports `127.0.0.1:4222:4222` and `127.0.0.1:8222:8222`, `cap_drop: [ALL]`).
2. **`compose/bifrost.yaml` (From Report `01b` §3.1):**
   - Configures `session_affinity: { enabled: true, ttl: "3600s", header: "x-session-id" }` and the 3-tier fallback route (`opencode` → `openrouter` → `local-vllm`) with `parse_retry_after: true` and `max_retry_after_clamp: "300s"`.
3. **`scripts/verify-stack.ts` (Deterministic Contract Verifier):**
   - Parses all `compose/*.yml`, `devcontainers/**/.devcontainer.json`, `quadlets/*.container`, and `.env.example` (or `.env`) and FAILS CLOSED (exit code 1 with exact file + rule violation) if any of the following invariants are broken:
     1. **Rule `NO_FLOATING_TAGS`:** Any `image:` string ending in `:latest` or lacking an explicit `:version` tag.
     2. **Rule `NO_DOCKER_SOCK`:** Any volume or mount referencing `docker.sock` or `podman.sock`.
     3. **Rule `LOOPBACK_PORTS_ONLY`:** Any `ports:` entry that does not start with `127.0.0.1:`.
     4. **Rule `HARDENED_CAPS`:** Any service missing `no-new-privileges:true` or missing `cap_drop: [ALL]` (except where explicitly documented with a narrow `cap_add: [SYS_PTRACE]` for `mdb-mcp`).
     5. **Rule `SELINUX_VOLUME_LABELS`:** Any bind mount (`./...` or `/...`) in Compose or Devcontainers missing `:z`, `:Z`, or `:ro,Z` for Fedora SELinux enforcing compatibility.
     6. **Rule `NO_AGPL_IN_DEV_OR_GAME`:** Any image referencing `firecrawl` or `RFingAdam/mcp-blender` or `bytebot` or `0xflux/ghidra-mcp` or `pentagi`.

---

### 2.2 Wave 2 Specification: The 4 On-Demand Domain Profiles (`compose/profile-*.yml`)

1. **`compose/profile-appsec.yml` (`profiles: ["appsec", "all"]`):**
   - `ghidra-mcp` (`bethington/ghidra-mcp-headless:v6.0.0`, user `1000:1000`, port `127.0.0.1:8089:8089`, mandatory `GHIDRA_MCP_AUTH_TOKEN`, `cap_drop: [ALL]`).
   - `radare2-mcp` (`ghcr.io/radareorg/radare2-mcp:1.8.8`, user `1000:1000`, command `["r2mcp", "-H", "0.0.0.0:8765", "-r"]` read-only mode, port `127.0.0.1:8765:8765`, `cap_drop: [ALL]`).
   - `rea-mcp` (`ghcr.io/morluto/rea:6.5.0`, user `1000:1000`, port `127.0.0.1:8766:8766`, `cap_drop: [ALL]`).
   - `mdb-mcp` (`ghcr.io/smadi0x86/mdb-mcp:1.2.0`, user `1000:1000`, port `127.0.0.1:8767:8767`, `cap_drop: [ALL]`, `cap_add: [SYS_PTRACE]`).
2. **`compose/profile-android.yml` (`profiles: ["android", "all"]`):**
   - `android-kvm` (`budtmo/docker-android:emulator_14.0`, `devices: ["/dev/kvm:/dev/kvm"]`, ports `127.0.0.1:6080:6080`, `127.0.0.1:5555:5555`).
   - `adb-mcp` (`ghcr.io/iksnerd/adb-mcp:v1.4.0`, connects to `android-kvm:5555`, port `127.0.0.1:8770:8770`, `cap_drop: [ALL]`).
   - `maestro-mcp` (`ghcr.io/mobile-dev-inc/maestro:v1.39.8`, command `["maestro", "mcp"]`, port `127.0.0.1:8771:8771`, `cap_drop: [ALL]`).
3. **`compose/profile-game.yml` (`profiles: ["game", "all"]`):**
   - `godot-mcp` (`ghcr.io/tugcantopaloglu/godot-mcp:v3.1.0`, headless Godot 4.3, port `127.0.0.1:8780:8780`, `cap_drop: [ALL]`).
   - `blender-mcp` (`ghcr.io/sandraschi/blender-mcp:v1.2.0`, headless `blender --background` FastMCP 3.2, port `127.0.0.1:8781:8781`, `cap_drop: [ALL]`).
4. **`compose/profile-research.yml` (`profiles: ["research", "all"]`):**
   - `searxng` (`searxng/searxng:2026.10.14`, port `127.0.0.1:8888:8080`, `cap_drop: [ALL]`).
   - `crawl4ai` (`unclecode/crawl4ai:0.9.5`, port `127.0.0.1:11235:11235`, `shm_size: "1g"`, `cap_drop: [ALL]`).
   - `computer-use-linux` (`ghcr.io/agent-sh/computer-use-linux:v0.9.4`, headless Sway + AT-SPI2 accessibility tree, port `127.0.0.1:8790:8790`, `cap_drop: [ALL]`).

---

### 2.3 Wave 3 Specification: Devcontainers, Podman Quadlets (`StopWhenUnneeded=true`), `heretek-exec.sh` & `heretek-box-ctl.sh`

1. **`devcontainers/polyglot-dev/` & `devcontainers/ai-cuda-dev/` & `devcontainers/headless-wayland-desktop/`:**
   - Complete `.devcontainer.json`, `mise.toml`, `pixi.toml`, and the headless Sway + AT-SPI2 `Dockerfile` from Report `05b` §6.1.
   - `polyglot-dev` `mise.toml` pins: Node 22.9.0, Python 3.12.7, Rust 1.80.0, Go 1.23.3, Bun 1.4.2, plus `@ast-grep/cli` and `fallow` tooling.
   - `ai-cuda-dev` `pixi.toml` uses conda-forge with PyTorch 2.4 / CUDA 12.4 / CMake / Ninja / OpenCV, deduplicated via rattler hardlinks.
   - `headless-wayland-desktop` `Dockerfile` is Debian trixie-slim + headless Sway + at-spi2-core + ydotool + `agent-sh/computer-use-linux:v0.9.4`.
   - Each `.devcontainer.json` uses a non-root `agent` user, `cap_drop ALL` semantics, and mounts the worktree with the `:Z` SELinux label.
2. **`quadlets/*.container`:**
   - Systemd Quadlet definitions with `StopWhenUnneeded=true` so heavy containers (`android-kvm`, `ghidra-mcp`, `blender-mcp`) sit at 0 MB RAM until socket-activated.
   - Covered units: `heretek-android-kvm.container`, `heretek-ghidra-mcp.container`, `heretek-blender-mcp.container`.
3. **`scripts/heretek-exec.sh` & `scripts/heretek-box-ctl.sh`:**
   - `heretek-exec.sh`: Wraps any agent command in `bwrap` + `landrun` + `mise exec` (from Report `05a` §7.2 Recipe 3), supporting `--dry-run` so tests can verify the exact `bwrap` and `landrun` arguments on any machine. Supports `/dev/kvm` passthrough and SELinux contexts.
   - `heretek-box-ctl.sh`: Provides `verify`, `list-profiles`, `up <profile>`, `down <profile>`, and `exec <task-id> <cmd>`.

---

## 3. WAVE-BY-WAVE TRIAD EXECUTION PLAN FOR `agency-coordinator`

### Step 0 (Coordinator Bootstrap on `main`)

1. Write `AGENTS.md`, `docs/prompts/SPEC.md`, `docs/prompts/verify-stage.md`, `Makefile`, `package.json`, and `tsconfig.json`.
2. Commit baseline scaffolding to `main`.

### Wave 1: Root Compose, `core.yml`, `bifrost.yaml`, `agentgateway.yaml` & `scripts/verify-stack.ts`

1. Create worktree: `git worktree add -b wave-1-core-verifier worktrees/wave-1 main`
2. Dispatch **Programmer (`agency-programmer`)** with prompt:
   > "You are the Programmer Agent for Wave 1 in `/home/john/Projects/Heretek-AI-Rebuild/heretek-devcontainers/worktrees/wave-1` on branch `wave-1-core-verifier`. FIRST: Read `AGENTS.md` and `docs/prompts/SPEC.md` in full. SECOND: Implement: (1) `.env.example`, `docker-compose.yml`, `compose/core.yml`, `compose/bifrost.yaml`, and `compose/agentgateway.yaml`. (2) `scripts/verify-stack.ts` enforcing all 6 fail-closed security & pinning rules (`NO_FLOATING_TAGS`, `NO_DOCKER_SOCK`, `LOOPBACK_PORTS_ONLY`, `HARDENED_CAPS`, `SELINUX_VOLUME_LABELS`, `NO_AGPL_IN_DEV_OR_GAME`). (3) Unit tests in `test/compose-contracts.test.ts` and `test/bifrost-config.test.ts`, acceptance script `scripts/accept/wave-1.sh`, and report `docs/reports/wave-1.md`. (4) Verify `bun test` and `bun run scripts/verify-stack.ts` exit 0, then commit."
3. Dispatch **QA (`agency-qa`)** to run `make check`, `bash scripts/accept/wave-1.sh`, and perform Red-Proof Sabotage (temporarily change `nats:2.15.1-alpine` to `nats:latest` in `compose/core.yml` and confirm `verify-stack.ts` exits 1; temporarily bind `0.0.0.0:8080:8080` and confirm `verify-stack.ts` exits 1; restore cleanly with `git checkout --`). Record in `docs/evidence/wave-1/red-proofs.log`.
4. Dispatch **Drift Guard (`agency-drift-guard`)** to audit Wave 1 and issue `VERDICT: PASS` in `docs/reports/wave-1-verification.md`.
5. Merge `wave-1-core-verifier` into `main` and remove worktree.

### Wave 2: The 4 Specialist Compose Profiles (`profile-appsec.yml`, `profile-android.yml`, `profile-game.yml`, `profile-research.yml`)

1. Create worktree: `git worktree add -b wave-2-specialist-profiles worktrees/wave-2 main`
2. Dispatch **Programmer (`agency-programmer`)** to implement all 4 profile compose files (`profile-appsec.yml`, `profile-android.yml`, `profile-game.yml`, `profile-research.yml`), expand `test/compose-contracts.test.ts`, write `scripts/accept/wave-2.sh`, and write `docs/reports/wave-2.md`. Programmer MUST first `read` `AGENTS.md` and `docs/prompts/SPEC.md` from disk in full.
3. Dispatch **QA (`agency-qa`)** (sabotaging `profile-appsec.yml` with a `/var/run/docker.sock` mount to prove `verify-stack.ts` catches it and exits 1; restore with `git checkout --`) and **Drift Guard (`agency-drift-guard`)** (`VERDICT: PASS` in `docs/reports/wave-2-verification.md`).
4. Merge `wave-2-specialist-profiles` into `main` and remove worktree.

### Wave 3: Devcontainers (`mise.toml`, `pixi.toml`, Headless Wayland), Quadlets, `heretek-exec.sh` & `heretek-box-ctl.sh`

1. Create worktree: `git worktree add -b wave-3-devcontainers-ctl worktrees/wave-3 main`
2. Dispatch **Programmer (`agency-programmer`)** to implement `devcontainers/**`, `quadlets/*.container`, `scripts/heretek-exec.sh`, `scripts/heretek-box-ctl.sh`, `test/scripts-ctl.test.ts`, `scripts/accept/wave-3.sh`, `README.md`, and `docs/reports/wave-3.md`. Programmer MUST first `read` `AGENTS.md` and `docs/prompts/SPEC.md` from disk in full.
3. Dispatch **QA (`agency-qa`)** and **Drift Guard (`agency-drift-guard`)** to verify and red-proof Wave 3 (`VERDICT: PASS` in `docs/reports/wave-3-verification.md`).
4. Merge `wave-3-devcontainers-ctl` into `main`, remove worktree, and verify `make check && make accept` exits 0 on `main`.
