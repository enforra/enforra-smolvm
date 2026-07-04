import { spawn } from "node:child_process";
import { recordArtifact } from "./artifact-store.js";

export function executeSmolvmCommand(argv, parsed) {
  return new Promise((resolve) => {
    const child = spawn("smolvm", argv, { stdio: "inherit" });
    child.on("close", (code) => {
      const finalCode = code ?? 0;
      if (finalCode === 0 && parsed.tool === "smolvm.pack.pull" && parsed.artifactOutput) {
        try {
          recordArtifact(parsed.artifactOutput, { sourceReference: parsed.args.reference });
        } catch (err) {
          console.error("Error recording artifact provenance:", err.message);
        }
      }
      resolve({ exitCode: finalCode });
    });
    child.on("error", (err) => {
      console.error("Failed to start smolvm process:", err.message);
      resolve({ exitCode: 1 });
    });
  });
}
