FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY enforra-run.js policy.yaml enforra-manifest.json ./
COPY runtime ./runtime

# Wrapper-based protection layer. Keep this as the final build step.
#
# Real binaries used by the wrapper are moved to /opt/enforra/real.
# Supported public command paths are replaced with Enforra wrappers so normal
# relative and public absolute-path invocations pass through policy first.
# Internal /opt/enforra/real paths are implementation details, not a
# malicious-root security boundary. See THREAT_MODEL.md in the repository.
RUN set -eux; \
    chmod +x enforra-run.js; \
    mkdir -p /opt/enforra/real; \
    \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/bin/sh; \
    \
    mv /usr/local/bin/node /opt/enforra/real/node; \
    mv /usr/bin/env /opt/enforra/real/env; \
    mv /usr/bin/printenv /opt/enforra/real/printenv; \
    mv /usr/bin/cat /opt/enforra/real/cat; \
    mv /usr/bin/rm /opt/enforra/real/rm; \
    mv /usr/bin/dash /opt/enforra/real/sh; \
    mv /usr/bin/bash /opt/enforra/real/bash; \
    \
    ln -s /app/enforra-run.js /usr/local/bin/enforra-run; \
    ln -s /app/enforra-run.js /usr/local/bin/enforra; \
    \
    for cmd in node npm npx; do \
      printf '#!/opt/enforra/real/sh\nexec /opt/enforra/real/node /app/enforra-run.js %s "$@"\n' "$cmd" > "/usr/local/bin/$cmd"; \
      chmod +x "/usr/local/bin/$cmd"; \
    done; \
    for cmd in env printenv cat rm sh dash bash; do \
      printf '#!/opt/enforra/real/sh\nexec /opt/enforra/real/node /app/enforra-run.js %s "$@"\n' "$cmd" > "/usr/bin/$cmd"; \
      chmod +x "/usr/bin/$cmd"; \
    done; \
    \
    test -x /usr/local/bin/enforra; \
    test -x /usr/local/bin/npm; \
    test -x /usr/local/bin/npx; \
    test -x /usr/bin/sh; \
    test -x /usr/bin/dash; \
    test -x /usr/bin/bash; \
    head -1 /usr/local/lib/node_modules/npm/bin/npm-cli.js | grep node; \
    head -1 /usr/local/lib/node_modules/npm/bin/npx-cli.js | grep node

CMD ["/opt/enforra/real/node", "/app/enforra-run.js", "--help"]
