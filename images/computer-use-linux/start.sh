#!/bin/sh
# Start a private D-Bus session bus and a headless Sway compositor, wait for
# the Wayland socket, then serve `computer-use-linux mcp` over streamable HTTP.
set -eu

mkdir -p "$XDG_RUNTIME_DIR"
chmod 0700 "$XDG_RUNTIME_DIR"

DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
export DBUS_SESSION_BUS_ADDRESS
dbus-daemon --session --address="$DBUS_SESSION_BUS_ADDRESS" --fork --nopidfile

sway --config /etc/heretek/sway-config &

tries=0
while [ ! -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ ! -S "$XDG_RUNTIME_DIR/wayland-0" ]; do
  tries=$((tries + 1))
  if [ "$tries" -gt 100 ]; then
    echo "heretek-computer-use: sway did not create a Wayland socket" >&2
    exit 1
  fi
  sleep 0.1
done
if [ -S "$XDG_RUNTIME_DIR/wayland-1" ]; then WAYLAND_DISPLAY=wayland-1; else WAYLAND_DISPLAY=wayland-0; fi
export WAYLAND_DISPLAY

exec mcp-proxy --host 0.0.0.0 --port "${MCP_PORT:-8790}" --pass-environment -- computer-use-linux mcp
