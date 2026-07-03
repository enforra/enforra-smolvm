#!/usr/bin/env node

import { createEnforraClient } from "@enforra/sdk-node";
import { spawn } from "node:child_process";
import { parseSmolvmArgs } from "./command.js";
import { getArtifact, recordArtifact } from "./artifact-store.js";

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

  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
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

  // Create Enforra client
  let enforra;
  try {
    enforra = await createEnforraClient({
      policyPath: process.env.ENFORRA_SMOLVM_POLICY || "./policies/smolvm-agent.yaml",
      auditPath: process.env.ENFORRA_SMOLVM_AUDIT || ".enforra/audit.jsonl"
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

        return new Promise((resolve) => {
          const child = spawn("smolvm", argv, { stdio: "inherit" });
          child.on("close", (code) => {
            const finalCode = code ?? 0;
            if (finalCode === 0 && parsed.tool === "smolvm.pack.pull" && parsed.artifactOutput && parsed.args.reference) {
              try {
                recordArtifact(parsed.artifactOutput, { sourceReference: parsed.args.reference });
              } catch (err) {
                console.error("Error recording artifact provenance:", err.message);
              }
            }
            resolve({ exitCode: finalCode });
          });
          child.on("error", (err) => {
            console.error("Failed to start smolvm process:", err.message);
            resolve({ exitCode: 1 });
          });
        });
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
      } else {
        console.error("Error: Approval required for this action.");
        if (result.reason) {
          console.error(`Reason: ${result.reason}`);
        }
      }
      process.exit(2);
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
