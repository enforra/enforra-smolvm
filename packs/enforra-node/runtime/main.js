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

const AGENT_ID = process.env.ENFORRA_AGENT_ID || "enforra-node";
const RUNTIME_ID = process.env.ENFORRA_RUNTIME_ID || "enforra-node-smolmachine";

function printHelp() {
  console.log(`Enforra Protected Node Runtime

Usage:
  <command> [args...]

  Inside the enforra-node smolmachine, common commands (node, npm, sh,
  env, curl, etc.) are wrapped so they route through Enforra policy
  before execution. Commands are automatically classified and gated 
  by Enforra policy internally before execution.

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

  // Always classify the actual target command internally
  const targetCommand = argv[0];
  const targetArgs = argv.slice(1);
  const targetArgv = argv;

  const classified = classifyCommand(targetArgv);
  const tool = classified.tool;
  const risk = classified.risk;
  const classificationArgs = classified;

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
      agent: AGENT_ID,
      tool,
      args,
      context: {
        environment: "production",
        runtime: RUNTIME_ID
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
          agent: AGENT_ID,
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
        agent: AGENT_ID,
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
