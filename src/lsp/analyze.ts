/**
 * AST analysis for the LSP: locate identifiers at a position and resolve
 * them to their binding (builtin, fn def, arg/flag, let, or lambda param).
 */

import type {
	ArgDecl,
	AssignStmt,
	BinaryOp,
	Call,
	Cmd,
	Expr,
	FieldAccess,
	FieldShorthand,
	FlagDecl,
	FnDef,
	Identifier,
	IfExpr,
	Item,
	LambdaExpr,
	ListExpr,
	MapExpr,
	Module,
	Stmt,
	StringExpr,
	TryExpr,
	UnaryOp,
} from "../ast";
import type { Span } from "../errors";

export type Resolution =
	| { kind: "builtin"; name: string }
	| { kind: "source_binding"; name: "__file__" | "__dir__" }
	| { kind: "fn"; node: FnDef }
	| { kind: "arg"; node: ArgDecl }
	| { kind: "flag"; node: FlagDecl }
	| { kind: "let"; name: string; nameSpan: Span; valueSpan: Span }
	| { kind: "lambda_param"; name: string; span: Span; lambda: LambdaExpr }
	| { kind: "fn_param"; name: string; span: Span; fn: FnDef }
	| { kind: "rescue_err"; name: string; span: Span; tryExpr: TryExpr };

type Binding = { name: string; resolution: Resolution };

function spanContains(span: Span, line: number, col: number): boolean {
	if (span.line !== line) return false;
	return col >= span.col && col < span.col + Math.max(span.length, 1);
}

export function findIdentAt(
	module: Module,
	line: number,
	col: number,
): Identifier | null {
	let best: Identifier | null = null;
	const consider = (id: Identifier) => {
		if (!spanContains(id.span, line, col)) return;
		if (best === null || id.span.length < best.span.length) {
			best = id;
		}
	};

	const visitExpr = (expr: Expr): void => {
		switch (expr.kind) {
			case "ident":
				consider(expr);
				return;
			case "string":
				for (const part of expr.parts) {
					if (typeof part !== "string") visitExpr(part);
				}
				return;
			case "int":
			case "float":
			case "bool":
			case "nil":
			case "field_shorthand":
				return;
			case "call":
				visitExpr(expr.callee);
				for (const a of expr.args) visitExpr(a);
				return;
			case "binop":
				visitExpr(expr.lhs);
				visitExpr(expr.rhs);
				return;
			case "unop":
				visitExpr(expr.operand);
				return;
			case "if":
				for (const b of expr.branches) {
					visitExpr(b.cond);
					visitExpr(b.body);
				}
				if (expr.elseBody) visitExpr(expr.elseBody);
				return;
			case "lambda":
				visitExpr(expr.body);
				return;
			case "list":
				for (const it of expr.items) visitExpr(it);
				return;
			case "map":
				for (const e of expr.entries) visitExpr(e.value);
				return;
			case "field_access":
				visitExpr(expr.target);
				return;
			case "try":
				for (const s of expr.tryBody) visitStmt(s);
				for (const s of expr.rescueBody) visitStmt(s);
				return;
			case "assert":
				visitExpr(expr.expr);
				return;
		}
	};

	const visitStmt = (stmt: Stmt): void => {
		if (stmt.kind === "assign") {
			visitExpr(stmt.value);
			return;
		}
		visitExpr(stmt);
	};

	const visitCmd = (cmd: import("../ast").Cmd): void => {
		for (const decl of cmd.decls) {
			if (decl.default) visitExpr(decl.default);
		}
		for (const s of cmd.body) visitStmt(s);
	};

	for (const item of module.items) {
		switch (item.kind) {
			case "fn_def":
				for (const s of item.body) visitStmt(s);
				break;
			case "cmd":
				visitCmd(item);
				break;
			case "program":
				for (const f of item.flags) {
					if (f.default) visitExpr(f.default);
				}
				for (const cmd of item.cmds) visitCmd(cmd);
				break;
			case "test":
				for (const s of item.body) visitStmt(s);
				break;
			case "assign":
				visitExpr(item.value);
				break;
			case "import":
				break;
			default:
				visitExpr(item);
				break;
		}
	}

	return best;
}

/**
 * Walks all identifiers in the module that appear in usage position
 * (i.e. inside expressions; not the names of declarations themselves).
 * For each identifier, the callback receives the identifier node and the
 * Resolution it refers to (or null). Return false from the callback to
 * stop the walk early.
 */
export function walkIdents(
	module: Module,
	builtinNames: Set<string>,
	onIdent: (ident: Identifier, res: Resolution | null) => boolean,
): void {
	const globalFns: Binding[] = [];
	const globalLets: Binding[] = [];
	for (const item of module.items) {
		if (item.kind === "fn_def") {
			globalFns.push({
				name: item.name,
				resolution: { kind: "fn", node: item },
			});
		} else if (item.kind === "assign") {
			globalLets.push({
				name: item.name,
				resolution: {
					kind: "let",
					name: item.name,
					nameSpan: item.span,
					valueSpan: item.value.span,
				},
			});
		}
	}

	const stack: Binding[][] = [globalFns, globalLets];
	let stop = false;

	const lookup = (name: string): Resolution | null => {
		for (let i = stack.length - 1; i >= 0; i--) {
			const frame = stack[i]!;
			for (const b of frame) {
				if (b.name === name) return b.resolution;
			}
		}
		if (name === "__file__" || name === "__dir__") {
			return { kind: "source_binding", name };
		}
		if (builtinNames.has(name)) return { kind: "builtin", name };
		return null;
	};

	const visitExpr = (expr: Expr): void => {
		if (stop) return;
		switch (expr.kind) {
			case "ident":
				if (!onIdent(expr, lookup(expr.name))) stop = true;
				return;
			case "string":
				for (const part of expr.parts) {
					if (stop) return;
					if (typeof part !== "string") visitExpr(part);
				}
				return;
			case "int":
			case "float":
			case "bool":
			case "nil":
			case "field_shorthand":
				return;
			case "call":
				visitExpr(expr.callee);
				for (const a of expr.args) {
					if (stop) return;
					visitExpr(a);
				}
				return;
			case "binop":
				visitExpr(expr.lhs);
				if (!stop) visitExpr(expr.rhs);
				return;
			case "unop":
				visitExpr(expr.operand);
				return;
			case "if":
				for (const b of expr.branches) {
					if (stop) return;
					visitExpr(b.cond);
					if (stop) return;
					visitExpr(b.body);
				}
				if (!stop && expr.elseBody) visitExpr(expr.elseBody);
				return;
			case "lambda": {
				const params: Binding[] = expr.params.map((p, i) => ({
					name: p,
					resolution: {
						kind: "lambda_param",
						name: p,
						span: expr.paramSpans?.[i] ?? expr.span,
						lambda: expr,
					},
				}));
				stack.push(params);
				visitExpr(expr.body);
				stack.pop();
				return;
			}
			case "list":
				for (const it of expr.items) {
					if (stop) return;
					visitExpr(it);
				}
				return;
			case "map":
				for (const e of expr.entries) {
					if (stop) return;
					visitExpr(e.value);
				}
				return;
			case "field_access":
				visitExpr(expr.target);
				return;
			case "try": {
				const tryFrame: Binding[] = [];
				stack.push(tryFrame);
				for (const s of expr.tryBody) {
					if (stop) return;
					visitStmt(s, tryFrame);
				}
				stack.pop();

				const rescueFrame: Binding[] = [
					{
						name: expr.errBinding,
						resolution: {
							kind: "rescue_err",
							name: expr.errBinding,
							span: expr.errBindingSpan,
							tryExpr: expr,
						},
					},
				];
				stack.push(rescueFrame);
				for (const s of expr.rescueBody) {
					if (stop) return;
					visitStmt(s, rescueFrame);
				}
				stack.pop();
				return;
			}
			case "assert":
				visitExpr(expr.expr);
				return;
		}
	};

	const visitStmt = (stmt: Stmt, frame: Binding[]): void => {
		if (stop) return;
		if (stmt.kind === "assign") {
			visitExpr(stmt.value);
			frame.push({
				name: stmt.name,
				resolution: {
					kind: "let",
					name: stmt.name,
					nameSpan: stmt.span,
					valueSpan: stmt.value.span,
				},
			});
			return;
		}
		visitExpr(stmt);
	};

	const visitCmdScope = (cmd: import("../ast").Cmd): void => {
		const cmdFrame: Binding[] = [];
		for (const decl of cmd.decls) {
			cmdFrame.push({
				name: decl.name,
				resolution:
					decl.kind === "arg_decl"
						? { kind: "arg", node: decl }
						: { kind: "flag", node: decl },
			});
		}
		stack.push(cmdFrame);
		const localFrame: Binding[] = [];
		stack.push(localFrame);
		for (const decl of cmd.decls) {
			if (decl.default && !stop) visitExpr(decl.default);
		}
		for (const s of cmd.body) {
			if (stop) return;
			visitStmt(s, localFrame);
		}
		stack.pop();
		stack.pop();
	};

	for (const item of module.items) {
		if (stop) return;
		switch (item.kind) {
			case "fn_def": {
				const params: Binding[] = item.params.map((p, i) => ({
					name: p,
					resolution: {
						kind: "fn_param",
						name: p,
						span: item.paramSpans?.[i] ?? item.span,
						fn: item,
					},
				}));
				stack.push(params);
				const localFrame: Binding[] = [];
				stack.push(localFrame);
				for (const s of item.body) {
					if (stop) break;
					visitStmt(s, localFrame);
				}
				stack.pop();
				stack.pop();
				break;
			}
			case "cmd":
				visitCmdScope(item);
				break;
			case "program": {
				const progFrame: Binding[] = [];
				for (const f of item.flags) {
					progFrame.push({
						name: f.name,
						resolution: { kind: "flag", node: f },
					});
				}
				stack.push(progFrame);
				for (const f of item.flags) {
					if (f.default && !stop) visitExpr(f.default);
				}
				for (const cmd of item.cmds) {
					if (stop) break;
					visitCmdScope(cmd);
				}
				stack.pop();
				break;
			}
			case "test": {
				const testFrame: Binding[] = [];
				stack.push(testFrame);
				for (const s of item.body) {
					if (stop) break;
					visitStmt(s, testFrame);
				}
				stack.pop();
				break;
			}
			case "assign":
				visitExpr(item.value);
				break;
			case "import":
				break;
			default:
				visitExpr(item);
				break;
		}
	}
}

export function resolveIdent(
	module: Module,
	target: Identifier,
	builtinNames: Set<string>,
): Resolution | null {
	let found: Resolution | null = null;
	walkIdents(module, builtinNames, (ident, res) => {
		if (ident === target) {
			found = res;
			return false;
		}
		return true;
	});
	return found;
}

function spanEq(a: Span, b: Span): boolean {
	return (
		a.file === b.file &&
		a.line === b.line &&
		a.col === b.col &&
		a.length === b.length
	);
}

export function sameBinding(a: Resolution, b: Resolution): boolean {
	if (a.kind !== b.kind) return false;
	switch (a.kind) {
		case "builtin":
			return a.name === (b as typeof a).name;
		case "source_binding":
			return a.name === (b as typeof a).name;
		case "fn":
			return a.node === (b as typeof a).node;
		case "arg":
			return a.node === (b as typeof a).node;
		case "flag":
			return a.node === (b as typeof a).node;
		case "let":
			return spanEq(a.nameSpan, (b as typeof a).nameSpan);
		case "fn_param": {
			const other = b as typeof a;
			return a.name === other.name && a.fn === other.fn;
		}
		case "lambda_param": {
			const other = b as typeof a;
			return a.name === other.name && a.lambda === other.lambda;
		}
		case "rescue_err":
			return a.tryExpr === (b as typeof a).tryExpr;
	}
}

/**
 * Returns the span of the binding's name at its definition site, when the
 * AST exposes one. Used to include the declaration in find-references and
 * to drive symbol rename. Returns null for builtins, source bindings, and
 * older AST nodes that lack a precise nameSpan.
 */
export function definitionNameSpan(res: Resolution): Span | null {
	switch (res.kind) {
		case "builtin":
		case "source_binding":
			return null;
		case "fn":
			return res.node.nameSpan ?? null;
		case "arg":
		case "flag":
			return res.node.nameSpan ?? null;
		case "let":
			return res.nameSpan;
		case "fn_param":
		case "lambda_param":
		case "rescue_err":
			return res.span;
	}
}

/**
 * Looks up a renamable/referenceable binding at the given position. Unlike
 * `findIdentAt + resolveIdent`, this also matches declaration name spans
 * (e.g. the `name` of `arg name: str`, the `x` of `def f(x) = ...`, the
 * `greeting` of `greeting = "hi"`). Returns the most specific binding when
 * spans overlap.
 */
export function findResolvableAt(
	module: Module,
	line: number,
	col: number,
	builtinNames: Set<string>,
): { name: string; span: Span; resolution: Resolution } | null {
	let best: { name: string; span: Span; resolution: Resolution } | null = null;

	const consider = (name: string, span: Span, resolution: Resolution): void => {
		if (span.line !== line) return;
		if (col < span.col) return;
		if (col >= span.col + Math.max(span.length, 1)) return;
		if (!best || span.length < best.span.length) {
			best = { name, span, resolution };
		}
	};

	const visitExpr = (expr: Expr): void => {
		switch (expr.kind) {
			case "lambda":
				if (expr.paramSpans) {
					for (let i = 0; i < expr.paramSpans.length; i++) {
						const sp = expr.paramSpans[i]!;
						consider(expr.params[i]!, sp, {
							kind: "lambda_param",
							name: expr.params[i]!,
							span: sp,
							lambda: expr,
						});
					}
				}
				visitExpr(expr.body);
				return;
			case "try":
				consider(expr.errBinding, expr.errBindingSpan, {
					kind: "rescue_err",
					name: expr.errBinding,
					span: expr.errBindingSpan,
					tryExpr: expr,
				});
				for (const s of expr.tryBody) visitStmt(s);
				for (const s of expr.rescueBody) visitStmt(s);
				return;
			case "call":
				visitExpr(expr.callee);
				for (const a of expr.args) visitExpr(a);
				return;
			case "binop":
				visitExpr(expr.lhs);
				visitExpr(expr.rhs);
				return;
			case "unop":
				visitExpr(expr.operand);
				return;
			case "if":
				for (const b of expr.branches) {
					visitExpr(b.cond);
					visitExpr(b.body);
				}
				if (expr.elseBody) visitExpr(expr.elseBody);
				return;
			case "list":
				for (const it of expr.items) visitExpr(it);
				return;
			case "map":
				for (const e of expr.entries) visitExpr(e.value);
				return;
			case "field_access":
				visitExpr(expr.target);
				return;
			case "string":
				for (const part of expr.parts) {
					if (typeof part !== "string") visitExpr(part);
				}
				return;
			case "assert":
				visitExpr(expr.expr);
				return;
		}
	};

	const visitStmt = (stmt: Stmt): void => {
		if (stmt.kind === "assign") {
			consider(stmt.name, stmt.span, {
				kind: "let",
				name: stmt.name,
				nameSpan: stmt.span,
				valueSpan: stmt.value.span,
			});
			visitExpr(stmt.value);
			return;
		}
		visitExpr(stmt);
	};

	const visitCmd = (cmd: import("../ast").Cmd): void => {
		for (const decl of cmd.decls) {
			const span = decl.nameSpan ?? decl.span;
			consider(
				decl.name,
				span,
				decl.kind === "arg_decl"
					? { kind: "arg", node: decl }
					: { kind: "flag", node: decl },
			);
			if (decl.default) visitExpr(decl.default);
		}
		for (const s of cmd.body) visitStmt(s);
	};

	for (const item of module.items) {
		switch (item.kind) {
			case "fn_def": {
				if (item.nameSpan) {
					consider(item.name, item.nameSpan, { kind: "fn", node: item });
				}
				if (item.paramSpans) {
					for (let i = 0; i < item.paramSpans.length; i++) {
						const sp = item.paramSpans[i]!;
						consider(item.params[i]!, sp, {
							kind: "fn_param",
							name: item.params[i]!,
							span: sp,
							fn: item,
						});
					}
				}
				for (const s of item.body) visitStmt(s);
				break;
			}
			case "cmd":
				visitCmd(item);
				break;
			case "program":
				for (const f of item.flags) {
					const span = f.nameSpan ?? f.span;
					consider(f.name, span, { kind: "flag", node: f });
					if (f.default) visitExpr(f.default);
				}
				for (const cmd of item.cmds) visitCmd(cmd);
				break;
			case "test":
				for (const s of item.body) visitStmt(s);
				break;
			case "assign":
				consider(item.name, item.span, {
					kind: "let",
					name: item.name,
					nameSpan: item.span,
					valueSpan: item.value.span,
				});
				visitExpr(item.value);
				break;
			case "import":
				break;
			default:
				visitExpr(item);
				break;
		}
	}

	if (best) return best;

	const ident = findIdentAt(module, line, col);
	if (ident) {
		const res = resolveIdent(module, ident, builtinNames);
		if (res) return { name: ident.name, span: ident.span, resolution: res };
	}
	return null;
}

/**
 * Returns all spans (declaration + usages) referring to the same binding
 * as `target`, in source order. Used by LSP find-references and rename.
 */
export function findReferences(
	module: Module,
	target: Resolution,
	builtinNames: Set<string>,
): Span[] {
	const out: Span[] = [];
	const def = definitionNameSpan(target);
	if (def) out.push(def);
	walkIdents(module, builtinNames, (ident, res) => {
		if (res && sameBinding(res, target)) out.push(ident.span);
		return true;
	});
	return out;
}
