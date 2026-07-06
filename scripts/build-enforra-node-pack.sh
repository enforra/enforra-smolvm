#!/bin/bash
set -e

# Make sure we are in the repository root directory
CDPATH="" cd -- "$(dirname -- "$0")/.."

echo "==> 1. Building OCI image enforra-node:latest..."
docker build -t enforra-node:latest packs/enforra-node

# Ensure local docker registry is running
REGISTRY_NAME="local-registry"
REGISTRY_HOST=${REGISTRY_HOST:-192.168.64.1}
REGISTRY_PORT=${REGISTRY_PORT:-5001}

if [ "$(docker ps -aq -f name=^/${REGISTRY_NAME}$)" ]; then
    if [ ! "$(docker ps -q -f name=^/${REGISTRY_NAME}$)" ]; then
        echo "==> Starting existing local registry container..."
        docker start ${REGISTRY_NAME}
    else
        echo "==> Local registry is already running."
    fi
else
    echo "==> Starting a new local registry on port ${REGISTRY_PORT}..."
    docker run -d -p ${REGISTRY_PORT}:5000 --name ${REGISTRY_NAME} registry:2
fi

echo "==> 2. Tagging and pushing image to local registry..."
docker tag enforra-node:latest localhost:${REGISTRY_PORT}/enforra-node:latest
docker push localhost:${REGISTRY_PORT}/enforra-node:latest

echo "==> 3. Creating .smolmachine pack using smolvm..."

smolvm pack create \
  -I "${REGISTRY_HOST}:${REGISTRY_PORT}/enforra-node:latest" \
  -o packs/enforra-node/enforra-node

echo "==> Build and packaging completed successfully!"
echo "    Artifact: packs/enforra-node/enforra-node.smolmachine"

