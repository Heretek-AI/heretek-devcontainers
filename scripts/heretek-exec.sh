#!/usr/bin/env bash
# scripts/heretek-exec.sh — sandboxed local worktree command wrapper (Wave 3)
#
# Wraps any agent command in `bwrap` + `landrun` + `mise exec`
# (Report 05a §7.2 Recipe 3):
#   1. `bwrap`  — bubblewrap filesystem isolation (unshare-all, read-only host
#                  binds, private /proc + /dev + /tmp, fixed workdir).
#   2. `landrun` — Landlock policy gate in front of the payload (invoked with
#                  `--` so everything after it is the payload, never a flag).
#   3. `mise exec` — resolves the pinned polyglot toolchain from
#                  devcontainers/polyglot-dev/mise.toml for the payload.
#
# SELinux: the sandbox inherits the caller context; on enforcing hosts the
# workdir must carry the `:Z` label granted by the compose/devcontainer mounts
# (see the SELINUX_VOLUME_LABELS contract in scripts/verify-stack.ts).
# KVM: pass `--kvm` to bind /dev/kvm into the sandbox (device-node grant, not
# a capability). Without --kvm the node is absent and emulator payloads fail
# closed instead of silently running without acceleration.
#
# `--dry-run` prints the exact argv that WOULD be executed (one stage per
# line plus the full chain) so tests can verify bwrap/landrun/mise argument
# construction on any machine, with or without the runners installed.
#
# Usage:
#   heretek-exec.sh [--dry-run] [--kvm] [--workdir DIR] [--landrun-arg ARG]... [--] <command> [args...]
#
# Exit codes: 0 payload (or dry-run) success, 2 usage/validation error,
# 1 sandbox/runner failure (including missing bwrap, landrun, or mise).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DRY_RUN=0
ALLOW_KVM=0
WORKDIR="$REPO_ROOT"
LANDRUN_EXTRA=()
CMD=()

usage() {
  printf '%s\n' \
    "heretek-exec.sh — sandboxed local worktree command wrapper (Wave 3)" \
    "" \
    "Wraps any agent command in bwrap + landrun + mise exec:" \
    "  1. bwrap isolates the filesystem (unshare-all, read-only host binds," \
    "     private /proc + /dev + /tmp, fixed workdir)." \
    "  2. landrun gates the payload behind a Landlock policy." \
    "  3. mise exec resolves the pinned polyglot toolchain for the payload." \
    "" \
    "Options:" \
    "  --dry-run            print the exact argv that would run (hermetic)" \
    "  --kvm                bind /dev/kvm into the sandbox (accelerator)" \
    "  --workdir DIR        sandbox root inside the repository (default: repo root)" \
    "  --landrun-arg ARG    extra landrun policy argument (repeatable)" \
    "  --help, -h           show this help" \
    "" \
    "Usage: heretek-exec.sh [--dry-run] [--kvm] [--workdir DIR] [--landrun-arg ARG]... [--] <command> [args...]"
}

fail_usage() {
  echo "heretek-exec: $1" >&2
  echo "heretek-exec: try 'heretek-exec.sh --help'" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --kvm)
      ALLOW_KVM=1
      shift
      ;;
    --workdir)
      [[ $# -ge 2 ]] || fail_usage "--workdir requires a directory argument"
      WORKDIR="$2"
      shift 2
      ;;
    --workdir=*)
      WORKDIR="${1#--workdir=}"
      [[ -n "$WORKDIR" ]] || fail_usage "--workdir requires a non-empty directory"
      shift
      ;;
    --landrun-arg)
      [[ $# -ge 2 ]] || fail_usage "--landrun-arg requires an argument"
      LANDRUN_EXTRA+=("$2")
      shift 2
      ;;
    --landrun-arg=*)
      LANDRUN_EXTRA+=("${1#--landrun-arg=}")
      shift
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        CMD+=("$1")
        shift
      done
      break
      ;;
    --*)
      fail_usage "unknown option: $1"
      ;;
    *)
      CMD+=("$1")
      shift
      ;;
  esac
done

[[ ${#CMD[@]} -gt 0 ]] || fail_usage "no command given"

# Fail closed: the workdir must exist, be a directory, and live inside the
# repository so the sandbox can never be pointed at /etc, $HOME, or /.
if [[ ! -d "$WORKDIR" ]]; then
  echo "heretek-exec: workdir is not a directory: $WORKDIR" >&2
  exit 2
fi
WORKDIR_REAL="$(realpath -m "$WORKDIR")"
ROOT_REAL="$(realpath -m "$REPO_ROOT")"
if [[ "$WORKDIR_REAL" != "$ROOT_REAL" && "$WORKDIR_REAL" != "$ROOT_REAL"/* ]]; then
  echo "heretek-exec: workdir escapes the repository (fail closed): $WORKDIR" >&2
  exit 2
fi

# --- Stage 1: bwrap isolation -------------------------------------------------
BWRAP_ARGS=(
  --unshare-all
  --die-with-parent
  --new-session
  --ro-bind /usr /usr
  --ro-bind /bin /bin
  --ro-bind /etc/resolv.conf /etc/resolv.conf
  --ro-bind /etc/ssl /etc/ssl
  --bind "$WORKDIR_REAL" "$WORKDIR_REAL"
  --proc /proc
  --dev /dev
  --tmpfs /tmp
  --setenv PATH "/usr/local/bin:/usr/bin:/bin"
  --setenv HERETEK_SANDBOX "1"
  --chdir "$WORKDIR_REAL"
)
if [[ "$ALLOW_KVM" -eq 1 ]]; then
  BWRAP_ARGS+=(--dev-bind /dev/kvm /dev/kvm --setenv HERETEK_ALLOW_KVM "1")
fi

# --- Stage 2: landrun policy gate --------------------------------------------
# Everything after `--` is payload; extra policy args go before it.
LANDRUN_ARGS=("${LANDRUN_EXTRA[@]}" --)

# --- Stage 3: pinned toolchain -----------------------------------------------
MISE_ARGS=(mise exec --)

quote_argv() {
  local out="" piece
  for piece in "$@"; do
    printf -v piece '%q' "$piece"
    out+="${out:+ }$piece"
  done
  printf '%s' "$out"
}

FULL_CHAIN=(bwrap "${BWRAP_ARGS[@]}" landrun "${LANDRUN_ARGS[@]}" "${MISE_ARGS[@]}" "${CMD[@]}")

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "heretek-exec dry-run:"
  echo "workdir: $WORKDIR_REAL"
  if [[ "$ALLOW_KVM" -eq 1 ]]; then
    echo "kvm: enabled (/dev/kvm bound into the sandbox)"
  else
    echo "kvm: disabled (accelerator node not passed through)"
  fi
  echo "bwrap: $(quote_argv bwrap "${BWRAP_ARGS[@]}")"
  echo "landrun: $(quote_argv landrun "${LANDRUN_ARGS[@]}")"
  echo "mise: $(quote_argv "${MISE_ARGS[@]}")"
  echo "payload: $(quote_argv "${CMD[@]}")"
  echo "full: $(quote_argv "${FULL_CHAIN[@]}")"
  exit 0
fi

# Fail closed on missing runners (checked only for real execution so
# --dry-run stays hermetic on machines without the sandbox installed).
for runner in bwrap landrun mise; do
  if ! command -v "$runner" >/dev/null 2>&1; then
    echo "heretek-exec: required runner not on PATH: $runner" >&2
    exit 1
  fi
done

# Fail closed when KVM was requested but the host has no accelerator node.
if [[ "$ALLOW_KVM" -eq 1 && ! -e /dev/kvm ]]; then
  echo "heretek-exec: --kvm requested but /dev/kvm is absent on this host" >&2
  exit 1
fi

exec "${FULL_CHAIN[@]}"
