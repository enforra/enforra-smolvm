// Enterprise Command Classifier
// Automatically infers and categorizes shell commands to feed Enforra policy engine.

const SENSITIVE_PATH_PATTERNS = [
  "/etc/passwd", "/etc/shadow", "/root",
  "~/.ssh", ".ssh", "id_rsa", "id_ed25519",
  ".env", ".npmrc", ".pypirc",
  "credentials", "token", "secret", "kubeconfig",
  "~/.aws", "~/.azure", "~/.config/gcloud"
];

const DESTRUCTIVE_PATTERNS = [
  "rm -rf", "rm -fr", "rmdir", "dd if=", "mkfs", "truncate"
];

const EXFILTRATION_COMMANDS = ["nc", "netcat", "ncat", "scp", "rsync"];
const EXFILTRATION_CURL_PATTERNS = ["curl -X POST", "curl -T", "curl --upload-file"];

const INFRA_COMMANDS = ["aws", "gcloud", "az", "kubectl", "docker", "ssh", "terraform", "helm"];

const PRIVILEGE_PATTERNS = ["sudo", "su", "chmod 777", "chown"];

export function classifyCommand(argv) {
  const executable = argv[0] || "";
  const subcommand = argv[1] || "";
  const commandString = argv.join(" ");

  // Base result
  const result = {
    executable,
    subcommand,
    command: commandString,
    argv,
    tool: "command.exec",
    category: "unknown",
    risk: "medium",
    destructiveOperation: false,
    touchesSensitivePath: false,
    readsSecrets: false,
    writesSecrets: false,
    packageInstall: false,
    packageMutation: false,
    networkDownload: false,
    downloadAndExecute: false,
    dataExfiltration: false,
    cloudOrInfraAccess: false,
    cloudCredentialAccess: false,
    privilegeEscalation: false,
    workspaceWrite: false,
    unknownCommand: false
  };

  // ── Global pattern checks (apply to any command) ──

  // Sensitive paths
  for (const pat of SENSITIVE_PATH_PATTERNS) {
    if (commandString.includes(pat)) {
      result.touchesSensitivePath = true;
      result.risk = "high";
    }
  }

  // Secret/env reading
  if (
    (executable === "env" || executable === "printenv") ||
    (commandString.includes("cat") && SENSITIVE_PATH_PATTERNS.some(p => commandString.includes(p))) ||
    (commandString.match(/\benv\b/) && (executable === "sh" || executable === "bash"))
  ) {
    result.readsSecrets = true;
    result.risk = "high";
  }

  // Destructive patterns
  for (const pat of DESTRUCTIVE_PATTERNS) {
    if (commandString.includes(pat)) {
      result.destructiveOperation = true;
      result.risk = "high";
    }
  }

  // Download and execute
  if (
    /curl\s+.*\|\s*(sh|bash)/.test(commandString) ||
    /wget\s+.*\|\s*(sh|bash)/.test(commandString)
  ) {
    result.downloadAndExecute = true;
    result.networkDownload = true;
    result.risk = "high";
  }

  // Pipe to shell (broader)
  if (/\|\s*(sh|bash)\b/.test(commandString)) {
    result.downloadAndExecute = true;
    result.risk = "high";
  }

  // Data exfiltration via curl
  for (const pat of EXFILTRATION_CURL_PATTERNS) {
    if (commandString.includes(pat)) {
      result.dataExfiltration = true;
      result.risk = "high";
    }
  }

  // Privilege escalation
  for (const pat of PRIVILEGE_PATTERNS) {
    if (commandString.includes(pat)) {
      result.privilegeEscalation = true;
      result.risk = "high";
    }
  }

  // ── Per-executable classification ──

  // Node
  if (executable === "node" || executable === "nodejs") {
    result.tool = "node.exec";
    result.category = "code_execution";
    if (result.risk !== "high") result.risk = "low";
    return result;
  }

  // npm
  if (executable === "npm" || executable === "npx") {
    const installSubs = ["install", "i", "add", "ci"];
    if (installSubs.includes(subcommand)) {
      result.tool = "npm.install";
      result.category = "package_install";
      result.packageInstall = true;
      result.packageMutation = true;
      result.networkDownload = true;
      if (result.risk !== "high") result.risk = "medium";
    } else if (["uninstall", "remove", "rm", "prune"].includes(subcommand)) {
      result.tool = "npm.install";
      result.category = "package_install";
      result.packageMutation = true;
      if (result.risk !== "high") result.risk = "medium";
    } else {
      result.tool = "npm.exec";
      result.category = "package_metadata";
      if (result.risk !== "high") result.risk = "low";
    }
    return result;
  }

  // Shell
  if (executable === "sh" || executable === "bash" || executable === "zsh") {
    result.tool = "shell.exec";

    // Check inner command for env/secret dumping
    const innerCommand = commandString;
    if (/\benv\b/.test(innerCommand) || /\bprintenv\b/.test(innerCommand)) {
      result.readsSecrets = true;
      result.category = "secret_access";
      result.risk = "high";
    }

    if (result.destructiveOperation) {
      result.category = "destructive_operation";
    } else if (result.downloadAndExecute) {
      result.category = "download_and_execute";
    } else if (result.touchesSensitivePath || result.readsSecrets) {
      result.category = "secret_access";
    } else if (result.dataExfiltration) {
      result.category = "data_exfiltration";
    } else {
      result.category = "shell_command";
      if (result.risk !== "high") result.risk = "medium";
    }
    return result;
  }

  // rm (direct, not via shell wrapper)
  if (executable === "rm") {
    result.tool = "file.delete";
    if (result.destructiveOperation) {
      result.category = "destructive_operation";
    } else {
      result.category = "file_access";
      if (result.risk !== "high") result.risk = "medium";
    }
    return result;
  }

  // Data exfiltration commands
  if (EXFILTRATION_COMMANDS.includes(executable)) {
    result.tool = "network.exec";
    result.category = "data_exfiltration";
    result.dataExfiltration = true;
    result.risk = "high";
    return result;
  }

  // Network download tools
  if (executable === "curl" || executable === "wget") {
    result.tool = "network.exec";
    result.category = "network_download";
    result.networkDownload = true;
    if (result.risk !== "high") result.risk = "medium";
    return result;
  }

  // Cloud / infra tools
  if (INFRA_COMMANDS.includes(executable)) {
    result.tool = "infra.exec";
    result.category = "infrastructure_access";
    result.cloudOrInfraAccess = true;
    // Check for credential access
    if (
      commandString.includes("credentials") ||
      commandString.includes("token") ||
      commandString.includes("secret") ||
      commandString.includes("iam") ||
      commandString.includes("auth")
    ) {
      result.cloudCredentialAccess = true;
    }
    result.risk = "high";
    return result;
  }

  // Privilege escalation commands
  if (executable === "sudo" || executable === "su") {
    result.tool = "system.exec";
    result.category = "privilege_change";
    result.privilegeEscalation = true;
    result.risk = "high";
    return result;
  }

  // chmod / chown
  if (executable === "chmod" || executable === "chown") {
    result.tool = "system.exec";
    result.category = "privilege_change";
    result.privilegeEscalation = true;
    result.risk = "high";
    return result;
  }

  // Git
  if (executable === "git") {
    result.tool = "git.exec";
    result.category = "source_control";
    if (["clone", "pull", "fetch"].includes(subcommand)) {
      result.networkDownload = true;
    }
    if (["push"].includes(subcommand)) {
      result.dataExfiltration = true;
    }
    if (result.risk !== "high") result.risk = "medium";
    return result;
  }

  // env / printenv as bare commands
  if (executable === "env" || executable === "printenv") {
    result.tool = "secrets.read";
    result.category = "secret_access";
    result.readsSecrets = true;
    result.risk = "high";
    return result;
  }

  // cat / less / head / tail — check for sensitive file targets
  if (["cat", "less", "head", "tail", "more"].includes(executable)) {
    if (result.touchesSensitivePath) {
      result.tool = "secrets.read";
      result.category = "secret_access";
      result.readsSecrets = true;
    } else {
      result.tool = "file.read";
      result.category = "file_access";
      if (result.risk !== "high") result.risk = "low";
    }
    return result;
  }

  // Unknown
  result.tool = "command.exec";
  result.category = "unknown";
  result.unknownCommand = true;
  if (result.risk !== "high") result.risk = "medium";
  return result;
}

// Legacy helper for backward compatibility & tests
export function inferToolAndRisk(argv) {
  const c = classifyCommand(argv);
  return { tool: c.tool, risk: c.risk };
}
