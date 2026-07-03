import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import { parseSmolvmArgs } from "../src/command.js";

test("pack inspect with --json (standard and reordered)", () => {
  const result1 = parseSmolvmArgs(["pack", "inspect", "--json", "registry.smolmachines.com/library/codex:arm64"]);
  assert.strictEqual(result1.supported, true);
  assert.strictEqual(result1.tool, "smolvm.pack.inspect");
  assert.strictEqual(result1.args.reference, "registry.smolmachines.com/library/codex:arm64");
  assert.strictEqual(result1.args.json, true);

  const result2 = parseSmolvmArgs(["pack", "inspect", "registry.smolmachines.com/library/codex:arm64"]);
  assert.strictEqual(result2.supported, true);
  assert.strictEqual(result2.tool, "smolvm.pack.inspect");
  assert.strictEqual(result2.args.reference, "registry.smolmachines.com/library/codex:arm64");
  assert.strictEqual(result2.args.json, false);
});

test("pack pull with -o and --output", () => {
  const result1 = parseSmolvmArgs(["pack", "pull", "registry.smolmachines.com/library/codex:arm64", "-o", "./codex.smolmachine"]);
  assert.strictEqual(result1.supported, true);
  assert.strictEqual(result1.tool, "smolvm.pack.pull");
  assert.strictEqual(result1.args.reference, "registry.smolmachines.com/library/codex:arm64");
  assert.strictEqual(result1.args.output, "./codex.smolmachine");
  assert.strictEqual(result1.artifactOutput, path.resolve(process.cwd(), "./codex.smolmachine"));

  const result2 = parseSmolvmArgs(["pack", "pull", "registry.smolmachines.com/library/codex:arm64", "--output", "./codex2.smolmachine"]);
  assert.strictEqual(result2.supported, true);
  assert.strictEqual(result2.tool, "smolvm.pack.pull");
  assert.strictEqual(result2.args.reference, "registry.smolmachines.com/library/codex:arm64");
  assert.strictEqual(result2.args.output, "./codex2.smolmachine");
  assert.strictEqual(result2.artifactOutput, path.resolve(process.cwd(), "./codex2.smolmachine"));

  const result3 = parseSmolvmArgs(["pack", "pull", "registry.smolmachines.com/library/codex:arm64"]);
  assert.strictEqual(result3.supported, true);
  assert.strictEqual(result3.tool, "smolvm.pack.pull");
  assert.strictEqual(result3.args.reference, "registry.smolmachines.com/library/codex:arm64");
  assert.strictEqual(result3.args.output, null);
  assert.strictEqual(result3.artifactOutput, undefined);
});

test("pack run with --sidecar", () => {
  const result = parseSmolvmArgs([
    "pack",
    "run",
    "--sidecar",
    "./codex.smolmachine",
    "node",
    "-e",
    "console.log(process.version)"
  ]);
  assert.strictEqual(result.supported, true);
  assert.strictEqual(result.tool, "smolvm.pack.run");
  assert.strictEqual(result.args.sidecar, "./codex.smolmachine");
  assert.strictEqual(result.args.command, "node -e console.log(process.version)");
  assert.strictEqual(result.artifactInput, path.resolve(process.cwd(), "./codex.smolmachine"));
});

test("machine run with --from", () => {
  const result = parseSmolvmArgs([
    "machine",
    "run",
    "--from",
    "./codex.smolmachine",
    "node",
    "-e",
    "console.log(process.version)"
  ]);
  assert.strictEqual(result.supported, true);
  assert.strictEqual(result.tool, "smolvm.machine.run.from_registry_pack");
  assert.strictEqual(result.args.from, "./codex.smolmachine");
  assert.strictEqual(result.args.command, "node -e console.log(process.version)");
  assert.strictEqual(result.artifactInput, path.resolve(process.cwd(), "./codex.smolmachine"));
});

test("unsupported commands", () => {
  const result1 = parseSmolvmArgs(["pack", "list"]);
  assert.strictEqual(result1.supported, false);
  assert.strictEqual(result1.tool, "smolvm.unsupported");

  const result2 = parseSmolvmArgs([]);
  assert.strictEqual(result2.supported, false);
  assert.strictEqual(result2.tool, "smolvm.unsupported");
});
