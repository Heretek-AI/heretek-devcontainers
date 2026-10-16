# images/mdb-mcp/Dockerfile — pinned local build of smadi0x86/mdb-mcp (GPL-3.0)
#
# Upstream publishes no image, no PyPI package and no release tag, so this
# build pins an exact upstream commit (package version 0.2.0) and verifies it
# after checkout. Compose tags the result localhost/heretek/mdb-mcp:0.2.0-5d03b25.
# GDB is the debugger backend; the compose service grants only SYS_PTRACE.
# The stdio MCP server is wrapped with a pinned mcp-proxy so the agent gateway
# can reach it over streamable HTTP at http://mdb-mcp:8767/mcp.

FROM debian:trixie-20261005-slim AS src

ARG MDB_MCP_COMMIT=5d03b25632c572e3640fd1004e9507600ed431d3

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates git; \
    git init -q /src; \
    cd /src; \
    git fetch -q --depth 1 https://github.com/smadi0x86/mdb-mcp.git "${MDB_MCP_COMMIT}"; \
    git checkout -q FETCH_HEAD; \
    test "$(git rev-parse HEAD)" = "${MDB_MCP_COMMIT}"; \
    rm -rf .git

FROM python:3.12.15-slim-trixie

ARG MCP_PROXY_VERSION=0.13.0

COPY --from=src /src /opt/mdb-mcp-src

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends gdb; \
    rm -rf /var/lib/apt/lists/*; \
    pip install --no-cache-dir /opt/mdb-mcp-src "mcp-proxy==${MCP_PROXY_VERSION}"; \
    useradd -m -u 1000 -s /bin/bash mcp; \
    mkdir -p /data; \
    chown 1000:1000 /data

USER 1000:1000
WORKDIR /data
EXPOSE 8767

CMD ["mcp-proxy", "--host", "0.0.0.0", "--port", "8767", "--pass-environment", "--", "mdb-mcp"]
