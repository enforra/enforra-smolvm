#!/usr/bin/env node

import { createEnforraClient } from "@enforra/sdk-node";
import { parseSmolvmArgs } from "./command.js";
import { getArtifact } from "./artifact-store.js";
import { appendApprovalAuditEvent, promptForApproval } from "./approval.js";
import { executeSmolvmCommand } from "./smolvm-executor.js";

const isPolicyOnly = process.env.ENFORRA_SMOLVM_POLICY_ONLY === "1";

function printHelp() {
  console.log(`enforra-smolvm <smolvm args>

Examples:
  enforra-smolvm pack inspect --json registry.smolmachines.com/library/codex:arm64
  enforra-smolvm pack pull registry.smolmachines.com/library/codex:arm64 -o ./codex.smolmachine
  enforra-smolvm pack run --sidecar ./codex.smolmachine node -e "console.log(process.version)"
  enforra-smolvm machine run --from ./codex.smolmachine node -e "console.log(process.version)"

Also mention:
- policy file: policies/smolvm-agent.yaml
- audit file: .enforra/audit.jsonl
- artifact provenance file: .enforra/smolvm-artifacts.json`);
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h"))) {
    printHelp();
    process.exit(0);
  }

  const parsed = parseSmolvmArgs(argv);

  // Retrieve sourceReference if artifactInput is specified
  if (parsed.artifactInput) {
    const artifact = getArtifact(parsed.artifactInput);
    if (artifact && artifact.sourceReference) {
      parsed.args.sourceReference = artifact.sourceReference;
    }
  }

  const auditPath = process.env.ENFORRA_SMOLVM_AUDIT || ".enforra/audit.jsonl";

  // Create Enforra client
  let enforra;
  try {
    enforra = await createEnforraClient({
      policyPath: process.env.ENFORRA_SMOLVM_POLICY || "./policies/smolvm-agent.yaml",
      auditPath
    });
  } catch (error) {
    console.error("Error creating Enforra client:", error.message);
    process.exit(1);
  }

  const commandText = ["smolvm", ...argv].join(" ");

  try {
    const result = await enforra.enforceToolCall({
      agent: "infra-agent",
      tool: parsed.tool,
      args: parsed.args,
      context: {
        environment: "integration",
        runtime: "smolvm",
        actor: "agent"
      },
      execute: async () => {
        if (isPolicyOnly) {
          console.log(`[Policy Only] Would run: ${commandText}`);
          return { exitCode: 0 };
        }

        return executeSmolvmCommand(argv, parsed);
      }
    });

    if (result.decision === "block") {
      if (!parsed.supported) {
        console.error("Error: This wrapper currently supports pack inspect, pack pull, pack run, and machine run --from");
      }
      if (isPolicyOnly) {
        console.log(`[Policy Only] Would block: ${commandText}`);
      } else {
        console.error("Error: Action blocked by policy.");
        if (result.reason) {
          console.error(`Reason: ${result.reason}`);
        }
      }
      process.exit(3);
    }

    if (result.decision === "require_approval") {
      if (!parsed.supported) {
        console.error("Error: This wrapper currently supports pack inspect, pack pull, pack run, and machine run --from");
      }
      if (isPolicyOnly) {
        console.log(`[Policy Only] Would require approval: ${commandText}`);
        process.exit(2);
      }

      console.error("Approval required for this action.");
      console.error(`Action: ${commandText}`);
      if (result.reason) {
        console.error(`Reason: ${result.reason}`);
      }

      const approved = await promptForApproval();
      if (!approved) {
        appendApprovalAuditEvent({
          auditPath,
          tool: parsed.tool,
          args: parsed.args,
          commandText,
          approved: false,
          executed: false,
          exitCode: 2,
          reason: result.reason
        });
        process.exit(2);
      }

      const execution = await executeSmolvmCommand(argv, parsed);
      appendApprovalAuditEvent({
        auditPath,
        tool: parsed.tool,
        args: parsed.args,
        commandText,
        approved: true,
        executed: true,
        exitCode: execution.exitCode,
        reason: result.reason
      });
      process.exit(execution.exitCode ?? 0);
    }

    if (result.decision === "allow" || result.decision === "log_only") {
      const exitCode = result.data?.exitCode ?? 0;
      process.exit(exitCode);
    }

    console.error("Unknown policy decision:", result.decision);
    process.exit(1);

  } catch (error) {
    console.error("Error executing action:", error.message);
    process.exit(1);
  }
}

main();
