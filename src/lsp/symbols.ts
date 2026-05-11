import {
	type DocumentSymbol,
	type FoldingRange,
	type Range,
	SymbolKind,
} from "vscode-languageserver/node.js";

import type {
	ArgDecl,
	Cmd,
	Expr,
	FlagDecl,
	FnDef,
	Item,
	LambdaExpr,
	Module,
	ProgramDecl,
	Stmt,
	TestBlock,
	TryExpr,
} from "../ast";
import type { Span } from "../errors";

function lastLineExpr(expr: Expr): number {
	let max = expr.span.line;
	switch (expr.kind) {
		case "string":
			for (const part of expr.parts) {
				if (typeof part !== "string") max = Math.max(max, lastLineExpr(part));
			}
			break;
		case "call":
			max = Math.max(max, lastLineExpr(expr.callee));
			for (const a of expr.args) max = Math.max(max, lastLineExpr(a));
			break;
		case "pipe":
			max = Math.max(max, lastLineExpr(expr.lhs), lastLineExpr(expr.rhs));
			break;
		case "binop":
			max = Math.max(max, lastLineExpr(expr.lhs), lastLineExpr(expr.rhs));
			break;
		case "unop":
			max = Math.max(max, lastLineExpr(expr.operand));
			break;
		case "if":
			for (const b of expr.branches) {
				max = Math.max(max, lastLineExpr(b.cond), lastLineExpr(b.body));
			}
			if (expr.elseBody) max = Math.max(max, lastLineExpr(expr.elseBody));
			break;
		case "lambda":
			max = Math.max(max, lastLineExpr(expr.body));
			break;
		case "list":
			for (const it of expr.items) max = Math.max(max, lastLineExpr(it));
			break;
		case "map":
			for (const e of expr.entries) max = Math.max(max, lastLineExpr(e.value));
			break;
		case "field_access":
			max = Math.max(max, lastLineExpr(expr.target));
			break;
		case "try":
			for (const s of expr.tryBody) max = Math.max(max, lastLineStmt(s));
			for (const s of expr.rescueBody) max = Math.max(max, lastLineStmt(s));
			break;
		case "assert":
			max = Math.max(max, lastLineExpr(expr.expr));
			break;
	}
	return max;
}

function lastLineStmt(s: Stmt): number {
	if (s.kind === "assign") {
		return Math.max(s.span.line, lastLineExpr(s.value));
	}
	return lastLineExpr(s);
}

function lastLineStmts(stmts: Stmt[]): number {
	let max = 0;
	for (const s of stmts) max = Math.max(max, lastLineStmt(s));
	return max;
}

function lastLineCmd(cmd: Cmd): number {
	let max = cmd.span.line;
	for (const d of cmd.decls) {
		max = Math.max(max, d.span.line);
		if (d.default) max = Math.max(max, lastLineExpr(d.default));
	}
	max = Math.max(max, lastLineStmts(cmd.body));
	return max;
}

function pointRange(span: Span): Range {
	const line = Math.max(0, span.line - 1);
	const ch = Math.max(0, span.col - 1);
	return {
		start: { line, character: ch },
		end: { line, character: ch + Math.max(span.length, 1) },
	};
}

function blockRange(headerSpan: Span, endLine1: number): Range {
	return {
		start: { line: Math.max(0, headerSpan.line - 1), character: 0 },
		end: { line: endLine1, character: 0 },
	};
}

function declSymbol(d: ArgDecl | FlagDecl): DocumentSymbol {
	const isArg = d.kind === "arg_decl";
	return {
		name: d.name,
		detail: `${isArg ? "arg" : "flag"}: ${d.type}`,
		kind: isArg ? SymbolKind.Field : SymbolKind.Property,
		range: pointRange(d.nameSpan ?? d.span),
		selectionRange: pointRange(d.nameSpan ?? d.span),
	};
}

function cmdSymbol(cmd: Cmd): DocumentSymbol {
	const last = lastLineCmd(cmd) + 1;
	return {
		name: cmd.name,
		detail: "cmd",
		kind: SymbolKind.Method,
		range: blockRange(cmd.span, last),
		selectionRange: pointRange(cmd.span),
		children: cmd.decls.map(declSymbol),
	};
}

function fnSymbol(fn: FnDef): DocumentSymbol {
	const bodyLast = fn.body.length > 0 ? lastLineStmts(fn.body) : fn.span.line;
	const last = bodyLast + 1;
	return {
		name: fn.name,
		detail: `fn(${fn.params.join(", ")})`,
		kind: SymbolKind.Function,
		range: blockRange(fn.span, last),
		selectionRange: pointRange(fn.nameSpan ?? fn.span),
	};
}

function programSymbol(p: ProgramDecl): DocumentSymbol {
	const lastCmd = p.cmds.length > 0
		? Math.max(...p.cmds.map(lastLineCmd))
		: p.span.line;
	const last = lastCmd + 1;
	const children: DocumentSymbol[] = [];
	for (const f of p.flags) {
		children.push({
			name: f.name,
			detail: `flag: ${f.type}`,
			kind: SymbolKind.Property,
			range: pointRange(f.nameSpan ?? f.span),
			selectionRange: pointRange(f.nameSpan ?? f.span),
		});
	}
	for (const cmd of p.cmds) children.push(cmdSymbol(cmd));
	return {
		name: p.name,
		detail: "program",
		kind: SymbolKind.Module,
		range: blockRange(p.span, last),
		selectionRange: pointRange(p.span),
		children,
	};
}

function testSymbol(t: TestBlock): DocumentSymbol {
	const last = (t.body.length > 0 ? lastLineStmts(t.body) : t.span.line) + 1;
	return {
		name: t.name,
		detail: "test",
		kind: SymbolKind.Method,
		range: blockRange(t.span, last),
		selectionRange: pointRange(t.nameSpan),
	};
}

export function buildDocumentSymbols(module: Module): DocumentSymbol[] {
	const out: DocumentSymbol[] = [];
	for (const item of module.items) {
		switch (item.kind) {
			case "fn_def":
				out.push(fnSymbol(item));
				break;
			case "cmd":
				out.push(cmdSymbol(item));
				break;
			case "program":
				out.push(programSymbol(item));
				break;
			case "test":
				out.push(testSymbol(item));
				break;
		}
	}
	return out;
}

function pushBlockFold(
	out: FoldingRange[],
	headerLine1: number,
	endLine1: number,
): void {
	if (endLine1 - 1 <= headerLine1) return;
	out.push({
		startLine: Math.max(0, headerLine1 - 1),
		endLine: Math.max(0, endLine1 - 1),
	});
}

function visitFoldingExpr(expr: Expr, out: FoldingRange[]): void {
	switch (expr.kind) {
		case "string":
			for (const part of expr.parts) {
				if (typeof part !== "string") visitFoldingExpr(part, out);
			}
			return;
		case "call":
			visitFoldingExpr(expr.callee, out);
			for (const a of expr.args) visitFoldingExpr(a, out);
			return;
		case "pipe":
			visitFoldingExpr(expr.lhs, out);
			visitFoldingExpr(expr.rhs, out);
			return;
		case "binop":
			visitFoldingExpr(expr.lhs, out);
			visitFoldingExpr(expr.rhs, out);
			return;
		case "unop":
			visitFoldingExpr(expr.operand, out);
			return;
		case "if":
			for (const b of expr.branches) {
				visitFoldingExpr(b.cond, out);
				visitFoldingExpr(b.body, out);
			}
			if (expr.elseBody) visitFoldingExpr(expr.elseBody, out);
			return;
		case "lambda":
			foldLambda(expr, out);
			return;
		case "list":
			for (const it of expr.items) visitFoldingExpr(it, out);
			return;
		case "map":
			for (const e of expr.entries) visitFoldingExpr(e.value, out);
			return;
		case "field_access":
			visitFoldingExpr(expr.target, out);
			return;
		case "try":
			foldTry(expr, out);
			return;
		case "assert":
			visitFoldingExpr(expr.expr, out);
			return;
	}
}

function visitFoldingStmt(s: Stmt, out: FoldingRange[]): void {
	if (s.kind === "assign") {
		visitFoldingExpr(s.value, out);
		return;
	}
	visitFoldingExpr(s, out);
}

function foldLambda(lam: LambdaExpr, out: FoldingRange[]): void {
	const last = lastLineExpr(lam.body);
	if (last > lam.span.line) {
		out.push({
			startLine: Math.max(0, lam.span.line - 1),
			endLine: Math.max(0, last - 1),
		});
	}
	visitFoldingExpr(lam.body, out);
}

function foldTry(t: TryExpr, out: FoldingRange[]): void {
	let last = t.span.line;
	for (const s of t.tryBody) last = Math.max(last, lastLineStmt(s));
	for (const s of t.rescueBody) last = Math.max(last, lastLineStmt(s));
	pushBlockFold(out, t.span.line, last + 1);
	for (const s of t.tryBody) visitFoldingStmt(s, out);
	for (const s of t.rescueBody) visitFoldingStmt(s, out);
}

function foldCmd(cmd: Cmd, out: FoldingRange[]): void {
	pushBlockFold(out, cmd.span.line, lastLineCmd(cmd) + 1);
	for (const d of cmd.decls) {
		if (d.default) visitFoldingExpr(d.default, out);
	}
	for (const s of cmd.body) visitFoldingStmt(s, out);
}

function foldFn(fn: FnDef, out: FoldingRange[]): void {
	const last = fn.body.length > 0 ? lastLineStmts(fn.body) : fn.span.line;
	pushBlockFold(out, fn.span.line, last + 1);
	for (const s of fn.body) visitFoldingStmt(s, out);
}

export function buildFoldingRanges(module: Module): FoldingRange[] {
	const out: FoldingRange[] = [];
	for (const item of module.items) {
		switch (item.kind) {
			case "fn_def":
				foldFn(item, out);
				break;
			case "cmd":
				foldCmd(item, out);
				break;
			case "program": {
				const lastCmd = item.cmds.length > 0
					? Math.max(...item.cmds.map(lastLineCmd))
					: item.span.line;
				pushBlockFold(out, item.span.line, lastCmd + 1);
				for (const cmd of item.cmds) foldCmd(cmd, out);
				break;
			}
			case "test": {
				const last = item.body.length > 0
					? lastLineStmts(item.body)
					: item.span.line;
				pushBlockFold(out, item.span.line, last + 1);
				for (const s of item.body) visitFoldingStmt(s, out);
				break;
			}
			case "assign":
				visitFoldingExpr(item.value, out);
				break;
		}
	}
	return out;
}
