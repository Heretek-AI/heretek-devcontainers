# verify-stage.md — QA & Drift Guard Stage Verification Protocol

> QA (`agency-qa`) and Drift Guard (`agency-drift-guard`) MUST `read` this file,
> plus `AGENTS.md` and `docs/prompts/SPEC.md`, directly from disk in full before
> verifying any wave. Never rely on relayed summaries.

---

## 1. QA PROCEDURE (`agency-qa`)

### 1.1 Green-path checks

For wave N (1, 2, or 3), run in the wave worktree on the wave branch:

```sh
make check
bash scripts/accept/wave-N.sh
bun test
bun run scripts/verify-stack.ts
```

- All four commands MUST exit 0 on a clean tree.
- Inspect real output — do not trust exit codes alone. Paste relevant output excerpts
  into the wave evidence log.
- If `scripts/verify-stack.ts` or `scripts/accept/wave-N.sh` does not exist yet
  (Step 0 only), `make check` / `make accept` skip gracefully — that is expected
  before Wave 1. From Wave 1 onward, missing verifier or acceptance scripts are FAILs.

### 1.2 Red-Proof Sabotage (binding — every wave)

Sabotage proves the verifier fails CLOSED. Perform at least the wave-mandated
sabotages, confirm exit code 1 with the exact file + rule violation in output,
then restore cleanly. NEVER leave sabotage in the tree.

**Wave 1 sabotages:**

```sh
# Sabotage A — floating tag (expect NO_FLOATING_TAGS, exit 1)
sed -i 's/nats:2.15.1-alpine/nats:latest/' compose/core.yml
bun run scripts/verify-stack.ts; echo "exit=$?"
git checkout -- compose/core.yml

# Sabotage B — wildcard bind (expect LOOPBACK_PORTS_ONLY, exit 1)
sed -i 's/127.0.0.1:8080:8080/0.0.0.0:8080:8080/' compose/core.yml
bun run scripts/verify-stack.ts; echo "exit=$?"
git checkout -- compose/core.yml
```

> NOTE: `sed`/`git checkout --` above are QA-only sabotage/restore tools. Normal file
> viewing and editing MUST still use native `read`/`edit`/`write` per AGENTS.md §0.3.

**Wave 2 sabotage:**

```sh
# Sabotage C — docker.sock mount (expect NO_DOCKER_SOCK, exit 1)
# Append a sock volume under any service in compose/profile-appsec.yml, verify exit 1,
# then restore:
git checkout -- compose/profile-appsec.yml
```

**Wave 3 sabotages:** re-run Sabotages A–C plus one quadlet sabotage
(e.g. remove `StopWhenUnneeded=true` or pin a `:latest` image in a `.container`
file if the verifier covers quadlets — confirm the verifier rejects it), then restore
with `git checkout --`.

### 1.3 Evidence log

Append every command, exit code, and observed verifier violation line to:

```text
docs/evidence/wave-<N>/red-proofs.log
```

Format per sabotage:

```text
## Sabotage <ID> (<RULE>) — <date UTC>
COMMAND: ...
OBSERVED: <exact verifier output + exit code>
RESTORED: git checkout -- <file> (git status --short clean for that file)
```

- Verify restoration with `git status --short` — the sabotaged file MUST NOT appear.
- If restoration fails (file still dirty), STOP and report FAIL. Never commit sabotage.

### 1.4 QA verdict

- QA PASSES iff: green-path checks exit 0 AND every mandated sabotage exits 1 with the
  correct rule named AND the tree is clean afterward.
- Otherwise QA FAILS — report exact failing command, output, and rule.

---

## 2. DRIFT GUARD PROCEDURE (`agency-drift-guard`)

### 2.1 Adversarial audit checklist

1. **Scope audit:** no 57 language Dockerfiles, no NixOS flakes, no WebUI/agent
   state-machine code. Any such file → `VERDICT: FAIL`.
2. **Spec fidelity audit:** every image tag, port binding, user, command, and config key
   in SPEC §§2.1–2.3 matches the implementation byte-for-byte in meaning
   (e.g. `bifrost` is `ghcr.io/maximhq/bifrost:v1.0.0` on `127.0.0.1:8080:8080`;
   `nats` command is exactly `["-js", "-sd", "/data", "-m", "8222"]`;
   `bifrost.yaml` has session affinity enabled, ttl `3600s`, header `x-session-id`,
   3-tier `opencode` → `openrouter` → `local-vllm`, `parse_retry_after: true`,
   `max_retry_after_clamp: "300s"`).
3. **Security audit:** grep the whole tree for `:latest`, `docker.sock`, `podman.sock`,
   `0.0.0.0`, `firecrawl`, `RFingAdam/mcp-blender`, `bytebot`, `0xflux/ghidra-mcp`,
   `pentagi`. Every hit is a FAIL unless the hit is inside a test fixture that asserts
   the verifier REJECTS it, or inside this protocol's documentation.
4. **Hardening audit:** every Compose service has `cap_drop: [ALL]` and
   `security_opt: ["no-new-privileges:true"]` (sole documented exception: `mdb-mcp`
   `cap_add: [SYS_PTRACE]`); every bind mount carries `:z`, `:Z`, or `:ro,Z`;
   every quadlet has `StopWhenUnneeded=true` and pinned images.
5. **Hygiene audit:** no `TODO`, no stub, no swallowed error, no `read` line numbers
   pasted into code, no `cat`/`sed` used for file edits outside QA sabotage.

### 2.2 Verification report

Write the verdict to:

```text
docs/reports/wave-<N>-verification.md
```

The report MUST contain exactly one verdict line:

```text
VERDICT: PASS
```

or

```text
VERDICT: FAIL
```

plus sections: scope audited, files checked, security grep results, spec deviations
(with file:line), and sabotage evidence cross-reference
(`docs/evidence/wave-<N>/red-proofs.log`).

### 2.3 Gate rule

- `VERDICT: PASS` → coordinator may merge the wave branch into `main`.
- `VERDICT: FAIL` → coordinator MUST NOT merge. Return to `agency-programmer` with the
  exact deviation list. Re-verify after fixes.
