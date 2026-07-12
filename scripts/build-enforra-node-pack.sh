#!/usr/bin/env bash
set -euo pipefail

CDPATH="" cd -- "$(dirname -- "$0")/.."

ARTIFACT_BASE="packs/enforra-node/enforra-node"
ARTIFACT_PATH="${ARTIFACT_BASE}.smolmachine"
REGISTRY_NAME="${REGISTRY_NAME:-local-registry}"
REGISTRY_HOST="${REGISTRY_HOST:-192.168.64.1}"
REGISTRY_PORT="${REGISTRY_PORT:-5001}"
IMAGE_NAME="${IMAGE_NAME:-enforra-node:latest}"
LOCAL_IMAGE_REF="localhost:${REGISTRY_PORT}/enforra-node:latest"

command -v docker >/dev/null 2>&1 || {
  echo "docker is required" >&2
  exit 1
}

command -v smolvm >/dev/null 2>&1 || {
  echo "smolvm is required" >&2
  exit 1
}

echo "==> 1. Building OCI image ${IMAGE_NAME}"
docker build -t "$IMAGE_NAME" packs/enforra-node

if [[ -n "$(docker ps -aq -f name=^/${REGISTRY_NAME}$)" ]]; then
  if [[ -z "$(docker ps -q -f name=^/${REGISTRY_NAME}$)" ]]; then
    echo "==> Starting existing temporary local registry"
    docker start "$REGISTRY_NAME" >/dev/null
  else
    echo "==> Temporary local registry is already running"
  fi
else
  echo "==> Starting temporary local registry on port ${REGISTRY_PORT}"
  docker run -d -p "${REGISTRY_PORT}:5000" --name "$REGISTRY_NAME" registry:2 >/dev/null
fi

echo "==> 2. Staging image in temporary local registry"
docker tag "$IMAGE_NAME" "$LOCAL_IMAGE_REF"
docker push "$LOCAL_IMAGE_REF"

echo "==> 3. Creating portable .smolmachine artifact"
rm -f "$ARTIFACT_PATH"
smolvm pack create \
  -I "${REGISTRY_HOST}:${REGISTRY_PORT}/enforra-node:latest" \
  -o "$ARTIFACT_BASE"

if [[ ! -s "$ARTIFACT_PATH" ]]; then
  echo "Packaging failed: artifact was not created at ${ARTIFACT_PATH}" >&2
  exit 1
fi

echo "==> Build and packaging completed successfully"
echo "    Artifact: ${ARTIFACT_PATH}"
echo "    Note: the registry above is local staging only; nothing was published publicly."
