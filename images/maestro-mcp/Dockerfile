# images/maestro-mcp/Dockerfile — pinned local build of mobile-dev-inc/maestro (Apache-2.0)
#
# Maestro publishes no container image, so compose builds this one as
# localhost/heretek/maestro-mcp:2.11.0. It installs the cli-2.11.0 release
# archive (verified against a pinned SHA-256) on a pinned JRE and wraps the
# stdio `maestro mcp` server with a pinned mcp-proxy so the agent gateway can
# reach it over streamable HTTP at http://maestro-mcp:8771/mcp.

FROM eclipse-temurin:21.0.12.1_1-jre-noble

ARG MAESTRO_VERSION=2.11.0
ARG MAESTRO_SHA256=5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a
ARG MCP_PROXY_VERSION=0.13.0

COPY start.sh /usr/local/bin/heretek-maestro-mcp

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends adb ca-certificates curl python3 python3-venv unzip; \
    rm -rf /var/lib/apt/lists/*; \
    curl -fsSL -o /tmp/maestro.zip "https://github.com/mobile-dev-inc/maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip"; \
    echo "${MAESTRO_SHA256}  /tmp/maestro.zip" | sha256sum -c -; \
    unzip -q /tmp/maestro.zip -d /opt; \
    rm /tmp/maestro.zip; \
    ln -s /opt/maestro/bin/maestro /usr/local/bin/maestro; \
    python3 -m venv /opt/mcp-proxy; \
    /opt/mcp-proxy/bin/pip install --no-cache-dir "mcp-proxy==${MCP_PROXY_VERSION}"; \
    ln -s /opt/mcp-proxy/bin/mcp-proxy /usr/local/bin/mcp-proxy; \
    chmod 0755 /usr/local/bin/heretek-maestro-mcp; \
    if ! getent passwd 1000 >/dev/null; then useradd -m -u 1000 -s /bin/bash mcp; fi; \
    mkdir -p /data /home/mcp; \
    chown 1000:1000 /data /home/mcp

ENV HOME=/home/mcp \
    MAESTRO_CLI_NO_ANALYTICS=1
USER 1000:1000
WORKDIR /data
EXPOSE 8771

CMD ["heretek-maestro-mcp"]
