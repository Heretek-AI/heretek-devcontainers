# images/godot-mcp/Dockerfile — pinned local build of tugcantopaloglu/godot-mcp (MIT)
#
# Upstream publishes no container image and its npm package lags the v3.1.0
# tag, so this build compiles the tagged source (commit verified after
# checkout) and pairs it with the official Godot 4.3-stable Linux binary
# (verified against the release's published SHA-512). Compose tags the result
# localhost/heretek/godot-mcp:3.1.0. The stdio MCP server is wrapped with a
# pinned mcp-proxy so the agent gateway can reach it over streamable HTTP at
# http://godot-mcp:8780/mcp.

FROM node:22.23.3-trixie-slim AS build

ARG GODOT_MCP_TAG=v3.1.0
ARG GODOT_MCP_COMMIT=fcbc29e03297900b9a1fcc6c7cbae116fe9d532a

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates git; \
    git clone -q --depth 1 --branch "${GODOT_MCP_TAG}" https://github.com/tugcantopaloglu/godot-mcp.git /src; \
    test "$(git -C /src rev-parse HEAD)" = "${GODOT_MCP_COMMIT}"; \
    cd /src; \
    npm ci --ignore-scripts; \
    npm run build; \
    npm prune --omit=dev

FROM node:22.23.3-trixie-slim

ARG GODOT_VERSION=4.3-stable
ARG GODOT_SHA512=fd52bb4ba8acc30ca5accd1c566d470ad7282f891ccc0995dfafabcf92bcf76280ce182bf9d80ebd885f3ed2165d01e1fc3f2928436b15498dfbd98656c2a45a
ARG MCP_PROXY_VERSION=0.13.0

COPY --from=build /src/build /opt/godot-mcp/build
COPY --from=build /src/node_modules /opt/godot-mcp/node_modules
COPY --from=build /src/package.json /opt/godot-mcp/package.json

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl fontconfig python3 python3-venv unzip; \
    curl -fsSL -o /tmp/godot.zip "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_linux.x86_64.zip"; \
    echo "${GODOT_SHA512}  /tmp/godot.zip" | sha512sum -c -; \
    unzip -q /tmp/godot.zip -d /opt/godot; \
    mv "/opt/godot/Godot_v${GODOT_VERSION}_linux.x86_64" /opt/godot/godot; \
    rm /tmp/godot.zip; \
    apt-get purge -y curl unzip; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*; \
    python3 -m venv /opt/mcp-proxy; \
    /opt/mcp-proxy/bin/pip install --no-cache-dir "mcp-proxy==${MCP_PROXY_VERSION}"; \
    ln -s /opt/mcp-proxy/bin/mcp-proxy /usr/local/bin/mcp-proxy; \
    mkdir -p /projects; \
    chown 1000:1000 /projects

# The node base image already ships the non-root `node` user as uid/gid 1000.
ENV HOME=/home/node \
    GODOT_PATH=/opt/godot/godot
USER 1000:1000
WORKDIR /projects
EXPOSE 8780

CMD ["mcp-proxy", "--host", "0.0.0.0", "--port", "8780", "--pass-environment", "--", "node", "/opt/godot-mcp/build/index.js"]
