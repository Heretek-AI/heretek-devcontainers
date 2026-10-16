# AGENTS.md — `heretek-devcontainers` (Repo 5, Goal 5 Infrastructure Layer)

> **READ FIRST — NON-NEGOTIABLE.** Every agent (`agency-coordinator`, `agency-programmer`,
> `agency-qa`, `agency-drift-guard`) MUST read this file AND `docs/prompts/SPEC.md`
> directly from disk using the native `read` tool before doing any work.
> Do NOT rely on summaries relayed through subagent prompts. Read the files yourself.

**Harness:** `opencode-go/muse-spark-1.3-contributor`. Obey the six rules below on every turn.
**Target repository:** `/home/john/Projects/Heretek-AI-Rebuild/heretek-devcontainers`
**GitHub remote:** `https://github.com/Heretek-AI/heretek-devcontainers`

---

## 0. HARNESS HYGIENE (NON-NEGOTIABLE)

### 0.1 Zero prompt summarization when calling subagents

- The full specification lives in `docs/prompts/SPEC.md` and in §1–§3 of this file.
- Every subagent call MUST instruct the subagent to `read` `AGENTS.md` and
  `docs/prompts/SPEC.md` directly from disk in full before implementing anything.
- Never paraphrase the spec into the subagent prompt as a substitute for reading the files.

### 0.2 Explicit subagent roles

Always pass an explicit agent role on every subagent dispatch:

| Role                  | Responsibility                                                              |
|-----------------------|-----------------------------------------------------------------------------|
| `agency-programmer`   | Implements production code and tests. Never delegates further.              |
| `agency-qa`           | Runs `make check`, `bash scripts/accept/*.sh`, performs Red-Proof Sabotage. |
| `agency-drift-guard`  | Adversarial scope/security audit. Issues `VERDICT: PASS` / `VERDICT: FAIL`. |

The coordinator (`agency-coordinator`) orchestrates waves, verifies evidence, merges to `main`.

### 0.3 Vanilla `read` / `edit` / `write` hygiene

- Use ONLY native `read`, `write`, `edit`, `glob`, and `grep`.
- NEVER use `cat`, `sed`, `awk` output splicing, or shell heredocs to view or modify files.
- NEVER include `read` line-number prefixes (e.g. `12: `) in `edit` `oldString`/`newString`.
  Copy the exact file bytes without the `N: ` prefix.
- Fix `<diagnostics>` (type errors, lint errors, failing tests) immediately — never defer them.
- Create parent directories via the `write` tool (it auto-creates parents); do not `mkdir -p` via shell
  when the `write` tool suffices.

### 0.4 Scope & refusal boundary (STRICT — fail closed)

This repository is **ONLY** the infrastructure layer for Goal 5:

1. The **5 Modular Docker Compose Profiles** (`core`, `appsec`, `android`, `game`, `research`)
   orchestrated via root `docker-compose.yml` (`include:`).
2. The **3 Declarative Devcontainer & Zero-Image Toolchain Templates**:
   - `polyglot-dev` with `mise.toml`,
   - `ai-cuda-dev` with `pixi.toml`,
   - `security-re` concept covered by the `headless-wayland-desktop` template with `bwrap`/`landrun`
     (see SPEC §2.3).
3. The **Systemd Podman Quadlets** (`quadlets/*.container` with `StopWhenUnneeded=true`
   for 0 MB idle RAM socket activation).
4. The **`heretek-box-ctl` CLI & Static Verifier** (`scripts/heretek-exec.sh` +
   `scripts/verify-stack.ts`) enforcing fail-closed security contracts:
   no floating `:latest` tags, no `/var/run/docker.sock` root mounts,
   `127.0.0.1` loopback port bindings, `cap_drop: [ALL]`, `no-new-privileges:true`,
   `:Z` SELinux volume labels on Fedora.

**FORBIDDEN IN THIS REPO — refuse immediately with a descriptive error:**

- Do NOT create 57 separate language Dockerfiles.
- Do NOT write NixOS VM flakes.
- Do NOT write WebUI or agent state-machine code here.

Any task requesting the above is out of scope. Refuse, log the refusal, do not implement
a permissive fallback.

### 0.5 Non-negotiable security & licensing invariants (from Reports `05a` & `05b`)

1. **Zero `docker.sock` mounts:** No service in any Compose file or Devcontainer may ever
   mount `/var/run/docker.sock` (or `podman.sock`). This prevents the
   `vxcontrol/pentagi` root-escape vulnerability class. Violations fail closed.
2. **Zero floating `:latest` tags:** Every `image:` in `compose/*.yml` and
   `quadlets/*.container` MUST be pinned to an exact version tag
   (e.g. `nats:2.15.1-alpine`, `unclecode/crawl4ai:0.9.5`,
   `bethington/ghidra-mcp-headless:v6.0.0`).
3. **Loopback-only host ports:** Every published port in `compose/*.yml` MUST bind strictly
   to `127.0.0.1:<host>:<container>` — never `0.0.0.0` or bare `<host>:<container>`.
4. **Non-AGPL core scraping:** Use `unclecode/crawl4ai:0.9.5` (Apache-2.0) +
   `D4Vinci/Scrapling` (BSD-3-Clause) instead of Firecrawl; keep `searxng` isolated
   behind HTTP JSON REST. Use `sandraschi/blender-mcp` (MIT) instead of
   `RFingAdam/mcp-blender` (AGPL-3.0).
5. **Hardened capabilities:** Every service sets `cap_drop: [ALL]` and
   `security_opt: ["no-new-privileges:true"]`. The SOLE exception is `mdb-mcp`,
   which is explicitly documented with a narrow `cap_add: [SYS_PTRACE]`.
6. **SELinux volume labels:** Every bind mount (`./...` or `/...`) in Compose files and
   Devcontainers carries `:z`, `:Z`, or `:ro,Z` for Fedora SELinux enforcing compatibility.
7. **Banned AGPL/root-escape images:** `firecrawl`, `RFingAdam/mcp-blender`, `bytebot`,
   `0xflux/ghidra-mcp`, `pentagi` must never appear as images. The verifier rule
   `NO_AGPL_IN_DEV_OR_GAME` rejects them fail-closed.

### 0.6 Binding triad gate

Every wave requires ALL of the following before merging to `main`:

1. `agency-programmer` implementation + green `bun test` + green verifier + wave report.
2. `agency-qa` Red-Proof Sabotage evidence at `docs/evidence/wave-<N>/red-proofs.log`
   (prove the verifier catches injected violations, then restore cleanly).
3. `agency-drift-guard` `VERDICT: PASS` in `docs/reports/wave-<N>-verification.md`.

No `VERDICT: PASS`, no merge. No exceptions.

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
│   ├── core.yml                    # Profile `core`: maximhq/bifrost:v2.3.0 (:8080), agentgateway:v1.6.0 (:3000), nats:2.15.1-alpine (:4222)
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
├── images/                         # Pinned local builds for upstreams with no usable published image
│   └── <service>/Dockerfile        # tagged localhost/heretek/<service>:<version> (see README "Images")
├── quadlets/                       # Systemd rootless Podman Quadlets, socket-activated (0 MB idle RAM)
│   ├── heretek-android-kvm.container   (+ -vnc-proxy / -adb-proxy .socket/.service)
│   ├── heretek-ghidra-mcp.container    (+ -proxy.socket/.service)
│   └── heretek-blender-mcp.container   (+ -proxy.socket/.service)
├── scripts/
│   ├── heretek-exec.sh             # Sub-5ms local worktree wrapper: bwrap + landrun + mise exec (with /dev/kvm & SELinux support)
│   ├── heretek-box-ctl.sh          # Operator CLI: `up <profile>`, `down <profile>`, `status`, `verify`, `exec <task-id> <cmd>`
│   ├── verify-stack.ts             # Deterministic static contract verifier auditing all Compose/Devcontainer/Quadlet/Env files
│   ├── check-images.ts             # `make images`: resolves every pinned remote image in its registry
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

> **Image pins (2026-10 remediation):** several image tags below never existed
> in their registries. The current pins (real published tags, or pinned local
> builds `localhost/heretek/<service>:<version>` from `images/`) are listed in
> README "Images" and enforced by `make images`. radare2-mcp runs with `-R`
> (read-only); `-r` would enable its dangerous run_* tools.

### 2.1 Wave 1: Root Compose, `core.yml`, `bifrost.yaml`, Fail-Closed Static Verifier

1. **`docker-compose.yml` & `compose/core.yml`:**
   - Root `docker-compose.yml` uses `include:` to reference `compose/core.yml`,
     `compose/profile-appsec.yml`, `compose/profile-android.yml`,
     `compose/profile-game.yml`, and `compose/profile-research.yml`.
   - `compose/core.yml` defines:
     - `bifrost` (`ghcr.io/maximhq/bifrost:v1.0.0`, port `127.0.0.1:8080:8080`,
       `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`, `:Z` on volume mounts).
     - `agentgateway` (`ghcr.io/agentgateway/agentgateway:v1.6.0`,
       port `127.0.0.1:3000:3000`, `cap_drop: [ALL]`,
       `security_opt: ["no-new-privileges:true"]`).
     - `nats` (`nats:2.15.1-alpine`, command `["-js", "-sd", "/data", "-m", "8222"]`,
       ports `127.0.0.1:4222:4222` and `127.0.0.1:8222:8222`, `cap_drop: [ALL]`).
2. **`compose/bifrost.yaml` (from Report `01b` §3.1):**
   - Configures `session_affinity: { enabled: true, ttl: "3600s", header: "x-session-id" }`
     and the 3-tier fallback route (`opencode` → `openrouter` → `local-vllm`) with
     `parse_retry_after: true` and `max_retry_after_clamp: "300s"`.
3. **`scripts/verify-stack.ts` (Deterministic Contract Verifier):**
   - Parses all `compose/*.yml`, `devcontainers/**/.devcontainer.json`,
     `quadlets/*.container`, and `.env.example` (or `.env`) and FAILS CLOSED
     (exit code 1 with exact file + rule violation) if any invariant is broken:
     1. **Rule `NO_FLOATING_TAGS`:** Any `image:` string ending in `:latest` or lacking
        an explicit `:version` tag.
     2. **Rule `NO_DOCKER_SOCK`:** Any volume or mount referencing `docker.sock` or `podman.sock`.
     3. **Rule `LOOPBACK_PORTS_ONLY`:** Any `ports:` entry that does not start with `127.0.0.1:`.
     4. **Rule `HARDENED_CAPS`:** Any service missing `no-new-privileges:true` or missing
        `cap_drop: [ALL]` (except where explicitly documented with a narrow
        `cap_add: [SYS_PTRACE]` for `mdb-mcp`).
     5. **Rule `SELINUX_VOLUME_LABELS`:** Any bind mount (`./...` or `/...`) in Compose or
        Devcontainers missing `:z`, `:Z`, or `:ro,Z` for Fedora SELinux enforcing compatibility.
     6. **Rule `NO_AGPL_IN_DEV_OR_GAME`:** Any image referencing `firecrawl` or
        `RFingAdam/mcp-blender` or `bytebot` or `0xflux/ghidra-mcp` or `pentagi`.

### 2.2 Wave 2: The 4 On-Demand Domain Profiles (`compose/profile-*.yml`)

1. **`compose/profile-appsec.yml` (`profiles: ["appsec", "all"]`):**
   - `ghidra-mcp` (`bethington/ghidra-mcp-headless:v6.0.0`, user `1000:1000`,
     port `127.0.0.1:8089:8089`, mandatory `GHIDRA_MCP_AUTH_TOKEN`, `cap_drop: [ALL]`).
   - `radare2-mcp` (`ghcr.io/radareorg/radare2-mcp:1.8.8`, user `1000:1000`,
     command `["r2mcp", "-H", "0.0.0.0:8765", "-r"]` read-only mode,
     port `127.0.0.1:8765:8765`, `cap_drop: [ALL]`).
   - `rea-mcp` (`ghcr.io/morluto/rea:6.5.0`, user `1000:1000`,
     port `127.0.0.1:8766:8766`, `cap_drop: [ALL]`).
   - `mdb-mcp` (`ghcr.io/smadi0x86/mdb-mcp:1.2.0`, user `1000:1000`,
     port `127.0.0.1:8767:8767`, `cap_drop: [ALL]`, `cap_add: [SYS_PTRACE]`).
2. **`compose/profile-android.yml` (`profiles: ["android", "all"]`):**
   - `android-kvm` (`budtmo/docker-android:emulator_14.0`, `devices: ["/dev/kvm:/dev/kvm"]`,
     ports `127.0.0.1:6080:6080`, `127.0.0.1:5555:5555`).
   - `adb-mcp` (`ghcr.io/iksnerd/adb-mcp:v1.4.0`, connects to `android-kvm:5555`,
     port `127.0.0.1:8770:8770`, `cap_drop: [ALL]`).
   - `maestro-mcp` (`ghcr.io/mobile-dev-inc/maestro:v1.39.8`, command `["maestro", "mcp"]`,
     port `127.0.0.1:8771:8771`, `cap_drop: [ALL]`).
3. **`compose/profile-game.yml` (`profiles: ["game", "all"]`):**
   - `godot-mcp` (`ghcr.io/tugcantopaloglu/godot-mcp:v3.1.0`, headless Godot 4.3,
     port `127.0.0.1:8780:8780`, `cap_drop: [ALL]`).
   - `blender-mcp` (`ghcr.io/sandraschi/blender-mcp:v1.2.0`, headless `blender --background`
     FastMCP 3.2, port `127.0.0.1:8781:8781`, `cap_drop: [ALL]`).
4. **`compose/profile-research.yml` (`profiles: ["research", "all"]`):**
   - `searxng` (`searxng/searxng:2026.10.14`, port `127.0.0.1:8888:8080`, `cap_drop: [ALL]`).
   - `crawl4ai` (`unclecode/crawl4ai:0.9.5`, port `127.0.0.1:11235:11235`,
     `shm_size: "1g"`, `cap_drop: [ALL]`).
   - `computer-use-linux` (`ghcr.io/agent-sh/computer-use-linux:v0.9.4`,
     headless Sway + AT-SPI2 accessibility tree, port `127.0.0.1:8790:8790`,
     `cap_drop: [ALL]`).

### 2.3 Wave 3: Devcontainers, Podman Quadlets (`StopWhenUnneeded=true`), `heretek-exec.sh` & `heretek-box-ctl.sh`

1. **`devcontainers/polyglot-dev/` & `devcontainers/ai-cuda-dev/` & `devcontainers/headless-wayland-desktop/`:**
   - Complete `.devcontainer.json`, `mise.toml`, `pixi.toml`, and the headless Sway + AT-SPI2
     `Dockerfile` from Report `05b` §6.1.
   - `polyglot-dev` `mise.toml` pins: Node 22.9.0, Python 3.12.7, Rust 1.80.0, Go 1.23.3,
     Bun 1.4.2, plus `@ast-grep/cli` and `fallow`.
   - `ai-cuda-dev` `pixi.toml` uses conda-forge with PyTorch 2.4 / CUDA 12.4 / CMake / Ninja /
     OpenCV, deduplicated via rattler hardlinks.
   - `headless-wayland-desktop` `Dockerfile` is Debian trixie-slim + headless Sway +
     at-spi2-core + ydotool + `agent-sh/computer-use-linux:v0.9.4`.
2. **`quadlets/*.container`:**
   - Systemd Quadlet definitions with `StopWhenUnneeded=true` so heavy containers
     (`android-kvm`, `ghidra-mcp`, `blender-mcp`) sit at 0 MB RAM until socket-activated.
3. **`scripts/heretek-exec.sh` & `scripts/heretek-box-ctl.sh`:**
   - `heretek-exec.sh`: wraps any agent command in `bwrap` + `landrun` + `mise exec`
     (from Report `05a` §7.2 Recipe 3), supporting `--dry-run` so tests can verify the
     exact `bwrap` and `landrun` arguments on any machine. Supports `/dev/kvm` and SELinux.
   - `heretek-box-ctl.sh`: provides `verify`, `list-profiles`, `up <profile>`,
     `down <profile>`, and `exec <task-id> <cmd>`.

---

## 3. WAVE-BY-WAVE TRIAD EXECUTION PLAN FOR `agency-coordinator`

### Step 0 (Coordinator Bootstrap on `main`)

1. Write `AGENTS.md`, `docs/prompts/SPEC.md`, `docs/prompts/verify-stage.md`, `Makefile`,
   `package.json`, and `tsconfig.json`.
2. Commit baseline scaffolding to `main`.

### Wave 1: Root Compose, `core.yml`, `bifrost.yaml`, `agentgateway.yaml` & `scripts/verify-stack.ts`

1. Create worktree: `git worktree add -b wave-1-core-verifier worktrees/wave-1 main`
2. Dispatch **Programmer (`agency-programmer`)** to implement `.env.example`,
   `docker-compose.yml`, `compose/core.yml`, `compose/bifrost.yaml`,
   `compose/agentgateway.yaml`, `scripts/verify-stack.ts` (all 6 fail-closed rules),
   unit tests (`test/compose-contracts.test.ts`, `test/bifrost-config.test.ts`),
   acceptance script `scripts/accept/wave-1.sh`, and report `docs/reports/wave-1.md`.
   Programmer MUST first `read` `AGENTS.md` and `docs/prompts/SPEC.md` from disk in full.
   Verify `bun test` and `bun run scripts/verify-stack.ts` exit 0, then commit.
3. Dispatch **QA (`agency-qa`)** to run `make check`, `bash scripts/accept/wave-1.sh`, and
   perform Red-Proof Sabotage (temporarily change `nats:2.15.1-alpine` to `nats:latest`
   in `compose/core.yml` and confirm `verify-stack.ts` exits 1; temporarily bind
   `0.0.0.0:8080:8080` and confirm `verify-stack.ts` exits 1; restore cleanly with
   `git checkout --`). Record in `docs/evidence/wave-1/red-proofs.log`.
4. Dispatch **Drift Guard (`agency-drift-guard`)** to audit Wave 1 and issue `VERDICT: PASS`
   in `docs/reports/wave-1-verification.md`.
5. Merge `wave-1-core-verifier` into `main` and remove worktree.

### Wave 2: The 4 Specialist Compose Profiles

1. Create worktree: `git worktree add -b wave-2-specialist-profiles worktrees/wave-2 main`
2. Dispatch **Programmer (`agency-programmer`)** to implement all 4 profile compose files,
   expand `test/compose-contracts.test.ts`, write `scripts/accept/wave-2.sh`, and write
   `docs/reports/wave-2.md`. Programmer MUST first `read` `AGENTS.md` and
   `docs/prompts/SPEC.md` from disk in full.
3. Dispatch **QA (`agency-qa`)** (sabotage `profile-appsec.yml` with a `/var/run/docker.sock`
   mount to prove `verify-stack.ts` catches it and exits 1; restore with `git checkout --`)
   and **Drift Guard (`agency-drift-guard`)** (`VERDICT: PASS` in
   `docs/reports/wave-2-verification.md`).
4. Merge `wave-2-specialist-profiles` into `main` and remove worktree.

### Wave 3: Devcontainers, Quadlets, `heretek-exec.sh` & `heretek-box-ctl.sh`

1. Create worktree: `git worktree add -b wave-3-devcontainers-ctl worktrees/wave-3 main`
2. Dispatch **Programmer (`agency-programmer`)** to implement `devcontainers/**`,
   `quadlets/*.container`, `scripts/heretek-exec.sh`, `scripts/heretek-box-ctl.sh`,
   `test/scripts-ctl.test.ts`, `scripts/accept/wave-3.sh`, `README.md`, and
   `docs/reports/wave-3.md`. Programmer MUST first `read` `AGENTS.md` and
   `docs/prompts/SPEC.md` from disk in full.
3. Dispatch **QA (`agency-qa`)** and **Drift Guard (`agency-drift-guard`)** to verify and
   red-proof Wave 3 (`VERDICT: PASS` in `docs/reports/wave-3-verification.md`).
4. Merge `wave-3-devcontainers-ctl` into `main`, remove worktree, and verify
   `make check && make accept` exits 0 on `main`.

---

## 4. OPERATING PROCEDURES FOR ALL AGENTS

1. **Read before acting:** `read` `AGENTS.md` + `docs/prompts/SPEC.md` (+ the wave's
   `docs/prompts/verify-stage.md` for QA/Drift Guard) directly from disk, in full, first.
2. **Stay in scope:** infrastructure layer only (§0.4). Refuse out-of-scope work fail-closed.
3. **Zero stubs:** complete every interface, struct, function, route, and test with exact logic.
   No `TODO: implement later`, no dummy `return true`, no swallowed errors.
4. **Test-first:** run `bun test`, `make check`, and the relevant `scripts/accept/*.sh`
   locally and inspect real output before reporting completion.
5. **Git hygiene:** work on the assigned branch/worktree only; leave commits for the
   coordinator unless explicitly instructed to commit; never push without instruction.
