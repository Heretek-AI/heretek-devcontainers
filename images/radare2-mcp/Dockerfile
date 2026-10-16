# images/radare2-mcp/Dockerfile — pinned local build of radareorg/radare2-mcp
#
# No container image is published for radare2-mcp, so compose builds this one
# as localhost/heretek/radare2-mcp:1.9.0. It installs the upstream release
# Debian packages (MIT r2mcp 1.9.0, LGPL radare2 6.2.4 — the radare2 version
# the 1.9.0 release was built against), each verified against a pinned SHA-256.
# r2mcp serves MCP over HTTP natively (`-H`), so no stdio bridge is needed.

FROM debian:trixie-20261005-slim

ARG R2_VERSION=6.2.4
ARG R2_SHA256=7019eedc0e0e87d1f53d6b8f5fc62b898567679c5efdce7fbfc557c9e7655e90
ARG R2MCP_VERSION=1.9.0
ARG R2MCP_SHA256=d426861a726f7e9bc13a44cc3bbfd8553c51b33fc05f1ff0eda75b433222d9e3

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    cd /tmp; \
    curl -fsSLO "https://github.com/radareorg/radare2/releases/download/${R2_VERSION}/radare2_${R2_VERSION}_amd64.deb"; \
    curl -fsSLO "https://github.com/radareorg/radare2-mcp/releases/download/${R2MCP_VERSION}/r2mcp_${R2MCP_VERSION}_amd64.deb"; \
    echo "${R2_SHA256}  radare2_${R2_VERSION}_amd64.deb" | sha256sum -c -; \
    echo "${R2MCP_SHA256}  r2mcp_${R2MCP_VERSION}_amd64.deb" | sha256sum -c -; \
    apt-get install -y --no-install-recommends "./radare2_${R2_VERSION}_amd64.deb" "./r2mcp_${R2MCP_VERSION}_amd64.deb"; \
    apt-get purge -y curl; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/* /tmp/*.deb; \
    useradd -m -u 1000 -s /bin/bash mcp; \
    mkdir -p /data; \
    chown 1000:1000 /data; \
    r2mcp -v

USER 1000:1000
WORKDIR /data
EXPOSE 8765

# -R: read-only tool set (never -r, which enables the dangerous run_* tools);
# -s /data: sandbox file access to the data volume.
CMD ["r2mcp", "-H", "0.0.0.0:8765", "-R", "-s", "/data"]
