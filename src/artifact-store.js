import fs from "node:fs";
import path from "node:path";

const STORE_PATH = path.resolve(process.cwd(), ".enforra/smolvm-artifacts.json");

function ensureDirectoryExists() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadStore() {
  ensureDirectoryExists();
  if (!fs.existsSync(STORE_PATH)) {
    return {};
  }
  try {
    const content = fs.readFileSync(STORE_PATH, "utf8");
    return JSON.parse(content);
  } catch (error) {
    // If malformed, return empty store
    return {};
  }
}

function saveStore(store) {
  ensureDirectoryExists();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

/**
 * Record provenance of an artifact.
 * @param {string} outputPath - Path to the saved artifact
 * @param {object} metadata - Metadata containing sourceReference, etc.
 */
export function recordArtifact(outputPath, metadata) {
  if (!outputPath) return;
  const absPath = path.resolve(process.cwd(), outputPath);
  const store = loadStore();
  store[absPath] = {
    sourceReference: metadata.sourceReference || "unknown",
    recordedAt: new Date().toISOString()
  };
  saveStore(store);
}

/**
 * Retrieve metadata for an artifact.
 * @param {string} inputPath - Path to the artifact
 * @returns {object|null} Metadata object or null if not found
 */
export function getArtifact(inputPath) {
  if (!inputPath) return null;
  const absPath = path.resolve(process.cwd(), inputPath);
  const store = loadStore();
  return store[absPath] || null;
}
