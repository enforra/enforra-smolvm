import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export function isApprovalAnswerApproved(answer) {
  const normalized = String(answer ?? "").trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

export async function promptForApproval() {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Approve and run this smolvm command? [y/N]: ");
    return isApprovalAnswerApproved(answer);
  } finally {
    rl.close();
  }
}

export function appendApprovalAuditEvent({ auditPath, tool, args, commandText, approved, executed, exitCode, reason }) {
  const targetPath = path.resolve(process.cwd(), auditPath || ".enforra/audit.jsonl");
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const event = {
    timestamp: new Date().toISOString(),
    agent: "infra-agent",
    tool,
    args,
    decision: "require_approval",
    status: approved ? "manual_approval_executed" : "manual_approval_declined",
    manualApproval: {
      approved,
      executed,
      command: commandText,
      exitCode
    }
  };
  if (reason) {
    event.reason = reason;
  }
  fs.appendFileSync(targetPath, `${JSON.stringify(event)}\n`, "utf8");
}
