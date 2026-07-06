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
# 1. Move the real node binary so wrappers can call it without recursion.
#    Wrappers at /usr/local/bin/<cmd> call:
#      /usr/local/bin/node-real /app/enforra-run.js <cmd> "$@"
#
# 2. Deleting /usr/local/bin/npm and /usr/local/bin/npx before writing
#    to them is CRITICAL. In the node base image, these are symlinks
#    pointing to node_modules/npm/bin/*-cli.js. Writing directly to
#    them without deleting them first will follow the symlink and
#    overwrite/destroy the real npm CLI files!
#
# 3. Generate thin shell wrapper scripts for each protected command.
#    Since /usr/local/bin precedes /usr/bin and /bin in PATH, these
#    wrappers intercept normal command usage.
#
#    Wrappers use #!/bin/sh which resolves to the real /bin/sh (dash)
#    via absolute path in the shebang — NOT via PATH lookup — so
#    there is no recursion even though we also wrap "sh".
#
# 4. enforra-run.js maps command names back to real binary paths
#    (e.g. npm → node-real /usr/local/lib/node_modules/npm/bin/npm-cli.js)
#    so execution after policy allow/approval bypasses the wrappers.
#
# IMPORTANT: Do not add RUN commands after this block. Any command
# that uses a wrapped binary would be routed through Enforra.

RUN set -eux; \
    chmod +x enforra-run.js; \
    mv /usr/local/bin/node /usr/local/bin/node-real; \
    rm -f /usr/local/bin/npm /usr/local/bin/npx; \
    ln -s /app/enforra-run.js /usr/local/bin/enforra-run; \
    for cmd in \
      node npm npx \
      sh bash \
      env printenv \
      cat rm chmod chown \
      curl wget scp rsync nc netcat \
      sudo su \
      git \
      aws gcloud az kubectl docker ssh terraform helm \
    ; do \
      printf '#!/bin/sh\nexec /usr/local/bin/node-real /app/enforra-run.js %s "$@"\n' "$cmd" > "/usr/local/bin/$cmd"; \
      chmod +x "/usr/local/bin/$cmd"; \
    done; \
    test -x /usr/local/bin/npm; \
    test -x /usr/local/bin/npx; \
    head -1 /usr/local/lib/node_modules/npm/bin/npm-cli.js | grep node; \
    head -1 /usr/local/lib/node_modules/npm/bin/npx-cli.js | grep node

CMD ["/usr/local/bin/node-real", "/app/enforra-run.js", "--help"]
