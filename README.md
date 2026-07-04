# enforra-smolvm

A policy-gated `smolvm` CLI wrapper powered by Enforra.

`enforra-smolvm` acts as a security wrapper around the `smolvm` command line interface. Users and agents can invoke the same commands and arguments they normally would with `smolvm`, and Enforra evaluates a local safety policy to decide whether to **allow**, **require approval**, or **block** the action before the real `smolvm` command is executed.

## Features

- **Transparent Wrapper**: Direct drop-in replacement for `smolvm` subcommands.
- **Local Policy Gating**: Evaluates policy against a local YAML file (`policies/smolvm-agent.yaml`). No hosted Enforra account is required.
- **Artifact Provenance Tracking**: Tracks pulled `.smolmachine` artifacts back to their registry reference using `.enforra/smolvm-artifacts.json`.
- **Local Auditing**: Logs decisions and executions locally in JSONL format (`.enforra/audit.jsonl`).
- **Policy-Only Dry Run**: Evaluate policies and simulate decisions without spawning `smolvm` or prompting for approval.
- **Interactive Approval**: `require_approval` decisions show the proposed action and ask a human before executing.

## Supported Commands

- `pack inspect`
- `pack pull`
- `pack run`
- `machine run --from`

*Note: Unsupported `smolvm` subcommands are mapped to `smolvm.unsupported` and blocked by default unless explicitly allowed by the policy.*

---

## Installation

### 1. Install smolvm CLI

The wrapper delegates allowed commands to the real `smolvm` CLI:

```bash
curl -sSL https://smolmachines.com/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
smolvm --help
```

### 2. Install and link the wrapper

Clone this repository and link it globally:

```bash
git clone https://github.com/enforra/enforra-smolvm.git
cd enforra-smolvm
npm install
npm link
```

Now, the `enforra-smolvm` command will be available globally.

---

## Usage

Run any supported `smolvm` commands using `enforra-smolvm`:

```bash
# 1. Inspect an approved public registry package
enforra-smolvm pack inspect --json registry.smolmachines.com/library/codex:arm64

# 2. Pull the registry package to a local file
enforra-smolvm pack pull registry.smolmachines.com/library/codex:arm64 -o ./codex.smolmachine

# 3. Run a command inside the pulled package sidecar ( provenance verified )
enforra-smolvm pack run --sidecar ./codex.smolmachine node -e "console.log(process.version)"

# 4. Rehydrate the package using machine run --from
enforra-smolvm machine run --from ./codex.smolmachine node -e "console.log(process.version)"
```

---

## Policy Decisions

`enforra-smolvm` handles Enforra decisions as follows:

- `allow` and `log_only`: run the real `smolvm` command immediately.
- `block`: never run the real `smolvm` command and exit with code `3`.
- `require_approval`: print the action, then prompt:

```text
Approve and run this smolvm command? [y/N]:
```

Only `y` or `yes` (case-insensitive) approves execution. Pressing Enter, `n`, or any other answer declines the action, does not run `smolvm`, appends a manual-decline audit event, and exits with code `2`. Approved commands run via the real `smolvm` binary; successful `pack pull` approvals also record artifact provenance. In `ENFORRA_SMOLVM_POLICY_ONLY=1` mode, the wrapper reports that approval would be required but never prompts and never runs `smolvm`.

---

## Verification & Scripts

### Run Unit Tests

Verify command parsing logic:

```bash
npm test
```

### Run Smoke Test

Run the full local simulation of allowed, approval-required, and blocked scenarios:

```bash
npm run smoke
```

### Policy-Only Dry Run

Check policy decisions without running the real `smolvm` binary:

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

- **Policy Path**: Customizable via `ENFORRA_SMOLVM_POLICY` (defaults to `policies/smolvm-agent.yaml`).
- **Audit Path**: Customizable via `ENFORRA_SMOLVM_AUDIT` (defaults to `.enforra/audit.jsonl`).
- **Artifact Provenance**: Tracked in `.enforra/smolvm-artifacts.json` mapping absolute paths of local artifacts to their original registry reference.

## Future Scope

- This wrapper operates at the command invocation level (does not replace `smolvm` globally unless linked).
- A future native integration could involve hooking into the `smolvm` CLI natively via a policy hook system.