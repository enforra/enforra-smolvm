// Compatibility shim — command-risk logic has moved to @enforra/command-guard.
// This file is retained only in case any external tooling still imports it directly.
// Prefer importing from @enforra/command-guard directly.
export { classifyCommand, inferToolAndRisk } from "@enforra/command-guard";
