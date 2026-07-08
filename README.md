# Enforra protected Node smolmachine

This repository contains the source code and configuration for building and testing the **Enforra protected Node smolmachine** guest VM pack.

## How it works

* **Transparent Policy Protection**: This is a pre-packaged guest VM runtime where Enforra is bundled directly inside the container image.
* **Standard smolvm Tooling**: End-users continue using their normal `smolvm` CLI. They do not need to install wrappers, clone this repository, or run npm links.
* **Interception at Guest Layer**: They simply run `enforra-node` instead of the official `node` machine. Internal wrapper paths intercept all `node`, `npm`, and shell commands inside the VM, routing them to the bundled Enforra policy engine before execution.
* **Gated Execution**: 
  - **Safe commands** (like standard node scripts) are allowed immediately.
  - **Risky commands** (like `npm install`) require manual approval from the user.
  - **Destructive or secret-reading commands** (like `rm -rf` or reading credentials) are blocked.

*Note: This is a policy-protected runtime VM package, not a typical application SDK integration path.*

---

## Usage

### Once published to the registry

To pull and execute commands using the official published package:

```bash
# 1. Pull the protected Node smolmachine package
smolvm pack pull registry.smolmachines.com/library/enforra-node:latest -o enforra-node.smolmachine

# 2. Run standard Node commands (allowed immediately)
smolvm pack run --sidecar enforra-node.smolmachine node -e "console.log('hello')"

# 3. Run installation commands (requires human approval; use -i for interactive stdin)
smolvm pack run -i --sidecar enforra-node.smolmachine npm install lodash

# 4. Attempt dangerous operations (blocked by policy)
smolvm pack run --sidecar enforra-node.smolmachine sh -lc "rm -rf /workspace"
```

### Until published (local development flow)

For developers wanting to build and test the pack locally:

```bash
# 1. Build and package the smolmachine locally
npm run pack:build

# 2. Run commands against the locally built sidecar package
smolvm pack run --sidecar packs/enforra-node/enforra-node.smolmachine node -e "console.log('hello')"
```

---

## Policy Gating Details

* **Allow**: Returns the child command's output and exit code.
* **Block**: Outputs the block reason, prevents command execution, and exits with code `3`.
* **Require Approval**: Outputs a prompt: `Approve and run this command? [y/N]: `. Approving (`y`/`yes`) executes the command. Declining (or hitting Enter) exits with code `2`. Always pass the `-i` flag to `smolvm pack run` to enable interactive terminal input when approval prompts are expected.

---

## Development & Verification

To run unit and security integration tests locally on the classifier and runtime wrapper logic:

```bash
npm test
```