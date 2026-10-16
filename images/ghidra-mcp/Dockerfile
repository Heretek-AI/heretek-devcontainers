# images/ghidra-mcp/Dockerfile — pinned local build of bethington/ghidra-mcp (Apache-2.0)
#
# No image is published for ghidra-mcp v6.0.0, so this build follows the
# upstream docker/Dockerfile recipe from the v6.0.0 tag (commit verified after
# checkout) against the official Ghidra 12.1.2 release (pinned SHA-256; the
# Ghidra version upstream's pom.xml requires). Compose tags the result
# localhost/heretek/ghidra-mcp:6.0.0.
#
# The container runs two processes: the headless Ghidra REST server bound to
# 127.0.0.1:8080 inside the container only, and upstream's MCP bridge serving
# streamable HTTP on 0.0.0.0:8089/mcp for the agent gateway. Both enforce
# GHIDRA_MCP_AUTH_TOKEN.

FROM debian:trixie-20261005-slim AS src

ARG GHIDRA_MCP_TAG=v6.0.0
ARG GHIDRA_MCP_COMMIT=8cd2078e10b9ba28b188cb84ce5b9051a904b995

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates git; \
    git clone -q --depth 1 --branch "${GHIDRA_MCP_TAG}" https://github.com/bethington/ghidra-mcp.git /src; \
    test "$(git -C /src rev-parse HEAD)" = "${GHIDRA_MCP_COMMIT}"; \
    rm -rf /src/.git

FROM eclipse-temurin:21.0.12.1_1-jdk-noble AS ghidra

ARG GHIDRA_VERSION=12.1.2
ARG GHIDRA_DATE=20260605
ARG GHIDRA_SHA256=b62e81a0390618466c019c60d8c2f796ced2509c4c1aea4a37644a77272cf99d

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl unzip; \
    curl -fsSL -o /tmp/ghidra.zip \
        "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_${GHIDRA_VERSION}_build/ghidra_${GHIDRA_VERSION}_PUBLIC_${GHIDRA_DATE}.zip"; \
    echo "${GHIDRA_SHA256}  /tmp/ghidra.zip" | sha256sum -c -; \
    unzip -q /tmp/ghidra.zip -d /opt; \
    mv "/opt/ghidra_${GHIDRA_VERSION}_PUBLIC" /opt/ghidra; \
    rm /tmp/ghidra.zip; \
    jython="$(ls /opt/ghidra/Extensions/Ghidra/*_Jython.zip | head -n1)"; \
    mkdir -p /opt/ghidra/Ghidra/Extensions; \
    unzip -q "$jython" -d /opt/ghidra/Ghidra/Extensions/

FROM eclipse-temurin:21.0.12.1_1-jdk-noble AS build

ARG GHIDRA_VERSION=12.1.2

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends maven; \
    rm -rf /var/lib/apt/lists/*

COPY --from=ghidra /opt/ghidra /opt/ghidra
COPY --from=src /src/pom.xml /build/pom.xml
COPY --from=src /src/src /build/src
COPY --from=src /src/lib /build/lib

# Install the Ghidra framework JARs the plugin compiles against into the local
# Maven repository at the exact version pom.xml expects (same list as
# upstream's docker/Dockerfile).
RUN set -eux; \
    for jar in \
        Framework/Generic Framework/SoftwareModeling Framework/Project Framework/Docking \
        Framework/Utility Framework/Gui Framework/FileSystem Framework/Help \
        Features/Base Features/Decompiler Framework/DB Framework/Emulation \
        Debug/Debugger-api Debug/Framework-TraceModeling Debug/Debugger-rmi-trace; do \
        name="${jar##*/}"; \
        mvn -q install:install-file -Dfile="/opt/ghidra/Ghidra/${jar}/lib/${name}.jar" \
            -DgroupId=ghidra -DartifactId="${name}" -Dversion="${GHIDRA_VERSION}" -Dpackaging=jar; \
    done; \
    cd /build; \
    mvn -q clean package -P headless -DskipTests

FROM eclipse-temurin:21.0.12.1_1-jdk-noble

COPY --from=ghidra /opt/ghidra /opt/ghidra
COPY --from=build /build/target/GhidraMCP-*.jar /app/GhidraMCP.jar
COPY --from=src /src/docker/entrypoint.sh /app/entrypoint.sh
COPY --from=src /src /opt/ghidra-mcp-src
COPY start.sh /usr/local/bin/heretek-ghidra-mcp

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends python3 python3-venv; \
    rm -rf /var/lib/apt/lists/*; \
    sed -i 's/\r$//' /app/entrypoint.sh; \
    chmod 0755 /app/entrypoint.sh /usr/local/bin/heretek-ghidra-mcp; \
    python3 -m venv /opt/ghidra-mcp-bridge; \
    /opt/ghidra-mcp-bridge/bin/pip install --no-cache-dir /opt/ghidra-mcp-src; \
    rm -rf /opt/ghidra-mcp-src; \
    ln -s /opt/ghidra-mcp-bridge/bin/bridge-mcp-ghidra /usr/local/bin/bridge-mcp-ghidra; \
    mkdir -p /data /projects /home/ghidra; \
    chown 1000:1000 /data /projects /home/ghidra

ENV GHIDRA_HOME=/opt/ghidra \
    HOME=/home/ghidra \
    JAVA_OPTS="-Xmx4g -XX:+UseG1GC" \
    GHIDRA_MCP_BIND_ADDRESS=127.0.0.1 \
    GHIDRA_MCP_PORT=8080 \
    GHIDRA_MCP_URL=http://127.0.0.1:8080
USER 1000:1000
WORKDIR /app
EXPOSE 8089

CMD ["heretek-ghidra-mcp"]
