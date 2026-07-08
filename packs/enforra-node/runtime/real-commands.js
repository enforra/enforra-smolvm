// This file only routes commands wrapped by this Node smolmachine image.
// Security classification lives in @enforra/command-guard.

import { spawn } from "node:child_process";

export const REAL_COMMANDS = {
  // Node.js runtime (moved to private path during image build)
  node:      { bin: "/opt/enforra/real/node", prependArgs: [] },
  nodejs:    { bin: "/opt/enforra/real/node", prependArgs: [] },

  // npm/npx: run via real node invoking the CLI script directly
  npm:       { bin: "/opt/enforra/real/node", prependArgs: ["/usr/local/lib/node_modules/npm/bin/npm-cli.js"] },
  npx:       { bin: "/opt/enforra/real/node", prependArgs: ["/usr/local/lib/node_modules/npm/bin/npx-cli.js"] },

  // Shells (real binaries at private path)
  sh:        { bin: "/opt/enforra/real/sh",   prependArgs: [] },
  bash:      { bin: "/opt/enforra/real/bash", prependArgs: [] },

  // System info / secrets
  env:       { bin: "/opt/enforra/real/env",      prependArgs: [] },
  printenv:  { bin: "/opt/enforra/real/printenv", prependArgs: [] },

  // File operations
  cat:       { bin: "/opt/enforra/real/cat",   prependArgs: [] },
  rm:        { bin: "/opt/enforra/real/rm",    prependArgs: [] },
};

export function resolveRealCommand(command, args) {
  const mapping = REAL_COMMANDS[command];
  if (mapping) {
    return {
      bin: mapping.bin,
      args: [...mapping.prependArgs, ...args]
    };
  }
  // Unwrapped command: use as-is (may fail with ENOENT if not installed)
  return { bin: command, args };
}

function runChildCommand(command, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { stdio: "inherit" });
    child.on("close", (code) => {
      resolve(code ?? 0);
    });
    child.on("error", (err) => {
      console.error(`Failed to start command: ${err.message}`);
      resolve(1);
    });
  });
}

export function executeReal(targetCommand, targetArgs) {
  const resolved = resolveRealCommand(targetCommand, targetArgs);
  return runChildCommand(resolved.bin, resolved.args);
}
