FROM node:22-slim

# Set working directory inside the VM container
WORKDIR /app

# Copy package configuration and install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the Enforra entrypoint and policy file
COPY enforra-run.js policy.yaml ./
COPY runtime ./runtime

# ── Wrapper-based protection layer (must be last in the build) ──────
#
# 1. Create the private runtime directory `/opt/enforra/real` and move
#    the real system/Node binaries there.
#
# 2. Replace the public paths (like /usr/bin/env, /bin/sh, etc.) with
#    wrapper scripts pointing to the private real paths. This ensures
#    absolute path invocations cannot bypass Enforra.
#
# 3. Wrapper script shebangs use the real private shell directly
#    (#!/opt/enforra/real/sh) to prevent wrapper recursion.
#
# IMPORTANT: Do not add RUN commands after this block. Any command
# that uses a wrapped binary would be routed through Enforra.

RUN set -eux; \
    chmod +x enforra-run.js; \
    mkdir -p /opt/enforra/real; \
    \
    # Delete old symlinks / wrappers first while rm is still in PATH \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/bin/sh; \
    \
    # Move real binaries to private runtime path \
    mv /usr/local/bin/node /opt/enforra/real/node; \
    mv /usr/bin/env /opt/enforra/real/env; \
    mv /usr/bin/printenv /opt/enforra/real/printenv; \
    mv /usr/bin/cat /opt/enforra/real/cat; \
    mv /usr/bin/rm /opt/enforra/real/rm; \
    mv /usr/bin/dash /opt/enforra/real/sh; \
    mv /usr/bin/bash /opt/enforra/real/bash; \
    \
    # Create enforra-run symlink for ease of access \
    ln -s /app/enforra-run.js /usr/local/bin/enforra-run; \
    \
    # Create wrapper scripts pointing to private node/sh \
    for cmd in node npm npx; do \
      printf '#!/opt/enforra/real/sh\nexec /opt/enforra/real/node /app/enforra-run.js %s "$@"\n' "$cmd" > "/usr/local/bin/$cmd"; \
      chmod +x "/usr/local/bin/$cmd"; \
    done; \
    for cmd in env printenv cat rm sh dash bash; do \
      printf '#!/opt/enforra/real/sh\nexec /opt/enforra/real/node /app/enforra-run.js %s "$@"\n' "$cmd" > "/usr/bin/$cmd"; \
      chmod +x "/usr/bin/$cmd"; \
    done; \
    \
    # Verify everything looks right \
    test -x /usr/local/bin/npm; \
    test -x /usr/local/bin/npx; \
    test -x /usr/bin/sh; \
    test -x /usr/bin/dash; \
    test -x /usr/bin/bash; \
    head -1 /usr/local/lib/node_modules/npm/bin/npm-cli.js | grep node; \
    head -1 /usr/local/lib/node_modules/npm/bin/npx-cli.js | grep node

CMD ["/opt/enforra/real/node", "/app/enforra-run.js", "--help"]
