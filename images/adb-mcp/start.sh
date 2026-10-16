#!/bin/sh
# Attach the local adb server to the emulator, then serve adb-mcp over
# streamable HTTP. A failed connect is not fatal: the emulator may still be
# booting, and adb-mcp reports device errors per tool call.
set -eu
adb start-server
adb connect "${ANDROID_HOST:-android-kvm}:${ADB_PORT:-5555}" || true
exec mcp-proxy --host 0.0.0.0 --port "${MCP_PORT:-8770}" --pass-environment -- adb-mcp
