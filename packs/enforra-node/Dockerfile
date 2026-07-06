FROM node:22-slim

# Set working directory inside the VM container
WORKDIR /app

# Copy package configuration and install production dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy the agent script and local Enforra policy file
COPY enforra-run.js policy.yaml ./

# Install transparent command wrappers. Remove npm/npx symlinks before writing
# wrappers so the real npm CLI JavaScript files remain untouched.
RUN set -eux; \
    chmod +x enforra-run.js; \
    mv /usr/local/bin/node /usr/local/bin/node-real; \
    rm -f /usr/local/bin/npm /usr/local/bin/npx; \
    ln -s /app/enforra-run.js /usr/local/bin/enforra-run; \
    for cmd in node npm npx sh bash env; do \
      printf '#!/bin/sh\nexec /usr/local/bin/node-real /app/enforra-run.js %s "$@"\n' "$cmd" > "/usr/local/bin/$cmd"; \
      chmod +x "/usr/local/bin/$cmd"; \
    done; \
    test -x /usr/local/bin/npm; \
    test -x /usr/local/bin/npx; \
    head -1 /usr/local/lib/node_modules/npm/bin/npm-cli.js | grep node; \
    head -1 /usr/local/lib/node_modules/npm/bin/npx-cli.js | grep node

# Default command displays the help/usage guide
CMD ["enforra-run", "--help"]
