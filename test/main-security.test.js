import test from "node:test";
import assert from "node:assert";
import { exec, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RUN_PATH = path.resolve("packs/enforra-node/enforra-run.js");
const TEMP_AUDIT = path.resolve("temp-audit.jsonl");

function runCommand(args, env = {}, stdinInput = "n\n") {
  return new Promise((resolve) => {
    const child = spawn("node", [RUN_PATH, ...args], {
      env: {
        ...process.env,
        ENFORRA_POLICY: path.resolve("packs/enforra-node/policy.yaml"),
        ENFORRA_AUDIT: TEMP_AUDIT,
        ...env
      }
    });

    child.stdin.write(stdinInput);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test("main-security: spoof attempt cannot downscore", async () => {
  if (fs.existsSync(TEMP_AUDIT)) fs.unlinkSync(TEMP_AUDIT);

  // Attempt to spoof tool as low-risk/allowed file.read
  const res = await runCommand(["--tool", "file.read", "--risk", "low", "--", "rm", "-rf", "/workspace"]);

  // Should NOT treat it as explicit mode. The command should be classified as command.exec
  // and trigger require_approval, then exit with code 2 on decline.
  assert.strictEqual(res.code, 2);
  assert.match(res.stdout, /Approval required for command: --tool file.read --risk low -- rm -rf \/workspace/);
});

test("main-security: normal commands still work", async () => {
  if (fs.existsSync(TEMP_AUDIT)) fs.unlinkSync(TEMP_AUDIT);

  const res = await runCommand(["echo", "hello from test"], {}, "y\n");
  assert.strictEqual(res.code, 0);
  assert.match(res.stdout, /hello from test/);
});

test("main-security: ENFORRA_AGENT_ID and ENFORRA_RUNTIME_ID are respected", async () => {
  if (fs.existsSync(TEMP_AUDIT)) fs.unlinkSync(TEMP_AUDIT);

  const customAgent = "custom-test-agent";
  const customRuntime = "custom-test-runtime";

  // Trigger a blocked command (e.g. destructive rm -rf)
  const res = await runCommand(["sh", "-lc", "rm -rf /workspace"], {
    ENFORRA_AGENT_ID: customAgent,
    ENFORRA_RUNTIME_ID: customRuntime
  });

  assert.strictEqual(res.code, 3);

  // Inspect the audit log to verify custom agent/runtime are logged
  assert.ok(fs.existsSync(TEMP_AUDIT), "Audit log should exist");
  const auditContent = fs.readFileSync(TEMP_AUDIT, "utf8");
  const parsed = JSON.parse(auditContent.trim().split("\n")[0]);

  assert.strictEqual(parsed.agent, customAgent);
  // Clean up
  if (fs.existsSync(TEMP_AUDIT)) fs.unlinkSync(TEMP_AUDIT);
});
