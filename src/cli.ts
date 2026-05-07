import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { build, BuildError, type BuildTarget } from "./build";
import { startRepl } from "./repl";
import { runMain } from "./run";
import { watchAndRun } from "./watch";

const VERSION = "0.1.0";

const VALID_TARGETS: ReadonlySet<BuildTarget> = new Set([
	"darwin-arm64",
	"darwin-x64",
	"linux-x64",
	"linux-arm64",
	"windows-x64",
]);

const HELP = `espeto v${VERSION}

usage:
  espeto run [-w|--watch] <file.esp> [cmd-args...]        run an Espeto program
  espeto build <file.esp> -o <out> [--target T]           bundle into a standalone binary
  espeto repl                                             start interactive REPL
  espeto lsp                                              run language server (stdio)
  espeto --help                                           show this help
  espeto --version                                        show version

build targets (--target):
  darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64
  (default: host platform)
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
		return await runRun(args.slice(1));
	}

	if (args[0] === "build") {
		return runBuild(args.slice(1));
	}

	if (args[0] === "repl") {
		await startRepl();
		return 0;
	}

	if (args[0] === "lsp") {
		return runLsp();
	}

	stderr.write(`error: unknown command: ${args[0]}\n\n`);
	stderr.write(HELP);
	return 1;
}

async function runRun(args: string[]): Promise<number> {
	let file: string | undefined;
	let watch = false;
	let i = 0;
	while (i < args.length) {
		const a = args[i]!;
		if (a === "--watch" || a === "-w") {
			watch = true;
			i++;
			continue;
		}
		if (a === "--") {
			i++;
			break;
		}
		if (a.startsWith("-") && a !== "-") {
			stderr.write(`error: unknown flag: ${a}\n`);
			return 1;
		}
		file = a;
		i++;
		break;
	}

	let cmdArgv = args.slice(i);
	const sepIdx = cmdArgv.indexOf("--");
	if (sepIdx >= 0) {
		cmdArgv = [...cmdArgv.slice(0, sepIdx), ...cmdArgv.slice(sepIdx + 1)];
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

	let source: string;
	try {
		source = readFileSync(file, "utf-8");
	} catch (e) {
		stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
		return 1;
	}
	return runMain(source, file, { cmdArgv });
}

function runBuild(args: string[]): number {
	let entryFile: string | undefined;
	let outFile: string | undefined;
	let target: BuildTarget | undefined;

	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === undefined) continue;
		if (a === "-o" || a === "--output") {
			outFile = args[++i];
			if (!outFile) {
				stderr.write(`error: ${a} requires a value\n`);
				return 1;
			}
		} else if (a === "--target") {
			const t = args[++i];
			if (!t) {
				stderr.write("error: --target requires a value\n");
				return 1;
			}
			if (!VALID_TARGETS.has(t as BuildTarget)) {
				stderr.write(
					`error: invalid target '${t}'. valid: ${[...VALID_TARGETS].join(", ")}\n`,
				);
				return 1;
			}
			target = t as BuildTarget;
		} else if (a.startsWith("-")) {
			stderr.write(`error: unknown flag: ${a}\n`);
			return 1;
		} else if (!entryFile) {
			entryFile = a;
		} else {
			stderr.write(`error: unexpected argument: ${a}\n`);
			return 1;
		}
	}

	if (!entryFile) {
		stderr.write("error: missing entry file\n\n");
		stderr.write(HELP);
		return 1;
	}
	if (!outFile) {
		stderr.write("error: missing -o <output>\n\n");
		stderr.write(HELP);
		return 1;
	}

	try {
		build({ entryFile, outFile, target });
		return 0;
	} catch (e) {
		if (e instanceof BuildError) {
			stderr.write(`error: ${e.message}\n`);
			return 1;
		}
		stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
		return 1;
	}
}

async function runLsp(): Promise<number> {
	const isDev = import.meta.url.endsWith(".ts");
	const entry = isDev
		? fileURLToPath(new URL("./lsp/server.ts", import.meta.url))
		: fileURLToPath(new URL("./lsp.js", import.meta.url));
	const command = isDev ? "tsx" : process.execPath;
	const cmdArgs = isDev ? [entry] : [entry];
	const child = spawn(command, cmdArgs, { stdio: "inherit" });
	return new Promise<number>((resolve) => {
		child.on("exit", (code) => resolve(code ?? 0));
		child.on("error", (err) => {
			stderr.write(`error: failed to start lsp: ${err.message}\n`);
			resolve(1);
		});
	});
}

main().then(exit);
