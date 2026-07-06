import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function promptForApproval() {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Approve and run this command? [y/N]: ");
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}
