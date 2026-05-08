import type {
	ArgDecl,
	AssertExpr,
	AssignStmt,
	BinaryOpKind,
	Call,
	CliType,
	Cmd,
	DeclAttrs,
	Expr,
	FieldShorthand,
	FlagDecl,
	FnDef,
	Identifier,
	IfBranch,
	IfExpr,
	ImportItem,
	ImportSelector,
	Item,
	LambdaExpr,
	ListExpr,
	MapEntry,
	MapExpr,
	MetaStmt,
	Module,
	ProgramDecl,
	Stmt,
	StringExpr,
	TestBlock,
	TryExpr,
} from "./ast";
import { EspetoError, type Span } from "./errors";
import type { Token, TokenType } from "./lexer";

const CLI_TYPES: Record<string, CliType> = {
	str: "str",
	int: "int",
	float: "float",
	bool: "bool",
};

class Parser {
	private i = 0;

	constructor(
		private readonly tokens: Token[],
		private readonly source: string,
	) {}

	parseModule(): Module {
		const items: Item[] = [];
		let cmdSeen = false;
		let programSeen = false;
		let testSeen = false;
		const testNames = new Set<string>();
		let nonImportSeen = false;
		let pendingDocs = this.collectPendingDocs();
		while (!this.match("eof")) {
			const item = this.parseTopLevelItem(pendingDocs);
			if (item.kind === "import") {
				if (nonImportSeen) {
					throw new EspetoError(
						"import must come before declarations",
						item.span,
						this.source,
					);
				}
			} else {
				nonImportSeen = true;
				if (item.kind === "cmd") {
					if (programSeen) {
						throw new EspetoError(
							"top-level 'cmd' not allowed alongside 'program' (wrap cmds inside the program block)",
							item.span,
							this.source,
						);
					}
					if (cmdSeen) {
						throw new EspetoError(
							"only one cmd block allowed per file (use 'program' to declare multiple commands)",
							item.span,
							this.source,
						);
					}
					if (testSeen) {
						throw new EspetoError(
							"'cmd' not allowed alongside 'test' (test files must be pure: no cmd/program)",
							item.span,
							this.source,
						);
					}
					cmdSeen = true;
				}
				if (item.kind === "program") {
					if (cmdSeen) {
						throw new EspetoError(
							"'program' not allowed alongside top-level 'cmd' (move the cmd inside the program block)",
							item.span,
							this.source,
						);
					}
					if (programSeen) {
						throw new EspetoError(
							"only one 'program' block allowed per file",
							item.span,
							this.source,
						);
					}
					if (testSeen) {
						throw new EspetoError(
							"'program' not allowed alongside 'test' (test files must be pure: no cmd/program)",
							item.span,
							this.source,
						);
					}
					programSeen = true;
				}
				if (item.kind === "test") {
					if (cmdSeen || programSeen) {
						throw new EspetoError(
							"'test' not allowed alongside 'cmd'/'program' (test files must be pure)",
							item.span,
							this.source,
						);
					}
					if (testNames.has(item.name)) {
						throw new EspetoError(
							`duplicate test name ${JSON.stringify(item.name)}`,
							item.nameSpan,
							this.source,
						);
					}
					testNames.add(item.name);
					testSeen = true;
				}
			}
			items.push(item);
			this.expectStmtEnd("eof");
			this.skipNewlines();
			pendingDocs = this.collectPendingDocs();
		}
		const span = items[0]?.span ?? this.peek().span;
		return { kind: "module", items, span };
	}

	private parseTopLevelItem(pendingDocs?: { doc: string; docSpan: Span }): Item {
		if (this.match("kw_import")) {
			return this.parseImport();
		}
		if (this.match("kw_def") || this.match("kw_defp")) {
			return this.parseFnDef(pendingDocs);
		}
		if (this.match("kw_program")) {
			return this.parseProgramDecl();
		}
		if (this.match("kw_cmd")) {
			return this.parseCmd();
		}
		if (this.match("kw_test")) {
			return this.parseTestBlock();
		}
		if (this.peek().type === "ident" && this.peek(1).type === "equals") {
			return this.parseAssign();
		}
		return this.parseExpr();
	}

	private parseTestBlock(): TestBlock {
		const kw = this.advance();
		const nameTok = this.peek();
		if (nameTok.type !== "string") {
			throw new EspetoError(
				`expected plain string literal for test name, got ${nameTok.type}`,
				nameTok.span,
				this.source,
			);
		}
		this.advance();
		this.expect("kw_do", "'do' to open test block");
		this.skipNewlines();
		const body: Stmt[] = [];
		while (!this.match("kw_end")) {
			if (this.match("eof")) {
				throw new EspetoError(
					"expected 'end' to close test",
					kw.span,
					this.source,
				);
			}
			body.push(this.parseStmt());
			this.expectStmtEnd("kw_end");
			this.skipNewlines();
		}
		this.expect("kw_end", "'end' to close test");
		if (body.length === 0) {
			throw new EspetoError(
				"test block must contain at least one statement",
				kw.span,
				this.source,
			);
		}
		return {
			kind: "test",
			name: nameTok.value,
			nameSpan: nameTok.span,
			body,
			span: kw.span,
		};
	}

	private parseImport(): ImportItem {
		const kw = this.advance();
		const pathTok = this.peek();
		if (pathTok.type !== "string") {
			throw new EspetoError(
				`expected plain string literal for import path, got ${pathTok.type}`,
				pathTok.span,
				this.source,
			);
		}
		this.advance();
		const path = pathTok.value;
		if (!path.startsWith("./") && !path.startsWith("../")) {
			throw new EspetoError(
				`import path must start with './' or '../' (got ${JSON.stringify(path)})`,
				pathTok.span,
				this.source,
			);
		}

		let only: ImportSelector[] | undefined;
		if (this.match("kw_only")) {
			this.advance();
			this.expect("lbracket", "'[' after 'only'");
			this.skipNewlines();
			if (this.match("rbracket")) {
				throw new EspetoError(
					"'only' list cannot be empty (omit 'only' to import all)",
					this.peek().span,
					this.source,
				);
			}
			only = [];
			const seenBindings = new Set<string>();
			while (true) {
				const nameTok = this.expect("ident", "import name");
				let alias: string | undefined;
				let aliasSpan: typeof nameTok.span | undefined;
				let bindingSpan = nameTok.span;
				if (this.match("kw_as")) {
					this.advance();
					const asTok = this.expect("ident", "alias name after 'as'");
					alias = asTok.value;
					aliasSpan = asTok.span;
					bindingSpan = asTok.span;
				}
				const bindingName = alias ?? nameTok.value;
				if (seenBindings.has(bindingName)) {
					throw new EspetoError(
						`duplicate import name '${bindingName}' in 'only' list`,
						bindingSpan,
						this.source,
					);
				}
				seenBindings.add(bindingName);
				only.push(
					alias === undefined
						? { name: nameTok.value, nameSpan: nameTok.span }
						: {
								name: nameTok.value,
								nameSpan: nameTok.span,
								as: alias,
								asSpan: aliasSpan,
							},
				);
				this.skipNewlines();
				if (this.match("rbracket")) break;
				this.expect("comma", "',' or ']'");
				this.skipNewlines();
				if (this.match("rbracket")) break;
			}
			this.expect("rbracket", "']' to close 'only'");
		}

		return {
			kind: "import",
			path,
			pathSpan: pathTok.span,
			only,
			span: kw.span,
		};
	}

	private parseCmd(): Cmd {
		const kw = this.advance();
		const nameTok = this.expect("ident", "cmd name");
		this.expect("kw_do", "'do' to open cmd block");
		this.skipNewlines();

		const meta: MetaStmt[] = [];
		while (this.match("kw_desc") || this.match("kw_version")) {
			const metaTok = this.advance();
			const value = this.parseExpr();
			meta.push({
				kind: metaTok.type === "kw_desc" ? "meta_desc" : "meta_version",
				value,
				span: metaTok.span,
			});
			this.expectStmtEnd("kw_end");
			this.skipNewlines();
		}

		const decls: (ArgDecl | FlagDecl)[] = [];
		while (this.match("kw_arg") || this.match("kw_flag")) {
			decls.push(this.parseDecl());
			this.expectStmtEnd("kw_end");
			this.skipNewlines();
		}

		const body: Stmt[] = [];
		while (!this.match("kw_end")) {
			if (this.match("eof")) {
				throw new EspetoError(
					"expected 'end' to close cmd",
					kw.span,
					this.source,
				);
			}
			if (this.match("kw_desc") || this.match("kw_version")) {
				throw new EspetoError(
					"meta (desc/version) must come before declarations and body",
					this.peek().span,
					this.source,
				);
			}
			if (this.match("kw_arg") || this.match("kw_flag")) {
				throw new EspetoError(
					"declarations (arg/flag) must come before body statements",
					this.peek().span,
					this.source,
				);
			}
			body.push(this.parseStmt());
			this.expectStmtEnd("kw_end");
			this.skipNewlines();
		}
		this.expect("kw_end", "'end' to close cmd");

		return {
			kind: "cmd",
			name: nameTok.value,
			meta,
			decls,
			body,
			span: kw.span,
		};
	}

	private parseProgramDecl(): ProgramDecl {
		const kw = this.advance();
		const nameTok = this.expect("ident", "program name");
		this.expect("kw_do", "'do' to open program block");
		this.skipNewlines();

		const meta: MetaStmt[] = [];
		while (this.match("kw_desc") || this.match("kw_version")) {
			const metaTok = this.advance();
			const value = this.parseExpr();
			meta.push({
				kind: metaTok.type === "kw_desc" ? "meta_desc" : "meta_version",
				value,
				span: metaTok.span,
			});
			this.expectStmtEnd("kw_end");
			this.skipNewlines();
		}

		const flags: FlagDecl[] = [];
		while (this.match("kw_flag")) {
			const decl = this.parseDecl();
			flags.push(decl as FlagDecl);
			this.expectStmtEnd("kw_end");
			this.skipNewlines();
		}

		if (this.match("kw_arg")) {
			throw new EspetoError(
				"'arg' not allowed at program level (declare 'arg' inside individual cmds)",
				this.peek().span,
				this.source,
			);
		}

		const cmds: Cmd[] = [];
		const cmdNames = new Set<string>();
		while (this.match("kw_cmd")) {
			const cmd = this.parseCmd();
			if (cmdNames.has(cmd.name)) {
				throw new EspetoError(
					`duplicate command '${cmd.name}' in program '${nameTok.value}'`,
					cmd.span,
					this.source,
				);
			}
			cmdNames.add(cmd.name);
			for (const cmdDecl of cmd.decls) {
				if (cmdDecl.kind !== "flag_decl") continue;
				const conflict = flags.find((f) => f.name === cmdDecl.name);
				if (conflict !== undefined) {
					throw new EspetoError(
						`flag '${cmdDecl.name}' in cmd '${cmd.name}' shadows program-level flag of the same name`,
						cmdDecl.span,
						this.source,
					);
				}
			}
			cmds.push(cmd);
			this.expectStmtEnd("kw_end");
			this.skipNewlines();
		}

		if (!this.match("kw_end")) {
			if (this.match("eof")) {
				throw new EspetoError(
					"expected 'end' to close program",
					kw.span,
					this.source,
				);
			}
			if (this.match("kw_desc") || this.match("kw_version")) {
				throw new EspetoError(
					"meta (desc/version) must come before flags and cmds",
					this.peek().span,
					this.source,
				);
			}
			if (this.match("kw_flag")) {
				throw new EspetoError(
					"flag declarations must come before cmd declarations",
					this.peek().span,
					this.source,
				);
			}
			throw new EspetoError(
				"unexpected statement in program body; only 'desc', 'version', 'flag', and 'cmd' are allowed at program level",
				this.peek().span,
				this.source,
			);
		}
		this.expect("kw_end", "'end' to close program");

		if (cmds.length === 0) {
			throw new EspetoError(
				`program '${nameTok.value}' has no commands; declare at least one 'cmd' inside`,
				kw.span,
				this.source,
			);
		}

		return {
			kind: "program",
			name: nameTok.value,
			meta,
			flags,
			cmds,
			span: kw.span,
		};
	}

	private parseDecl(): ArgDecl | FlagDecl {
		const kw = this.advance();
		const isFlag = kw.type === "kw_flag";
		const nameTok = this.expect("ident", "decl name");
		this.expect("colon", "':' after decl name");
		const typeTok = this.expect("ident", "type (str/int/float/bool)");
		const type = CLI_TYPES[typeTok.value];
		if (type === undefined) {
			throw new EspetoError(
				`unknown type: ${typeTok.value} (expected str/int/float/bool)`,
				typeTok.span,
				this.source,
			);
		}

		let defaultExpr: Expr | undefined;
		if (this.match("equals")) {
			this.advance();
			defaultExpr = this.parseExpr();
		}

		const attrs: DeclAttrs = {};
		while (this.match("comma")) {
			this.advance();
			const attrTok = this.peek();
			if (
				attrTok.type !== "ident" &&
				attrTok.type !== "kw_desc" &&
				attrTok.type !== "kw_version"
			) {
				throw new EspetoError(
					`expected attr name, got ${attrTok.type}`,
					attrTok.span,
					this.source,
				);
			}
			this.advance();
			this.expect("colon", "':' after attr name");
			const valueExpr = this.parseExpr();
			const attrName = attrTok.value;
			if (attrName !== "short" && attrName !== "desc") {
				throw new EspetoError(
					`unknown attr: '${attrName}' (expected 'short' or 'desc')`,
					attrTok.span,
					this.source,
				);
			}
			if (
				valueExpr.kind !== "string" ||
				valueExpr.parts.length !== 1 ||
				typeof valueExpr.parts[0] !== "string"
			) {
				throw new EspetoError(
					`'${attrName}' must be a plain string literal`,
					valueExpr.span,
					this.source,
				);
			}
			attrs[attrName] = valueExpr.parts[0];
		}

		return {
			kind: isFlag ? "flag_decl" : "arg_decl",
			name: nameTok.value,
			nameSpan: nameTok.span,
			type,
			default: defaultExpr,
			attrs,
			span: kw.span,
		};
	}

	private parseStmt(): Stmt {
		if (this.peek().type === "ident" && this.peek(1).type === "equals") {
			return this.parseAssign();
		}
		return this.parseExpr();
	}

	private expectStmtEnd(otherTerminator: TokenType): void {
		if (this.match(otherTerminator) || this.match("newline")) return;
		const tok = this.peek();
		throw new EspetoError(
			`unexpected token: ${tok.type}`,
			tok.span,
			this.source,
		);
	}

	private parseFnDef(pendingDocs?: { doc: string; docSpan: Span }): FnDef {
		const kw = this.advance();
		const exported = kw.type === "kw_def";
		const nameTok = this.expect("ident", "function name");
		this.expect("lparen", "'('");
		const params: string[] = [];
		const paramSpans: Span[] = [];
		if (!this.match("rparen")) {
			const p = this.expect("ident", "parameter name");
			params.push(p.value);
			paramSpans.push(p.span);
			while (this.match("comma")) {
				this.advance();
				const next = this.expect("ident", "parameter name");
				params.push(next.value);
				paramSpans.push(next.span);
			}
		}
		this.expect("rparen", "')'");

		let body: Stmt[];
		if (this.match("kw_do")) {
			this.advance();
			this.skipNewlines();
			body = [];
			while (!this.match("kw_end")) {
				if (this.match("eof")) {
					throw new EspetoError(
						"expected 'end' to close def",
						kw.span,
						this.source,
					);
				}
				body.push(this.parseStmt());
				this.expectStmtEnd("kw_end");
				this.skipNewlines();
			}
			this.expect("kw_end", "'end' to close def");
			if (body.length === 0) {
				throw new EspetoError(
					"def block must contain at least one statement",
					kw.span,
					this.source,
				);
			}
		} else {
			this.expect("equals", "'=' or 'do' after parameters");
			body = [this.parseExpr()];
		}

		return {
			kind: "fn_def",
			name: nameTok.value,
			nameSpan: nameTok.span,
			params,
			paramSpans,
			body,
			exported,
			doc: pendingDocs?.doc,
			docSpan: pendingDocs?.docSpan,
			span: kw.span,
		};
	}

	private parseAssign(): AssignStmt {
		const nameTok = this.advance();
		this.advance();
		this.skipNewlines();
		const value = this.parseExpr();
		return {
			kind: "assign",
			name: nameTok.value,
			value,
			span: nameTok.span,
		};
	}

	private parseExpr(): Expr {
		if (this.match("kw_assert")) {
			return this.parseAssertExpr();
		}
		return this.parseOr();
	}

	private parseAssertExpr(): AssertExpr {
		const kw = this.advance();
		const expr = this.parseOr();
		return { kind: "assert", expr, span: kw.span };
	}

	private parseOr(): Expr {
		let lhs = this.parseAnd();
		while (this.match("kw_or")) {
			this.advance();
			this.skipNewlines();
			const rhs = this.parseAnd();
			lhs = { kind: "binop", op: "or", lhs, rhs, span: lhs.span };
		}
		return lhs;
	}

	private parseAnd(): Expr {
		let lhs = this.parseComparison();
		while (this.match("kw_and")) {
			this.advance();
			this.skipNewlines();
			const rhs = this.parseComparison();
			lhs = { kind: "binop", op: "and", lhs, rhs, span: lhs.span };
		}
		return lhs;
	}

	private parseComparison(): Expr {
		const lhs = this.parseAdditive();
		const op = peekCmpOp(this.peek().type);
		if (op === null) return lhs;
		this.advance();
		this.skipNewlines();
		const rhs = this.parseAdditive();
		if (peekCmpOp(this.peek().type) !== null) {
			throw new EspetoError(
				"comparisons cannot be chained, use 'and'",
				this.peek().span,
				this.source,
			);
		}
		return { kind: "binop", op, lhs, rhs, span: lhs.span };
	}

	private parseAdditive(): Expr {
		let lhs = this.parseMultiplicative();
		while (this.match("plus") || this.match("minus")) {
			const opTok = this.advance();
			this.skipNewlines();
			const rhs = this.parseMultiplicative();
			lhs = {
				kind: "binop",
				op: opTok.type === "plus" ? "+" : "-",
				lhs,
				rhs,
				span: lhs.span,
			};
		}
		return lhs;
	}

	private parseMultiplicative(): Expr {
		let lhs = this.parseUnary();
		while (this.match("star") || this.match("slash")) {
			const opTok = this.advance();
			this.skipNewlines();
			const rhs = this.parseUnary();
			lhs = {
				kind: "binop",
				op: opTok.type === "star" ? "*" : "/",
				lhs,
				rhs,
				span: lhs.span,
			};
		}
		return lhs;
	}

	private parseUnary(): Expr {
		if (this.match("minus") || this.match("kw_not")) {
			const opTok = this.advance();
			const operand = this.parseUnary();
			return {
				kind: "unop",
				op: opTok.type === "minus" ? "-" : "not",
				operand,
				span: opTok.span,
			};
		}
		return this.parsePipe();
	}

	private parsePipe(): Expr {
		let lhs = this.parsePrimary();
		while (this.peekPastNewlines() === "pipe") {
			this.skipNewlines();
			this.advance();
			this.skipNewlines();
			lhs = this.parsePipeRhs(lhs);
		}
		return lhs;
	}

	private peekPastNewlines(): TokenType {
		let j = this.i;
		while (j < this.tokens.length && this.tokens[j]!.type === "newline") j++;
		return this.tokens[j]?.type ?? "eof";
	}

	private parsePipeRhs(lhs: Expr): Call {
		if (this.match("kw_fn")) {
			const lambda = this.parseLambda();
			return { kind: "call", callee: lambda, args: [lhs], span: lhs.span };
		}

		if (this.match("dot")) {
			const dotTok = this.advance();
			const fieldTok = this.expect("ident", "field name after '.'");
			const shorthand: FieldShorthand = {
				kind: "field_shorthand",
				field: fieldTok.value,
				span: dotTok.span,
			};
			return {
				kind: "call",
				callee: shorthand,
				args: [lhs],
				span: lhs.span,
			};
		}

		const ident = this.expect("ident", "function name or 'fn' after |>");
		const callee: Identifier = {
			kind: "ident",
			name: ident.value,
			span: ident.span,
		};

		if (this.match("lparen")) {
			this.advance();
			const explicitArgs: Expr[] = [];
			if (!this.match("rparen")) {
				explicitArgs.push(this.parseExpr());
				while (this.match("comma")) {
					this.advance();
					explicitArgs.push(this.parseExpr());
				}
			}
			this.expect("rparen", "')'");

			const placeholders: number[] = [];
			for (let i = 0; i < explicitArgs.length; i++) {
				const a = explicitArgs[i]!;
				if (a.kind === "ident" && a.name === "_") placeholders.push(i);
			}

			let args: Expr[];
			if (placeholders.length === 0) {
				args = [lhs, ...explicitArgs];
			} else if (placeholders.length === 1) {
				args = explicitArgs.slice();
				args[placeholders[0]!] = lhs;
			} else {
				const second = explicitArgs[placeholders[1]!]!;
				throw new EspetoError(
					"pipe placeholder '_' may appear at most once per call",
					second.span,
					this.source,
				);
			}

			return { kind: "call", callee, args, span: lhs.span };
		}

		return { kind: "call", callee, args: [lhs], span: lhs.span };
	}

	private parsePrimary(): Expr {
		let expr = this.parseAtom();
		while (true) {
			if (this.match("dot")) {
				const dotTok = this.advance();
				const fieldTok = this.expect("ident", "field name after '.'");
				expr = {
					kind: "field_access",
					target: expr,
					field: fieldTok.value,
					fieldSpan: fieldTok.span,
					span: dotTok.span,
				};
				continue;
			}
			if (this.match("lparen")) {
				this.advance();
				const args: Expr[] = [];
				if (!this.match("rparen")) {
					args.push(this.parseExpr());
					while (this.match("comma")) {
						this.advance();
						args.push(this.parseExpr());
					}
				}
				this.expect("rparen", "')'");
				expr = { kind: "call", callee: expr, args, span: expr.span };
				continue;
			}
			break;
		}
		return expr;
	}

	private parseAtom(): Expr {
		const tok = this.peek();

		if (tok.type === "kw_if") {
			return this.parseIf();
		}

		if (tok.type === "kw_try") {
			return this.parseTry();
		}

		if (tok.type === "kw_fn") {
			return this.parseLambda();
		}

		if (tok.type === "lbracket") {
			return this.parseList();
		}

		if (tok.type === "lbrace") {
			return this.parseMap();
		}

		if (tok.type === "dot") {
			this.advance();
			const fieldTok = this.expect("ident", "field name after '.'");
			return {
				kind: "field_shorthand",
				field: fieldTok.value,
				span: tok.span,
			};
		}

		if (tok.type === "lparen") {
			this.advance();
			this.skipNewlines();
			const inner = this.parseExpr();
			this.skipNewlines();
			this.expect("rparen", "')'");
			return inner;
		}

		if (tok.type === "string") {
			this.advance();
			return { kind: "string", parts: [tok.value], span: tok.span };
		}

		if (tok.type === "string_template_start") {
			return this.parseStringTemplate();
		}

		if (tok.type === "int") {
			this.advance();
			return { kind: "int", value: Number(tok.value), span: tok.span };
		}

		if (tok.type === "float") {
			this.advance();
			return { kind: "float", value: Number(tok.value), span: tok.span };
		}

		if (tok.type === "kw_true") {
			this.advance();
			return { kind: "bool", value: true, span: tok.span };
		}

		if (tok.type === "kw_false") {
			this.advance();
			return { kind: "bool", value: false, span: tok.span };
		}

		if (tok.type === "kw_nil") {
			this.advance();
			return { kind: "nil", span: tok.span };
		}

		if (tok.type === "ident") {
			this.advance();
			return {
				kind: "ident",
				name: tok.value,
				span: tok.span,
			};
		}

		throw new EspetoError(
			`unexpected token: ${tok.type}`,
			tok.span,
			this.source,
		);
	}

	private parseLambda(): LambdaExpr {
		const kw = this.advance();
		const params: string[] = [];
		const paramSpans: Span[] = [];
		if (this.match("lparen")) {
			this.advance();
			this.skipNewlines();
			if (!this.match("rparen")) {
				const p = this.expect("ident", "lambda parameter");
				params.push(p.value);
				paramSpans.push(p.span);
				this.skipNewlines();
				while (this.match("comma")) {
					this.advance();
					this.skipNewlines();
					const next = this.expect("ident", "lambda parameter");
					params.push(next.value);
					paramSpans.push(next.span);
					this.skipNewlines();
				}
			}
			this.expect("rparen", "')' to close lambda parameters");
		} else if (this.match("ident")) {
			const t = this.advance();
			params.push(t.value);
			paramSpans.push(t.span);
		} else {
			const tok = this.peek();
			throw new EspetoError(
				`expected lambda parameter or '(' after 'fn', got ${tok.type}`,
				tok.span,
				this.source,
			);
		}
		this.expect("fat_arrow", "'=>' after lambda parameters");
		this.skipNewlines();
		const body = this.parseExpr();
		return { kind: "lambda", params, paramSpans, body, span: kw.span };
	}

	private parseList(): ListExpr {
		const lbracket = this.advance();
		this.skipNewlines();
		const items: Expr[] = [];
		while (!this.match("rbracket")) {
			items.push(this.parseExpr());
			this.skipNewlines();
			if (this.match("rbracket")) break;
			this.expect("comma", "',' or ']'");
			this.skipNewlines();
		}
		this.expect("rbracket", "']' to close list");
		return { kind: "list", items, span: lbracket.span };
	}

	private parseMap(): MapExpr {
		const lbrace = this.advance();
		this.skipNewlines();
		const entries: MapEntry[] = [];
		const seen = new Set<string>();
		while (!this.match("rbrace")) {
			let key: string;
			let keySpan;
			if (this.match("ident")) {
				const kt = this.advance();
				key = kt.value;
				keySpan = kt.span;
			} else if (this.match("string")) {
				const kt = this.advance();
				key = kt.value;
				keySpan = kt.span;
			} else {
				const tok = this.peek();
				throw new EspetoError(
					`expected map key (ident or string), got ${tok.type}`,
					tok.span,
					this.source,
				);
			}
			if (seen.has(key)) {
				throw new EspetoError(
					`duplicate map key '${key}'`,
					keySpan,
					this.source,
				);
			}
			seen.add(key);
			this.expect("colon", "':' after map key");
			this.skipNewlines();
			const value = this.parseExpr();
			entries.push({ key, keySpan, value });
			this.skipNewlines();
			if (this.match("rbrace")) break;
			this.expect("comma", "',' or '}'");
			this.skipNewlines();
		}
		this.expect("rbrace", "'}' to close map");
		return { kind: "map", entries, span: lbrace.span };
	}

	private parseIf(): IfExpr {
		const kwIf = this.advance();
		const branches: IfBranch[] = [];
		const firstCond = this.parseExpr();
		this.expect("kw_do", "'do' after if condition");
		this.skipNewlines();
		const firstBody = this.parseExpr();
		this.skipNewlines();
		branches.push({ cond: firstCond, body: firstBody });

		let elseBody: Expr | undefined;
		while (this.match("kw_else")) {
			this.advance();
			this.skipNewlines();
			if (this.match("kw_if")) {
				this.advance();
				const cond = this.parseExpr();
				this.expect("kw_do", "'do' after else if condition");
				this.skipNewlines();
				const body = this.parseExpr();
				this.skipNewlines();
				branches.push({ cond, body });
				continue;
			}
			elseBody = this.parseExpr();
			this.skipNewlines();
			break;
		}

		this.expect("kw_end", "'end' to close if");
		return { kind: "if", branches, elseBody, span: kwIf.span };
	}

	private parseTry(): TryExpr {
		const kw = this.advance();
		this.skipNewlines();
		this.expect("kw_do", "'do' after 'try'");
		this.skipNewlines();

		const tryBody: Stmt[] = [];
		while (!this.match("kw_rescue")) {
			if (this.match("eof")) {
				throw new EspetoError(
					"expected 'rescue' to close try",
					kw.span,
					this.source,
				);
			}
			tryBody.push(this.parseStmt());
			this.expectStmtEnd("kw_rescue");
			this.skipNewlines();
		}

		this.advance();
		this.skipNewlines();
		const errIdent = this.expect(
			"ident",
			"error binding name after 'rescue'",
		);
		this.skipNewlines();
		this.expect("fat_arrow", "'=>' after rescue binding");
		this.skipNewlines();

		const rescueBody: Stmt[] = [];
		while (!this.match("kw_end")) {
			if (this.match("eof")) {
				throw new EspetoError(
					"expected 'end' to close try",
					kw.span,
					this.source,
				);
			}
			rescueBody.push(this.parseStmt());
			this.expectStmtEnd("kw_end");
			this.skipNewlines();
		}
		this.advance();

		return {
			kind: "try",
			tryBody,
			errBinding: errIdent.value,
			errBindingSpan: errIdent.span,
			rescueBody,
			span: kw.span,
		};
	}

	private parseStringTemplate(): StringExpr {
		const startTok = this.advance();
		const parts: (string | Expr)[] = [];
		while (!this.match("string_template_end")) {
			const tok = this.peek();
			if (tok.type === "string_part") {
				this.advance();
				parts.push(tok.value);
			} else if (tok.type === "interp_start") {
				this.advance();
				parts.push(this.parseExpr());
				this.expect("interp_end", "'}' to close interpolation");
			} else if (tok.type === "eof") {
				throw new EspetoError(
					"unterminated string template",
					startTok.span,
					this.source,
				);
			} else {
				throw new EspetoError(
					`unexpected token in string: ${tok.type}`,
					tok.span,
					this.source,
				);
			}
		}
		this.advance();
		return { kind: "string", parts, span: startTok.span };
	}

	private peek(offset = 0): Token {
		return this.tokens[this.i + offset]!;
	}

	private advance(): Token {
		return this.tokens[this.i++]!;
	}

	private match(type: TokenType): boolean {
		return this.peek().type === type;
	}

	private expect(type: TokenType, what: string): Token {
		const tok = this.peek();
		if (tok.type !== type) {
			throw new EspetoError(
				`expected ${what}, got ${tok.type}`,
				tok.span,
				this.source,
			);
		}
		return this.advance();
	}

	private skipNewlines(): void {
		while (this.match("newline")) this.advance();
	}

	private collectPendingDocs():
		| { doc: string; docSpan: Span }
		| undefined {
		this.skipNewlines();
		while (true) {
			if (!this.match("doc_line")) return undefined;
			const lines: string[] = [];
			const firstTok = this.peek();
			let brokenByBlankLine = false;
			while (this.match("doc_line")) {
				const tok = this.advance();
				lines.push(tok.value);
				if (this.match("newline")) {
					this.advance();
					if (this.match("newline")) {
						brokenByBlankLine = true;
						break;
					}
				} else {
					break;
				}
			}
			while (this.match("newline")) this.advance();
			if (
				!brokenByBlankLine &&
				(this.match("kw_def") || this.match("kw_defp"))
			) {
				return {
					doc: lines.join("\n"),
					docSpan: firstTok.span,
				};
			}
		}
	}
}

function peekCmpOp(type: TokenType): BinaryOpKind | null {
	switch (type) {
		case "eq_eq":
			return "==";
		case "lt":
			return "<";
		case "lte":
			return "<=";
		case "gt":
			return ">";
		case "gte":
			return ">=";
		default:
			return null;
	}
}

export function parse(tokens: Token[], source: string): Module {
	return new Parser(tokens, source).parseModule();
}
