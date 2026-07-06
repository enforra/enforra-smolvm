# Enforra protected Node smolmachine

Node.js runtime with Enforra policy, approval and audit built in for commands run inside the VM.

## Overview and Differences

It is important to distinguish this runtime from the wrapper located at the root of the repository:
- **Root Repository (enforra-smolvm)**: Act as a host-side policy-gating wrapper around the `smolvm` CLI command itself.
- **Packs (packs/enforra-node)**: Enforra runs **inside** the smolmachine VM, protecting agent and tool actions inside the virtual machine boundary. No host wrapper is needed; the safety policies, interactive approval mechanism, and audit logger reside directly within the running guest OS.

---

## Registry Usage

Once this smolmachine is published, the intended registry path is `registry.smolmachines.com/library/enforra-node:latest`. Users will be able to pull and run it directly:

```bash
# Pull the latest packed smolmachine
smolvm pack pull registry.smolmachines.com/library/enforra-node:latest -o enforra-node.smolmachine

# 1. Allow Safe Command (inferred as node.exec / low risk)
smolvm pack run --sidecar enforra-node.smolmachine enforra-run node -e "console.log('hello from Enforra Node ' + process.version)"

# 2. Require Approval for Risky Command (inferred as npm.install / medium risk)
# Note: Use -i when a command may require approval, because smolvm pack run does not forward interactive stdin by default.
smolvm pack run -i --sidecar enforra-node.smolmachine enforra-run npm install lodash

# 3. Block Dangerous Command (inferred as shell.exec / high risk due to rm -rf)
smolvm pack run --sidecar enforra-node.smolmachine enforra-run sh -lc "rm -rf /workspace"
```

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
   On macOS, the guest VM reaches the host's localhost via the default bridge network interface, typically `192.168.64.1`. You can build it by running:
   ```bash
   smolvm pack create -I 192.168.64.1:5001/enforra-node:latest -o packs/enforra-node/enforra-node
   ```
   Or if you need to override the registry host/port (for example, if your VM network uses a different gateway/subnet):
   ```bash
   REGISTRY_HOST=<reachable-host-ip> REGISTRY_PORT=5001 npm run pack:build
   ```

---

## Inside-VM Runtime Behavior

### Safe Commands (e.g. `node ...`, `npm --version`)
- **Enforra Decision**: `allow`
- **Behavior**: Action executes immediately.
- **Exit Code**: exits with the child command's exit code.

### Risky Commands (e.g. `npm install ...`, unknown commands)
- **Enforra Decision**: `require_approval`
- **Behavior**: Prompts the user:
  ```text
  Approval required for command: <commandString>
  Approve and run this command? [y/N]:
  ```
  Inputting `y` or `yes` (case-insensitive) executes the action and exits with the child command's exit code. Pressing Enter, `n`, or any other input declines the command, writes a manual decline audit event inside the VM, and exits `2`.

### Dangerous Commands (e.g. `sh` containing `rm -rf`)
- **Enforra Decision**: `block`
- **Behavior**: Never prompts, never executes, and exits `3`.
