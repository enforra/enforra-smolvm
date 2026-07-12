#!/opt/enforra/real/node

import { main } from "./runtime/main.js";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
