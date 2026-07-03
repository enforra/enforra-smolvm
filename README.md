# enforra-smolvm

Policy, approval, and audit for agent-driven smolvm registry workloads.

`enforra-smolvm` shows how Enforra can gate real smolvm registry actions before they execute.

It controls:

- registry inspect
- registry pull
- running a pulled `.smolmachine`
- rehydrating a pulled `.smolmachine` with `machine run --from`
- approval for unknown registry artifacts
- blocking destructive commands
- local audit logging

## Why

smolvm gives agents isolated execution with portable `.smolmachine` artifacts.

Enforra adds the control layer around how agents use those artifacts:

- Which registry artifacts can be inspected or pulled?
- Which pulled machines can be run automatically?
- Which actions need approval?
- Which commands should be blocked?
- What audit trail is recorded?

## Flow

This integration gates the public smolvm registry flow:

```bash
smolvm pack inspect --json registry.smolmachines.com/library/codex:arm64
smolvm pack pull registry.smolmachines.com/library/codex:arm64 -o ./codex-registry.smolmachine
smolvm pack run --sidecar ./codex-registry.smolmachine node -e "..."
smolvm machine run --from ./codex-registry.smolmachine node -e "..."
