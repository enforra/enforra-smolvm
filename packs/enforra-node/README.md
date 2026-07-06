# Enforra protected Node smolmachine

Node.js runtime with Enforra policy, approval and audit built in for commands run inside the VM.

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

Users run normal commands. The image includes wrappers for common Node, npm, shell, file, network, git, cloud and system commands. These wrappers route commands through Enforra policy before execution.

Use `-i` when a command may require human approval, because `smolvm pack run` does not forward interactive stdin by default.

---

## How it works

The enforra-node smolmachine replaces common binaries in `/usr/local/bin` with thin shell wrappers. Since `/usr/local/bin` precedes `/usr/bin` and `/bin` in PATH, these wrappers intercept normal command usage.

Each wrapper calls:

```
/usr/local/bin/node-real /app/enforra-run.js <command> "$@"
```

`enforra-run.js` classifies the command, evaluates it against Enforra policy, and if allowed or approved, executes the real binary via absolute path (bypassing the wrapper).

### Wrapped commands

The following commands are wrapped and protected:

| Category | Commands |
|---|---|
| Node.js | `node`, `npm`, `npx` |
| Shell | `sh`, `bash` |
| System info | `env`, `printenv` |
| File operations | `cat`, `rm`, `chmod`, `chown` |
| Network | `curl`, `wget`, `scp`, `rsync`, `nc`, `netcat` |
| Privilege | `sudo`, `su` |
| Source control | `git` |
| Cloud / infra | `aws`, `gcloud`, `az`, `kubectl`, `docker`, `ssh`, `terraform`, `helm` |

Commands invoked via absolute path (e.g. `/usr/bin/env` instead of `env`) bypass the wrappers and are not protected. This is a known limitation of the PATH-based interception approach.

### Decision flow

| You type | Enforra classifies | Decision |
|---|---|---|
| `node -e "..."` | `node.exec` / low risk | **allow** |
| `npm --version` | `npm.exec` / low risk | **allow** |
| `npm install lodash` | `npm.install` / medium risk | **require approval** |
| `sh -lc "echo hi"` | `shell.exec` / medium risk | **require approval** |
| `sh -lc "rm -rf /"` | `shell.exec` / high risk / destructive | **block** |
| `sh -lc "cat /etc/passwd"` | `shell.exec` / high risk / sensitive path | **block** |
| `env` | `secrets.read` / high risk / reads secrets | **block** |
| `sh -lc "curl ... \| sh"` | `shell.exec` / high risk / download+exec | **block** |
| `sudo ls` | `system.exec` / high risk / privilege | **block** |

---

## Policy coverage

The bundled starter policy covers these categories:

| Category | Tool | Risk | Decision |
|---|---|---|---|
| Code execution | `node.exec` | low | allow |
| Package metadata | `npm.exec` | low | allow |
| File reads (safe) | `file.read` | low | allow |
| Package install | `npm.install` | medium | require approval |
| File deletion | `file.delete` | medium | require approval |
| Shell commands | `shell.exec` | medium | require approval |
| Network download | `network.exec` | medium | require approval |
| Git operations | `git.exec` | medium | require approval |
| Unknown commands | `command.exec` | medium | require approval |
| Cloud/infra tools | `infra.exec` | high | require approval |
| Destructive operations | any | high | block |
| Sensitive file access | any | high | block |
| Secret/env access | `secrets.read` | high | block |
| Download and execute | any | high | block |
| Data exfiltration | `network.exec` | high | block |
| Privilege escalation | `system.exec` | high | block |
| Cloud credential access | `infra.exec` | high | block |

Teams can edit `policy.yaml` and rebuild the smolmachine with their own controls.

---

## Overview and Differences

- **Root Repository (enforra-smolvm)**: Acts as a host-side policy-gating wrapper around the `smolvm` CLI command itself.
- **Packs (packs/enforra-node)**: Enforra runs **inside** the smolmachine VM, protecting commands inside the virtual machine boundary. No host wrapper is needed; the safety policies, interactive approval mechanism, and audit logger reside directly within the running guest OS.

---

## Local Build & Packaging

If you are developing or testing this pack locally, you can build the OCI image and package it into a `.smolmachine` using a local docker registry.

### A. Build the OCI Image
```bash
docker build -t enforra-node:latest packs/enforra-node
```

### B. Setup Local Registry for Packaging
Since `smolvm pack create` pulls images inside a virtualization environment, you must run a local docker registry and push the image there so `smolvm` can pull it:

1. **Start the local registry container**:
   ```bash
   docker run -d -p 5001:5000 --name local-registry registry:2
   ```

2. **Tag and push the image**:
   ```bash
   docker tag enforra-node:latest localhost:5001/enforra-node:latest
   docker push localhost:5001/enforra-node:latest
   ```

3. **Pack the image into `.smolmachine`**:
   ```bash
   smolvm pack create -I 192.168.64.1:5001/enforra-node:latest -o packs/enforra-node/enforra-node
   ```
   Or use the build script:
   ```bash
   REGISTRY_HOST=<reachable-host-ip> REGISTRY_PORT=5001 npm run pack:build
   ```

---

## Audit Log Persistence

In one-off `smolvm pack run` mode, the VM is ephemeral, so audit files written inside the VM are not persisted after the run unless the user exports them during the same command or uses a persistent machine flow.

For persistent audit inspection, create/start a named machine and run the commands there:

```bash
# Create and start a persistent VM from the packed smolmachine
smolvm machine create --name enforra-node --from enforra-node.smolmachine
smolvm machine start --name enforra-node

# Run commands inside the persistent machine
smolvm machine exec --name enforra-node -- node -e "console.log('hello')"

# View the accumulated audit log inside the VM
smolvm machine exec --name enforra-node -- /usr/local/bin/node-real -e "require('fs').readFileSync('/app/audit.jsonl','utf8').split('\\n').forEach(l=>l&&console.log(l))"

# Stop the machine when done
smolvm machine stop --name enforra-node
```
