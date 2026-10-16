# images/computer-use-linux/Dockerfile — pinned local build of agent-sh/computer-use-linux (MIT)
#
# Upstream publishes no container image, so this build installs the v0.7.17
# release binary (verified against the release's published SHA-256) on a
# pinned Debian trixie base with a headless Sway compositor and the AT-SPI2
# accessibility bus. Compose tags the result
# localhost/heretek/computer-use-linux:0.7.17. The stdio MCP server
# (`computer-use-linux mcp`) is wrapped with a pinned mcp-proxy so the agent
# gateway can reach it over streamable HTTP at http://computer-use-linux:8790/mcp.

FROM debian:trixie-20261005-slim

ARG CUL_VERSION=0.7.17
ARG CUL_SHA256=4b9dccfda2e1b593d7ce333f30f88f48dce14c2235efa4f3ef37468e6fbc10b5
ARG MCP_PROXY_VERSION=0.13.0

COPY start.sh /usr/local/bin/heretek-computer-use
COPY sway-config /etc/heretek/sway-config

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates curl \
        sway at-spi2-core dbus dbus-user-session wtype grim fonts-dejavu-core \
        python3 python3-venv; \
    curl -fsSL -o /usr/local/bin/computer-use-linux \
        "https://github.com/agent-sh/computer-use-linux/releases/download/v${CUL_VERSION}/computer-use-linux-x86_64-unknown-linux-gnu"; \
    echo "${CUL_SHA256}  /usr/local/bin/computer-use-linux" | sha256sum -c -; \
    chmod 0755 /usr/local/bin/computer-use-linux /usr/local/bin/heretek-computer-use; \
    apt-get purge -y curl; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*; \
    python3 -m venv /opt/mcp-proxy; \
    /opt/mcp-proxy/bin/pip install --no-cache-dir "mcp-proxy==${MCP_PROXY_VERSION}"; \
    ln -s /opt/mcp-proxy/bin/mcp-proxy /usr/local/bin/mcp-proxy; \
    useradd -m -u 1000 -s /bin/bash agent; \
    mkdir -p /data; \
    chown 1000:1000 /data

ENV HOME=/home/agent \
    XDG_RUNTIME_DIR=/tmp/xdg-runtime \
    WLR_BACKENDS=headless \
    WLR_RENDERER=pixman \
    WLR_LIBINPUT_NO_DEVICES=1 \
    COMPUTER_USE_LINUX_INDICATOR=0
USER 1000:1000
WORKDIR /data
EXPOSE 8790

CMD ["heretek-computer-use"]
