// Compatibility shim and local augmentations for command classification.
// Enforra node-pack intercepts Node inline code evaluation blocklists.
import { classifyCommand as baseClassifyCommand, inferToolAndRisk as baseInferToolAndRisk } from "@enforra/command-guard";

export function classifyCommand(targetArgv) {
  const classified = baseClassifyCommand(targetArgv);

  // Augment classification for Node execution evaluating inline code
  const isNode = targetArgv[0] === "node" || targetArgv[0] === "nodejs";
  if (isNode) {
    const evalIndex = targetArgv.findIndex(arg => arg === "-e" || arg === "--eval" || arg === "-p" || arg === "--print");
    if (evalIndex !== -1 && evalIndex + 1 < targetArgv.length) {
      const code = targetArgv[evalIndex + 1];
      
      if (code.includes("process.env")) {
        return {
          ...classified,
          tool: "secrets.read",
          risk: "high",
          readsSecrets: true,
          signals: [...(classified.signals || []), "secrets_read_attempt"]
        };
      }

      if (code.includes("readFileSync") && code.includes("/etc/passwd")) {
        return {
          ...classified,
          tool: "file.read",
          risk: "high",
          touchesSensitivePath: true,
          signals: [...(classified.signals || []), "sensitive_file_read_attempt"]
        };
      }

      if (code.includes("child_process")) {
        return {
          ...classified,
          tool: "command.exec",
          risk: "high",
          privilegeEscalation: true,
          signals: [...(classified.signals || []), "child_process_exec_attempt"]
        };
      }
    }
  }

  return classified;
}

export function inferToolAndRisk(targetArgv) {
  const classified = classifyCommand(targetArgv);
  return { tool: classified.tool, risk: classified.risk };
}
