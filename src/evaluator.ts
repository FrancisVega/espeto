import type {
	AssertExpr,
	BinaryOp,
	Cmd,
	Expr,
	FieldAccess,
	FieldShorthand,
	IfExpr,
	LambdaExpr,
	ListExpr,
	MapExpr,
	Module,
	ProgramDecl,
	Stmt,
	TryExpr,
	UnaryOp,
} from "./ast";
import {
	CliUsageError,
	formatHelp,
	formatProgramHelp,
	formatUsageLine,
	parseCmdArgv,
	parseProgramFlags,
	pickMeta,
	splitProgramArgv,
} from "./cmd";
import type { Env } from "./env";
import { AssertionError, EspetoError } from "./errors";
import { findSimilar } from "./hints";
import {
	isCallable,
	isBuiltin,
	isList,
	isMap,
	isStream,
	isUserFn,
	type BuiltinFn,
	type Invoke,
	type MapValue,
	type UserFn,
	type Value,
	typeName,
} from "./values";

export class CmdRuntimeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CmdRuntimeError";
	}
}

export function evaluate(
	module: Module,
	env: Env,
	source: string,
	cmdArgv: string[] | null = null,
): Value {
	for (const item of module.items) {
		if (item.kind === "fn_def") {
			env.define(item.name, {
				kind: "userfn",
				name: item.name,
				params: item.params,
				body: item.body,
				closure: env,
				source,
			});
		}
	}

	let cmd: Cmd | null = null;
	let prog: ProgramDecl | null = null;
	for (const item of module.items) {
		if (item.kind === "cmd") {
			cmd = item;
			break;
		}
		if (item.kind === "program") {
			prog = item;
			break;
		}
	}

	let result: Value = null;
	for (const item of module.items) {
		if (item.kind === "fn_def") continue;
		if (item.kind === "cmd") continue;
		if (item.kind === "program") continue;
		if (item.kind === "import") continue;
		if (item.kind === "test") continue;
		if (item.kind === "assign") {
			const v = evalExpr(item.value, env, source);
			env.define(item.name, v);
			continue;
		}
		result = evalExpr(item, env, source);
	}

	if (prog && cmdArgv !== null) {
		return runProgram(prog, env, source, cmdArgv);
	}
	if (cmd && cmdArgv !== null) {
		return runCmd(cmd, env, source, cmdArgv);
	}

	return result;
}

function runProgram(
	prog: ProgramDecl,
	env: Env,
	source: string,
	argv: string[],
): Value {
	const split = splitProgramArgv(argv, prog.flags);
	const progParse = parseProgramFlags(prog, split.progArgv);

	if (progParse.kind === "help") {
		process.stdout.write(formatProgramHelp(prog));
		return null;
	}
	if (progParse.kind === "version") {
		const v = pickMeta(prog.meta, "meta_version");
		if (v !== null) process.stdout.write(`${v}\n`);
		return null;
	}

	if (split.subcmd === null) {
		process.stdout.write(formatProgramHelp(prog));
		return null;
	}

	const cmd = prog.cmds.find((c) => c.name === split.subcmd);
	if (!cmd) {
		const names = prog.cmds.map((c) => c.name);
		const hint = findSimilar(split.subcmd, names);
		const lines: string[] = [`unknown subcommand '${split.subcmd}'`];
		if (hint) {
			lines.push("");
			lines.push(`  did you mean '${hint}'?`);
		}
		lines.push("");
		lines.push(`run '${prog.name} --help' for available commands.`);
		throw new CliUsageError(lines.join("\n"));
	}

	const progEnv = env.extend();
	for (const flag of prog.flags) {
		const v = progParse.provided.get(flag.name);
		if (v !== undefined) {
			progEnv.define(flag.name, v);
		} else if (flag.default) {
			progEnv.define(flag.name, evalExpr(flag.default, env, source));
		} else {
			throw new CliUsageError(
				`missing required flag: --${flag.name.replace(/_/g, "-")}`,
			);
		}
	}

	return runCmd(cmd, progEnv, source, split.cmdArgv, prog);
}

function runCmd(
	cmd: Cmd,
	env: Env,
	source: string,
	argv: string[],
	parent?: ProgramDecl,
): Value {
	const parseRes = parseCmdArgv(cmd, argv, parent);
	if (parseRes.kind === "help") {
		process.stdout.write(formatHelp(cmd, parent));
		return null;
	}

	const cmdEnv = env.extend();
	for (const decl of cmd.decls) {
		if (parseRes.provided.has(decl.name)) {
			cmdEnv.define(decl.name, parseRes.provided.get(decl.name)!);
		} else if (decl.default) {
			cmdEnv.define(decl.name, evalExpr(decl.default, env, source));
		} else {
			const label =
				decl.kind === "arg_decl"
					? `<${decl.name}>`
					: `--${decl.name.replace(/_/g, "-")}`;
			const kindLabel = decl.kind === "arg_decl" ? "argument" : "flag";
			throw new CliUsageError(
				`missing required ${kindLabel} ${label}\n\n${formatUsageLine(cmd, parent)}`,
			);
		}
	}

	try {
		let last: Value = null;
		for (const stmt of cmd.body) {
			if (stmt.kind === "assign") {
				cmdEnv.define(stmt.name, evalExpr(stmt.value, cmdEnv, source));
				last = null;
			} else {
				last = evalExpr(stmt, cmdEnv, source);
			}
		}
		return last;
	} catch (e) {
		if (e instanceof CliUsageError) throw e;
		if (e instanceof CmdRuntimeError) throw e;
		const msg = e instanceof Error ? e.message : String(e);
		throw new CmdRuntimeError(msg);
	}
}

function evalExpr(expr: Expr, env: Env, source: string): Value {
	switch (expr.kind) {
		case "string":
			return evalStringExpr(expr.parts, env, source);
		case "int":
			return BigInt(expr.value);
		case "float":
		case "bool":
			return expr.value;
		case "nil":
			return null;
		case "ident": {
			const v = env.lookup(expr.name);
			if (v === undefined) {
				const hint = findSimilar(expr.name, env.allNames());
				const msg = hint
					? `undefined: ${expr.name} (did you mean '${hint}'?)`
					: `undefined: ${expr.name}`;
				throw new EspetoError(msg, expr.span, source);
			}
			return v;
		}
		case "call": {
			const callee = evalExpr(expr.callee, env, source);
			if (!isCallable(callee)) {
				throw new EspetoError(
					`not a function: ${typeName(callee)}`,
					expr.callee.span,
					source,
				);
			}
			const args = expr.args.map((a) => evalExpr(a, env, source));
			try {
				return invoke(callee, args, source, expr.span);
			} catch (e) {
				if (e instanceof EspetoError) throw e;
				const msg = e instanceof Error ? e.message : String(e);
				throw new EspetoError(msg, expr.span, source);
			}
		}
		case "pipe": {
			const placeholder = expr.rhs.args.findIndex(
				(a) => a.kind === "ident" && a.name === "_",
			);
			const args =
				placeholder === -1
					? [expr.lhs, ...expr.rhs.args]
					: expr.rhs.args.map((a, i) => (i === placeholder ? expr.lhs : a));
			return evalExpr({ ...expr.rhs, args }, env, source);
		}
		case "binop":
			return evalBinaryOp(expr, env, source);
		case "unop":
			return evalUnaryOp(expr, env, source);
		case "if":
			return evalIf(expr, env, source);
		case "lambda":
			return evalLambda(expr, env, source);
		case "list":
			return expr.items.map((it) => evalExpr(it, env, source));
		case "map":
			return evalMap(expr, env, source);
		case "field_access":
			return evalFieldAccess(expr, env, source);
		case "field_shorthand":
			return evalFieldShorthand(expr, env, source);
		case "try":
			return evalTry(expr, env, source);
		case "assert":
			return evalAssert(expr, env, source);
	}
}

export function evalStmts(stmts: Stmt[], env: Env, source: string): Value {
	let last: Value = null;
	for (const stmt of stmts) {
		if (stmt.kind === "assign") {
			env.define(stmt.name, evalExpr(stmt.value, env, source));
			last = null;
		} else {
			last = evalExpr(stmt, env, source);
		}
	}
	return last;
}

function evalTry(expr: TryExpr, env: Env, source: string): Value {
	try {
		return evalStmts(expr.tryBody, env.extend(), source);
	} catch (e) {
		if (e instanceof CliUsageError) throw e;
		if (e instanceof AssertionError) throw e;
		const msg =
			e instanceof EspetoError
				? e.message
				: e instanceof Error
					? e.message
					: String(e);
		const rescueEnv = env.extend();
		rescueEnv.define(expr.errBinding, msg);
		return evalStmts(expr.rescueBody, rescueEnv, source);
	}
}

function evalAssert(expr: AssertExpr, env: Env, source: string): Value {
	const inner = expr.expr;
	if (
		inner.kind === "binop" &&
		(inner.op === "==" ||
			inner.op === "<" ||
			inner.op === "<=" ||
			inner.op === ">" ||
			inner.op === ">=")
	) {
		const lhs = evalExpr(inner.lhs, env, source);
		const rhs = evalExpr(inner.rhs, env, source);
		const pass = compareValues(inner.op, lhs, rhs, inner.span, source);
		if (pass) return null;
		const lhsStr = formatValueForAssert(lhs);
		const rhsStr = formatValueForAssert(rhs);
		const msg =
			inner.op === "=="
				? `assertion failed\n   expected: ${rhsStr}\n        got: ${lhsStr}`
				: `assertion failed: expected ${lhsStr} ${inner.op} ${rhsStr}`;
		throw new AssertionError(msg, inner.span, source);
	}

	const result = evalExpr(inner, env, source);
	if (typeof result !== "boolean") {
		throw new EspetoError(
			`assert requires bool, got ${typeName(result)}`,
			inner.span,
			source,
		);
	}
	if (!result) {
		throw new AssertionError("assertion failed", inner.span, source);
	}
	return null;
}

function compareValues(
	op: "==" | "<" | "<=" | ">" | ">=",
	lhs: Value,
	rhs: Value,
	span: import("./errors").Span,
	source: string,
): boolean {
	if (op === "==") {
		return equalValues(lhs, rhs, span, source);
	}
	if (typeof lhs === "bigint" && typeof rhs === "bigint") {
		return compareOp(op, lhs, rhs);
	}
	if (typeof lhs === "number" && typeof rhs === "number") {
		return compareOp(op, lhs, rhs);
	}
	if (typeof lhs === "string" && typeof rhs === "string") {
		return compareOp(op, lhs, rhs);
	}
	throw new EspetoError(
		`'${op}' requires same numeric type or strings, got ${typeName(lhs)} and ${typeName(rhs)}`,
		span,
		source,
	);
}

function formatValueForAssert(v: Value): string {
	if (v === null) return "nil";
	if (typeof v === "string") return JSON.stringify(v);
	if (typeof v === "bigint") return v.toString();
	if (typeof v === "number") return floatToString(v);
	if (typeof v === "boolean") return v ? "true" : "false";
	if (isList(v)) return `[${v.map(formatValueForAssert).join(", ")}]`;
	if (isMap(v)) {
		const parts = Object.keys(v.entries).map(
			(k) => `${k}: ${formatValueForAssert(v.entries[k]!)}`,
		);
		return `{${parts.join(", ")}}`;
	}
	if (isStream(v)) return "#stream";
	if (isBuiltin(v) || isUserFn(v)) return `#fn<${v.name}>`;
	return "?";
}

function evalMap(expr: MapExpr, env: Env, source: string): MapValue {
	const entries: Record<string, Value> = {};
	for (const e of expr.entries) {
		entries[e.key] = evalExpr(e.value, env, source);
	}
	return { kind: "map", entries };
}

function evalFieldAccess(
	expr: FieldAccess,
	env: Env,
	source: string,
): Value {
	const target = evalExpr(expr.target, env, source);
	if (!isMap(target)) {
		throw new EspetoError(
			`'.${expr.field}' requires map, got ${typeName(target)}`,
			expr.target.span,
			source,
		);
	}
	if (!Object.prototype.hasOwnProperty.call(target.entries, expr.field)) {
		throw new EspetoError(
			`key not found: ${expr.field}`,
			expr.fieldSpan,
			source,
		);
	}
	return target.entries[expr.field]!;
}

function evalFieldShorthand(
	expr: FieldShorthand,
	env: Env,
	source: string,
): UserFn {
	const field = expr.field;
	const fieldSpan = expr.span;
	return {
		kind: "userfn",
		name: `<.${field}>`,
		params: ["__x"],
		body: [
			{
				kind: "field_access",
				target: { kind: "ident", name: "__x", span: fieldSpan },
				field,
				fieldSpan,
				span: fieldSpan,
			},
		],
		closure: env,
		source,
	};
}

function evalLambda(expr: LambdaExpr, env: Env, source: string): UserFn {
	return {
		kind: "userfn",
		name: "<lambda>",
		params: expr.params,
		body: [expr.body],
		closure: env,
		source,
	};
}

function evalBinaryOp(expr: BinaryOp, env: Env, source: string): Value {
	if (expr.op === "and" || expr.op === "or") {
		const lhs = evalExpr(expr.lhs, env, source);
		if (typeof lhs !== "boolean") {
			throw new EspetoError(
				`'${expr.op}' requires bool, got ${typeName(lhs)}`,
				expr.lhs.span,
				source,
			);
		}
		if (expr.op === "and" && !lhs) return false;
		if (expr.op === "or" && lhs) return true;
		const rhs = evalExpr(expr.rhs, env, source);
		if (typeof rhs !== "boolean") {
			throw new EspetoError(
				`'${expr.op}' requires bool, got ${typeName(rhs)}`,
				expr.rhs.span,
				source,
			);
		}
		return rhs;
	}

	const lhs = evalExpr(expr.lhs, env, source);
	const rhs = evalExpr(expr.rhs, env, source);

	if (
		expr.op === "==" ||
		expr.op === "<" ||
		expr.op === "<=" ||
		expr.op === ">" ||
		expr.op === ">="
	) {
		return compareValues(expr.op, lhs, rhs, expr.span, source);
	}

	if (
		expr.op === "+" ||
		expr.op === "-" ||
		expr.op === "*" ||
		expr.op === "/"
	) {
		const lhsNum = typeof lhs === "bigint" || typeof lhs === "number";
		const rhsNum = typeof rhs === "bigint" || typeof rhs === "number";
		if (!lhsNum || !rhsNum) {
			throw new EspetoError(
				`'${expr.op}' requires numbers, got ${typeName(lhs)} and ${typeName(rhs)}`,
				expr.span,
				source,
			);
		}
		if (expr.op === "/") {
			const ln = typeof lhs === "bigint" ? Number(lhs) : (lhs as number);
			const rn = typeof rhs === "bigint" ? Number(rhs) : (rhs as number);
			return ln / rn;
		}
		if (typeof lhs !== typeof rhs) {
			throw new EspetoError(
				`'${expr.op}' requires same numeric type, got ${typeName(lhs)} and ${typeName(rhs)} (use to_int/to_float to convert)`,
				expr.span,
				source,
			);
		}
		if (typeof lhs === "bigint") {
			const r = rhs as bigint;
			switch (expr.op) {
				case "+":
					return lhs + r;
				case "-":
					return lhs - r;
				case "*":
					return lhs * r;
			}
		}
		const l = lhs as number;
		const r = rhs as number;
		switch (expr.op) {
			case "+":
				return l + r;
			case "-":
				return l - r;
			case "*":
				return l * r;
		}
	}

	throw new EspetoError(
		`unsupported binary op: ${expr.op}`,
		expr.span,
		source,
	);
}

function compareOp<T extends number | bigint | string>(
	op: "<" | "<=" | ">" | ">=",
	lhs: T,
	rhs: T,
): boolean {
	switch (op) {
		case "<":
			return lhs < rhs;
		case "<=":
			return lhs <= rhs;
		case ">":
			return lhs > rhs;
		case ">=":
			return lhs >= rhs;
	}
}

function equalValues(
	lhs: Value,
	rhs: Value,
	span: import("./errors").Span,
	source: string,
): boolean {
	if (isCallable(lhs) || isCallable(rhs)) {
		throw new EspetoError(
			"functions are not comparable",
			span,
			source,
		);
	}
	if (isStream(lhs) || isStream(rhs)) {
		throw new EspetoError(
			"streams are not comparable (consume with collect first)",
			span,
			source,
		);
	}
	if (lhs === null || rhs === null) return lhs === rhs;
	if (isList(lhs) || isList(rhs)) {
		if (!isList(lhs) || !isList(rhs)) return false;
		if (lhs.length !== rhs.length) return false;
		for (let i = 0; i < lhs.length; i++) {
			if (!equalValues(lhs[i]!, rhs[i]!, span, source)) return false;
		}
		return true;
	}
	if (isMap(lhs) || isMap(rhs)) {
		if (!isMap(lhs) || !isMap(rhs)) return false;
		const lk = Object.keys(lhs.entries);
		const rk = Object.keys(rhs.entries);
		if (lk.length !== rk.length) return false;
		for (const k of lk) {
			if (!Object.prototype.hasOwnProperty.call(rhs.entries, k)) return false;
			if (!equalValues(lhs.entries[k]!, rhs.entries[k]!, span, source))
				return false;
		}
		return true;
	}
	if (typeof lhs !== typeof rhs) return false;
	return lhs === rhs;
}

function evalUnaryOp(expr: UnaryOp, env: Env, source: string): Value {
	const operand = evalExpr(expr.operand, env, source);
	if (expr.op === "-") {
		if (typeof operand !== "number" && typeof operand !== "bigint") {
			throw new EspetoError(
				`unary '-' requires number, got ${typeName(operand)}`,
				expr.span,
				source,
			);
		}
		return -operand;
	}
	if (typeof operand !== "boolean") {
		throw new EspetoError(
			`'not' requires bool, got ${typeName(operand)}`,
			expr.span,
			source,
		);
	}
	return !operand;
}

function evalIf(expr: IfExpr, env: Env, source: string): Value {
	for (const branch of expr.branches) {
		const cond = evalExpr(branch.cond, env, source);
		if (typeof cond !== "boolean") {
			throw new EspetoError(
				`if condition must be bool, got ${typeName(cond)}`,
				branch.cond.span,
				source,
			);
		}
		if (cond) {
			return evalExpr(branch.body, env, source);
		}
	}
	if (expr.elseBody) {
		return evalExpr(expr.elseBody, env, source);
	}
	return null;
}

function invoke(
	callee: BuiltinFn | UserFn,
	args: Value[],
	source: string,
	callSpan: import("./errors").Span | null,
): Value {
	const inv: Invoke = (c, a) => invoke(c, a, source, callSpan);
	if (callee.kind === "builtin") {
		if (callee.arity !== -1 && args.length !== callee.arity) {
			throw new Error(
				`${callee.name}: expected ${callee.arity} args, got ${args.length}`,
			);
		}
		const ctx = callSpan === null ? null : { span: callSpan, source };
		return callee.call(args, inv, ctx);
	}
	if (args.length !== callee.params.length) {
		throw new Error(
			`${callee.name}: expected ${callee.params.length} args, got ${args.length}`,
		);
	}
	const childEnv = callee.closure.extend();
	for (let i = 0; i < callee.params.length; i++) {
		childEnv.define(callee.params[i]!, args[i]!);
	}
	try {
		return evalStmts(callee.body, childEnv, callee.source);
	} catch (e) {
		if (e instanceof EspetoError && callSpan !== null) {
			e.frames.push({
				name: callee.name,
				callSpan,
				callerSource: source,
			});
		}
		throw e;
	}
}

function evalStringExpr(
	parts: (string | Expr)[],
	env: Env,
	source: string,
): string {
	let out = "";
	for (const p of parts) {
		if (typeof p === "string") {
			out += p;
		} else {
			out += valueToInterpString(evalExpr(p, env, source));
		}
	}
	return out;
}

function valueToInterpString(v: Value): string {
	if (v === null) return "nil";
	if (typeof v === "string") return v;
	if (typeof v === "bigint") return v.toString();
	if (typeof v === "number") return floatToString(v);
	if (typeof v === "boolean") return v ? "true" : "false";
	if (isList(v)) return `[${v.map(valueToInterpString).join(", ")}]`;
	if (isMap(v)) {
		const parts = Object.keys(v.entries).map(
			(k) => `${k}: ${valueToInterpString(v.entries[k]!)}`,
		);
		return `{${parts.join(", ")}}`;
	}
	if (isStream(v)) {
		throw new Error(
			"interpolation: streams cannot be stringified (consume with each/collect first)",
		);
	}
	if (isBuiltin(v) || isUserFn(v)) return `#fn<${v.name}>`;
	return "?";
}

export function floatToString(n: number): string {
	if (Number.isNaN(n)) return "NaN";
	if (n === Number.POSITIVE_INFINITY) return "Infinity";
	if (n === Number.NEGATIVE_INFINITY) return "-Infinity";
	const s = String(n);
	if (s.includes(".") || s.includes("e") || s.includes("E")) return s;
	return `${s}.0`;
}
