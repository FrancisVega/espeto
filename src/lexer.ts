import { EspetoError, type Span } from "./errors";

export type TokenType =
	| "string"
	| "string_template_start"
	| "string_part"
	| "interp_start"
	| "interp_end"
	| "string_template_end"
	| "ident"
	| "int"
	| "float"
	| "pipe"
	| "lparen"
	| "rparen"
	| "lbracket"
	| "rbracket"
	| "lbrace"
	| "rbrace"
	| "comma"
	| "colon"
	| "dot"
	| "equals"
	| "plus"
	| "minus"
	| "star"
	| "slash"
	| "eq_eq"
	| "fat_arrow"
	| "lt"
	| "lte"
	| "gt"
	| "gte"
	| "newline"
	| "doc_line"
	| "eof"
	| "kw_def"
	| "kw_defp"
	| "kw_do"
	| "kw_end"
	| "kw_true"
	| "kw_false"
	| "kw_nil"
	| "kw_program"
	| "kw_cmd"
	| "kw_arg"
	| "kw_flag"
	| "kw_desc"
	| "kw_version"
	| "kw_import"
	| "kw_only"
	| "kw_as"
	| "kw_if"
	| "kw_else"
	| "kw_and"
	| "kw_or"
	| "kw_not"
	| "kw_fn"
	| "kw_try"
	| "kw_rescue"
	| "kw_test"
	| "kw_assert";

export type Token = {
	type: TokenType;
	value: string;
	span: Span;
};

type Mark = { line: number; col: number; index: number };

class Lexer {
	private i = 0;
	private line = 1;
	private col = 1;
	private out: Token[] = [];

	constructor(
		private readonly source: string,
		private readonly file: string,
	) {}

	tokenize(): Token[] {
		while (this.i < this.source.length) {
			this.lexNext();
		}
		this.out.push({
			type: "eof",
			value: "",
			span: { file: this.file, line: this.line, col: this.col, length: 0 },
		});
		return this.out;
	}

	private lexNext(): void {
		const ch = this.source[this.i]!;

		if (ch === " " || ch === "\t" || ch === "\r") {
			this.advance();
			return;
		}

		if (ch === "#") {
			const isDocMarker =
				this.source[this.i + 1] === "#" &&
				(this.source[this.i + 2] === " " ||
					this.source[this.i + 2] === "\n" ||
					this.i + 2 >= this.source.length);
			if (isDocMarker) {
				const start = this.mark();
				this.advance();
				this.advance();
				if (this.source[this.i] === " ") this.advance();
				const contentStart = this.i;
				while (this.i < this.source.length && this.source[this.i] !== "\n") {
					this.advance();
				}
				const value = this.source.slice(contentStart, this.i);
				this.out.push({
					type: "doc_line",
					value,
					span: this.spanFrom(start),
				});
				return;
			}
			while (this.i < this.source.length && this.source[this.i] !== "\n") {
				this.advance();
			}
			return;
		}

		if (ch === "\n") {
			const start = this.mark();
			this.advance();
			this.out.push({
				type: "newline",
				value: "\n",
				span: this.spanFrom(start),
			});
			return;
		}

		if (ch === '"') {
			this.lexString();
			return;
		}

		if (ch === "|" && this.source[this.i + 1] === ">") {
			const start = this.mark();
			this.advance();
			this.advance();
			this.out.push({ type: "pipe", value: "|>", span: this.spanFrom(start) });
			return;
		}

		if (ch === "=") {
			const start = this.mark();
			this.advance();
			if (this.source[this.i] === "=") {
				this.advance();
				this.out.push({
					type: "eq_eq",
					value: "==",
					span: this.spanFrom(start),
				});
				return;
			}
			if (this.source[this.i] === ">") {
				this.advance();
				this.out.push({
					type: "fat_arrow",
					value: "=>",
					span: this.spanFrom(start),
				});
				return;
			}
			this.out.push({
				type: "equals",
				value: "=",
				span: this.spanFrom(start),
			});
			return;
		}

		if (ch === "<") {
			const start = this.mark();
			this.advance();
			if (this.source[this.i] === "=") {
				this.advance();
				this.out.push({
					type: "lte",
					value: "<=",
					span: this.spanFrom(start),
				});
				return;
			}
			this.out.push({ type: "lt", value: "<", span: this.spanFrom(start) });
			return;
		}

		if (ch === ">") {
			const start = this.mark();
			this.advance();
			if (this.source[this.i] === "=") {
				this.advance();
				this.out.push({
					type: "gte",
					value: ">=",
					span: this.spanFrom(start),
				});
				return;
			}
			this.out.push({ type: "gt", value: ">", span: this.spanFrom(start) });
			return;
		}

		if (ch === "+" || ch === "*" || ch === "/" || ch === "-") {
			const start = this.mark();
			this.advance();
			const type: TokenType =
				ch === "+"
					? "plus"
					: ch === "*"
						? "star"
						: ch === "/"
							? "slash"
							: "minus";
			this.out.push({ type, value: ch, span: this.spanFrom(start) });
			return;
		}

		if (
			ch === "(" ||
			ch === ")" ||
			ch === "[" ||
			ch === "]" ||
			ch === "{" ||
			ch === "}" ||
			ch === "," ||
			ch === ":" ||
			ch === "."
		) {
			const start = this.mark();
			this.advance();
			const type: TokenType =
				ch === "("
					? "lparen"
					: ch === ")"
						? "rparen"
						: ch === "["
							? "lbracket"
							: ch === "]"
								? "rbracket"
								: ch === "{"
									? "lbrace"
									: ch === "}"
										? "rbrace"
										: ch === ","
											? "comma"
											: ch === ":"
												? "colon"
												: "dot";
			this.out.push({ type, value: ch, span: this.spanFrom(start) });
			return;
		}

		if (isDigit(ch)) {
			this.lexNumber();
			return;
		}

		if (isIdentStart(ch)) {
			this.lexIdent();
			return;
		}

		throw new EspetoError(
			`unexpected character: ${JSON.stringify(ch)}`,
			{ file: this.file, line: this.line, col: this.col, length: 1 },
			this.source,
		);
	}

	private lexString(): void {
		const startMark = this.mark();
		this.advance();

		type Seg =
			| { kind: "text"; value: string; span: Span }
			| { kind: "interp"; tokens: Token[]; openSpan: Span; closeSpan: Span };

		const segs: Seg[] = [];
		let buf = "";
		let bufStart = this.mark();

		const flushText = (): void => {
			segs.push({ kind: "text", value: buf, span: this.spanFrom(bufStart) });
			buf = "";
			bufStart = this.mark();
		};

		while (this.i < this.source.length && this.source[this.i] !== '"') {
			if (this.source[this.i] === "\\") {
				const escStart = this.mark();
				this.advance();
				const esc = this.source[this.i];
				if (esc === undefined) {
					throw new EspetoError(
						"unterminated escape",
						this.spanFrom(escStart),
						this.source,
					);
				}
				if (esc === "#") {
					buf += "#";
					this.advance();
					continue;
				}
				const replaced = ESCAPES[esc];
				if (replaced === undefined) {
					throw new EspetoError(
						`invalid escape: \\${esc}`,
						{
							file: this.file,
							line: escStart.line,
							col: escStart.col,
							length: 2,
						},
						this.source,
					);
				}
				buf += replaced;
				this.advance();
				continue;
			}

			if (
				this.source[this.i] === "#" &&
				this.source[this.i + 1] === "{"
			) {
				flushText();
				const openMark = this.mark();
				this.advance();
				this.advance();
				const openSpan = this.spanFrom(openMark);

				const innerOut: Token[] = [];
				const savedOut = this.out;
				this.out = innerOut;
				let depth = 0;
				while (this.i < this.source.length) {
					const c = this.source[this.i];
					if (c === "}" && depth === 0) break;
					if (c === "\n") {
						throw new EspetoError(
							"newline inside interpolation",
							{ file: this.file, line: this.line, col: this.col, length: 1 },
							this.source,
						);
					}
					if (c === "{") depth++;
					else if (c === "}") depth--;
					this.lexNext();
				}
				this.out = savedOut;
				if (this.i >= this.source.length) {
					throw new EspetoError(
						"unterminated interpolation",
						openSpan,
						this.source,
					);
				}
				const closeMark = this.mark();
				this.advance();
				const closeSpan = this.spanFrom(closeMark);

				segs.push({ kind: "interp", tokens: innerOut, openSpan, closeSpan });
				bufStart = this.mark();
				continue;
			}

			buf += this.source[this.i];
			this.advance();
		}

		if (this.i >= this.source.length) {
			throw new EspetoError(
				"unterminated string",
				{
					file: this.file,
					line: startMark.line,
					col: startMark.col,
					length: 1,
				},
				this.source,
			);
		}
		flushText();
		this.advance();

		const fullSpan = this.spanFrom(startMark);

		if (segs.length === 1 && segs[0]!.kind === "text") {
			this.out.push({
				type: "string",
				value: segs[0]!.value,
				span: fullSpan,
			});
			return;
		}

		this.out.push({
			type: "string_template_start",
			value: '"',
			span: {
				file: this.file,
				line: startMark.line,
				col: startMark.col,
				length: 1,
			},
		});
		for (const seg of segs) {
			if (seg.kind === "text") {
				this.out.push({
					type: "string_part",
					value: seg.value,
					span: seg.span,
				});
			} else {
				this.out.push({
					type: "interp_start",
					value: "#{",
					span: seg.openSpan,
				});
				for (const t of seg.tokens) this.out.push(t);
				this.out.push({
					type: "interp_end",
					value: "}",
					span: seg.closeSpan,
				});
			}
		}
		this.out.push({
			type: "string_template_end",
			value: '"',
			span: {
				file: this.file,
				line: this.line,
				col: this.col - 1,
				length: 1,
			},
		});
	}

	private lexNumber(): void {
		const start = this.mark();
		let raw = "";
		while (
			this.i < this.source.length &&
			(isDigit(this.source[this.i]!) || this.source[this.i] === "_")
		) {
			raw += this.source[this.i];
			this.advance();
		}
		let isFloat = false;
		if (
			this.source[this.i] === "." &&
			this.source[this.i + 1] !== undefined &&
			isDigit(this.source[this.i + 1]!)
		) {
			raw += ".";
			this.advance();
			while (
				this.i < this.source.length &&
				(isDigit(this.source[this.i]!) || this.source[this.i] === "_")
			) {
				raw += this.source[this.i];
				this.advance();
			}
			isFloat = true;
		}
		this.out.push({
			type: isFloat ? "float" : "int",
			value: raw.replace(/_/g, ""),
			span: this.spanFrom(start),
		});
	}

	private lexIdent(): void {
		const start = this.mark();
		let name = "";
		while (
			this.i < this.source.length &&
			isIdentCont(this.source[this.i]!)
		) {
			name += this.source[this.i];
			this.advance();
		}
		if (this.source[this.i] === "?" || this.source[this.i] === "!") {
			name += this.source[this.i];
			this.advance();
		}
		const span = this.spanFrom(start);
		const kw = KEYWORDS[name];
		if (kw !== undefined) {
			this.out.push({ type: kw, value: name, span });
			return;
		}
		this.out.push({ type: "ident", value: name, span });
	}

	private advance(): void {
		const ch = this.source[this.i]!;
		this.i++;
		if (ch === "\n") {
			this.line++;
			this.col = 1;
		} else {
			this.col++;
		}
	}

	private mark(): Mark {
		return { line: this.line, col: this.col, index: this.i };
	}

	private spanFrom(start: Mark): Span {
		return {
			file: this.file,
			line: start.line,
			col: start.col,
			length: this.i - start.index,
		};
	}
}

const ESCAPES: Record<string, string> = {
	n: "\n",
	t: "\t",
	r: "\r",
	e: "\x1b",
	"\\": "\\",
	'"': '"',
};

const KEYWORDS: Record<string, TokenType> = {
	def: "kw_def",
	defp: "kw_defp",
	do: "kw_do",
	end: "kw_end",
	true: "kw_true",
	false: "kw_false",
	nil: "kw_nil",
	program: "kw_program",
	cmd: "kw_cmd",
	arg: "kw_arg",
	flag: "kw_flag",
	desc: "kw_desc",
	version: "kw_version",
	import: "kw_import",
	only: "kw_only",
	as: "kw_as",
	if: "kw_if",
	else: "kw_else",
	and: "kw_and",
	or: "kw_or",
	not: "kw_not",
	fn: "kw_fn",
	try: "kw_try",
	rescue: "kw_rescue",
	test: "kw_test",
	assert: "kw_assert",
};

function isIdentStart(ch: string): boolean {
	return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentCont(ch: string): boolean {
	return isIdentStart(ch) || isDigit(ch);
}

function isDigit(ch: string): boolean {
	return ch >= "0" && ch <= "9";
}

export function lex(source: string, file: string): Token[] {
	return new Lexer(source, file).tokenize();
}
