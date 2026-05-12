import { describe, expect, it } from "vitest";
import { lex } from "../src/lexer";

describe("lexer", () => {
	it("tokenizes a simple string", () => {
		const tokens = lex(`"hola"`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual(["string", "eof"]);
		expect(tokens[0]!.value).toBe("hola");
		expect(tokens[0]!.span).toEqual({
			file: "x.esp",
			line: 1,
			col: 1,
			length: 6,
		});
	});

	it("tokenizes idents and pipes", () => {
		const tokens = lex(`"a" |> upcase |> print`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual([
			"string",
			"pipe",
			"ident",
			"pipe",
			"ident",
			"eof",
		]);
		expect(tokens[2]!.value).toBe("upcase");
		expect(tokens[4]!.value).toBe("print");
	});

	it("handles escape sequences in strings", () => {
		const tokens = lex(`"hola\\nmundo"`, "x.esp");
		expect(tokens[0]!.value).toBe("hola\nmundo");
	});

	it("handles \\e escape as ESC byte", () => {
		const tokens = lex(`"\\e[31mhi\\e[0m"`, "x.esp");
		expect(tokens[0]!.value).toBe("\x1b[31mhi\x1b[0m");
	});

	it("emits newlines as tokens", () => {
		const tokens = lex(`a\nb`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual([
			"ident",
			"newline",
			"ident",
			"eof",
		]);
	});

	it("emits comments as tokens until end of line", () => {
		const tokens = lex(`"a" # this is a comment\n"b"`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual([
			"string",
			"comment",
			"newline",
			"string",
			"eof",
		]);
		expect(tokens[1]!.value).toBe("this is a comment");
	});

	it("throws on unterminated string", () => {
		expect(() => lex(`"unclosed`, "x.esp")).toThrow(/unterminated string/);
	});

	it("throws on invalid escape", () => {
		expect(() => lex(`"bad\\x"`, "x.esp")).toThrow(/invalid escape/);
	});

	it("throws on unexpected character", () => {
		expect(() => lex(`@`, "x.esp")).toThrow(/unexpected character/);
	});

	it("tracks line/col for multi-line source", () => {
		const tokens = lex(`a\n  b`, "x.esp");
		expect(tokens[0]!.span).toMatchObject({ line: 1, col: 1 });
		expect(tokens[2]!.span).toMatchObject({ line: 2, col: 3 });
	});

	it("allows '?' at end of identifier", () => {
		const tokens = lex(`exists?`, "x.esp");
		expect(tokens[0]!.type).toBe("ident");
		expect(tokens[0]!.value).toBe("exists?");
	});

	it("allows '!' at end of identifier", () => {
		const tokens = lex(`sh!`, "x.esp");
		expect(tokens[0]!.type).toBe("ident");
		expect(tokens[0]!.value).toBe("sh!");
	});

	it("emits parens and commas as tokens", () => {
		const tokens = lex(`f(a, b)`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual([
			"ident",
			"lparen",
			"ident",
			"comma",
			"ident",
			"rparen",
			"eof",
		]);
	});

	it("reserves def/defp/do/end as keyword tokens", () => {
		const tokens = lex(`def defp do end`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual([
			"kw_def",
			"kw_defp",
			"kw_do",
			"kw_end",
			"eof",
		]);
	});

	it("emits an equals token for '='", () => {
		const tokens = lex(`=`, "x.esp");
		expect(tokens[0]!.type).toBe("equals");
		expect(tokens[0]!.value).toBe("=");
	});

	it("does not treat keyword prefixes as keywords", () => {
		const tokens = lex(`define defpx done ended`, "x.esp");
		expect(tokens.slice(0, -1).map((t) => t.type)).toEqual([
			"ident",
			"ident",
			"ident",
			"ident",
		]);
	});

	it("reserves true/false/nil as keyword tokens", () => {
		const tokens = lex(`true false nil`, "x.esp");
		expect(tokens.slice(0, -1).map((t) => t.type)).toEqual([
			"kw_true",
			"kw_false",
			"kw_nil",
		]);
	});

	it("tokenizes an integer", () => {
		const tokens = lex(`42`, "x.esp");
		expect(tokens[0]!).toMatchObject({ type: "int", value: "42" });
	});

	it("tokenizes an integer with underscores", () => {
		const tokens = lex(`1_000_000`, "x.esp");
		expect(tokens[0]!).toMatchObject({ type: "int", value: "1000000" });
	});

	it("tokenizes a float", () => {
		const tokens = lex(`3.14`, "x.esp");
		expect(tokens[0]!).toMatchObject({ type: "float", value: "3.14" });
	});

	it("tokenizes a string with interpolation as a token sequence", () => {
		const tokens = lex(`"Hola, #{name}!"`, "x.esp");
		const types = tokens.map((t) => t.type);
		expect(types).toEqual([
			"string_template_start",
			"string_part",
			"interp_start",
			"ident",
			"interp_end",
			"string_part",
			"string_template_end",
			"eof",
		]);
		expect(tokens[1]!.value).toBe("Hola, ");
		expect(tokens[3]!.value).toBe("name");
		expect(tokens[5]!.value).toBe("!");
	});

	it("emits a plain string token when no interp is present", () => {
		const tokens = lex(`"plain"`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual(["string", "eof"]);
	});

	it("preserves literal #{ when escaped as \\#{", () => {
		const tokens = lex(`"a \\#{x}"`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual(["string", "eof"]);
		expect(tokens[0]!.value).toBe("a #{x}");
	});

	it("throws on unterminated interpolation", () => {
		expect(() => lex(`"a #{x"`, "x.esp")).toThrow(/unterminated/);
	});

	it("throws on newline inside interpolation", () => {
		expect(() => lex(`"a #{x\ny}"`, "x.esp")).toThrow(
			/newline inside interpolation/,
		);
	});

	it("reserves cmd/arg/flag/desc/version as keyword tokens", () => {
		const tokens = lex(`cmd arg flag desc version`, "x.esp");
		expect(tokens.slice(0, -1).map((t) => t.type)).toEqual([
			"kw_cmd",
			"kw_arg",
			"kw_flag",
			"kw_desc",
			"kw_version",
		]);
	});

	it("emits a colon token for ':'", () => {
		const tokens = lex(`name: str`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual([
			"ident",
			"colon",
			"ident",
			"eof",
		]);
		expect(tokens[1]!.value).toBe(":");
	});

	it("reserves import/only/as as keyword tokens", () => {
		const tokens = lex(`import only as`, "x.esp");
		expect(tokens.slice(0, -1).map((t) => t.type)).toEqual([
			"kw_import",
			"kw_only",
			"kw_as",
		]);
	});

	it("emits brackets as lbracket/rbracket tokens", () => {
		const tokens = lex(`[a, b]`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual([
			"lbracket",
			"ident",
			"comma",
			"ident",
			"rbracket",
			"eof",
		]);
	});

	it("emits arithmetic operator tokens", () => {
		const tokens = lex(`a + b - c * d / e`, "x.esp");
		expect(tokens.slice(0, -1).map((t) => t.type)).toEqual([
			"ident",
			"plus",
			"ident",
			"minus",
			"ident",
			"star",
			"ident",
			"slash",
			"ident",
		]);
	});

	it("distinguishes '=' from '==' via dual-char peek", () => {
		const tokens = lex(`a == b = c`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual([
			"ident",
			"eq_eq",
			"ident",
			"equals",
			"ident",
			"eof",
		]);
	});

	it("distinguishes '<' from '<=' and '>' from '>='", () => {
		const tokens = lex(`< <= > >=`, "x.esp");
		expect(tokens.slice(0, -1).map((t) => t.type)).toEqual([
			"lt",
			"lte",
			"gt",
			"gte",
		]);
	});

	it("reserves if/else/and/or/not as keyword tokens", () => {
		const tokens = lex(`if else and or not`, "x.esp");
		expect(tokens.slice(0, -1).map((t) => t.type)).toEqual([
			"kw_if",
			"kw_else",
			"kw_and",
			"kw_or",
			"kw_not",
		]);
	});

	it("does not treat 'andx'/'iffy' as keywords", () => {
		const tokens = lex(`andx iffy notice`, "x.esp");
		expect(tokens.slice(0, -1).map((t) => t.type)).toEqual([
			"ident",
			"ident",
			"ident",
		]);
	});

	it("reserves fn as keyword token", () => {
		const tokens = lex(`fn`, "x.esp");
		expect(tokens[0]!.type).toBe("kw_fn");
	});

	it("does not treat 'fname' as fn keyword", () => {
		const tokens = lex(`fname`, "x.esp");
		expect(tokens[0]!.type).toBe("ident");
	});

	it("emits fat_arrow token for '=>'", () => {
		const tokens = lex(`=>`, "x.esp");
		expect(tokens[0]!.type).toBe("fat_arrow");
		expect(tokens[0]!.value).toBe("=>");
	});

	it("distinguishes '=' from '==' from '=>'", () => {
		const tokens = lex(`a == b => c = d`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual([
			"ident",
			"eq_eq",
			"ident",
			"fat_arrow",
			"ident",
			"equals",
			"ident",
			"eof",
		]);
	});

	it("emits braces as lbrace/rbrace tokens", () => {
		const tokens = lex(`{a: 1}`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual([
			"lbrace",
			"ident",
			"colon",
			"int",
			"rbrace",
			"eof",
		]);
	});

	it("emits dot as a separate token", () => {
		const tokens = lex(`user.name`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual([
			"ident",
			"dot",
			"ident",
			"eof",
		]);
	});

	it("treats '1.0' as float, '1.foo' as int + dot + ident", () => {
		const a = lex(`1.0`, "x.esp");
		expect(a.map((t) => t.type)).toEqual(["float", "eof"]);
		const b = lex(`1.foo`, "x.esp");
		expect(b.map((t) => t.type)).toEqual(["int", "dot", "ident", "eof"]);
	});

	it("reserves try and rescue as keyword tokens", () => {
		const tokens = lex(`try rescue`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual([
			"kw_try",
			"kw_rescue",
			"eof",
		]);
	});

	it("does not treat 'tryout' as try keyword", () => {
		const tokens = lex(`tryout rescuer`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual(["ident", "ident", "eof"]);
	});

	it("balances inner braces inside string interpolation", () => {
		const tokens = lex(`"x: #{{a: 1}}"`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual([
			"string_template_start",
			"string_part",
			"interp_start",
			"lbrace",
			"ident",
			"colon",
			"int",
			"rbrace",
			"interp_end",
			"string_part",
			"string_template_end",
			"eof",
		]);
	});

	describe("doc-comments", () => {
		it("emits doc_line for `## text`", () => {
			const tokens = lex(`## hello`, "x.esp");
			expect(tokens.map((t) => t.type)).toEqual(["doc_line", "eof"]);
			expect(tokens[0]!.value).toBe("hello");
		});

		it("emits doc_line with empty content for `##` alone", () => {
			const tokens = lex(`##\n`, "x.esp");
			expect(tokens.map((t) => t.type)).toEqual([
				"doc_line",
				"newline",
				"eof",
			]);
			expect(tokens[0]!.value).toBe("");
		});

		it("emits doc_line with empty content for `## ` (space + EOL)", () => {
			const tokens = lex(`## \n`, "x.esp");
			expect(tokens.map((t) => t.type)).toEqual([
				"doc_line",
				"newline",
				"eof",
			]);
			expect(tokens[0]!.value).toBe("");
		});

		it("preserves markdown headers in doc content (## ### Title)", () => {
			const tokens = lex(`## ### Title`, "x.esp");
			expect(tokens.map((t) => t.type)).toEqual(["doc_line", "eof"]);
			expect(tokens[0]!.value).toBe("### Title");
		});

		it("preserves extra leading space (markdown indent)", () => {
			const tokens = lex(`##  indented`, "x.esp");
			expect(tokens.map((t) => t.type)).toEqual(["doc_line", "eof"]);
			expect(tokens[0]!.value).toBe(" indented");
		});

		it("treats `### foo` as a regular comment (strict marker)", () => {
			const tokens = lex(`### foo`, "x.esp");
			expect(tokens.map((t) => t.type)).toEqual(["comment", "eof"]);
			expect(tokens[0]!.value).toBe("## foo");
		});

		it("treats `##hello` as a regular comment (no space after ##)", () => {
			const tokens = lex(`##hello`, "x.esp");
			expect(tokens.map((t) => t.type)).toEqual(["comment", "eof"]);
			expect(tokens[0]!.value).toBe("#hello");
		});

		it("treats `##!important` as a regular comment", () => {
			const tokens = lex(`##!important`, "x.esp");
			expect(tokens.map((t) => t.type)).toEqual(["comment", "eof"]);
			expect(tokens[0]!.value).toBe("#!important");
		});

		it("does not interfere with `##{var}` inside strings", () => {
			const tokens = lex(`"##{x}"`, "x.esp");
			expect(tokens.map((t) => t.type)).toEqual([
				"string_template_start",
				"string_part",
				"interp_start",
				"ident",
				"interp_end",
				"string_part",
				"string_template_end",
				"eof",
			]);
			expect(tokens[1]!.value).toBe("#");
		});

		it("emits a run of doc_lines separated by newlines", () => {
			const tokens = lex(`## first\n## second`, "x.esp");
			expect(tokens.map((t) => t.type)).toEqual([
				"doc_line",
				"newline",
				"doc_line",
				"eof",
			]);
			expect(tokens[0]!.value).toBe("first");
			expect(tokens[2]!.value).toBe("second");
		});
	});
});
