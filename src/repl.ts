import { createInterface } from "node:readline";
import { stderr, stdin, stdout } from "node:process";
import { Env } from "./env";
import { EspetoError, formatError } from "./errors";
import { CmdRuntimeError, evaluate, floatToString } from "./evaluator";
import { lex } from "./lexer";
import { parse } from "./parser";
import { loadPrelude } from "./stdlib";
import { isBuiltin, isList, isMap, isUserFn, type Value } from "./values";

export type ReplResult =
	| { kind: "value"; value: Value }
	| { kind: "binding"; name: string }
	| { kind: "fn_def"; names: string[] }
	| { kind: "empty" }
	| { kind: "incomplete" }
	| { kind: "error"; error: unknown };

export function replEval(
	env: Env,
	source: string,
	file = "<repl>",
): ReplResult {
	let module;
	try {
		const tokens = lex(source, file);
		module = parse(tokens, source);
	} catch (e) {
		if (e instanceof EspetoError && isIncompleteError(e)) {
			return { kind: "incomplete" };
		}
		return { kind: "error", error: e };
	}

	if (module.items.length === 0) {
		return { kind: "empty" };
	}

	for (const item of module.items) {
		if (item.kind === "import") {
			return {
				kind: "error",
				error: new EspetoError(
					"import not supported in REPL — use ':load' (coming soon) or run a script with 'espeto run'",
					item.span,
					source,
				),
			};
		}
	}

	const fnNames: string[] = [];
	for (const item of module.items) {
		if (item.kind === "fn_def") fnNames.push(item.name);
	}

	let result: Value;
	try {
		result = evaluate(module, env, source, null);
	} catch (e) {
		return { kind: "error", error: e };
	}

	const last = module.items[module.items.length - 1]!;
	if (last.kind === "fn_def") return { kind: "fn_def", names: fnNames };
	if (last.kind === "assign") return { kind: "binding", name: last.name };
	if (last.kind === "cmd") return { kind: "empty" };
	return { kind: "value", value: result };
}

function isIncompleteError(err: EspetoError): boolean {
	const m = err.message;
	return (
		m === "unterminated string" ||
		m === "unterminated string template" ||
		m === "unterminated interpolation" ||
		m === "unterminated escape" ||
		m === "expected 'end' to close cmd" ||
		m === "expected 'end' to close if" ||
		m === "expected 'end' to close try" ||
		m === "expected 'rescue' to close try" ||
		m === "unexpected token: eof" ||
		m.endsWith(", got eof")
	);
}

export function inspectValue(v: Value): string {
	if (v === null) return "nil";
	if (typeof v === "string") return JSON.stringify(v);
	if (typeof v === "bigint") return v.toString();
	if (typeof v === "number") return floatToString(v);
	if (typeof v === "boolean") return v ? "true" : "false";
	if (isList(v)) return `[${v.map(inspectValue).join(", ")}]`;
	if (isMap(v)) {
		const parts = Object.keys(v.entries).map(
			(k) => `${k}: ${inspectValue(v.entries[k]!)}`,
		);
		return `{${parts.join(", ")}}`;
	}
	if (isBuiltin(v) || isUserFn(v)) return `#fn<${v.name}>`;
	return "?";
}

export function startRepl(): Promise<void> {
	const preludeEnv = new Env();
	loadPrelude(preludeEnv);
	let env = preludeEnv.extend();

	const isTty = stdin.isTTY === true;
	const rl = createInterface({
		input: stdin,
		output: stdout,
		prompt: "> ",
		terminal: isTty,
	});
	const prompt = (continuation = false): void => {
		if (!isTty) return;
		rl.setPrompt(continuation ? "… " : "> ");
		rl.prompt();
	};

	let buffer = "";

	if (isTty) {
		stdout.write("Espeto REPL — :quit to exit, :reset to clear env\n");
	}
	prompt();

	return new Promise<void>((resolve) => {
		rl.on("line", (line) => {
			if (buffer === "") {
				const trimmed = line.trim();
				if (trimmed === ":quit" || trimmed === ":q") {
					rl.close();
					return;
				}
				if (trimmed === ":reset") {
					env = preludeEnv.extend();
					stdout.write("env reset\n");
					prompt();
					return;
				}
			}

			buffer = buffer === "" ? line : `${buffer}\n${line}`;

			const result = replEval(env, buffer);
			if (result.kind === "incomplete") {
				prompt(true);
				return;
			}

			buffer = "";

			if (result.kind === "value") {
				stdout.write(`${inspectValue(result.value)}\n`);
			} else if (result.kind === "error") {
				const e = result.error;
				if (e instanceof EspetoError) {
					stderr.write(
						`${formatError(e, { color: stderr.isTTY === true })}\n`,
					);
				} else if (e instanceof CmdRuntimeError || e instanceof Error) {
					stderr.write(`Error: ${e.message}\n`);
				} else {
					stderr.write(`Error: ${String(e)}\n`);
				}
			}

			prompt();
		});

		rl.on("close", () => {
			if (isTty) stdout.write("\n");
			resolve();
		});
	});
}
