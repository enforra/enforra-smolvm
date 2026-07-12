import test from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RUN_PATH = path.resolve("packs/enforra-node/enforra-run.js");
const TEMP_AUDIT = path.resolve("temp-audit.jsonl");
const TEMP_RECEIPTS = path.resolve("temp-receipts.jsonl");

function cleanupEvidence() {
  for (const evidencePath of [TEMP_AUDIT, TEMP_RECEIPTS, `${TEMP_RECEIPTS}.lock`]) {
    if (fs.existsSync(evidencePath)) {
      fs.rmSync(evidencePath, { force: true });
    }
  }
}

function runCommand(args, env = {}, stdinInput = "n\n") {
  return new Promise((resolve) => {
    const child = spawn("node", [RUN_PATH, ...args], {
      env: {
        ...process.env,
        ENFORRA_POLICY: path.resolve("packs/enforra-node/policy.yaml"),
        ENFORRA_AUDIT: TEMP_AUDIT,
        ENFORRA_RECEIPTS: TEMP_RECEIPTS,
        ...env
      }
    });

    child.stdin.write(stdinInput);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test("main-security: spoof attempt cannot downscore", async () => {
  cleanupEvidence();

  try {
    const result = await runCommand([
      "--tool",
      "file.read",
      "--risk",
      "low",
      "--",
      "rm",
      "-rf",
      "/workspace"
    ]);

    assert.strictEqual(result.code, 2);
    assert.match(
      result.stdout,
      /Approval required for command: --tool file.read --risk low -- rm -rf \/workspace/
    );
  } finally {
    cleanupEvidence();
  }
});

test("main-security: normal commands still work", async () => {
  cleanupEvidence();

  try {
    const result = await runCommand(["echo", "hello from test"], {}, "y\n");
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /hello from test/);
    assert.ok(fs.existsSync(TEMP_RECEIPTS), "Policy receipt should be written");
  } finally {
    cleanupEvidence();
  }
});

test("main-security: agent/runtime identity is recorded in audit and receipt", async () => {
  cleanupEvidence();

  try {
    const customAgent = "custom-test-agent";
    const customRuntime = "custom-test-runtime";
    const result = await runCommand(["sh", "-lc", "rm -rf /workspace"], {
      ENFORRA_AGENT_ID: customAgent,
      ENFORRA_RUNTIME_ID: customRuntime
    });

    assert.strictEqual(result.code, 3);
    assert.ok(fs.existsSync(TEMP_AUDIT), "Audit log should exist");
    assert.ok(fs.existsSync(TEMP_RECEIPTS), "Receipt log should exist");

    const auditEvent = JSON.parse(fs.readFileSync(TEMP_AUDIT, "utf8").trim().split("\n")[0]);
    assert.strictEqual(auditEvent.agent, customAgent);

    const receipt = JSON.parse(fs.readFileSync(TEMP_RECEIPTS, "utf8").trim().split("\n")[0]);
    assert.strictEqual(receipt.agent, customAgent);
    assert.strictEqual(receipt.runtime, customRuntime);
    assert.strictEqual(receipt.decision, "block");
    assert.strictEqual(receipt.executed, false);
  } finally {
    cleanupEvidence();
  }
});
