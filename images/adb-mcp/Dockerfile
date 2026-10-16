# images/adb-mcp/Dockerfile — adb-mcp (MIT) with a streamable-HTTP front end
#
# The upstream image ghcr.io/iksnerd/adb-mcp:0.23.0 exists but speaks MCP over
# stdio only, so this build copies its pinned binary next to the Debian adb
# client and a pinned mcp-proxy. Compose tags the result
# localhost/heretek/adb-mcp:0.23.0; the agent gateway reaches it at
# http://adb-mcp:8770/mcp.

FROM ghcr.io/iksnerd/adb-mcp:0.23.0 AS upstream

FROM python:3.12.15-slim-trixie

ARG MCP_PROXY_VERSION=0.13.0

COPY --from=upstream /usr/local/bin/adb-mcp /usr/local/bin/adb-mcp
COPY start.sh /usr/local/bin/heretek-adb-mcp

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends adb; \
    rm -rf /var/lib/apt/lists/*; \
    pip install --no-cache-dir "mcp-proxy==${MCP_PROXY_VERSION}"; \
    chmod 0755 /usr/local/bin/heretek-adb-mcp; \
    useradd -m -u 1000 -s /bin/bash mcp; \
    mkdir -p /data; \
    chown 1000:1000 /data

ENV HOME=/home/mcp
USER 1000:1000
WORKDIR /data
EXPOSE 8770

CMD ["heretek-adb-mcp"]
