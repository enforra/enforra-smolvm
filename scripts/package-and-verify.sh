#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

SOURCE_ARTIFACT="packs/enforra-node/enforra-node.smolmachine"
DIST_DIR="${DIST_DIR:-dist}"
DIST_ARTIFACT="$DIST_DIR/enforra-node.smolmachine"
CHECKSUM_FILE="$DIST_ARTIFACT.sha256"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

echo "==> 1. Running unit and security tests"
npm test

echo "==> 2. Building Docker image and packaging .smolmachine"
npm run pack:build

if [[ ! -s "$SOURCE_ARTIFACT" ]]; then
  echo "Expected packaged artifact was not created: $SOURCE_ARTIFACT" >&2
  exit 1
fi

cp "$SOURCE_ARTIFACT" "$DIST_ARTIFACT"

node -e '
  const fs = require("node:fs");
  const crypto = require("node:crypto");
  const artifact = process.argv[1];
  const output = process.argv[2];
  const digest = crypto.createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
  fs.writeFileSync(output, `${digest}  ${artifact}\n`, "utf8");
' "$DIST_ARTIFACT" "$CHECKSUM_FILE"

echo "==> 3. Running full smolvm acceptance suite against packaged artifact"
PACK_PATH="$DIST_ARTIFACT" npm run verify:pack

echo "==> 4. Verifying artifact checksum"
node -e '
  const fs = require("node:fs");
  const crypto = require("node:crypto");
  const artifact = process.argv[1];
  const checksumFile = process.argv[2];
  const expected = fs.readFileSync(checksumFile, "utf8").trim().split(/\s+/)[0];
  const actual = crypto.createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
  if (actual !== expected) {
    console.error(`Checksum mismatch: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
  console.log(`Checksum verified: sha256:${actual}`);
' "$DIST_ARTIFACT" "$CHECKSUM_FILE"

cat <<EOF

Package and verification completed successfully.

Shareable artifact:
  $DIST_ARTIFACT

Checksum:
  $CHECKSUM_FILE

This artifact can be transferred directly and run with:
  smolvm pack run --sidecar $DIST_ARTIFACT enforra info --json
EOF
