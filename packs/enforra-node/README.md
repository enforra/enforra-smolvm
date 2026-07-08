# Enforra protected Node smolmachine

Node.js runtime with Enforra policy, approval, and audit built directly inside the virtual machine boundary.

## Quickstart

```bash
# Pull the latest packed smolmachine
smolvm pack pull registry.smolmachines.com/library/enforra-node:latest -o enforra-node.smolmachine

# Run a safe Node command
smolvm pack run --sidecar enforra-node.smolmachine node -e "console.log('hello from Enforra Node ' + process.version)"

# Install a package (requires approval — use -i for interactive stdin)
smolvm pack run -i --sidecar enforra-node.smolmachine npm install lodash

# Destructive command (blocked by policy)
smolvm pack run --sidecar enforra-node.smolmachine sh -lc "rm -rf /workspace"

# Secret access (blocked by policy)
smolvm pack run --sidecar enforra-node.smolmachine env
```

---

## How it works

This pack wraps specific Node and shell-related utilities inside the VM to enforce policy check routing before execution.

* **Standard smolvm commands**: End-users keep using normal `smolvm` commands. Enforra is bundled inside the VM image.
* **Wrapper-based protection**: Common relative commands and their public absolute binary paths are replaced with wrappers inside the image:
  - Node.js: `node`, `nodejs`, `npm`, `npx`
  - Shell: `sh`, `bash` (including `/bin/sh`, `/bin/dash`, `/bin/bash`)
  - System: `env`, `printenv` (including `/usr/bin/env`, `/usr/bin/printenv`)
  - File: `cat`, `rm` (including `/usr/bin/cat`, `/usr/bin/rm`)
* **Secure internal routing**: Real binaries are moved to a private directory (`/opt/enforra/real/`) during the image build. The wrappers invoke Enforra via `/opt/enforra/real/node`, ensuring absolute path executions (like `/usr/bin/env` or `/usr/bin/rm`) cannot bypass protection.

*Note: This is a targeted policy-protected runtime for Node execution workloads, not a universal Linux security runtime, and it does not wrap or protect every possible binary in the VM.*

---

## Local Build & Packaging

To develop or test this pack locally, build the OCI image and package it into a `.smolmachine`:

### 1. Build the OCI Image
```bash
docker build -t enforra-node:latest packs/enforra-node
```

### 2. Setup Local Registry for Packaging
Because `smolvm` pulls images inside a virtualization environment, you must run a local docker registry:

```bash
# Start the registry container
docker run -d -p 5001:5000 --name local-registry registry:2

# Tag and push the image
docker tag enforra-node:latest localhost:5001/enforra-node:latest
docker push localhost:5001/enforra-node:latest

# Pack the image into .smolmachine
REGISTRY_HOST=192.168.64.1 REGISTRY_PORT=5001 npm run pack:build
```

---

## Audit Log Persistence

By default in ephemeral command runs, files written inside the VM are discarded. For persistent audit logging, create a named machine:

```bash
# Create and start a persistent VM
smolvm machine create --name enforra-node --from enforra-node.smolmachine
smolvm machine start --name enforra-node

# Run commands
smolvm machine exec --name enforra-node -- node -e "console.log('hello')"

# View the accumulated audit log
smolvm machine exec --name enforra-node -- /opt/enforra/real/node -e "console.log(require('fs').readFileSync('/app/audit.jsonl','utf8'))"
```
