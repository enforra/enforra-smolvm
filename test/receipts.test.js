import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendPolicyReceipt,
  hashCommand,
  hashFile,
  verifyPolicyReceipts
} from "../packs/enforra-node/runtime/receipts.js";

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "enforra-receipts-test-"));
  const policyPath = path.join(directory, "policy.yaml");
  const receiptPath = path.join(directory, "receipts.jsonl");
  fs.writeFileSync(policyPath, "version: 1\ndefaults:\n  decision: block\n", "utf8");
  return { directory, policyPath, receiptPath };
}

function receiptInput(policyPath, overrides = {}) {
  return {
    agent: "test-agent",
    runtime: "test-runtime",
    commandHash: hashCommand(["node", "-e", "console.log('hello')"]),
    policyHash: hashFile(policyPath),
    classifierVersion: "0.1.0",
    sdkVersion: "0.3.0",
    packVersion: "1.0.0",
    tool: "node.exec",
    risk: "low",
    signals: ["code_execution"],
    decision: "allow",
    matchedPolicyId: "allow-low-risk-node-exec",
    reason: "matched policy allow-low-risk-node-exec",
    approved: null,
    executed: true,
    exitCode: 0,
    ...overrides
  };
}

test("policy receipts: appends and verifies a hash chain", async () => {
  const { directory, policyPath, receiptPath } = fixture();

  try {
    const first = await appendPolicyReceipt(receiptPath, receiptInput(policyPath));
    const second = await appendPolicyReceipt(
      receiptPath,
      receiptInput(policyPath, {
        commandHash: hashCommand(["env"]),
        tool: "secrets.read",
        risk: "high",
        decision: "block",
        matchedPolicyId: "block-secret-reading",
        executed: false,
        exitCode: 3
      })
    );

    assert.strictEqual(first.previousReceiptHash, null);
    assert.strictEqual(second.previousReceiptHash, first.receiptHash);

    const verification = verifyPolicyReceipts(receiptPath, policyPath);
    assert.strictEqual(verification.valid, true);
    assert.strictEqual(verification.receiptsChecked, 2);
    assert.strictEqual(verification.allReceiptsMatchCurrentPolicy, true);
    assert.strictEqual(verification.receiptHead, second.receiptHash);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("policy receipts: detects tampering", async () => {
  const { directory, policyPath, receiptPath } = fixture();

  try {
    await appendPolicyReceipt(receiptPath, receiptInput(policyPath));
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8").trim());
    receipt.decision = "block";
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, "utf8");

    const verification = verifyPolicyReceipts(receiptPath, policyPath);
    assert.strictEqual(verification.valid, false);
    assert.strictEqual(verification.firstInvalidLine, 1);
    assert.strictEqual(verification.reason, "Receipt hash mismatch");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("policy receipts: reports policy changes without invalidating the chain", async () => {
  const { directory, policyPath, receiptPath } = fixture();

  try {
    await appendPolicyReceipt(receiptPath, receiptInput(policyPath));
    fs.appendFileSync(policyPath, "# changed\n", "utf8");

    const verification = verifyPolicyReceipts(receiptPath, policyPath);
    assert.strictEqual(verification.valid, true);
    assert.strictEqual(verification.allReceiptsMatchCurrentPolicy, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
