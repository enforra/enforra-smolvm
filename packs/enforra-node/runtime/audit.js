import fs from "node:fs";
import path from "node:path";

export function writeManualAuditEvent({ tool, args, approved, executed, exitCode }, auditPath) {
  const event = {
    timestamp: new Date().toISOString(),
    agent: "enforra-node",
    tool,
    args,
    decision: "require_approval",
    status: approved ? "manual_approval_executed" : "manual_approval_declined",
    manualApproval: {
      approved,
      executed,
      exitCode
    }
  };
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.appendFileSync(auditPath, `${JSON.stringify(event)}\n`, "utf8");
}
