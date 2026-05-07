import { resolve as resolvePath } from "node:path";
import { stderr } from "node:process";
import { CliUsageError } from "./cmd";
import { Env } from "./env";
import { EspetoError, formatError } from "./errors";
import { CmdRuntimeError, evaluate } from "./evaluator";
import { defaultResolver, ModuleLoader, type Resolver } from "./imports";
import { lex } from "./lexer";
import { parse } from "./parser";
import { loadPrelude } from "./stdlib";
import type { Value } from "./values";

export type RunOptions = {
	cmdArgv?: string[] | null;
	resolver?: Resolver;
	entryAbsPath?: string;
};

export function run(
	source: string,
	file: string,
	opts: RunOptions = {},
): Value {
	const tokens = lex(source, file);
	const module = parse(tokens, source);
	const preludeEnv = new Env();
	loadPrelude(preludeEnv);
	const userEnv = preludeEnv.extend();

	const resolver = opts.resolver ?? defaultResolver;
	const entryAbsPath = opts.entryAbsPath ?? resolvePath(file);
	const loader = new ModuleLoader(preludeEnv, resolver);
	loader.loadInto(module, userEnv, entryAbsPath, source);

	const cmdArgv = opts.cmdArgv ?? null;
	return evaluate(module, userEnv, source, cmdArgv);
}

export function runMain(
	source: string,
	file: string,
	opts: RunOptions = {},
): number {
	const color = stderr.isTTY === true;
	try {
		run(source, file, opts);
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
			stderr.write(`${formatError(e, { color })}\n`);
			return 1;
		}
		stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
		return 1;
	}
}
