import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const isPolicyOnly = process.env.ENFORRA_SMOLVM_POLICY_ONLY === "1";

const auditPath = path.resolve(process.cwd(), ".enforra/audit.jsonl");
const artifactsPath = path.resolve(process.cwd(), ".enforra/smolvm-artifacts.json");

// Clean up old audit log
if (fs.existsSync(auditPath)) {
  fs.unlinkSync(auditPath);
}

// Ensure parent directory for artifacts store exists
fs.mkdirSync(path.dirname(artifactsPath), { recursive: true });

// Pre-populate provenance store so that pack run/machine run can look up the registry reference
// even in policy-only mode (where no real file is pulled).
fs.writeFileSync(
  artifactsPath,
  JSON.stringify(
    {
      [path.resolve(process.cwd(), "./codex.smolmachine")]: {
        sourceReference: "registry.smolmachines.com/library/codex:arm64",
        recordedAt: new Date().toISOString()
      }
    },
    null,
    2
  ),
  "utf8"
);

async function runCLI(args, inputText, envExtra = {}) {
  return new Promise((resolve) => {
    const child = spawn("node", ["src/cli.js", ...args], {
      stdio: inputText === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
      env: { ...process.env, ...envExtra }
    });
    if (inputText !== undefined) {
      child.stdin.end(inputText);
    }
    child.on("close", (code) => {
      resolve(code ?? 0);
    });
  });
}

function createFakeSmolvmBin() {
  const fakeBinDir = fs.mkdtempSync(path.join(process.cwd(), ".enforra/fake-smolvm-"));
  const fakeSmolvmPath = path.join(fakeBinDir, "smolvm");
  fs.writeFileSync(fakeSmolvmPath, "#!/usr/bin/env node\nprocess.exit(0);\n", "utf8");
  fs.chmodSync(fakeSmolvmPath, 0o755);
  return fakeBinDir;
}

async function run() {
  console.log("Starting Smoke Test...");
  console.log(`Mode: ${isPolicyOnly ? "Policy-Only (Dry Run)" : "Live Execution"}`);
  console.log("==========================================");

  const testCases = [
    {
      name: "1. Allowed: Inspect approved registry reference",
      args: ["pack", "inspect", "--json", "registry.smolmachines.com/library/codex:arm64"],
      expectedExitCode: 0
    },
    {
      name: "2. Allowed: Pull approved registry reference",
      args: ["pack", "pull", "registry.smolmachines.com/library/codex:arm64", "-o", "./codex.smolmachine"],
      expectedExitCode: 0
    },
    {
      name: "3. Allowed: Run command on approved sidecar package",
      args: ["pack", "run", "--sidecar", "./codex.smolmachine", "node", "-e", "console.log('hello from enforra-smolvm')"],
      expectedExitCode: 0
    },
    {
      name: "4. Allowed: Rehydrate approved registry package via machine run",
      args: ["machine", "run", "--from", "./codex.smolmachine", "node", "-e", "console.log('rehydrated through enforra-smolvm')"],
      expectedExitCode: 0
    },
    {
      name: "5. Approval Required: Pull unknown registry reference (decline)",
      args: ["pack", "pull", "registry.smolmachines.com/unknown/agent:latest", "-o", "./unknown-agent.smolmachine"],
      input: "n\n",
      expectedExitCode: 2
    },
    {
      name: "6. Approval Required: Pull unknown registry reference (approve with fake smolvm)",
      args: ["pack", "pull", "registry.smolmachines.com/unknown/agent:latest", "-o", "./unknown-agent.smolmachine"],
      input: "y\n",
      fakeSmolvm: true,
      expectedExitCode: isPolicyOnly ? 2 : 0
    },
    {
      name: "7. Blocked: Destructive command on sidecar package",
      args: ["pack", "run", "--sidecar", "./codex.smolmachine", "sh", "-lc", "rm -rf /workspace"],
      expectedExitCode: 3
    },
    {
      name: "8. Blocked: Unsupported smolvm command",
      args: ["pack", "list"],
      expectedExitCode: 3
    }
  ];

  const results = [];

  for (const tc of testCases) {
    console.log(`\n--- Running Case: ${tc.name} ---`);
    console.log(`Command: enforra-smolvm ${tc.args.join(" ")}`);
    const envExtra = tc.fakeSmolvm && !isPolicyOnly ? { PATH: `${createFakeSmolvmBin()}${path.delimiter}${process.env.PATH || ""}` } : {};
    const code = await runCLI(tc.args, isPolicyOnly ? undefined : tc.input, envExtra);
    const passed = code === tc.expectedExitCode;
    results.push({ name: tc.name, expected: tc.expectedExitCode, actual: code, passed });
    console.log(`Exit Code: ${code} (Expected: ${tc.expectedExitCode}) -> ${passed ? "PASS" : "FAIL"}`);
  }

  console.log("\n==========================================");
  console.log("Smoke Test Results Summary:");
  console.table(
    results.map(r => ({
      "Test Case": r.name,
      "Expected Code": r.expected,
      "Actual Code": r.actual,
      "Status": r.passed ? "PASS" : "FAIL"
    }))
  );

  // Print audit log summary
  console.log("\n==========================================");
  console.log("Audit Log Summary (.enforra/audit.jsonl):");
  if (fs.existsSync(auditPath)) {
    try {
      const content = fs.readFileSync(auditPath, "utf8").trim();
      if (content) {
        const rows = content
          .split("\n")
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        // Filter out decision_logged rows to get a clean action summary
        const actionRows = rows.filter((r) => r.status !== "decision_logged");
        console.table(
          actionRows.map((r) => ({
            tool: r.tool,
            decision: r.decision,
            status: r.status,
            policy: r.matchedPolicyId
          }))
        );
      } else {
        console.log("(Audit log is empty)");
      }
    } catch (err) {
      console.error("Error reading audit log:", err.message);
    }
  } else {
    console.log("(No audit log found)");
  }
}

run();
