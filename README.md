# enforra-smolvm

This repository contains two related integrations:

1. **Enforra protected Node smolmachine**
   This is the registry-pack integration. Users install the standard `smolvm` CLI, pull the protected pack, and run normal `node`, `npm`, and shell commands. It enforces safety policies, approval gates, and logging directly inside the guest VM container. Users do not need to clone this repo or link the host wrapper.

2. **enforra-smolvm host wrapper**
   This is an advanced/developer wrapper around the `smolvm` CLI command itself on the host side. It evaluates policies before the VM starts (requires cloning this repo, running `npm install` and `npm link`).

---

## Using the Enforra Node smolmachine pack

To use the Enforra protected Node smolmachine, you only need the standard `smolvm` CLI installed:

### 1. Install smolvm CLI
```bash
curl -sSL https://smolmachines.com/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
```

### 2. Pull and run the protected Node pack
```bash
# Pull the latest pack from the registry
smolvm pack pull registry.smolmachines.com/library/enforra-node:latest -o enforra-node.smolmachine

# Run safe node commands immediately (allowed by default policy)
smolvm pack run --sidecar enforra-node.smolmachine node -e "console.log('hello from Enforra Node')"

# Run package installation (requires human approval prompt; use -i for interactive stdin)
smolvm pack run -i --sidecar enforra-node.smolmachine npm install lodash
```

*Note: Until the pack is officially published to the registry, developers can build it locally using:*
```bash
npm run pack:build
```
This script builds the Docker image locally, tags and pushes it to a local registry, and outputs the packaged `packs/enforra-node/enforra-node.smolmachine` artifact.

---

## Advanced: host-side smolvm wrapper

The host-side wrapper intercepts your `smolvm` command line calls on the host machine before the virtualization container is launched.

### Installation & Setup

1. Clone this repository and link it globally:
   ```bash
   git clone https://github.com/enforra/enforra-smolvm.git
   cd enforra-smolvm
   npm install
   npm link
   ```

2. The wrapper CLI is now available globally as `enforra-smolvm`.

### Usage & Policy Gating

Run any supported `smolvm` commands using `enforra-smolvm` instead of `smolvm`:

```bash
# 1. Inspect an approved public registry package
enforra-smolvm pack inspect --json registry.smolmachines.com/library/codex:arm64

# 2. Pull the registry package to a local file
enforra-smolvm pack pull registry.smolmachines.com/library/codex:arm64 -o ./codex.smolmachine

# 3. Run a command inside the pulled package sidecar (provenance verified)
enforra-smolvm pack run --sidecar ./codex.smolmachine node -e "console.log(process.version)"

# 4. Rehydrate the package using machine run --from
enforra-smolvm machine run --from ./codex.smolmachine node -e "console.log(process.version)"
```

### Policy Decisions

`enforra-smolvm` handles Enforra decisions as follows:

- `allow` and `log_only`: run the real `smolvm` command immediately.
- `block`: never run the real `smolvm` command and exit with code `3`.
- `require_approval`: print the action, then prompt:
  ```text
  Approve and run this smolvm command? [y/N]:
  ```
  Only `y` or `yes` (case-insensitive) approves execution. Pressing Enter, `n`, or any other answer declines the action and exits with code `2`.

---

## Policy files

This repo contains two separate policy layers:

1. **Host-side policy** (`policies/smolvm-host-policy.yaml`)
   Used by the host-side `enforra-smolvm` wrapper. It evaluates and gates command invocation (like `pack pull`) before a VM is created.

2. **Guest-side policy** (`packs/enforra-node/policy.yaml`)
   Bundled inside the `enforra-node` smolmachine. It evaluates and gates command usage (like `npm install` or `sh`) directly inside the running VM.

*For the Enforra Node smolmachine guest protection flow, only `packs/enforra-node/policy.yaml` is needed.*

---

## Verification & Scripts

### Run Unit Tests
Verify command parsing and classifier logic:
```bash
npm test
```

### Run Smoke Test
Run the full local simulation of allowed, approval-required, and blocked host-side wrapper scenarios:
```bash
npm run smoke
```

### Policy-Only Dry Run
Check host-side policy decisions without running the real `smolvm` binary:
```bash
npm run policy
```

### View Audit Summary
Print a quick table summary of decisions from the local audit log:
```bash
node -e 'const fs=require("fs"); const rows=fs.readFileSync(".enforra/audit.jsonl","utf8").trim().split("\n").map(JSON.parse).filter(r=>r.status!=="decision_logged").slice(-8); console.table(rows.map(r=>({tool:r.tool,decision:r.decision,status:r.status,policy:r.matchedPolicyId})));'
```

---

## Technical Details

- **Policy Path**: Customizable via `ENFORRA_SMOLVM_POLICY` (defaults to `policies/smolvm-host-policy.yaml`).
- **Audit Path**: Customizable via `ENFORRA_SMOLVM_AUDIT` (defaults to `.enforra/audit.jsonl`).
- **Artifact Provenance**: Tracked in `.enforra/smolvm-artifacts.json` mapping absolute paths of local artifacts to their original registry reference.

## Future Scope

- This wrapper operates at the command invocation level (does not replace `smolvm` globally unless linked).
- A future native integration could involve hooking into the `smolvm` CLI natively via a policy hook system.

---

## Command risk classification

Command risk classification is provided by [`@enforra/command-guard`](https://github.com/enforra/enforra/tree/main/packages/command-guard) from the Enforra OSS core. The smolvm repo only adds the smolvm-specific wrapper, binary mapping (`real-commands.js`), pack build script, and policy wiring. The local `command-classifier.js` file is a thin re-export shim for backward compatibility only.