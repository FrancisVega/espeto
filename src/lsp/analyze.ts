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

export function resolveIdent(
	module: Module,
	target: Identifier,
	builtinNames: Set<string>,
): Resolution | null {
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
	let found: Resolution | null = null;
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
				if (expr === target) {
					found = lookup(expr.name);
					stop = true;
				}
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
				const params: Binding[] = expr.params.map((p) => ({
					name: p,
					resolution: {
						kind: "lambda_param",
						name: p,
						span: expr.span,
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

	const visitItems = (): void => {
		for (const item of module.items) {
			if (stop) return;
			switch (item.kind) {
				case "fn_def": {
					const params: Binding[] = item.params.map((p) => ({
						name: p,
						resolution: { kind: "fn_param", name: p, span: item.span, fn: item },
					}));
					stack.push(params);
					const localFrame: Binding[] = [];
					stack.push(localFrame);
					for (const s of item.body) {
						if (stop) return;
						visitStmt(s, localFrame);
					}
					stack.pop();
					stack.pop();
					break;
				}
				case "cmd": {
					visitCmdScope(item);
					break;
				}
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
						if (stop) return;
						visitCmdScope(cmd);
					}
					stack.pop();
					break;
				}
				case "test": {
					const testFrame: Binding[] = [];
					stack.push(testFrame);
					for (const s of item.body) {
						if (stop) return;
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
	};

	visitItems();
	return found;
}
