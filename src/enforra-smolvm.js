import { createEnforraClient } from "@enforra/sdk-node";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const dryRun = process.argv.includes("--dry-run");

const REGISTRY_REF = "registry.smolmachines.com/library/codex:arm64";
const REGISTRY_ARTIFACT = "./codex-registry.smolmachine";

const enforra = await createEnforraClient({
  policyPath: "./policies/smolvm-agent.yaml",
  auditPath: ".enforra/audit.jsonl"
});

async function execSmolvm(command, timeout = 180_000) {
  const { stdout, stderr } = await execFileAsync("smolvm", command, {
    timeout,
    maxBuffer: 1024 * 1024 * 20
  });

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim()
  };
}

async function assertSmolvmInstalled() {
  if (dryRun) return;

  try {
    await execSmolvm(["--help"], 10_000);
  } catch {
    console.error("\nsmolvm CLI was not found or did not run correctly.");
    console.error('Run: export PATH="$HOME/.local/bin:$PATH"');
    process.exit(1);
  }
}

async function runSmolvmAction({ label, tool, args, command, timeout = 180_000 }) {
  const result = await enforra.enforceToolCall({
    agent: "infra-agent",
    tool,
    args,
    context: {
      environment: "integration",
      runtime: "smolvm",
      actor: "agent"
    },
    execute: async () => {
      const commandText = ["smolvm", ...command].join(" ");

      if (dryRun) {
        return {
          mode: "policy-only",
          wouldRun: commandText
        };
      }

      console.log("\nEnforra allowed this action.");
      console.log("Calling real smolvm CLI:");
      console.log(commandText);

      const { stdout, stderr } = await execSmolvm(command, timeout);

      if (stdout) {
        console.log("\nsmolvm stdout:");
        console.log(stdout);
      }

      if (stderr) {
        console.log("\nsmolvm stderr:");
        console.log(stderr);
      }

      return {
        ran: commandText,
        stdout,
        stderr
      };
    }
  });

  const executed =
    typeof result.executed === "boolean"
      ? result.executed
      : ["allow", "log_only"].includes(result.decision);

  console.log("\n---");
  console.log(label);
  console.log(`Tool: ${tool}`);
  console.log(`Args: ${JSON.stringify(args)}`);
  console.log(`Decision: ${result.decision}`);
  console.log(`Executed: ${executed ? "yes" : "no"}`);

  if (result.reason) {
    console.log(`Reason: ${result.reason}`);
  }
}

console.log("Enforra + smolvm registry integration");
console.log("Enforra gates registry inspect, pull, package run, rehydration, approval, block, and audit.");

if (dryRun) {
  console.log("Mode: policy-only dry run. No smolvm commands will execute.");
}

await assertSmolvmInstalled();

await runSmolvmAction({
  label: "1) Allowed: agent inspects approved public smolvm registry artifact",
  tool: "smolvm.pack.inspect",
  args: {
    reference: REGISTRY_REF,
    json: true,
    workload: "approved-registry-inspect"
  },
  command: [
    "pack",
    "inspect",
    "--json",
    REGISTRY_REF
  ]
});

await runSmolvmAction({
  label: "2) Allowed: agent pulls approved public .smolmachine artifact",
  tool: "smolvm.pack.pull",
  args: {
    reference: REGISTRY_REF,
    output: REGISTRY_ARTIFACT,
    workload: "approved-registry-pull"
  },
  command: [
    "pack",
    "pull",
    REGISTRY_REF,
    "-o",
    REGISTRY_ARTIFACT
  ]
});

await runSmolvmAction({
  label: "3) Allowed: agent runs command from pulled registry .smolmachine",
  tool: "smolvm.pack.run",
  args: {
    sidecar: REGISTRY_ARTIFACT,
    runtime: "node",
    command: "console.log('hello from Enforra gated registry artifact ' + process.version)",
    workload: "approved-registry-pack-run"
  },
  command: [
    "pack",
    "run",
    "--sidecar",
    REGISTRY_ARTIFACT,
    "node",
    "-e",
    "console.log('hello from Enforra gated registry artifact ' + process.version)"
  ]
});

await runSmolvmAction({
  label: "4) Allowed: agent rehydrates pulled registry artifact with machine run --from",
  tool: "smolvm.machine.run.from_registry_pack",
  args: {
    from: REGISTRY_ARTIFACT,
    runtime: "node",
    command: "console.log('rehydrated Enforra gated registry artifact ' + process.version)",
    workload: "approved-registry-rehydrate"
  },
  command: [
    "machine",
    "run",
    "--from",
    REGISTRY_ARTIFACT,
    "node",
    "-e",
    "console.log('rehydrated Enforra gated registry artifact ' + process.version)"
  ]
});

await runSmolvmAction({
  label: "5) Approval required: agent tries to pull unknown registry artifact",
  tool: "smolvm.pack.pull",
  args: {
    reference: "registry.smolmachines.com/unknown/agent:latest",
    output: "./unknown-agent.smolmachine",
    workload: "unknown-registry-artifact"
  },
  command: [
    "pack",
    "pull",
    "registry.smolmachines.com/unknown/agent:latest",
    "-o",
    "./unknown-agent.smolmachine"
  ]
});

await runSmolvmAction({
  label: "6) Blocked: agent tries destructive command through registry package run",
  tool: "smolvm.pack.run",
  args: {
    sidecar: REGISTRY_ARTIFACT,
    runtime: "shell",
    command: "rm -rf /workspace",
    workload: "destructive-registry-pack-run"
  },
  command: [
    "pack",
    "run",
    "--sidecar",
    REGISTRY_ARTIFACT,
    "sh",
    "-lc",
    "rm -rf /workspace"
  ]
});

console.log("\nAudit log: .enforra/audit.jsonl");
console.log("View clean summary:");
console.log(
  `node -e 'const fs=require("fs"); const rows=fs.readFileSync(".enforra/audit.jsonl","utf8").trim().split("\\n").map(JSON.parse).filter(r=>r.status!=="decision_logged").slice(-8); console.table(rows.map(r=>({tool:r.tool,decision:r.decision,status:r.status,policy:r.matchedPolicyId})));'`
);