import { createEnforraClient } from "@enforra/sdk-node";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCommand } from "./command-classifier.js";
import { executeReal } from "./real-commands.js";
import { promptForApproval } from "./approval.js";
import { writeManualAuditEvent } from "./audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POLICY_PATH = process.env.ENFORRA_POLICY || path.join(__dirname, "..", "policy.yaml");
const AUDIT_PATH = process.env.ENFORRA_AUDIT || path.join(__dirname, "..", "audit.jsonl");

function printHelp() {
  console.log(`Enforra Protected Node Runtime

Usage:
  <command> [args...]

  Inside the enforra-node smolmachine, common commands (node, npm, sh,
  env, curl, etc.) are wrapped so they route through Enforra policy
  before execution. Users run normal commands — wrappers handle the rest.

Usage (explicit mode — advanced/debug):
  enforra-run --tool <tool> --risk <risk> -- <command> [args...]

Examples:
  node -e "console.log('hello')"
  npm install lodash
  sh -lc "rm -rf /workspace"
  env
`);
}

export async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h"))) {
    printHelp();
    process.exit(0);
  }

  let tool = null;
  let risk = null;
  let classificationArgs = {};
  let targetCommand = null;
  let targetArgs = [];
  let targetArgv = [];

  const commandIndex = argv.indexOf("--");
  const hasExplicitFlags = argv.includes("--tool") && argv.includes("--risk") && commandIndex !== -1;

  if (hasExplicitFlags) {
    for (let i = 0; i < commandIndex; i++) {
      if (argv[i] === "--tool" && i + 1 < commandIndex) {
        tool = argv[i + 1];
        i++;
      } else if (argv[i] === "--risk" && i + 1 < commandIndex) {
        risk = argv[i + 1];
        i++;
      }
    }
    if (!tool || !risk || commandIndex + 1 >= argv.length) {
      console.error("Error: Missing required arguments for explicit mode.");
      printHelp();
      process.exit(1);
    }
    targetCommand = argv[commandIndex + 1];
    targetArgs = argv.slice(commandIndex + 2);
    targetArgv = argv.slice(commandIndex + 1);
    classificationArgs = { tool, risk, command: targetArgv.join(" "), argv: targetArgv };
  } else {
    // Inferred mode: argv IS the command
    targetCommand = argv[0];
    targetArgs = argv.slice(1);
    targetArgv = argv;

    const classified = classifyCommand(targetArgv);
    tool = classified.tool;
    risk = classified.risk;
    classificationArgs = classified;
  }

  const commandString = targetArgv.join(" ");

  const args = {
    ...classificationArgs,
    tool,
    risk,
    command: commandString,
    argv: targetArgv
  };

  let enforra;
  try {
    enforra = await createEnforraClient({
      policyPath: POLICY_PATH,
      auditPath: AUDIT_PATH
    });
  } catch (error) {
    console.error("Error creating Enforra client:", error.message);
    process.exit(1);
  }

  try {
    const result = await enforra.enforceToolCall({
      agent: "enforra-node",
      tool,
      args,
      context: {
        environment: "production",
        runtime: "enforra-node-smolmachine"
      },
      execute: async () => {
        const exitCode = await executeReal(targetCommand, targetArgs);
        return { exitCode };
      }
    });

    if (result.decision === "allow") {
      const exitCode = result.data?.exitCode ?? 0;
      process.exit(exitCode);
    }

    if (result.decision === "block") {
      console.error(`Action blocked: ${tool}`);
      if (result.reason) {
        console.error(`Reason: ${result.reason}`);
      }
      process.exit(3);
    }

    if (result.decision === "require_approval") {
      console.log(`Approval required for command: ${commandString}`);
      const approved = await promptForApproval();
      if (!approved) {
        console.log(`Command declined: ${commandString}`);
        writeManualAuditEvent({
          tool,
          args,
          approved: false,
          executed: false,
          exitCode: 2
        }, AUDIT_PATH);
        process.exit(2);
      }

      console.log(`Command approved: ${commandString}`);
      const exitCode = await executeReal(targetCommand, targetArgs);
      writeManualAuditEvent({
        tool,
        args,
        approved: true,
        executed: true,
        exitCode
      }, AUDIT_PATH);
      process.exit(exitCode);
    }

    console.error("Unknown decision:", result.decision);
    process.exit(1);

  } catch (error) {
    console.error("Error enforcing tool call:", error.message);
    process.exit(1);
  }
}
