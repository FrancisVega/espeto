import { existsSync, readFileSync } from "node:fs";
import { argv, exit, stderr, stdout } from "node:process";
import { CliUsageError } from "./cmd";
import { EspetoError, formatError } from "./errors";
import { CmdRuntimeError } from "./evaluator";
import { startRepl } from "./repl";
import { run } from "./run";
import { watchAndRun } from "./watch";

const VERSION = "0.1.0";

const HELP = `espeto v${VERSION}

usage:
  espeto run [-w|--watch] <file.esp> [-- <cmd-args>...]   run an Espeto program
  espeto repl                                             start interactive REPL
  espeto --help                                           show this help
  espeto --version                                        show version
`;

async function main(): Promise<number> {
	const args = argv.slice(2);

	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		stdout.write(HELP);
		return 0;
	}

	if (args[0] === "--version" || args[0] === "-v") {
		stdout.write(`${VERSION}\n`);
		return 0;
	}

	if (args[0] === "run") {
		const runArgs = args.slice(1);
		const sepIdx = runArgs.indexOf("--");
		const inner = sepIdx >= 0 ? runArgs.slice(0, sepIdx) : runArgs;
		const cmdArgv = sepIdx >= 0 ? runArgs.slice(sepIdx + 1) : [];

		let file: string | undefined;
		let watch = false;
		for (const a of inner) {
			if (a === "--watch" || a === "-w") {
				watch = true;
			} else if (a.startsWith("-") && a !== "-") {
				stderr.write(`error: unknown flag: ${a}\n`);
				return 1;
			} else if (!file) {
				file = a;
			} else {
				stderr.write(`error: unexpected argument: ${a}\n`);
				return 1;
			}
		}

		if (!file) {
			stderr.write("error: missing file\n\n");
			stderr.write(HELP);
			return 1;
		}

		if (watch) {
			if (!existsSync(file)) {
				stderr.write(`error: file not found: ${file}\n`);
				return 1;
			}
			return watchAndRun(file, { cmdArgv });
		}

		try {
			const source = readFileSync(file, "utf-8");
			run(source, file, { cmdArgv });
			return 0;
		} catch (e) {
			if (e instanceof CmdRuntimeError) {
				stderr.write(`Error: ${e.message}\n`);
				return 1;
			}
			if (e instanceof CliUsageError) {
				stderr.write(`error: ${e.message}\n`);
				return 1;
			}
			if (e instanceof EspetoError) {
				stderr.write(`${formatError(e, { color: stderr.isTTY === true })}\n`);
				return 1;
			}
			stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
			return 1;
		}
	}

	if (args[0] === "repl") {
		await startRepl();
		return 0;
	}

	stderr.write(`error: unknown command: ${args[0]}\n\n`);
	stderr.write(HELP);
	return 1;
}

main().then(exit);
