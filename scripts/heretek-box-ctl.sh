#!/usr/bin/env bash
# scripts/heretek-box-ctl.sh — operator CLI for the heretek-devcontainers stack (Wave 3)
#
# Subcommands:
#   verify                 run the fail-closed static verifier (scripts/verify-stack.ts)
#   list-profiles          print the 6 loadable profiles, one per line
#   up <profile>           start a profile (docker compose --profile <name> up -d)
#   down <profile>         stop a profile   (docker compose --profile <name> down)
#   status                 show compose container status
#   exec [--kvm] [--dry-run] <task-id> <cmd> [args...]
#                          run a task command via scripts/heretek-exec.sh
#                          (task-id is fail-closed alphanumeric: [A-Za-z0-9_.-]+)
#
# Profiles: core appsec android game research all
#   `core` is the always-loaded foundation (no --profile flag needed);
#   `all` pulls every specialist profile; any other name is rejected fail-closed.
#
# Exit codes: 0 success, 2 usage/validation error, 1 delegated tool failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXEC_SH="$SCRIPT_DIR/heretek-exec.sh"
VERIFY_TS="$SCRIPT_DIR/verify-stack.ts"

VALID_PROFILES="core appsec android game research all"

usage() {
  printf '%s\n' \
    "heretek-box-ctl.sh — operator CLI for the heretek-devcontainers stack (Wave 3)" \
    "" \
    "Subcommands:" \
    "  verify                 run the fail-closed static verifier" \
    "  list-profiles          print the 6 loadable profiles, one per line" \
    "  up <profile>           start a profile (docker compose up -d)" \
    "  down <profile>         stop a profile (docker compose down)" \
    "  status                 show compose container status" \
    "  exec [--kvm] [--dry-run] <task-id> <cmd> [args...]" \
    "                         run a task command via heretek-exec.sh" \
    "" \
    "Profiles: core appsec android game research all" \
    "" \
    "Usage: heretek-box-ctl.sh <verify|list-profiles|up|down|status|exec> [args...]"
}

fail_usage() {
  echo "heretek-box-ctl: $1" >&2
  echo "heretek-box-ctl: try 'heretek-box-ctl.sh --help'" >&2
  exit 2
}

is_valid_profile() {
  local candidate="$1" known
  for known in $VALID_PROFILES; do
    if [[ "$candidate" == "$known" ]]; then
      return 0
    fi
  done
  return 1
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "heretek-box-ctl: required tool not on PATH: docker" >&2
    exit 1
  fi
}

cmd_verify() {
  [[ $# -eq 0 ]] || fail_usage "verify takes no arguments"
  if ! command -v bun >/dev/null 2>&1; then
    echo "heretek-box-ctl: required tool not on PATH: bun" >&2
    exit 1
  fi
  (cd "$REPO_ROOT" && exec bun run "$VERIFY_TS")
}

cmd_list_profiles() {
  [[ $# -eq 0 ]] || fail_usage "list-profiles takes no arguments"
  printf '%s\n' $VALID_PROFILES
}

cmd_up() {
  [[ $# -eq 1 ]] || fail_usage "up requires exactly one profile: up <profile>"
  is_valid_profile "$1" || fail_usage "unknown profile: $1 (valid: $VALID_PROFILES)"
  require_docker
  if [[ "$1" == "core" ]]; then
    (cd "$REPO_ROOT" && exec docker compose up -d)
  else
    (cd "$REPO_ROOT" && exec docker compose --profile "$1" up -d)
  fi
}

cmd_down() {
  [[ $# -eq 1 ]] || fail_usage "down requires exactly one profile: down <profile>"
  is_valid_profile "$1" || fail_usage "unknown profile: $1 (valid: $VALID_PROFILES)"
  require_docker
  if [[ "$1" == "core" ]]; then
    (cd "$REPO_ROOT" && exec docker compose down)
  else
    (cd "$REPO_ROOT" && exec docker compose --profile "$1" down)
  fi
}

cmd_status() {
  [[ $# -eq 0 ]] || fail_usage "status takes no arguments"
  require_docker
  (cd "$REPO_ROOT" && exec docker compose ps)
}

cmd_exec() {
  local dry_run="" kvm=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) dry_run="--dry-run"; shift ;;
      --kvm) kvm="--kvm"; shift ;;
      --) shift; break ;;
      --*) fail_usage "unknown exec option: $1" ;;
      *) break ;;
    esac
  done
  [[ $# -ge 2 ]] || fail_usage "exec requires a task id and a command: exec [--kvm] [--dry-run] <task-id> <cmd> [args...]"
  local task_id="$1"
  shift
  if [[ ! "$task_id" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    echo "heretek-box-ctl: invalid task id (fail closed): $task_id" >&2
    exit 2
  fi
  if [[ ! -x "$EXEC_SH" ]]; then
    echo "heretek-box-ctl: sandbox wrapper missing or not executable: $EXEC_SH" >&2
    exit 1
  fi
  # shellcheck disable=SC2086
  exec "$EXEC_SH" $dry_run $kvm -- "$@"
}

[[ $# -ge 1 ]] || fail_usage "no subcommand given"

subcommand="$1"
shift

case "$subcommand" in
  --help|-h|help)
    usage
    exit 0
    ;;
  verify)
    cmd_verify "$@"
    ;;
  list-profiles)
    cmd_list_profiles "$@"
    ;;
  up)
    cmd_up "$@"
    ;;
  down)
    cmd_down "$@"
    ;;
  status)
    cmd_status "$@"
    ;;
  exec)
    cmd_exec "$@"
    ;;
  *)
    fail_usage "unknown subcommand: $subcommand"
    ;;
esac
