# images/rea-mcp/Dockerfile — pinned local build of morluto/rea (MIT)
#
# No container image is published for REA, so compose builds this one as
# localhost/heretek/rea-mcp:6.5.0. It installs the pinned npm release
# rea-agents@6.5.0 (the package behind the upstream rea-agents-6.5.0 tag) and
# wraps its stdio MCP server (`rea mcp`) with a pinned mcp-proxy so the agent
# gateway can reach it over streamable HTTP at http://rea-mcp:8766/mcp.

FROM node:22.23.3-trixie-slim

ARG REA_VERSION=6.5.0
ARG MCP_PROXY_VERSION=0.13.0

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends python3 python3-venv ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    npm install --global --omit=dev "rea-agents@${REA_VERSION}"; \
    npm cache clean --force; \
    python3 -m venv /opt/mcp-proxy; \
    /opt/mcp-proxy/bin/pip install --no-cache-dir "mcp-proxy==${MCP_PROXY_VERSION}"; \
    ln -s /opt/mcp-proxy/bin/mcp-proxy /usr/local/bin/mcp-proxy; \
    mkdir -p /data; \
    chown 1000:1000 /data

# The node base image already ships the non-root `node` user as uid/gid 1000.
ENV HOME=/home/node
USER 1000:1000
WORKDIR /data
EXPOSE 8766

CMD ["mcp-proxy", "--host", "0.0.0.0", "--port", "8766", "--pass-environment", "--", "rea", "mcp"]
