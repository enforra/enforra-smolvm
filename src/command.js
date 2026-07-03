import path from "node:path";

/**
 * Parses smolvm CLI arguments and maps them to Enforra tool definitions.
 * @param {string[]} argv - Array of command-line arguments (typically process.argv.slice(2))
 * @returns {{
 *   supported: boolean,
 *   tool: string,
 *   args: object,
 *   smolvmArgs: string[],
 *   artifactOutput?: string,
 *   artifactInput?: string,
 *   error?: string
 * }}
 */
export function parseSmolvmArgs(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return {
      supported: false,
      tool: "smolvm.unsupported",
      args: {},
      smolvmArgs: argv || []
    };
  }

  // A) pack inspect
  if (argv[0] === "pack" && argv[1] === "inspect") {
    const json = argv.includes("--json");
    const filtered = argv.slice(2).filter(arg => arg !== "--json");
    const reference = filtered.find(arg => !arg.startsWith("-")) || null;

    return {
      supported: true,
      tool: "smolvm.pack.inspect",
      args: {
        reference,
        json
      },
      smolvmArgs: argv
    };
  }

  // B) pack pull
  if (argv[0] === "pack" && argv[1] === "pull") {
    let output = null;
    let outputIdx = argv.indexOf("-o");
    if (outputIdx === -1) {
      outputIdx = argv.indexOf("--output");
    }
    if (outputIdx !== -1 && outputIdx + 1 < argv.length) {
      output = argv[outputIdx + 1];
    }

    // Filter out pack, pull, and the output flag and value to find the reference
    const filtered = [];
    for (let i = 2; i < argv.length; i++) {
      if (i === outputIdx || i === outputIdx + 1) {
        continue;
      }
      filtered.push(argv[i]);
    }
    const reference = filtered.find(arg => !arg.startsWith("-")) || null;

    const result = {
      supported: true,
      tool: "smolvm.pack.pull",
      args: {
        reference,
        output
      },
      smolvmArgs: argv
    };

    if (output) {
      result.artifactOutput = path.resolve(process.cwd(), output);
    }
    return result;
  }

  // C) pack run
  if (argv[0] === "pack" && argv[1] === "run") {
    const sidecarIdx = argv.indexOf("--sidecar");
    if (sidecarIdx !== -1 && sidecarIdx + 1 < argv.length) {
      const sidecar = argv[sidecarIdx + 1];
      const commandArgs = argv.slice(sidecarIdx + 2);
      return {
        supported: true,
        tool: "smolvm.pack.run",
        args: {
          sidecar,
          sourceReference: "unknown",
          command: commandArgs.join(" ")
        },
        smolvmArgs: argv,
        artifactInput: path.resolve(process.cwd(), sidecar)
      };
    }
  }

  // D) machine run --from
  if (argv[0] === "machine" && argv[1] === "run") {
    const fromIdx = argv.indexOf("--from");
    if (fromIdx !== -1 && fromIdx + 1 < argv.length) {
      const from = argv[fromIdx + 1];
      const commandArgs = argv.slice(fromIdx + 2);
      return {
        supported: true,
        tool: "smolvm.machine.run.from_registry_pack",
        args: {
          from,
          sourceReference: "unknown",
          command: commandArgs.join(" ")
        },
        smolvmArgs: argv,
        artifactInput: path.resolve(process.cwd(), from)
      };
    }
  }

  // Unsupported command
  return {
    supported: false,
    tool: "smolvm.unsupported",
    args: {},
    smolvmArgs: argv
  };
}
