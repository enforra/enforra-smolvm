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

// ── Real command resolution map ────────────────────────────────────────
//
// Inside the VM, common binaries at /usr/local/bin are replaced with
// thin shell wrappers that call:
//   /usr/local/bin/node-real /app/enforra-run.js <commandName> "$@"
//
// After policy evaluation, enforra-run.js must invoke the REAL binary
// (not the wrapper) to avoid recursion. This map provides the real
// binary paths.
//
// For npm/npx, the real execution requires node-real to run the
// npm-cli.js / npx-cli.js scripts directly, since the original
// /usr/local/bin/npm shell script has been replaced by the wrapper.

export const REAL_COMMANDS = {
  // Node.js runtime (moved to node-real during image build)
  node:      { bin: "/usr/local/bin/node-real", prependArgs: [] },
  nodejs:    { bin: "/usr/local/bin/node-real", prependArgs: [] },

  // npm/npx: run via node-real invoking the CLI script directly
  npm:       { bin: "/usr/local/bin/node-real", prependArgs: ["/usr/local/lib/node_modules/npm/bin/npm-cli.js"] },
  npx:       { bin: "/usr/local/bin/node-real", prependArgs: ["/usr/local/lib/node_modules/npm/bin/npx-cli.js"] },

  // Shells (real binaries at /bin, not our /usr/local/bin wrappers)
  sh:        { bin: "/bin/sh",   prependArgs: [] },
  bash:      { bin: "/bin/bash", prependArgs: [] },
  zsh:       { bin: "/usr/bin/zsh", prependArgs: [] },

  // System info / secrets
  env:       { bin: "/usr/bin/env",      prependArgs: [] },
  printenv:  { bin: "/usr/bin/printenv", prependArgs: [] },

  // File operations
  cat:       { bin: "/usr/bin/cat",   prependArgs: [] },
  rm:        { bin: "/usr/bin/rm",    prependArgs: [] },
  chmod:     { bin: "/usr/bin/chmod", prependArgs: [] },
  chown:     { bin: "/usr/bin/chown", prependArgs: [] },

  // Network tools
  curl:      { bin: "/usr/bin/curl",    prependArgs: [] },
  wget:      { bin: "/usr/bin/wget",    prependArgs: [] },
  scp:       { bin: "/usr/bin/scp",     prependArgs: [] },
  rsync:     { bin: "/usr/bin/rsync",   prependArgs: [] },
  nc:        { bin: "/usr/bin/nc",      prependArgs: [] },
  netcat:    { bin: "/usr/bin/netcat",  prependArgs: [] },
  ncat:      { bin: "/usr/bin/ncat",    prependArgs: [] },

  // Privilege
  sudo:      { bin: "/usr/bin/sudo", prependArgs: [] },
  su:        { bin: "/usr/bin/su",   prependArgs: [] },

  // Source control
  git:       { bin: "/usr/bin/git", prependArgs: [] },

  // Cloud / infra
  aws:       { bin: "/usr/bin/aws",       prependArgs: [] },
  gcloud:    { bin: "/usr/bin/gcloud",    prependArgs: [] },
  az:        { bin: "/usr/bin/az",        prependArgs: [] },
  kubectl:   { bin: "/usr/bin/kubectl",   prependArgs: [] },
  docker:    { bin: "/usr/bin/docker",    prependArgs: [] },
  ssh:       { bin: "/usr/bin/ssh",       prependArgs: [] },
  terraform: { bin: "/usr/bin/terraform", prependArgs: [] },
  helm:      { bin: "/usr/bin/helm",      prependArgs: [] },
};

/**
 * Resolve a command name to its real binary path and arguments.
 * This prevents wrapper recursion by using absolute paths that
 * bypass the /usr/local/bin wrappers.
 */
export function resolveRealCommand(command, args) {
  const mapping = REAL_COMMANDS[command];
  if (mapping) {
    return {
      bin: mapping.bin,
      args: [...mapping.prependArgs, ...args]
    };
  }
  // Unwrapped command: use as-is (may fail with ENOENT if not installed)
  return { bin: command, args };
}

// ── Enterprise command classifier ──────────────────────────────────────

const SENSITIVE_PATH_PATTERNS = [
  "/etc/passwd", "/etc/shadow", "/root",
  "~/.ssh", ".ssh", "id_rsa", "id_ed25519",
  ".env", ".npmrc", ".pypirc",
  "credentials", "token", "secret", "kubeconfig",
  "~/.aws", "~/.azure", "~/.config/gcloud"
];

const DESTRUCTIVE_PATTERNS = [
  "rm -rf", "rm -fr", "rmdir", "dd if=", "mkfs", "truncate"
];

const EXFILTRATION_COMMANDS = ["nc", "netcat", "ncat", "scp", "rsync"];
const EXFILTRATION_CURL_PATTERNS = ["curl -X POST", "curl -T", "curl --upload-file"];

const INFRA_COMMANDS = ["aws", "gcloud", "az", "kubectl", "docker", "ssh", "terraform", "helm"];

const PRIVILEGE_PATTERNS = ["sudo", "su", "chmod 777", "chown"];

export function classifyCommand(argv) {
  const executable = argv[0] || "";
  const subcommand = argv[1] || "";
  const commandString = argv.join(" ");

  // Base result
  const result = {
    executable,
    subcommand,
    command: commandString,
    argv,
    tool: "command.exec",
    category: "unknown",
    risk: "medium",
    destructiveOperation: false,
    touchesSensitivePath: false,
    readsSecrets: false,
    writesSecrets: false,
    packageInstall: false,
    packageMutation: false,
    networkDownload: false,
    downloadAndExecute: false,
    dataExfiltration: false,
    cloudOrInfraAccess: false,
    cloudCredentialAccess: false,
    privilegeEscalation: false,
    workspaceWrite: false,
    unknownCommand: false
  };

  // ── Global pattern checks (apply to any command) ──

  // Sensitive paths
  for (const pat of SENSITIVE_PATH_PATTERNS) {
    if (commandString.includes(pat)) {
      result.touchesSensitivePath = true;
      result.risk = "high";
    }
  }

  // Secret/env reading
  if (
    (executable === "env" || executable === "printenv") ||
    (commandString.includes("cat") && SENSITIVE_PATH_PATTERNS.some(p => commandString.includes(p))) ||
    (commandString.match(/\benv\b/) && (executable === "sh" || executable === "bash"))
  ) {
    result.readsSecrets = true;
    result.risk = "high";
  }

  // Destructive patterns
  for (const pat of DESTRUCTIVE_PATTERNS) {
    if (commandString.includes(pat)) {
      result.destructiveOperation = true;
      result.risk = "high";
    }
  }

  // Download and execute
  if (
    /curl\s+.*\|\s*(sh|bash)/.test(commandString) ||
    /wget\s+.*\|\s*(sh|bash)/.test(commandString)
  ) {
    result.downloadAndExecute = true;
    result.networkDownload = true;
    result.risk = "high";
  }

  // Pipe to shell (broader)
  if (/\|\s*(sh|bash)\b/.test(commandString)) {
    result.downloadAndExecute = true;
    result.risk = "high";
  }

  // Data exfiltration via curl
  for (const pat of EXFILTRATION_CURL_PATTERNS) {
    if (commandString.includes(pat)) {
      result.dataExfiltration = true;
      result.risk = "high";
    }
  }

  // Privilege escalation
  for (const pat of PRIVILEGE_PATTERNS) {
    if (commandString.includes(pat)) {
      result.privilegeEscalation = true;
      result.risk = "high";
    }
  }

  // ── Per-executable classification ──

  // Node
  if (executable === "node" || executable === "nodejs") {
    result.tool = "node.exec";
    result.category = "code_execution";
    if (result.risk !== "high") result.risk = "low";
    return result;
  }

  // npm
  if (executable === "npm" || executable === "npx") {
    const installSubs = ["install", "i", "add", "ci"];
    if (installSubs.includes(subcommand)) {
      result.tool = "npm.install";
      result.category = "package_install";
      result.packageInstall = true;
      result.packageMutation = true;
      result.networkDownload = true;
      if (result.risk !== "high") result.risk = "medium";
    } else if (["uninstall", "remove", "rm", "prune"].includes(subcommand)) {
      result.tool = "npm.install";
      result.category = "package_install";
      result.packageMutation = true;
      if (result.risk !== "high") result.risk = "medium";
    } else {
      result.tool = "npm.exec";
      result.category = "package_metadata";
      if (result.risk !== "high") result.risk = "low";
    }
    return result;
  }

  // Shell
  if (executable === "sh" || executable === "bash" || executable === "zsh") {
    result.tool = "shell.exec";

    // Check inner command for env/secret dumping
    const innerCommand = commandString;
    if (/\benv\b/.test(innerCommand) || /\bprintenv\b/.test(innerCommand)) {
      result.readsSecrets = true;
      result.category = "secret_access";
      result.risk = "high";
    }

    if (result.destructiveOperation) {
      result.category = "destructive_operation";
    } else if (result.downloadAndExecute) {
      result.category = "download_and_execute";
    } else if (result.touchesSensitivePath || result.readsSecrets) {
      result.category = "secret_access";
    } else if (result.dataExfiltration) {
      result.category = "data_exfiltration";
    } else {
      result.category = "shell_command";
      if (result.risk !== "high") result.risk = "medium";
    }
    return result;
  }

  // rm (direct, not via shell wrapper)
  if (executable === "rm") {
    result.tool = "file.delete";
    if (result.destructiveOperation) {
      result.category = "destructive_operation";
    } else {
      result.category = "file_access";
      if (result.risk !== "high") result.risk = "medium";
    }
    return result;
  }

  // Data exfiltration commands
  if (EXFILTRATION_COMMANDS.includes(executable)) {
    result.tool = "network.exec";
    result.category = "data_exfiltration";
    result.dataExfiltration = true;
    result.risk = "high";
    return result;
  }

  // Network download tools
  if (executable === "curl" || executable === "wget") {
    result.tool = "network.exec";
    result.category = "network_download";
    result.networkDownload = true;
    if (result.risk !== "high") result.risk = "medium";
    return result;
  }

  // Cloud / infra tools
  if (INFRA_COMMANDS.includes(executable)) {
    result.tool = "infra.exec";
    result.category = "infrastructure_access";
    result.cloudOrInfraAccess = true;
    // Check for credential access
    if (
      commandString.includes("credentials") ||
      commandString.includes("token") ||
      commandString.includes("secret") ||
      commandString.includes("iam") ||
      commandString.includes("auth")
    ) {
      result.cloudCredentialAccess = true;
    }
    result.risk = "high";
    return result;
  }

  // Privilege escalation commands
  if (executable === "sudo" || executable === "su") {
    result.tool = "system.exec";
    result.category = "privilege_change";
    result.privilegeEscalation = true;
    result.risk = "high";
    return result;
  }

  // chmod / chown
  if (executable === "chmod" || executable === "chown") {
    result.tool = "system.exec";
    result.category = "privilege_change";
    result.privilegeEscalation = true;
    result.risk = "high";
    return result;
  }

  // Git
  if (executable === "git") {
    result.tool = "git.exec";
    result.category = "source_control";
    if (["clone", "pull", "fetch"].includes(subcommand)) {
      result.networkDownload = true;
    }
    if (["push"].includes(subcommand)) {
      result.dataExfiltration = true;
    }
    if (result.risk !== "high") result.risk = "medium";
    return result;
  }

  // env / printenv as bare commands
  if (executable === "env" || executable === "printenv") {
    result.tool = "secrets.read";
    result.category = "secret_access";
    result.readsSecrets = true;
    result.risk = "high";
    return result;
  }

  // cat / less / head / tail — check for sensitive file targets
  if (["cat", "less", "head", "tail", "more"].includes(executable)) {
    if (result.touchesSensitivePath) {
      result.tool = "secrets.read";
      result.category = "secret_access";
      result.readsSecrets = true;
    } else {
      result.tool = "file.read";
      result.category = "file_access";
      if (result.risk !== "high") result.risk = "low";
    }
    return result;
  }

  // Unknown
  result.tool = "command.exec";
  result.category = "unknown";
  result.unknownCommand = true;
  if (result.risk !== "high") result.risk = "medium";
  return result;
}

// Legacy compat: inferToolAndRisk returns {tool, risk} subset
export function inferToolAndRisk(argv) {
  const c = classifyCommand(argv);
  return { tool: c.tool, risk: c.risk };
}

// ── Core runtime ───────────────────────────────────────────────────────

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

function runChildCommand(command, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { stdio: "inherit" });
    child.on("close", (code) => {
      resolve(code ?? 0);
    });
    child.on("error", (err) => {
      console.error(`Failed to start command: ${err.message}`);
      resolve(1);
    });
  });
}

/**
 * Execute a command using the real binary path, bypassing wrappers.
 * This resolves command names to their actual binary locations so
 * execution does not recurse back through the Enforra wrappers.
 */
function executeReal(targetCommand, targetArgs) {
  const resolved = resolveRealCommand(targetCommand, targetArgs);
  return runChildCommand(resolved.bin, resolved.args);
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
        });
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

let isMain = false;
if (process.argv[1]) {
  try {
    const realArgv1 = fs.realpathSync(process.argv[1]);
    const realMetaUrl = fileURLToPath(import.meta.url);
    isMain = realArgv1 === realMetaUrl;
  } catch (e) {
    isMain = process.argv[1] === fileURLToPath(import.meta.url) ||
             path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (isMain) {
  main();
}
