# devcontainers/headless-wayland-desktop/Dockerfile — headless Sway + AT-SPI2 desktop (Wave 3)
#
# Debian trixie-slim base (pinned, never floating) with a headless Sway
# compositor, AT-SPI2 accessibility bus, and ydotool for synthetic input.
# Pairs at runtime with the pinned computer-use-linux agent image noted below
# (see compose/profile-research.yml `computer-use-linux` service), which
# consumes this desktop over the headless Wayland socket.
#
# Runtime peer (pinned, Apache-2.0/MIT stack — no AGPL tooling):
#   ghcr.io/agent-sh/computer-use-linux:v0.9.4
#
# Security posture: non-root `agent` user (uid 1000), no container-socket
# mounts, no privileged capabilities required (KVM passthrough, where needed,
# is granted by the orchestrator via device mapping, not by this image).

FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive \
    WLR_BACKENDS=headless \
    WLR_LIBINPUT_NO_DEVICES=1 \
    XDG_RUNTIME_DIR=/run/user/1000 \
    MOZ_ENABLE_WAYLAND=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        sway \
        swayidle \
        at-spi2-core \
        ydotool \
        wl-clipboard \
        grim \
        slurp \
        fonts-dejavu-core \
        dbus-user-session \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 -s /bin/bash agent \
    && mkdir -p /run/user/1000 /home/agent/.config/sway \
    && chown -R 1000:1000 /run/user/1000 /home/agent/.config

COPY --chown=1000:1000 sway-config /home/agent/.config/sway/config

USER 1000:1000
WORKDIR /home/agent

EXPOSE 8790

CMD ["sway", "--unsupported-gpu"]
