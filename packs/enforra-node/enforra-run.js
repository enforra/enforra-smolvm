#!/usr/bin/env node-real

import { createEnforraClient } from "@enforra/sdk-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POLICY_PATH = process.env.ENFORRA_POLICY || path.join(__dirname, "policy.yaml");
const AUDIT_PATH = process.env.ENFORRA_AUDIT || path.join(__dirname, "audit.jsonl");

function printHelp() {
  console.log(`Enforra Protected Command Runner (enforra-run)

Usage:
  enforra-run <command> [args...]
  enforra-run --tool <tool> --risk <risk> -- <command> [args...]

Examples:
  enforra-run node -e "console.log('hello')"
  enforra-run npm install lodash
  enforra-run sh -lc "rm -rf /workspace"

Options (advanced):
  --tool       The name of the tool to evaluate (e.g. node.exec, npm.install, shell.exec)
  --risk       The risk level (e.g. low, medium, high)
  --           Separator before the target command to run
`);
}

function inferToolAndRisk(argv) {
  const commandString = argv.join(" ");

  // Rule 1: Node
  if (argv[0] === "node") {
    return { tool: "node.exec", risk: "low" };
  }

  // Rule 2 & 3: npm and npx
  if (argv[0] === "npm") {
    if (argv[1] === "install" || argv[1] === "i") {
      return { tool: "npm.install", risk: "medium" };
    }
    return { tool: "npm.exec", risk: "low" };
  }

  if (argv[0] === "npx") {
    return { tool: "npm.exec", risk: "low" };
  }

  if (argv[0] === "env") {
    return { tool: "env.exec", risk: "high" };
  }

  // Dangerous patterns check
  const hasDangerousPattern =
    commandString.includes("rm -rf") ||
    commandString.includes("/etc/passwd") ||
    /curl\s+.*\|\s*(sh|bash)/.test(commandString) ||
    /wget\s+.*\|\s*(sh|bash)/.test(commandString);

  // Rule 4: sh, bash, or dangerous patterns
  if (argv[0] === "sh" || argv[0] === "bash" || hasDangerousPattern) {
    return {
      tool: "shell.exec",
      risk: hasDangerousPattern ? "high" : "medium"
    };
  }

  // Rule 5: Unknown commands
  return { tool: "command.exec", risk: "medium" };
}

async function promptForApproval() {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Approve and run this command? [y/N]: ");
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}

function resolveRealCommand(command, commandArgs) {
  if (command === "node") {
    return { command: "/usr/local/bin/node-real", args: commandArgs };
  }

  if (command === "npm") {
    return {
      command: "/usr/local/bin/node-real",
      args: ["/usr/local/lib/node_modules/npm/bin/npm-cli.js", ...commandArgs]
    };
  }

  if (command === "npx") {
    return {
      command: "/usr/local/bin/node-real",
      args: ["/usr/local/lib/node_modules/npm/bin/npx-cli.js", ...commandArgs]
    };
  }

  if (command === "sh") {
    return { command: "/bin/sh", args: commandArgs };
  }

  if (command === "bash") {
    return { command: "/bin/bash", args: commandArgs };
  }

  if (command === "env") {
    return { command: "/usr/bin/env", args: commandArgs };
  }

  return { command, args: commandArgs };
}

function runChildCommand(command, commandArgs) {
  const resolved = resolveRealCommand(command, commandArgs);

  return new Promise((resolve) => {
    const child = spawn(resolved.command, resolved.args, { stdio: "inherit" });
    child.on("close", (code) => {
      resolve(code ?? 0);
    });
    child.on("error", (err) => {
      console.error(`Failed to start command: ${err.message}`);
      resolve(1);
    });
  });
}

function writeManualAuditEvent({ tool, args, approved, executed, exitCode }) {
  const event = {
    timestamp: new Date().toISOString(),
    agent: "enforra-node",
    tool,
    args,
    decision: "require_approval",
    status: approved ? "manual_approval_executed" : "manual_approval_declined",
    manualApproval: {
      approved,
      executed,
      exitCode
    }
  };
  fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true });
  fs.appendFileSync(AUDIT_PATH, `${JSON.stringify(event)}\n`, "utf8");
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  let tool = null;
  let risk = null;
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
  } else {
    targetCommand = argv[0];
    targetArgs = argv.slice(1);
    targetArgv = argv;

    const inferred = inferToolAndRisk(targetArgv);
    tool = inferred.tool;
    risk = inferred.risk;
  }

  const commandString = targetArgv.join(" ");

  const args = {
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
        const exitCode = await runChildCommand(targetCommand, targetArgs);
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
        });
        process.exit(2);
      }

      console.log(`Command approved: ${commandString}`);
      const exitCode = await runChildCommand(targetCommand, targetArgs);
      writeManualAuditEvent({
        tool,
        args,
        approved: true,
        executed: true,
        exitCode
      });
      process.exit(exitCode);
    }

    console.error("Unknown decision:", result.decision);
    process.exit(1);

  } catch (error) {
    console.error("Error enforcing tool call:", error.message);
    process.exit(1);
  }
}

main();
