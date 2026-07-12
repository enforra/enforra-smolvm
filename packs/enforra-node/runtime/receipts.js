import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const RECEIPT_VERSION = 1;
const HASH_PREFIX = "sha256:";
const LOCK_TIMEOUT_MS = 2_000;
const LOCK_RETRY_MS = 25;
const STALE_LOCK_MS = 30_000;

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        const nested = value[key];
        if (nested !== undefined) {
          result[key] = canonicalize(nested);
        }
        return result;
      }, {});
  }

  return value;
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return `${HASH_PREFIX}${crypto.createHash("sha256").update(value).digest("hex")}`;
}

export function hashFile(filePath) {
  return sha256(fs.readFileSync(filePath));
}

export function hashCommand(argv) {
  return sha256(canonicalStringify(argv));
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function packageVersion(packRoot, packageName, fallback = "unknown") {
  const packagePath = path.join(packRoot, "node_modules", ...packageName.split("/"), "package.json");
  const packageJson = readJson(packagePath);
  return packageJson?.version || fallback;
}

export function loadRuntimeIdentity(packRoot) {
  const packPackage = readJson(path.join(packRoot, "package.json")) || {};
  const dependencies = packPackage.dependencies || {};

  return {
    packVersion: packPackage.version || "unknown",
    classifierVersion: packageVersion(
      packRoot,
      "@enforra/command-guard",
      dependencies["@enforra/command-guard"] || "unknown"
    ),
    sdkVersion: packageVersion(
      packRoot,
      "@enforra/sdk-node",
      dependencies["@enforra/sdk-node"] || "unknown"
    )
  };
}

function readLastReceiptHash(receiptPath) {
  if (!fs.existsSync(receiptPath)) {
    return null;
  }

  const lines = fs
    .readFileSync(receiptPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return null;
  }

  const lastReceipt = JSON.parse(lines.at(-1));
  return typeof lastReceipt.receiptHash === "string" ? lastReceipt.receiptHash : null;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function removeStaleLock(lockPath) {
  try {
    const age = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (age > STALE_LOCK_MS) {
      fs.unlinkSync(lockPath);
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

async function acquireLock(lockPath) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < LOCK_TIMEOUT_MS) {
    try {
      const descriptor = fs.openSync(lockPath, "wx");
      return () => {
        try {
          fs.closeSync(descriptor);
        } finally {
          fs.rmSync(lockPath, { force: true });
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      if (!removeStaleLock(lockPath)) {
        await delay(LOCK_RETRY_MS);
      }
    }
  }

  throw new Error(`Timed out waiting for receipt lock: ${lockPath}`);
}

export async function appendPolicyReceipt(receiptPath, input) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const release = await acquireLock(`${receiptPath}.lock`);

  try {
    const previousReceiptHash = readLastReceiptHash(receiptPath);
    const receiptBase = {
      receiptVersion: RECEIPT_VERSION,
      timestamp: new Date().toISOString(),
      id: crypto.randomUUID(),
      agent: input.agent,
      runtime: input.runtime,
      commandHash: input.commandHash,
      policyHash: input.policyHash,
      classifierVersion: input.classifierVersion,
      sdkVersion: input.sdkVersion,
      packVersion: input.packVersion,
      tool: input.tool,
      risk: input.risk,
      signals: [...new Set(input.signals || [])].sort(),
      decision: input.decision,
      matchedPolicyId: input.matchedPolicyId || null,
      reason: input.reason || null,
      approved: input.approved ?? null,
      executed: Boolean(input.executed),
      exitCode: Number.isInteger(input.exitCode) ? input.exitCode : null,
      previousReceiptHash
    };

    const receipt = {
      ...receiptBase,
      receiptHash: sha256(canonicalStringify(receiptBase))
    };

    fs.appendFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, "utf8");
    return receipt;
  } finally {
    release();
  }
}

function invalidResult(receiptsChecked, firstInvalidLine, reason, currentPolicyHash = null) {
  return {
    valid: false,
    receiptsChecked,
    firstInvalidLine,
    reason,
    currentPolicyHash,
    allReceiptsMatchCurrentPolicy: false,
    distinctPolicyHashes: []
  };
}

export function verifyPolicyReceipts(receiptPath, policyPath) {
  const currentPolicyHash = policyPath && fs.existsSync(policyPath) ? hashFile(policyPath) : null;

  if (!fs.existsSync(receiptPath)) {
    return invalidResult(0, undefined, `Receipt file not found: ${receiptPath}`, currentPolicyHash);
  }

  const lines = fs
    .readFileSync(receiptPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  let previousReceiptHash = null;
  const policyHashes = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    let receipt;

    try {
      receipt = JSON.parse(lines[index]);
    } catch {
      return invalidResult(index, lineNumber, "Invalid JSON receipt", currentPolicyHash);
    }

    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
      return invalidResult(index, lineNumber, "Receipt is not a JSON object", currentPolicyHash);
    }

    if (receipt.receiptVersion !== RECEIPT_VERSION) {
      return invalidResult(index, lineNumber, "Unsupported receipt version", currentPolicyHash);
    }

    if (receipt.previousReceiptHash !== previousReceiptHash) {
      return invalidResult(index, lineNumber, "Broken receipt hash chain", currentPolicyHash);
    }

    if (typeof receipt.receiptHash !== "string") {
      return invalidResult(index, lineNumber, "Missing receipt hash", currentPolicyHash);
    }

    const { receiptHash, ...receiptBase } = receipt;
    const expectedReceiptHash = sha256(canonicalStringify(receiptBase));
    if (receiptHash !== expectedReceiptHash) {
      return invalidResult(index, lineNumber, "Receipt hash mismatch", currentPolicyHash);
    }

    if (typeof receipt.commandHash !== "string" || !receipt.commandHash.startsWith(HASH_PREFIX)) {
      return invalidResult(index, lineNumber, "Invalid command hash", currentPolicyHash);
    }

    if (typeof receipt.policyHash !== "string" || !receipt.policyHash.startsWith(HASH_PREFIX)) {
      return invalidResult(index, lineNumber, "Invalid policy hash", currentPolicyHash);
    }

    policyHashes.add(receipt.policyHash);
    previousReceiptHash = receiptHash;
  }

  const distinctPolicyHashes = [...policyHashes].sort();
  const allReceiptsMatchCurrentPolicy =
    currentPolicyHash === null || distinctPolicyHashes.every((policyHash) => policyHash === currentPolicyHash);

  return {
    valid: true,
    receiptsChecked: lines.length,
    firstInvalidLine: undefined,
    reason: undefined,
    currentPolicyHash,
    allReceiptsMatchCurrentPolicy,
    distinctPolicyHashes,
    receiptHead: previousReceiptHash
  };
}
