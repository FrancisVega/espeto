import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { argv, cwd, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { build, BuildError, type BuildTarget } from "./build";
import { buildDocs } from "./docs";
import { AddError, runAdd, type AddSpec } from "./moraga/add";
import { install, InstallError } from "./moraga/install";
import { startRepl } from "./repl";
import { runMain } from "./run";
import { runTestsMain } from "./test";
import { VERSION } from "./version";
import { startTestWatcher, watchAndRun } from "./watch";

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
  espeto test [-w|--watch] [path]                         run *_test.esp under path (default cwd)
  espeto docs                                             print language reference (markdown) to stdout
  espeto repl                                             start interactive REPL
  espeto lsp                                              run language server (stdio)
  espeto install                                          install deps from moraga.esp into .espetos/
  espeto add <url>@<ver> [<url>@<ver>...]                 add deps to moraga.esp + install
  espeto add --dev <url>@<ver> ...                        add to dev_deps
  espeto add --as <name> <url>@<ver>                      add with alias (single dep only)
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

	if (args[0] === "test") {
		return await runTest(args.slice(1));
	}

	if (args[0] === "docs") {
		return runDocs(args.slice(1));
	}

	if (args[0] === "repl") {
		await startRepl();
		return 0;
	}

	if (args[0] === "lsp") {
		return runLsp();
	}

	if (args[0] === "install") {
		return await runInstall(args.slice(1));
	}

	if (args[0] === "add") {
		return await runAddCli(args.slice(1));
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

	if (file.endsWith("_test.esp")) {
		stderr.write(
			`error: test files (*_test.esp) must be run with 'espeto test'\n`,
		);
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

async function runTest(args: string[]): Promise<number> {
	let path: string | undefined;
	let watch = false;
	for (let i = 0; i < args.length; i++) {
		const a = args[i]!;
		if (a === "--watch" || a === "-w") {
			watch = true;
			continue;
		}
		if (a.startsWith("-") && a !== "-") {
			stderr.write(`error: unknown flag: ${a}\n`);
			return 1;
		}
		if (path !== undefined) {
			stderr.write(`error: unexpected argument: ${a}\n`);
			return 1;
		}
		path = a;
	}
	const root = path ?? ".";
	if (watch) {
		return startTestWatcher(root);
	}
	return runTestsMain(root);
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
	if (entryFile.endsWith("_test.esp")) {
		stderr.write(
			`error: test files (*_test.esp) cannot be built into binaries\n`,
		);
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

function runDocs(args: string[]): number {
	if (args.length > 0) {
		stderr.write(`error: unexpected argument: ${args[0]}\n`);
		stderr.write("usage: espeto docs\n");
		return 1;
	}
	stdout.write(buildDocs());
	return 0;
}

async function runInstall(args: string[]): Promise<number> {
	if (args.length > 0) {
		stderr.write(`error: unexpected argument: ${args[0]}\n`);
		stderr.write("usage: espeto install\n");
		return 1;
	}
	try {
		await install(cwd());
		return 0;
	} catch (e) {
		if (e instanceof InstallError) {
			stderr.write(`error: ${e.message}\n`);
			return 1;
		}
		stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
		return 1;
	}
}

async function runAddCli(args: string[]): Promise<number> {
	let dev = false;
	let alias: string | undefined;
	const positional: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i]!;
		if (a === "--dev") {
			dev = true;
			continue;
		}
		if (a === "--as") {
			const v = args[++i];
			if (!v) {
				stderr.write("error: --as requires a value\n");
				return 1;
			}
			alias = v;
			continue;
		}
		if (a.startsWith("--as=")) {
			alias = a.slice("--as=".length);
			continue;
		}
		if (a.startsWith("-")) {
			stderr.write(`error: unknown flag: ${a}\n`);
			return 1;
		}
		positional.push(a);
	}

	if (positional.length === 0) {
		stderr.write("error: missing <url>@<version>\n\n");
		stderr.write("usage: espeto add [--dev] [--as <name>] <url>@<ver> ...\n");
		return 1;
	}

	if (alias !== undefined && positional.length !== 1) {
		stderr.write(
			"error: --as can only be used with a single <url>@<version>\n",
		);
		return 1;
	}

	const specs: AddSpec[] = [];
	for (const p of positional) {
		const at = p.lastIndexOf("@");
		if (at <= 0 || at === p.length - 1) {
			stderr.write(
				`error: "${p}" must be of the form <url>@<version> (e.g., github.com/foo/bar@1.2.3)\n`,
			);
			return 1;
		}
		const url = p.slice(0, at);
		const version = p.slice(at + 1);
		const spec: AddSpec = { url, version };
		if (alias !== undefined) spec.alias = alias;
		specs.push(spec);
	}

	try {
		const r = await runAdd(cwd(), specs, { dev });
		const count = r.added.length;
		const noun = count === 1 ? "package" : "packages";
		const where = dev ? "dev_deps" : "deps";
		if (count > 0) {
			stdout.write(`added ${count} ${noun} to ${where}\n`);
		}
		if (r.skipped.length > 0) {
			stdout.write(
				`already present (skipped): ${r.skipped.join(", ")}\n`,
			);
		}
		return 0;
	} catch (e) {
		if (e instanceof AddError) {
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
