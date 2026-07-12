#!/usr/bin/env bash
set -euo pipefail

PACK_PATH="${PACK_PATH:-packs/enforra-node/enforra-node.smolmachine}"
MACHINE_NAME="${MACHINE_NAME:-enforra-node-verify}"
BUILD_PACK="${BUILD_PACK:-0}"
VERIFY_REAL_INSTALL="${VERIFY_REAL_INSTALL:-0}"
SMOLVM_RUN_EXTRA_ARGS="${SMOLVM_RUN_EXTRA_ARGS:-}"

if ! command -v smolvm >/dev/null 2>&1; then
  echo "smolvm is required" >&2
  exit 1
fi

if [[ "$BUILD_PACK" == "1" ]]; then
  npm run pack:build
fi

if [[ ! -f "$PACK_PATH" ]]; then
  echo "Pack not found: $PACK_PATH" >&2
  echo "Run npm run pack:build or set PACK_PATH." >&2
  exit 1
fi

run_expect() {
  local expected="$1"
  local label="$2"
  shift 2

  set +e
  local output
  output=$("$@" 2>&1)
  local code=$?
  set -e

  if [[ $code -ne $expected ]]; then
    echo "FAIL: $label (expected $expected, got $code)" >&2
    echo "$output" >&2
    exit 1
  fi

  echo "PASS: $label (exit $code)"
}

run_shell_expect() {
  local expected="$1"
  local label="$2"
  local command="$3"

  set +e
  local output
  output=$(bash -o pipefail -c "$command" 2>&1)
  local code=$?
  set -e

  if [[ $code -ne $expected ]]; then
    echo "FAIL: $label (expected $expected, got $code)" >&2
    echo "$output" >&2
    exit 1
  fi

  echo "PASS: $label (exit $code)"
}

cleanup_machine() {
  smolvm machine stop --name "$MACHINE_NAME" >/dev/null 2>&1 || true
  printf 'y\n' | smolvm machine delete --name "$MACHINE_NAME" >/dev/null 2>&1 || true
}

trap cleanup_machine EXIT
cleanup_machine

echo "== Ephemeral pack-run checks =="
run_expect 0 "safe Node command is allowed" \
  smolvm pack run --sidecar "$PACK_PATH" node -e "console.log('hello from verify-pack')"
run_expect 0 "npm metadata is allowed" \
  smolvm pack run --sidecar "$PACK_PATH" npm --version
run_expect 3 "environment read is blocked" \
  smolvm pack run --sidecar "$PACK_PATH" env
run_expect 3 "public absolute env path is blocked" \
  smolvm pack run --sidecar "$PACK_PATH" /usr/bin/env
run_expect 3 "destructive shell command is blocked" \
  smolvm pack run --sidecar "$PACK_PATH" sh -lc "rm -rf /workspace"
run_expect 3 "public absolute rm path is blocked" \
  smolvm pack run --sidecar "$PACK_PATH" /usr/bin/rm -rf /workspace
run_expect 1 "legacy node-real bypass is absent" \
  smolvm pack run --sidecar "$PACK_PATH" /usr/local/bin/node-real -e "console.log('bypass')"

run_shell_expect 2 "approval decline stops npm install" \
  "printf 'n\\n' | smolvm pack run -i --sidecar '$PACK_PATH' npm install lodash"
run_shell_expect 0 "approval accept executes safe npm help" \
  "printf 'y\\n' | smolvm pack run -i --sidecar '$PACK_PATH' npm install --help"

run_expect 0 "explain previews approval without execution" \
  smolvm pack run --sidecar "$PACK_PATH" enforra explain -- npm install lodash
run_expect 0 "explain previews a block without execution" \
  smolvm pack run --sidecar "$PACK_PATH" enforra explain -- env
run_expect 0 "pack identity is available" \
  smolvm pack run --sidecar "$PACK_PATH" enforra info --json

if [[ "$VERIFY_REAL_INSTALL" == "1" ]]; then
  read -r -a extra_args <<< "$SMOLVM_RUN_EXTRA_ARGS"
  run_shell_expect 0 "approved real package install succeeds" \
    "printf 'y\\n' | smolvm pack run -i ${extra_args[*]} --sidecar '$PACK_PATH' npm install lodash --ignore-scripts --no-audit --no-fund"
else
  echo "SKIP: real networked npm install"
  echo "Set VERIFY_REAL_INSTALL=1 and SMOLVM_RUN_EXTRA_ARGS to the required smolvm network flags."
fi

echo "== Persistent-machine checks =="
smolvm machine create --name "$MACHINE_NAME" --from "$PACK_PATH"
smolvm machine start --name "$MACHINE_NAME"

run_expect 0 "persistent safe command is allowed" \
  smolvm machine exec --name "$MACHINE_NAME" -- node -e "console.log('persistent ok')"
run_expect 3 "persistent secret read is blocked" \
  smolvm machine exec --name "$MACHINE_NAME" -- /usr/bin/env
run_expect 3 "persistent destructive operation is blocked" \
  smolvm machine exec --name "$MACHINE_NAME" -- /usr/bin/rm -rf /workspace
run_expect 0 "persistent receipt chain verifies" \
  smolvm machine exec --name "$MACHINE_NAME" -- enforra receipts verify /app/receipts.jsonl

cleanup_machine
trap - EXIT

echo "All Enforra Node pack acceptance checks passed."
