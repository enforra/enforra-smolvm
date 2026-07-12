# Threat model

## Goal

The Enforra Node smolmachine provides deterministic policy checks before commands executed through its supported public entrypoints. It is designed for controlled AI-agent and automation workloads where the agent uses normal `node`, `npm`, shell, environment, and file commands.

## Protected behavior

The pack is intended to:

- classify proposed commands before execution
- allow, log, require approval, or block according to local policy
- fail closed for unmatched commands under the bundled policy
- prevent public absolute-path bypasses for supported binaries such as `/usr/bin/env`, `/usr/bin/rm`, and `/bin/sh`
- record local audit events
- produce tamper-evident policy receipts containing command and policy hashes, runtime versions, decisions, and execution outcomes
- preview decisions through `enforra explain` without executing the target command

## Supported public entrypoints

The image currently wraps:

```text
node, nodejs, npm, npx
sh, dash, bash
env, printenv
cat, rm
```

Only these public entrypoints and risk signals reached through them are part of the protection claim.

## Out of scope

This pack does not claim to defend against:

- a malicious root user or VM administrator
- direct execution of internal implementation paths under `/opt/enforra/real`
- kernel, hypervisor, container, or smolvm isolation vulnerabilities
- arbitrary binaries that are not wrapped by this image
- all possible obfuscations or dynamically generated code
- code that is already allowed and then uses language/runtime APIs that the command classifier cannot observe
- replacement or modification of the policy, runtime, wrappers, audit log, or receipt implementation by an actor with write access to the image or persistent machine
- data exposure through external systems outside this VM

The VM sandbox remains the isolation boundary. Enforra supplies policy enforcement on the supported command path; it is not a replacement for the sandbox.

## Receipt guarantees

Policy receipts use a SHA-256 hash chain. This detects accidental corruption and edits that do not recompute the chain. Each receipt also captures the policy hash, command hash, matched policy, classifier version, SDK version, pack version, approval result, and execution outcome.

Receipts are not digitally signed and are not anchored to an external trusted service. An actor with full write access can replace the file and recompute an entirely new chain. Treat them as local tamper-evident evidence, not remote attestation.

## Secret handling

Receipts store a hash of the command rather than the raw command. The policy input sent to the audit layer omits the raw command and argv, while retaining structured risk signals and a command hash.

The classifier detects common secret-read signals, but it is not a JavaScript sandbox or complete information-flow system. Policies should remain conservative, and sensitive credentials should not be injected into workloads that do not need them.

## Failure behavior

- policy initialization failure: command does not run
- block: command does not run, exit code `3`
- declined approval: command does not run, exit code `2`
- receipt failure after an allowed command has completed: evidence failure is reported with exit code `70`

Because an allowed command is executed by the SDK before its outcome receipt is appended, a receipt write failure can occur after execution. The audit decision is still written by the SDK before allowed execution. Future externally anchored receipts may tighten this guarantee.

## Reporting

Please report suspected bypasses privately to the Enforra maintainers before public disclosure when practical. Include the exact command, smolvm version, pack version, platform, expected result, and observed result.
