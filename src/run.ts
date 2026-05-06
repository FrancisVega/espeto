import { resolve as resolvePath } from "node:path";
import { Env } from "./env";
import { evaluate } from "./evaluator";
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
	const program = parse(tokens, source);
	const preludeEnv = new Env();
	loadPrelude(preludeEnv);
	const userEnv = preludeEnv.extend();

	const resolver = opts.resolver ?? defaultResolver;
	const entryAbsPath = opts.entryAbsPath ?? resolvePath(file);
	const loader = new ModuleLoader(preludeEnv, resolver);
	loader.loadInto(program, userEnv, entryAbsPath, source);

	const cmdArgv = opts.cmdArgv ?? null;
	return evaluate(program, userEnv, source, cmdArgv);
}
