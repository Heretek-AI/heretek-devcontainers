# images/blender-mcp/Dockerfile — pinned local build of sandraschi/blender-mcp (MIT)
#
# Upstream publishes no container image, so this build installs the v0.11.1
# tagged source (commit verified after checkout) next to Blender 4.2.3 LTS —
# the Blender version upstream's own Dockerfile targets — whose tarball is
# verified against a SHA-256 pinned here (BLENDER_SHA256, copied from the
# list blender.org publishes for that release), not a list fetched at build.
# Compose tags the result localhost/heretek/blender-mcp:0.11.1. blender-mcp
# serves streamable HTTP natively (FastMCP), at http://blender-mcp:8781/mcp.

FROM debian:trixie-20261005-slim AS src

ARG BLENDER_MCP_TAG=v0.11.1
ARG BLENDER_MCP_COMMIT=5a9e923f6ae68cfc34a221d31bd1fd5c8aff07f6

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates git; \
    git clone -q --depth 1 --branch "${BLENDER_MCP_TAG}" https://github.com/sandraschi/blender-mcp.git /src; \
    test "$(git -C /src rev-parse HEAD)" = "${BLENDER_MCP_COMMIT}"; \
    rm -rf /src/.git

FROM python:3.12.15-slim-trixie

ARG BLENDER_SERIES=4.2
ARG BLENDER_VERSION=4.2.3
ARG BLENDER_SHA256=3a64efd1982465395abab4259b4091d5c8c56054c7267e9633e4f702a71ea3f4

COPY --from=src /src /opt/blender-mcp-src

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates curl xz-utils \
        libgl1 libglib2.0-0 libx11-6 libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 libsm6 libice6; \
    cd /tmp; \
    curl -fsSLO "https://download.blender.org/release/Blender${BLENDER_SERIES}/blender-${BLENDER_VERSION}-linux-x64.tar.xz"; \
    echo "${BLENDER_SHA256}  blender-${BLENDER_VERSION}-linux-x64.tar.xz" | sha256sum -c -; \
    tar -xJf "blender-${BLENDER_VERSION}-linux-x64.tar.xz"; \
    mv "blender-${BLENDER_VERSION}-linux-x64" /opt/blender; \
    rm -f /tmp/blender-*; \
    apt-get purge -y curl xz-utils; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*; \
    pip install --no-cache-dir /opt/blender-mcp-src; \
    useradd -m -u 1000 -s /bin/bash mcp; \
    mkdir -p /data; \
    chown 1000:1000 /data

ENV HOME=/home/mcp \
    BLENDER_EXECUTABLE=/opt/blender/blender
USER 1000:1000
WORKDIR /data
EXPOSE 8781

CMD ["python", "-c", "from blender_mcp.server import main_http; main_http(host='0.0.0.0', port=8781)"]
