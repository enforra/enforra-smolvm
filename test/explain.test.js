import test from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RUN_PATH = path.resolve("packs/enforra-node/enforra-run.js");
const POLICY_PATH = path.resolve("packs/enforra-node/policy.yaml");

function runEnforra(args) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "enforra-explain-test-"));

  return new Promise((resolve) => {
    const child = spawn("node", [RUN_PATH, ...args], {
      env: {
        ...process.env,
        ENFORRA_POLICY: POLICY_PATH,
        ENFORRA_AUDIT: path.join(directory, "audit.jsonl"),
        ENFORRA_RECEIPTS: path.join(directory, "receipts.jsonl")
      }
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("close", (code) => {
      fs.rmSync(directory, { recursive: true, force: true });
      resolve({ code, stdout, stderr });
    });
  });
}

test("explain: previews an approval decision without executing", async () => {
  const result = await runEnforra([
    "explain",
    "--json",
    "--",
    "npm",
    "install",
    "lodash"
  ]);

  assert.strictEqual(result.code, 0, result.stderr);
  const explanation = JSON.parse(result.stdout);
  assert.strictEqual(explanation.decision, "require_approval");
  assert.strictEqual(explanation.tool, "npm.install");
  assert.strictEqual(explanation.executed, false);
  assert.strictEqual(explanation.wouldExecuteImmediately, false);
  assert.match(explanation.policyHash, /^sha256:/);
});

test("explain: reports a blocked secret-read command", async () => {
  const result = await runEnforra(["explain", "--json", "--", "env"]);

  assert.strictEqual(result.code, 0, result.stderr);
  const explanation = JSON.parse(result.stdout);
  assert.strictEqual(explanation.decision, "block");
  assert.strictEqual(explanation.tool, "secrets.read");
  assert.strictEqual(explanation.risk, "high");
  assert.strictEqual(explanation.executed, false);
});

test("explain: keeps a safe Node command low risk", async () => {
  const result = await runEnforra([
    "explain",
    "--json",
    "--",
    "node",
    "-e",
    "console.log('hello')"
  ]);

  assert.strictEqual(result.code, 0, result.stderr);
  const explanation = JSON.parse(result.stdout);
  assert.strictEqual(explanation.decision, "allow");
  assert.strictEqual(explanation.tool, "node.exec");
  assert.strictEqual(explanation.risk, "low");
  assert.strictEqual(explanation.executed, false);
  assert.strictEqual(explanation.wouldExecuteImmediately, true);
});
