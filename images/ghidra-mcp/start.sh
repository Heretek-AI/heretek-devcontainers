#!/bin/sh
# Run the headless Ghidra REST server on the container-internal loopback
# (127.0.0.1:${GHIDRA_MCP_PORT}) and expose upstream's MCP bridge over
# streamable HTTP on ${MCP_PORT}/mcp. Fails closed without the auth token.
set -eu

if [ -z "${GHIDRA_MCP_AUTH_TOKEN:-}" ]; then
  echo "heretek-ghidra-mcp: GHIDRA_MCP_AUTH_TOKEN is mandatory" >&2
  exit 1
fi

/app/entrypoint.sh &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM

bridge-mcp-ghidra --transport streamable-http --mcp-host 0.0.0.0 --mcp-port "${MCP_PORT:-8089}" &
bridge_pid=$!

# Exit (and let the orchestrator restart us) as soon as either process dies.
while kill -0 "$server_pid" 2>/dev/null && kill -0 "$bridge_pid" 2>/dev/null; do
  sleep 2
done
kill "$server_pid" "$bridge_pid" 2>/dev/null || true
exit 1
