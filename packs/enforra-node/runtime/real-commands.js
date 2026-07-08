// Image-specific command routing.
// These paths point to the real binaries behind the wrapper commands.
// Security classification lives in @enforra/command-guard.

import { spawn } from "node:child_process";

export const REAL_COMMANDS = {
  // Node.js runtime (moved to node-real during image build)
  node:      { bin: "/usr/local/bin/node-real", prependArgs: [] },
  nodejs:    { bin: "/usr/local/bin/node-real", prependArgs: [] },

  // npm/npx: run via node-real invoking the CLI script directly
  npm:       { bin: "/usr/local/bin/node-real", prependArgs: ["/usr/local/lib/node_modules/npm/bin/npm-cli.js"] },
  npx:       { bin: "/usr/local/bin/node-real", prependArgs: ["/usr/local/lib/node_modules/npm/bin/npx-cli.js"] },

  // Shells (real binaries at /bin, not our /usr/local/bin wrappers)
  sh:        { bin: "/bin/sh",   prependArgs: [] },
  bash:      { bin: "/bin/bash", prependArgs: [] },
  zsh:       { bin: "/usr/bin/zsh", prependArgs: [] },

  // System info / secrets
  env:       { bin: "/usr/bin/env",      prependArgs: [] },
  printenv:  { bin: "/usr/bin/printenv", prependArgs: [] },

  // File operations
  cat:       { bin: "/usr/bin/cat",   prependArgs: [] },
  rm:        { bin: "/usr/bin/rm",    prependArgs: [] },
  chmod:     { bin: "/usr/bin/chmod", prependArgs: [] },
  chown:     { bin: "/usr/bin/chown", prependArgs: [] },

  // Network tools
  curl:      { bin: "/usr/bin/curl",    prependArgs: [] },
  wget:      { bin: "/usr/bin/wget",    prependArgs: [] },
  scp:       { bin: "/usr/bin/scp",     prependArgs: [] },
  rsync:     { bin: "/usr/bin/rsync",   prependArgs: [] },
  nc:        { bin: "/usr/bin/nc",      prependArgs: [] },
  netcat:    { bin: "/usr/bin/netcat",  prependArgs: [] },
  ncat:      { bin: "/usr/bin/ncat",    prependArgs: [] },

  // Privilege
  sudo:      { bin: "/usr/bin/sudo", prependArgs: [] },
  su:        { bin: "/usr/bin/su",   prependArgs: [] },

  // Source control
  git:       { bin: "/usr/bin/git", prependArgs: [] },

  // Cloud / infra
  aws:       { bin: "/usr/bin/aws",       prependArgs: [] },
  gcloud:    { bin: "/usr/bin/gcloud",    prependArgs: [] },
  az:        { bin: "/usr/bin/az",        prependArgs: [] },
  kubectl:   { bin: "/usr/bin/kubectl",   prependArgs: [] },
  docker:    { bin: "/usr/bin/docker",    prependArgs: [] },
  ssh:       { bin: "/usr/bin/ssh",       prependArgs: [] },
  terraform: { bin: "/usr/bin/terraform", prependArgs: [] },
  helm:      { bin: "/usr/bin/helm",      prependArgs: [] },
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
