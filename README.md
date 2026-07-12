# Enforra protected Node smolmachine

A portable Node smolmachine with Enforra policy, approval, audit, explain mode, and tamper-evident policy receipts built into the supported command path.

Users keep using normal `smolvm` commands. Safe commands run, risky commands can require approval, and destructive or secret-reading commands are blocked before the wrapped command executes.

> This is a targeted protected runtime for normal agent and smolvm workflows. It is not a malicious-root or arbitrary-internal-path security boundary. See [THREAT_MODEL.md](THREAT_MODEL.md).

## Quickstart

### Once published to the registry

```bash
smolvm pack pull registry.smolmachines.com/library/enforra-node:latest -o enforra-node.smolmachine

# Allowed
smolvm pack run --sidecar enforra-node.smolmachine node -e "console.log('hello')"

# Requires approval. Use -i so stdin reaches the VM.
smolvm pack run -i --sidecar enforra-node.smolmachine npm install lodash

# Blocked
smolvm pack run --sidecar enforra-node.smolmachine sh -lc "rm -rf /workspace"
smolvm pack run --sidecar enforra-node.smolmachine env
```

### Local build

```bash
npm run pack:build
smolvm pack run --sidecar packs/enforra-node/enforra-node.smolmachine node -e "console.log('hello')"
```

## Explain before execution

`enforra explain` evaluates the same classifier and policy without running the target command.

```bash
smolvm pack run --sidecar enforra-node.smolmachine \
  enforra explain -- npm install lodash
```

Example output:

```text
Decision: require_approval
Tool: npm.install
Risk: medium
Signals: package_install, package_mutation, network_download
Matched policy: approval-for-package-install
Would execute immediately: no
Policy hash: sha256:...
Classifier: @enforra/command-guard@...
Executed: no (explain mode)
```

Use `--json` for machine-readable output:

```bash
smolvm pack run --sidecar enforra-node.smolmachine \
  enforra explain --json -- sh -lc "rm -rf /workspace"
```

## Policy receipts

Every enforced decision writes a receipt containing:

- command hash, not the raw command
- policy hash
- classifier, SDK, and pack versions
- decision and matched policy
- approval and execution outcome
- previous receipt hash and current receipt hash

Receipts are stored at `/app/receipts.jsonl` by default and form a SHA-256 hash chain.

For persistent evidence, use a named machine:

```bash
smolvm machine create --name enforra-node --from enforra-node.smolmachine
smolvm machine start --name enforra-node

smolvm machine exec --name enforra-node -- node -e "console.log('hello')"
smolvm machine exec --name enforra-node -- env

smolvm machine exec --name enforra-node -- \
  enforra receipts verify /app/receipts.jsonl

smolvm machine exec --name enforra-node -- cat /app/audit.jsonl
```

The verifier checks the receipt hash chain and reports whether all receipts were produced under the currently loaded policy hash. Receipts are tamper-evident, not externally signed or remotely anchored.

## Pack identity

```bash
smolvm pack run --sidecar enforra-node.smolmachine enforra info --json
```

The pack includes `enforra-manifest.json` with supported entrypoints, default policy behavior, receipt format, and evidence paths. This is intended to support future registry verification metadata without requiring a custom host wrapper.

## Protected entrypoints

The image currently wraps these supported public command entrypoints:

```text
node, nodejs, npm, npx
sh, dash, bash
env, printenv
cat, rm
```

The policy can still classify risk signals found inside protected shell commands, such as download-and-execute patterns. The pack does not claim to wrap every binary in the VM.

## Decisions and exit codes

| Decision | Behavior | Exit code |
|---|---|---:|
| `allow` / `log_only` | executes the real command | child exit code |
| `require_approval`, declined | does not execute | `2` |
| `block` | does not execute | `3` |
| receipt write failure after an allowed execution | reports evidence failure | `70` |

## Development and verification

```bash
npm ci
npm test
npm run pack:build
npm run verify:pack
```

`npm run verify:pack` exercises ephemeral and persistent user flows, allow/approval/block behavior, public absolute paths, explain mode, and receipt verification.

A real networked package install is optional because smolvm network flags can differ by environment:

```bash
VERIFY_REAL_INSTALL=1 \
SMOLVM_RUN_EXTRA_ARGS="<your smolvm network flags>" \
npm run verify:pack
```

## Configuration

| Variable | Default |
|---|---|
| `ENFORRA_POLICY` | `/app/policy.yaml` |
| `ENFORRA_AUDIT` | `/app/audit.jsonl` |
| `ENFORRA_RECEIPTS` | `/app/receipts.jsonl` |
| `ENFORRA_AGENT_ID` | `enforra-node` |
| `ENFORRA_RUNTIME_ID` | `enforra-node-smolmachine` |

Teams can edit `packs/enforra-node/policy.yaml` and rebuild the smolmachine with their own controls.
