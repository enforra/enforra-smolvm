import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEnforraClient } from "@enforra/sdk-node";
import { classifyCommand } from "./command-classifier.js";
import { executeReal } from "./real-commands.js";
import { promptForApproval } from "./approval.js";
import { writeManualAuditEvent } from "./audit.js";
import {
  appendPolicyReceipt,
  hashCommand,
  hashFile,
  loadRuntimeIdentity,
  verifyPolicyReceipts
} from "./receipts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACK_ROOT = path.join(__dirname, "..");

const POLICY_PATH = process.env.ENFORRA_POLICY || path.join(PACK_ROOT, "policy.yaml");
const AUDIT_PATH = process.env.ENFORRA_AUDIT || path.join(PACK_ROOT, "audit.jsonl");
const RECEIPT_PATH = process.env.ENFORRA_RECEIPTS || path.join(PACK_ROOT, "receipts.jsonl");
const MANIFEST_PATH = path.join(PACK_ROOT, "enforra-manifest.json");

const AGENT_ID = process.env.ENFORRA_AGENT_ID || "enforra-node";
const RUNTIME_ID = process.env.ENFORRA_RUNTIME_ID || "enforra-node-smolmachine";

function printHelp() {
  console.log(`Enforra Protected Node Runtime

Usage:
  <command> [args...]
  enforra explain [--json] -- <command> [args...]
  enforra receipts verify [--json] [receipt-path]
  enforra info [--json]

Protected public entrypoints:
  node, nodejs, npm, npx, sh, dash, bash, env, printenv, cat, rm

Examples:
  node -e "console.log('hello')"
  npm install lodash
  sh -lc "rm -rf /workspace"
  enforra explain -- npm install lodash
  enforra receipts verify /app/receipts.jsonl

This pack protects the supported public command entrypoints used by normal
smolvm and agent workflows. It is not a malicious-root or arbitrary
internal-path security boundary.
`);
}

function classificationFor(targetArgv) {
  const classified = classifyCommand(targetArgv);
  return {
    classified,
    tool: classified.tool,
    risk: classified.risk,
    commandHash: hashCommand(targetArgv)
  };
}

function enforcementInput(targetArgv, execute) {
  const { classified, tool, risk, commandHash } = classificationFor(targetArgv);
  const { command: _command, argv: _argv, ...safeClassification } = classified;

  return {
    classified,
    commandHash,
    input: {
      agent: AGENT_ID,
      tool,
      args: {
        ...safeClassification,
        tool,
        risk,
        commandHash,
        argumentCount: targetArgv.length
      },
      context: {
        environment: "production",
        runtime: RUNTIME_ID,
        pack: "enforra-node"
      },
      execute
    }
  };
}

async function createRuntimeClient(auditPath = AUDIT_PATH) {
  return createEnforraClient({
    policyPath: POLICY_PATH,
    auditPath
  });
}

async function evaluateWithoutExecution(targetArgv) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "enforra-explain-"));
  const tempAuditPath = path.join(tempDirectory, "audit.jsonl");

  try {
    const enforra = await createRuntimeClient(tempAuditPath);
    const prepared = enforcementInput(targetArgv, async () => ({ preview: true }));
    const result = await enforra.enforceToolCall(prepared.input);
    return { ...prepared, result };
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function parseExplainArguments(argv) {
  const args = [...argv];
  const jsonIndex = args.indexOf("--json");
  const json = jsonIndex !== -1;
  if (json) {
    args.splice(jsonIndex, 1);
  }

  const separatorIndex = args.indexOf("--");
  if (separatorIndex === -1 || separatorIndex === args.length - 1) {
    throw new Error("Usage: enforra explain [--json] -- <command> [args...]");
  }

  return {
    json,
    targetArgv: args.slice(separatorIndex + 1)
  };
}

function printExplainText(explanation) {
  console.log(`Decision: ${explanation.decision}`);
  console.log(`Tool: ${explanation.tool}`);
  console.log(`Risk: ${explanation.risk}`);
  console.log(`Signals: ${explanation.signals.length > 0 ? explanation.signals.join(", ") : "none"}`);
  console.log(`Matched policy: ${explanation.matchedPolicyId || "default"}`);
  console.log(`Reason: ${explanation.reason || "none"}`);
  console.log(`Would execute immediately: ${explanation.wouldExecuteImmediately ? "yes" : "no"}`);
  console.log(`Policy hash: ${explanation.policyHash}`);
  console.log(`Classifier: @enforra/command-guard@${explanation.classifierVersion}`);
  console.log(`Pack: enforra-node@${explanation.packVersion}`);
  console.log("Executed: no (explain mode)");
}

async function runExplain(argv) {
  const { json, targetArgv } = parseExplainArguments(argv);
  const { classified, result, commandHash } = await evaluateWithoutExecution(targetArgv);
  const identity = loadRuntimeIdentity(PACK_ROOT);

  const explanation = {
    commandHash,
    decision: result.decision,
    tool: classified.tool,
    risk: classified.risk,
    signals: classified.signals || [],
    matchedPolicyId: result.matchedPolicyId || null,
    reason: result.reason || null,
    wouldExecuteImmediately: result.decision === "allow" || result.decision === "log_only",
    policyHash: hashFile(POLICY_PATH),
    classifierVersion: identity.classifierVersion,
    sdkVersion: identity.sdkVersion,
    packVersion: identity.packVersion,
    executed: false
  };

  if (json) {
    console.log(JSON.stringify(explanation, null, 2));
  } else {
    printExplainText(explanation);
  }
}

function parseReceiptsArguments(argv) {
  const args = [...argv];
  const jsonIndex = args.indexOf("--json");
  const json = jsonIndex !== -1;
  if (json) {
    args.splice(jsonIndex, 1);
  }

  if (args[0] !== "verify") {
    throw new Error("Usage: enforra receipts verify [--json] [receipt-path]");
  }

  return {
    json,
    receiptPath: args[1] || RECEIPT_PATH
  };
}

function printReceiptVerification(result, receiptPath) {
  if (!result.valid) {
    console.error(`Receipt verification failed: ${result.reason}`);
    if (result.firstInvalidLine) {
      console.error(`First invalid line: ${result.firstInvalidLine}`);
    }
    return;
  }

  console.log(`${result.receiptsChecked} receipts verified`);
  console.log("Receipt chain: valid");
  console.log(`Receipt head: ${result.receiptHead || "none"}`);
  console.log(`Current policy hash: ${result.currentPolicyHash || "unavailable"}`);
  console.log(
    `All receipts match current policy: ${result.allReceiptsMatchCurrentPolicy ? "yes" : "no"}`
  );
  console.log(`File: ${receiptPath}`);
}

function runReceipts(argv) {
  const { json, receiptPath } = parseReceiptsArguments(argv);
  const result = verifyPolicyReceipts(receiptPath, POLICY_PATH);

  if (json) {
    console.log(JSON.stringify({ receiptPath, ...result }, null, 2));
  } else {
    printReceiptVerification(result, receiptPath);
  }

  if (!result.valid) {
    process.exit(4);
  }
}

function runInfo(argv) {
  const json = argv.includes("--json");
  const manifest = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
    : { name: "enforra-node", version: loadRuntimeIdentity(PACK_ROOT).packVersion };

  const info = {
    ...manifest,
    policyHash: hashFile(POLICY_PATH),
    runtimeIdentity: loadRuntimeIdentity(PACK_ROOT)
  };

  if (json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  console.log(`Pack: ${info.name}@${info.version}`);
  console.log(`Protection mode: ${info.protection?.mode || "supported-entrypoints"}`);
  console.log(`Policy hash: ${info.policyHash}`);
  console.log(`Receipt format: ${info.protection?.policyReceipts?.format || "jsonl"}`);
}

async function writeReceipt({ classified, commandHash, result, approved, executed, exitCode }) {
  const identity = loadRuntimeIdentity(PACK_ROOT);

  return appendPolicyReceipt(RECEIPT_PATH, {
    agent: AGENT_ID,
    runtime: RUNTIME_ID,
    commandHash,
    policyHash: hashFile(POLICY_PATH),
    classifierVersion: identity.classifierVersion,
    sdkVersion: identity.sdkVersion,
    packVersion: identity.packVersion,
    tool: classified.tool,
    risk: classified.risk,
    signals: classified.signals || [],
    decision: result.decision,
    matchedPolicyId: result.matchedPolicyId,
    reason: result.reason,
    approved,
    executed,
    exitCode
  });
}

async function writeReceiptOrReport(receipt) {
  try {
    await writeReceipt(receipt);
    return true;
  } catch (error) {
    console.error(`Failed to write policy receipt: ${error.message}`);
    return false;
  }
}

async function runProtectedCommand(targetArgv) {
  const targetCommand = targetArgv[0];
  const targetArgs = targetArgv.slice(1);
  const commandString = targetArgv.join(" ");
  const prepared = enforcementInput(targetArgv, async () => {
    const exitCode = await executeReal(targetCommand, targetArgs);
    return { exitCode };
  });

  let enforra;
  try {
    enforra = await createRuntimeClient();
  } catch (error) {
    console.error("Error creating Enforra client:", error.message);
    process.exit(1);
  }

  try {
    const result = await enforra.enforceToolCall(prepared.input);

    if (result.decision === "allow" || result.decision === "log_only") {
      const exitCode = result.data?.exitCode ?? (result.executed ? 0 : 1);
      const receiptWritten = await writeReceiptOrReport({
        ...prepared,
        result,
        approved: null,
        executed: result.executed,
        exitCode
      });
      process.exit(receiptWritten ? exitCode : 70);
    }

    if (result.decision === "block") {
      await writeReceiptOrReport({
        ...prepared,
        result,
        approved: null,
        executed: false,
        exitCode: 3
      });
      console.error(`Action blocked: ${prepared.classified.tool}`);
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
        writeManualAuditEvent(
          {
            agent: AGENT_ID,
            tool: prepared.classified.tool,
            args: prepared.input.args,
            approved: false,
            executed: false,
            exitCode: 2
          },
          AUDIT_PATH
        );
        await writeReceiptOrReport({
          ...prepared,
          result,
          approved: false,
          executed: false,
          exitCode: 2
        });
        process.exit(2);
      }

      console.log(`Command approved: ${commandString}`);
      const exitCode = await executeReal(targetCommand, targetArgs);
      writeManualAuditEvent(
        {
          agent: AGENT_ID,
          tool: prepared.classified.tool,
          args: prepared.input.args,
          approved: true,
          executed: true,
          exitCode
        },
        AUDIT_PATH
      );
      const receiptWritten = await writeReceiptOrReport({
        ...prepared,
        result,
        approved: true,
        executed: true,
        exitCode
      });
      process.exit(receiptWritten ? exitCode : 70);
    }

    console.error("Unknown decision:", result.decision);
    process.exit(1);
  } catch (error) {
    console.error("Error enforcing tool call:", error.message);
    process.exit(1);
  }
}

export async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h"))) {
    printHelp();
    return;
  }

  try {
    if (argv[0] === "explain") {
      await runExplain(argv.slice(1));
      return;
    }

    if (argv[0] === "receipts") {
      runReceipts(argv.slice(1));
      return;
    }

    if (argv[0] === "info") {
      runInfo(argv.slice(1));
      return;
    }

    await runProtectedCommand(argv);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
