import type {
	ArgDecl,
	AssertExpr,
	AssignStmt,
	BinaryOp,
	BinaryOpKind,
	Call,
	Cmd,
	Expr,
	FieldAccess,
	FieldShorthand,
	FlagDecl,
	FnDef,
	IfExpr,
	ImportItem,
	Item,
	LambdaExpr,
	ListExpr,
	MapExpr,
	MetaStmt,
	Module,
	PipeExpr,
	ProgramDecl,
	Stmt,
	StringExpr,
	TestBlock,
	TryExpr,
	UnaryOp,
} from "./ast";

// ============================================================
// Lindig "Strictly Pretty" core
// ============================================================

type Doc =
	| { kind: "text"; value: string }
	| { kind: "line" }
	| { kind: "softline" }
	| { kind: "hardline" }
	| { kind: "concat"; docs: Doc[] }
	| { kind: "nest"; indent: number; doc: Doc }
	| { kind: "group"; doc: Doc; shouldBreak: boolean }
	| { kind: "ifBreak"; brk: Doc; flat: Doc };

const EMPTY: Doc = { kind: "concat", docs: [] };

function text(value: string): Doc {
	return { kind: "text", value };
}

const LINE: Doc = { kind: "line" };
const SOFTLINE: Doc = { kind: "softline" };
const HARDLINE: Doc = { kind: "hardline" };

function concat(...docs: Doc[]): Doc {
	if (docs.length === 0) return EMPTY;
	if (docs.length === 1) return docs[0]!;
	return { kind: "concat", docs };
}

function nest(indent: number, doc: Doc): Doc {
	return { kind: "nest", indent, doc };
}

function group(doc: Doc): Doc {
	return { kind: "group", doc, shouldBreak: hasHardline(doc) };
}

function ifBreak(brk: Doc, flat: Doc): Doc {
	return { kind: "ifBreak", brk, flat };
}

function join(docs: Doc[], sep: Doc): Doc {
	if (docs.length === 0) return EMPTY;
	if (docs.length === 1) return docs[0]!;
	const parts: Doc[] = [];
	for (let i = 0; i < docs.length; i++) {
		if (i > 0) parts.push(sep);
		parts.push(docs[i]!);
	}
	return concat(...parts);
}

function hasHardline(doc: Doc): boolean {
	switch (doc.kind) {
		case "hardline":
			return true;
		case "concat":
			return doc.docs.some(hasHardline);
		case "nest":
			return hasHardline(doc.doc);
		case "group":
			return doc.shouldBreak;
		default:
			return false;
	}
}

type Mode = "flat" | "break";

function fits(width: number, items: [number, Mode, Doc][]): boolean {
	let rem = width;
	const stack = items.slice();
	while (stack.length > 0) {
		if (rem < 0) return false;
		const [indent, mode, doc] = stack.pop()!;
		switch (doc.kind) {
			case "text":
				rem -= doc.value.length;
				break;
			case "line":
				if (mode === "flat") rem -= 1;
				else return true;
				break;
			case "softline":
				if (mode === "break") return true;
				break;
			case "hardline":
				return true;
			case "concat":
				for (let i = doc.docs.length - 1; i >= 0; i--) {
					stack.push([indent, mode, doc.docs[i]!]);
				}
				break;
			case "nest":
				stack.push([indent + doc.indent, mode, doc.doc]);
				break;
			case "group":
				if (doc.shouldBreak) return true;
				stack.push([indent, "flat", doc.doc]);
				break;
			case "ifBreak":
				stack.push([indent, mode, mode === "break" ? doc.brk : doc.flat]);
				break;
		}
	}
	return rem >= 0;
}

export function render(doc: Doc, width: number): string {
	const out: string[] = [];
	let pos = 0;
	const stack: [number, Mode, Doc][] = [[0, "break", doc]];
	while (stack.length > 0) {
		const [indent, mode, d] = stack.pop()!;
		switch (d.kind) {
			case "text":
				out.push(d.value);
				pos += d.value.length;
				break;
			case "line":
				if (mode === "flat") {
					out.push(" ");
					pos += 1;
				} else {
					out.push("\n");
					out.push("\t".repeat(indent));
					pos = indent;
				}
				break;
			case "softline":
				if (mode === "break") {
					out.push("\n");
					out.push("\t".repeat(indent));
					pos = indent;
				}
				break;
			case "hardline":
				out.push("\n");
				out.push("\t".repeat(indent));
				pos = indent;
				break;
			case "concat":
				for (let i = d.docs.length - 1; i >= 0; i--) {
					stack.push([indent, mode, d.docs[i]!]);
				}
				break;
			case "nest":
				stack.push([indent + d.indent, mode, d.doc]);
				break;
			case "group": {
				if (d.shouldBreak) {
					stack.push([indent, "break", d.doc]);
					break;
				}
				const trial: [number, Mode, Doc][] = [[indent, "flat", d.doc]];
				for (let i = stack.length - 1; i >= 0; i--) {
					trial.push(stack[i]!);
				}
				if (fits(width - pos, trial)) {
					stack.push([indent, "flat", d.doc]);
				} else {
					stack.push([indent, "break", d.doc]);
				}
				break;
			}
			case "ifBreak":
				stack.push([indent, mode, mode === "break" ? d.brk : d.flat]);
				break;
		}
	}
	return out.join("");
}

// ============================================================
// Precedence
// ============================================================

const PREC = {
	or: 1,
	and: 2,
	cmp: 3,
	add: 4,
	mul: 5,
	unary: 6,
	pipe: 7,
	primary: 100,
} as const;

function binopPrec(op: BinaryOpKind): number {
	switch (op) {
		case "or":
			return PREC.or;
		case "and":
			return PREC.and;
		case "==":
		case "<":
		case "<=":
		case ">":
		case ">=":
			return PREC.cmp;
		case "+":
		case "-":
			return PREC.add;
		case "*":
		case "/":
			return PREC.mul;
	}
}

function exprPrec(e: Expr): number {
	switch (e.kind) {
		case "binop":
			return binopPrec(e.op);
		case "unop":
			return PREC.unary;
		case "pipe":
			return PREC.pipe;
		default:
			return PREC.primary;
	}
}

function isPrimaryLike(e: Expr): boolean {
	switch (e.kind) {
		case "ident":
		case "call":
		case "field_access":
		case "field_shorthand":
		case "list":
		case "map":
		case "string":
		case "int":
		case "float":
		case "bool":
		case "nil":
			return true;
		default:
			return false;
	}
}

// ============================================================
// Per-node printers
// ============================================================

const WIDTH = 100;

export function format(mod: Module): string {
	const itemDocs = mod.items.map(formatItem);
	const body = join(itemDocs, concat(HARDLINE, HARDLINE));
	return render(body, WIDTH) + "\n";
}

function formatItem(item: Item): Doc {
	switch (item.kind) {
		case "import":
			return formatImport(item);
		case "fn_def":
			return formatFnDef(item);
		case "assign":
			return formatAssign(item);
		case "cmd":
			return formatCmd(item);
		case "program":
			return formatProgram(item);
		case "test":
			return formatTest(item);
		default:
			return formatExpr(item, 1);
	}
}

function formatStmt(s: Stmt): Doc {
	if (s.kind === "assign") return formatAssign(s);
	return formatExpr(s, 1);
}

function formatStmts(stmts: Stmt[]): Doc {
	return join(stmts.map(formatStmt), HARDLINE);
}

function formatExpr(e: Expr, minPrec: number): Doc {
	if (exprPrec(e) < minPrec) {
		return concat(text("("), formatExprUnchecked(e), text(")"));
	}
	return formatExprUnchecked(e);
}

function formatExprUnchecked(e: Expr): Doc {
	switch (e.kind) {
		case "binop":
			return formatBinop(e);
		case "unop":
			return formatUnop(e);
		case "pipe":
			return formatPipe(e);
		case "call":
			return formatCall(e);
		case "field_access":
			return formatFieldAccess(e);
		case "field_shorthand":
			return text("." + e.field);
		case "ident":
			return text(e.name);
		case "int":
			return text(formatInt(e.value));
		case "float":
			return text(formatFloat(e.value));
		case "bool":
			return text(e.value ? "true" : "false");
		case "nil":
			return text("nil");
		case "string":
			return formatString(e);
		case "list":
			return formatList(e);
		case "map":
			return formatMap(e);
		case "lambda":
			return formatLambda(e);
		case "if":
			return formatIf(e);
		case "try":
			return formatTry(e);
		case "assert":
			return formatAssert(e);
	}
}

function formatBinop(e: BinaryOp): Doc {
	const p = binopPrec(e.op);
	const isCmp =
		e.op === "==" ||
		e.op === "<" ||
		e.op === "<=" ||
		e.op === ">" ||
		e.op === ">=";
	const lhsMin = isCmp ? p + 1 : p;
	const rhsMin = p + 1;
	const lhs = formatExpr(e.lhs, lhsMin);
	const rhs = formatExpr(e.rhs, rhsMin);
	return concat(lhs, text(` ${e.op} `), rhs);
}

function formatUnop(e: UnaryOp): Doc {
	const opStr = e.op === "not" ? "not " : "-";
	const operand = formatExpr(e.operand, PREC.unary);
	return concat(text(opStr), operand);
}

function formatPipe(e: PipeExpr): Doc {
	const lhs = formatExpr(e.lhs, PREC.pipe);
	const rhs = formatPipeRhs(e.rhs);
	return concat(lhs, text(" |> "), rhs);
}

function formatPipeRhs(call: Call): Doc {
	const callee = call.callee;
	if (callee.kind === "lambda") {
		return formatLambda(callee);
	}
	if (callee.kind === "field_shorthand") {
		return text("." + callee.field);
	}
	if (callee.kind === "ident" && call.args.length === 0) {
		return text(callee.name);
	}
	return formatCall(call);
}

function formatCall(e: Call): Doc {
	const callee = formatCallee(e.callee);
	const argDocs = e.args.map((a) => formatExpr(a, 1));
	return concat(callee, text("("), join(argDocs, text(", ")), text(")"));
}

function formatCallee(callee: Expr): Doc {
	if (isPrimaryLike(callee)) return formatExprUnchecked(callee);
	return concat(text("("), formatExprUnchecked(callee), text(")"));
}

function formatFieldAccess(e: FieldAccess): Doc {
	const target = formatCallee(e.target);
	return concat(target, text("." + e.field));
}

function formatList(e: ListExpr): Doc {
	if (e.items.length === 0) return text("[]");
	const itemDocs = e.items.map((i) => formatExpr(i, 1));
	return group(
		concat(
			text("["),
			nest(
				1,
				concat(
					SOFTLINE,
					join(itemDocs, concat(text(","), LINE)),
					ifBreak(text(","), EMPTY),
				),
			),
			SOFTLINE,
			text("]"),
		),
	);
}

function formatMap(e: MapExpr): Doc {
	if (e.entries.length === 0) return text("{}");
	const entryDocs = e.entries.map((entry) =>
		concat(text(`${entry.key}: `), formatExpr(entry.value, 1)),
	);
	return group(
		concat(
			text("{"),
			nest(
				1,
				concat(
					SOFTLINE,
					join(entryDocs, concat(text(","), LINE)),
					ifBreak(text(","), EMPTY),
				),
			),
			SOFTLINE,
			text("}"),
		),
	);
}

function formatLambda(e: LambdaExpr): Doc {
	const header =
		e.params.length === 1
			? `fn ${e.params[0]!} => `
			: `fn(${e.params.join(", ")}) => `;
	return concat(text(header), formatExpr(e.body, 1));
}

function formatIf(e: IfExpr): Doc {
	if (e.branches.length > 1) return formatIfChain(e);
	const b = e.branches[0]!;
	const cond = formatExpr(b.cond, 1);
	const body = formatExpr(b.body, 1);
	const parts: Doc[] = [
		text("if "),
		cond,
		text(" do"),
		nest(1, concat(LINE, body)),
	];
	if (e.elseBody !== undefined) {
		parts.push(
			LINE,
			text("else"),
			nest(1, concat(LINE, formatExpr(e.elseBody, 1))),
		);
	}
	parts.push(LINE, text("end"));
	return group(concat(...parts));
}

function formatIfChain(e: IfExpr): Doc {
	const parts: Doc[] = [];
	for (let i = 0; i < e.branches.length; i++) {
		const b = e.branches[i]!;
		const prefix = i === 0 ? text("if ") : text("else if ");
		parts.push(prefix, formatExpr(b.cond, 1), text(" do"));
		parts.push(nest(1, concat(HARDLINE, formatExpr(b.body, 1))));
		parts.push(HARDLINE);
	}
	if (e.elseBody !== undefined) {
		parts.push(text("else"));
		parts.push(nest(1, concat(HARDLINE, formatExpr(e.elseBody, 1))));
		parts.push(HARDLINE);
	}
	parts.push(text("end"));
	return concat(...parts);
}

function formatTry(e: TryExpr): Doc {
	const tryInlineable =
		e.tryBody.length === 1 &&
		e.tryBody[0]!.kind !== "assign" &&
		e.rescueBody.length === 1 &&
		e.rescueBody[0]!.kind !== "assign";
	if (!tryInlineable) return formatTryMultiLine(e);
	const tryExpr = formatExpr(e.tryBody[0] as Expr, 1);
	const rescueExpr = formatExpr(e.rescueBody[0] as Expr, 1);
	return group(
		concat(
			text("try do"),
			nest(1, concat(LINE, tryExpr)),
			LINE,
			text(`rescue ${e.errBinding} =>`),
			nest(1, concat(LINE, rescueExpr)),
			LINE,
			text("end"),
		),
	);
}

function formatTryMultiLine(e: TryExpr): Doc {
	return concat(
		text("try do"),
		nest(1, concat(HARDLINE, formatStmts(e.tryBody))),
		HARDLINE,
		text(`rescue ${e.errBinding} =>`),
		nest(1, concat(HARDLINE, formatStmts(e.rescueBody))),
		HARDLINE,
		text("end"),
	);
}

function formatAssert(e: AssertExpr): Doc {
	return concat(text("assert "), formatExpr(e.expr, 1));
}

function formatString(e: StringExpr): Doc {
	const inner: Doc[] = [];
	for (const part of e.parts) {
		if (typeof part === "string") {
			inner.push(text(escapeStringPart(part)));
		} else {
			inner.push(text("#{"), formatExpr(part, 1), text("}"));
		}
	}
	return concat(text('"'), ...inner, text('"'));
}

function escapeStringPart(s: string): string {
	let out = "";
	for (let i = 0; i < s.length; i++) {
		const ch = s[i]!;
		if (ch === '"') {
			out += '\\"';
			continue;
		}
		if (ch === "\\") {
			out += "\\\\";
			continue;
		}
		if (ch === "\n") {
			out += "\\n";
			continue;
		}
		if (ch === "\t") {
			out += "\\t";
			continue;
		}
		if (ch === "\r") {
			out += "\\r";
			continue;
		}
		if (ch === "\x1b") {
			out += "\\e";
			continue;
		}
		if (ch === "#" && s[i + 1] === "{") {
			out += "\\#";
			continue;
		}
		out += ch;
	}
	return out;
}

function formatInt(n: number): string {
	return n.toString();
}

function formatFloat(n: number): string {
	const s = n.toString();
	if (!s.includes(".") && !s.includes("e") && !s.includes("E")) {
		return `${s}.0`;
	}
	return s;
}

function formatAssign(s: AssignStmt): Doc {
	return concat(text(`${s.name} = `), formatExpr(s.value, 1));
}

function formatFnDef(d: FnDef): Doc {
	const kw = d.exported ? "def" : "defp";
	const params = d.params.join(", ");
	const header = `${kw} ${d.name}(${params})`;
	const docPrefix = d.doc !== undefined ? formatDocComment(d.doc) : EMPTY;
	if (
		d.body.length === 1 &&
		d.body[0]!.kind !== "assign" &&
		(d.danglingComments === undefined || d.danglingComments.length === 0)
	) {
		const expr = d.body[0] as Expr;
		const exprDoc = formatExpr(expr, 1);
		const flatForm = concat(text(`${header} = `), exprDoc);
		const breakForm = concat(
			text(`${header} do`),
			nest(1, concat(HARDLINE, exprDoc)),
			HARDLINE,
			text("end"),
		);
		return concat(docPrefix, group(ifBreak(breakForm, flatForm)));
	}
	const bodyDoc = formatStmts(d.body);
	return concat(
		docPrefix,
		text(`${header} do`),
		nest(1, concat(HARDLINE, bodyDoc)),
		HARDLINE,
		text("end"),
	);
}

function formatDocComment(doc: string): Doc {
	const lines = doc.split("\n");
	const docs: Doc[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (i > 0) docs.push(HARDLINE);
		const line = lines[i]!;
		docs.push(text(line === "" ? "##" : `## ${line}`));
	}
	docs.push(HARDLINE);
	return concat(...docs);
}

function formatCmd(c: Cmd): Doc {
	const parts: Doc[] = [];
	for (const m of c.meta) parts.push(formatMeta(m));
	for (const d of c.decls) parts.push(formatDecl(d));
	for (const s of c.body) parts.push(formatStmt(s));
	const body = join(parts, HARDLINE);
	return concat(
		text(`cmd ${c.name} do`),
		nest(1, concat(HARDLINE, body)),
		HARDLINE,
		text("end"),
	);
}

function formatProgram(p: ProgramDecl): Doc {
	const sections: Doc[] = [];
	const headerParts: Doc[] = [];
	for (const m of p.meta) headerParts.push(formatMeta(m));
	for (const f of p.flags) headerParts.push(formatDecl(f));
	if (headerParts.length > 0) sections.push(join(headerParts, HARDLINE));
	if (p.cmds.length > 0) {
		const cmdDocs = p.cmds.map(formatCmd);
		sections.push(join(cmdDocs, concat(HARDLINE, HARDLINE)));
	}
	const body = join(sections, concat(HARDLINE, HARDLINE));
	return concat(
		text(`program ${p.name} do`),
		nest(1, concat(HARDLINE, body)),
		HARDLINE,
		text("end"),
	);
}

function formatTest(t: TestBlock): Doc {
	const bodyDoc = formatStmts(t.body);
	return concat(
		text(`test "${escapeStringPart(t.name)}" do`),
		nest(1, concat(HARDLINE, bodyDoc)),
		HARDLINE,
		text("end"),
	);
}

function formatImport(i: ImportItem): Doc {
	const pathStr = `"${escapeStringPart(i.path)}"`;
	if (!i.only) return concat(text("import "), text(pathStr));
	const selDocs = i.only.map((sel) =>
		sel.as !== undefined
			? text(`${sel.name} as ${sel.as}`)
			: text(sel.name),
	);
	return group(
		concat(
			text("import "),
			text(pathStr),
			text(" only ["),
			nest(
				1,
				concat(
					SOFTLINE,
					join(selDocs, concat(text(","), LINE)),
					ifBreak(text(","), EMPTY),
				),
			),
			SOFTLINE,
			text("]"),
		),
	);
}

function formatMeta(m: MetaStmt): Doc {
	const kw = m.kind === "meta_desc" ? "desc" : "version";
	return concat(text(`${kw} `), formatExpr(m.value, 1));
}

function formatDecl(d: ArgDecl | FlagDecl): Doc {
	const kw = d.kind === "arg_decl" ? "arg" : "flag";
	const parts: Doc[] = [text(`${kw} ${d.name}: ${d.type}`)];
	if (d.default !== undefined) {
		parts.push(text(" = "), formatExpr(d.default, 1));
	}
	if (d.attrs.short !== undefined) {
		parts.push(text(`, short: "${escapeStringPart(d.attrs.short)}"`));
	}
	if (d.attrs.desc !== undefined) {
		parts.push(text(`, desc: "${escapeStringPart(d.attrs.desc)}"`));
	}
	return concat(...parts);
}
