# Enforra protected Node smolmachine

Node.js runtime with Enforra policy, approval, audit, explain mode, and tamper-evident policy receipts inside the guest VM.

Users run normal `smolvm` commands. The pack protects a defined set of public Node and shell-related entrypoints before execution.

> Scope: supported public command entrypoints used by normal agent workflows. This is not a universal Linux security runtime or a malicious-root boundary. See the repository `THREAT_MODEL.md`.

## Quickstart

```bash
smolvm pack pull registry.smolmachines.com/library/enforra-node:latest -o enforra-node.smolmachine

# Allowed
smolvm pack run --sidecar enforra-node.smolmachine node -e "console.log('hello')"

# Requires approval
smolvm pack run -i --sidecar enforra-node.smolmachine npm install lodash

# Blocked
smolvm pack run --sidecar enforra-node.smolmachine sh -lc "rm -rf /workspace"
smolvm pack run --sidecar enforra-node.smolmachine env
```

## Explain mode

```bash
smolvm pack run --sidecar enforra-node.smolmachine \
  enforra explain -- npm install lodash

smolvm pack run --sidecar enforra-node.smolmachine \
  enforra explain --json -- env
```

Explain mode returns the classification, risk, decision, matched policy, policy hash, and runtime versions without executing the target command.

## Policy receipts

Each real decision writes a receipt to `/app/receipts.jsonl`. Receipts include command and policy hashes, versions, decision evidence, approval outcome, execution result, and a previous-receipt hash.

```bash
smolvm machine create --name enforra-node --from enforra-node.smolmachine
smolvm machine start --name enforra-node
smolvm machine exec --name enforra-node -- node -e "console.log('hello')"
smolvm machine exec --name enforra-node -- enforra receipts verify /app/receipts.jsonl
```

The hash chain is tamper-evident. It is not externally signed or remotely anchored.

## Protected public entrypoints

```text
node, nodejs, npm, npx
sh, dash, bash
env, printenv
cat, rm
```

Real binaries are moved to `/opt/enforra/real` during image construction so the supported public relative and absolute paths route through Enforra. Those internal paths are implementation details and are not claimed as a boundary against a user with arbitrary execution or root-level access.

## Local build

```bash
docker build -t enforra-node:latest packs/enforra-node

docker run -d -p 5001:5000 --name local-registry registry:2
docker tag enforra-node:latest localhost:5001/enforra-node:latest
docker push localhost:5001/enforra-node:latest

REGISTRY_HOST=192.168.64.1 REGISTRY_PORT=5001 npm run pack:build
```

## Evidence paths

| Evidence | Default path |
|---|---|
| Policy | `/app/policy.yaml` |
| Audit log | `/app/audit.jsonl` |
| Policy receipts | `/app/receipts.jsonl` |
| Pack manifest | `/app/enforra-manifest.json` |

Use the protected `cat` entrypoint to inspect the audit log:

```bash
smolvm machine exec --name enforra-node -- cat /app/audit.jsonl
```
