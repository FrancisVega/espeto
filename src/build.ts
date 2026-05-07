import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "./lexer";
import { parse } from "./parser";

export type BuildTarget =
	| "darwin-arm64"
	| "darwin-x64"
	| "linux-x64"
	| "linux-arm64"
	| "windows-x64";

export type BuildOptions = {
	entryFile: string;
	outFile: string;
	target?: BuildTarget;
};

export class BuildError extends Error {}

export function build(opts: BuildOptions): void {
	if (!checkBunAvailable()) {
		throw new BuildError(
			"bun not found in PATH. install: curl -fsSL https://bun.sh/install | bash",
		);
	}

	const entryAbs = resolvePath(opts.entryFile);
	if (!existsSync(entryAbs)) {
		throw new BuildError(`entry file not found: ${opts.entryFile}`);
	}

	const sources = collectSources(entryAbs);
	const runtimePath = resolveRuntimePath();

	const tempDir = mkdtempSync(join(tmpdir(), "espeto-build-"));
	try {
		const entryTs = join(tempDir, "entry.ts");
		writeFileSync(entryTs, generateEntry(sources, entryAbs, runtimePath));

		const bunArgs = ["build", "--compile", entryTs, `--outfile=${opts.outFile}`];
		if (opts.target) bunArgs.push(`--target=bun-${opts.target}`);

		const result = spawnSync("bun", bunArgs, { stdio: "inherit" });
		if (result.status !== 0) {
			throw new BuildError(`bun build failed (exit ${result.status})`);
		}
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

function checkBunAvailable(): boolean {
	const r = spawnSync("bun", ["--version"], { stdio: "ignore" });
	return r.status === 0;
}

function collectSources(entryAbs: string): Map<string, string> {
	const sources = new Map<string, string>();
	const stack: string[] = [entryAbs];

	while (stack.length > 0) {
		const path = stack.pop()!;
		if (sources.has(path)) continue;

		let src: string;
		try {
			src = readFileSync(path, "utf-8");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new BuildError(`cannot read ${path}: ${msg}`);
		}
		sources.set(path, src);

		const tokens = lex(src, path);
		const module = parse(tokens, src);
		for (const item of module.items) {
			if (item.kind !== "import") continue;
			const importedAbs = resolvePath(dirname(path), `${item.path}.esp`);
			stack.push(importedAbs);
		}
	}

	return sources;
}

function resolveRuntimePath(): string {
	const distPath = fileURLToPath(new URL("./runtime.js", import.meta.url));
	if (existsSync(distPath)) return distPath;
	const devPath = fileURLToPath(new URL("./run.ts", import.meta.url));
	if (existsSync(devPath)) return devPath;
	throw new BuildError(
		"cannot locate espeto runtime (looked for runtime.js and run.ts)",
	);
}

function generateEntry(
	sources: Map<string, string>,
	entryAbs: string,
	runtimePath: string,
): string {
	const entries: string[] = [];
	for (const [path, src] of sources) {
		entries.push(`  [${JSON.stringify(path)}, ${JSON.stringify(src)}],`);
	}
	const sourcesLiteral = `new Map<string, string>([\n${entries.join("\n")}\n])`;

	return `import { runMain } from ${JSON.stringify(runtimePath)};
import { dirname, resolve as resolvePath } from "node:path";

const SOURCES: Map<string, string> = ${sourcesLiteral};
const ENTRY = ${JSON.stringify(entryAbs)};

const memResolver = (importerAbs: string, importPath: string) => {
  const abs = resolvePath(dirname(importerAbs), importPath + ".esp");
  const src = SOURCES.get(abs);
  if (src === undefined) {
    throw new Error("embedded source missing: " + abs);
  }
  return { absPath: abs, source: src };
};

const mainSource = SOURCES.get(ENTRY);
if (mainSource === undefined) {
  throw new Error("embedded entry source missing: " + ENTRY);
}

const code = runMain(mainSource, ENTRY, {
  cmdArgv: process.argv.slice(2),
  resolver: memResolver,
  entryAbsPath: ENTRY,
});
process.exit(code);
`;
}
