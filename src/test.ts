import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve as resolvePath } from "node:path";
import type { TestBlock } from "./ast";
import { CliUsageError } from "./cmd";
import { Env } from "./env";
import { AssertionError, EspetoError } from "./errors";
import { CmdRuntimeError, evalStmts, evaluate } from "./evaluator";
import {
	defaultResolver,
	defineSourceBindings,
	ModuleLoader,
	type Resolver,
} from "./imports";
import { lex } from "./lexer";
import { parse } from "./parser";
import { loadPrelude } from "./stdlib";

export type TestStatus = "pass" | "fail" | "error";

export type TestOutcome = {
	name: string;
	status: TestStatus;
	error?: AssertionError | EspetoError | Error;
	durationMs: number;
};

export type FileOutcome = {
	file: string;
	loadError?: Error;
	tests: TestOutcome[];
};

export type RunSummary = {
	total: number;
	passed: number;
	failed: number;
	errored: number;
	durationMs: number;
};

export type RunOutcome = {
	files: FileOutcome[];
	summary: RunSummary;
};

const TEST_SUFFIX = "_test.esp";

export function discoverTestFiles(root: string): string[] {
	const abs = resolvePath(root);
	let info: ReturnType<typeof statSync>;
	try {
		info = statSync(abs);
	} catch (e) {
		throw new Error(
			`cannot read ${root}: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	if (info.isFile()) {
		if (!abs.endsWith(TEST_SUFFIX)) {
			throw new Error(
				`not a test file: ${root} (test files must end in _test.esp)`,
			);
		}
		return [abs];
	}
	const out: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) continue;
			if (entry.name === "node_modules") continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile() && entry.name.endsWith(TEST_SUFFIX)) {
				out.push(full);
			}
		}
	};
	walk(abs);
	out.sort();
	return out;
}

export type RunOptions = {
	resolver?: Resolver;
};

export function runTestFile(
	absPath: string,
	opts: RunOptions = {},
): FileOutcome {
	let source: string;
	try {
		source = readFileSync(absPath, "utf-8");
	} catch (e) {
		return { file: absPath, loadError: e as Error, tests: [] };
	}

	let module: ReturnType<typeof parse>;
	try {
		const tokens = lex(source, absPath);
		module = parse(tokens, source);
	} catch (e) {
		return { file: absPath, loadError: e as Error, tests: [] };
	}

	const tests = module.items.filter(
		(it): it is TestBlock => it.kind === "test",
	);

	const preludeEnv = new Env();
	loadPrelude(preludeEnv);
	const userEnv = preludeEnv.extend();
	defineSourceBindings(userEnv, absPath);
	const loader = new ModuleLoader(preludeEnv, opts.resolver ?? defaultResolver);

	try {
		loader.loadInto(module, userEnv, absPath, source);
		evaluate(module, userEnv, source, null);
	} catch (e) {
		return { file: absPath, loadError: e as Error, tests: [] };
	}

	const outcomes: TestOutcome[] = [];
	for (const test of tests) {
		const t0 = Date.now();
		const testEnv = userEnv.extend();
		try {
			evalStmts(test.body, testEnv, source);
			outcomes.push({
				name: test.name,
				status: "pass",
				durationMs: Date.now() - t0,
			});
		} catch (e) {
			const status: TestStatus =
				e instanceof AssertionError ? "fail" : "error";
			outcomes.push({
				name: test.name,
				status,
				error: e as Error,
				durationMs: Date.now() - t0,
			});
		}
	}

	return { file: absPath, tests: outcomes };
}

export function runTests(root: string, opts: RunOptions = {}): RunOutcome {
	const files = discoverTestFiles(root);
	const t0 = Date.now();
	const fileOutcomes: FileOutcome[] = [];
	let total = 0;
	let passed = 0;
	let failed = 0;
	let errored = 0;
	for (const file of files) {
		const fo = runTestFile(file, opts);
		if (fo.loadError) {
			errored++;
		}
		for (const t of fo.tests) {
			total++;
			if (t.status === "pass") passed++;
			else if (t.status === "fail") failed++;
			else errored++;
		}
		fileOutcomes.push(fo);
	}
	return {
		files: fileOutcomes,
		summary: {
			total,
			passed,
			failed,
			errored,
			durationMs: Date.now() - t0,
		},
	};
}

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const wrap = (s: string, codes: string, color: boolean): string =>
	color ? `${codes}${s}${RESET}` : s;

function indent(s: string, n: number): string {
	const pad = " ".repeat(n);
	return s
		.split("\n")
		.map((l) => (l.length === 0 ? l : pad + l))
		.join("\n");
}

function relPath(absPath: string, cwd: string): string {
	const rel = relative(cwd, absPath);
	return rel === "" || rel.startsWith("..") ? absPath : rel;
}

function formatLoadError(err: Error, color: boolean): string {
	if (err instanceof EspetoError) {
		return formatEspetoError(err, color);
	}
	return wrap(`error: ${err.message}`, RED, color);
}

function formatEspetoError(err: EspetoError, color: boolean): string {
	const { span, source, message } = err;
	const lines = source.split("\n");
	const line = lines[span.line - 1] ?? "";
	const lineNumStr = String(span.line);
	const gutter = " ".repeat(lineNumStr.length);
	const caretCol = Math.max(span.col - 1, 0);
	const caretLength = Math.max(span.length, 1);
	const carets = "^".repeat(caretLength);
	const loc = wrap(`${span.file}:${span.line}:${span.col}`, BOLD, color);
	const out: string[] = [
		`${message}`,
		wrap(`at ${loc}`, DIM, color),
		`  ${lineNumStr} | ${line}`,
		`  ${gutter} | ${" ".repeat(caretCol)}${wrap(carets, `${RED}${BOLD}`, color)}`,
	];
	return out.join("\n");
}

function formatTestError(
	err: AssertionError | EspetoError | Error,
	color: boolean,
): string {
	if (err instanceof EspetoError) {
		return formatEspetoError(err, color);
	}
	return wrap(`error: ${err.message}`, RED, color);
}

export function formatReport(outcome: RunOutcome, color: boolean): string {
	const cwd = process.cwd();
	const lines: string[] = [];
	for (const fo of outcome.files) {
		lines.push(wrap(relPath(fo.file, cwd), BOLD, color));
		if (fo.loadError) {
			lines.push(
				indent(
					`${wrap("✗", RED, color)} ${wrap("<load error>", RED, color)}`,
					2,
				),
			);
			lines.push(indent(formatLoadError(fo.loadError, color), 6));
		}
		for (const t of fo.tests) {
			if (t.status === "pass") {
				lines.push(indent(`${wrap("✓", GREEN, color)} ${t.name}`, 2));
			} else {
				const mark = wrap("✗", RED, color);
				const tag =
					t.status === "fail"
						? wrap("fail", RED, color)
						: wrap("error", RED, color);
				lines.push(indent(`${mark} ${tag}: ${t.name}`, 2));
				if (t.error) lines.push(indent(formatTestError(t.error, color), 6));
			}
		}
		lines.push("");
	}

	const { summary } = outcome;
	const partsRaw: string[] = [];
	partsRaw.push(`${summary.total} tests`);
	if (summary.failed > 0) partsRaw.push(`${summary.failed} failed`);
	if (summary.errored > 0) partsRaw.push(`${summary.errored} errored`);
	const passLabel =
		summary.failed === 0 && summary.errored === 0 && summary.total > 0
			? wrap(partsRaw.join(", "), GREEN, color)
			: summary.failed > 0 || summary.errored > 0
				? wrap(partsRaw.join(", "), RED, color)
				: partsRaw.join(", ");
	lines.push(`${passLabel} (${summary.durationMs}ms)`);
	return lines.join("\n");
}

export function exitCodeFor(outcome: RunOutcome): number {
	const { summary } = outcome;
	if (summary.failed > 0 || summary.errored > 0) return 1;
	return 0;
}

export function runTestsMain(root: string, opts: RunOptions = {}): number {
	const color = process.stderr.isTTY === true && process.env.NO_COLOR !== "1";
	let outcome: RunOutcome;
	try {
		outcome = runTests(root, opts);
	} catch (e) {
		process.stderr.write(
			`error: ${e instanceof Error ? e.message : String(e)}\n`,
		);
		return 1;
	}
	if (outcome.files.length === 0) {
		process.stderr.write(`no test files found under ${root}\n`);
		return 0;
	}
	process.stdout.write(`${formatReport(outcome, color)}\n`);
	return exitCodeFor(outcome);
}

// Re-export for the watcher to use the same machinery.
export { CliUsageError, CmdRuntimeError };
