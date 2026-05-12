import { describe, expect, it } from "vitest";
import { lex } from "../src/lexer";
import { parse } from "../src/parser";

function ast(src: string) {
	return parse(lex(src, "x.esp"), src);
}

describe("parser: expressions", () => {
	it("parses a string literal as parts: [text]", () => {
		const p = ast(`"hola"`);
		expect(p.items).toHaveLength(1);
		expect(p.items[0]).toMatchObject({ kind: "string", parts: ["hola"] });
	});

	it("parses a bare identifier", () => {
		const p = ast(`print`);
		expect(p.items[0]).toMatchObject({ kind: "ident", name: "print" });
	});

	it("parses a direct call", () => {
		const p = ast(`print("hola")`);
		expect(p.items[0]).toMatchObject({
			kind: "call",
			callee: { kind: "ident", name: "print" },
			args: [{ kind: "string", parts: ["hola"] }],
		});
	});

	it("parses zero-arg call", () => {
		const p = ast(`now()`);
		expect(p.items[0]).toMatchObject({
			kind: "call",
			callee: { kind: "ident", name: "now" },
			args: [],
		});
	});

	it("parses `x |> f` as PipeExpr with empty rhs.args", () => {
		const p = ast(`"hola" |> print`);
		expect(p.items[0]).toMatchObject({
			kind: "pipe",
			lhs: { kind: "string", parts: ["hola"] },
			rhs: {
				kind: "call",
				callee: { kind: "ident", name: "print" },
				args: [],
			},
		});
	});

	it("parses chained pipes left-associative", () => {
		const p = ast(`"a" |> upcase |> print`);
		const outer = p.items[0]!;
		expect(outer).toMatchObject({
			kind: "pipe",
			rhs: {
				kind: "call",
				callee: { kind: "ident", name: "print" },
				args: [],
			},
		});
		const inner = (outer as { lhs: unknown }).lhs;
		expect(inner).toMatchObject({
			kind: "pipe",
			lhs: { kind: "string", parts: ["a"] },
			rhs: {
				kind: "call",
				callee: { kind: "ident", name: "upcase" },
				args: [],
			},
		});
	});

	it("parses `x |> f(y)` as PipeExpr preserving explicit args", () => {
		const p = ast(`"hello" |> replace("l", "L")`);
		expect(p.items[0]).toMatchObject({
			kind: "pipe",
			lhs: { kind: "string", parts: ["hello"] },
			rhs: {
				kind: "call",
				callee: { kind: "ident", name: "replace" },
				args: [
					{ kind: "string", parts: ["l"] },
					{ kind: "string", parts: ["L"] },
				],
			},
		});
	});

	it("parses multiple statements separated by newlines", () => {
		const p = ast(`"a"\n"b"`);
		expect(p.items).toHaveLength(2);
	});

	it("skips leading and trailing blank lines", () => {
		const p = ast(`\n\n"a"\n\n`);
		expect(p.items).toHaveLength(1);
	});

	it("throws on missing function name after pipe", () => {
		expect(() => ast(`"a" |>`)).toThrow();
	});

	it("throws on adjacent expressions without newline", () => {
		expect(() => ast(`"a" "b"`)).toThrow(/unexpected token/);
	});

	it("throws on missing closing paren", () => {
		expect(() => ast(`f("a"`)).toThrow();
	});
});

describe("parser: literals", () => {
	it("parses an int literal", () => {
		const p = ast(`42`);
		expect(p.items[0]).toMatchObject({ kind: "int", value: 42 });
	});

	it("parses an int with underscores", () => {
		const p = ast(`1_000_000`);
		expect(p.items[0]).toMatchObject({ kind: "int", value: 1000000 });
	});

	it("parses a float literal", () => {
		const p = ast(`3.14`);
		expect(p.items[0]).toMatchObject({ kind: "float", value: 3.14 });
	});

	it("parses a float with underscores", () => {
		const p = ast(`3.14_15`);
		expect(p.items[0]).toMatchObject({ kind: "float", value: 3.1415 });
	});

	it("parses true / false / nil", () => {
		expect(ast(`true`).items[0]).toMatchObject({ kind: "bool", value: true });
		expect(ast(`false`).items[0]).toMatchObject({ kind: "bool", value: false });
		expect(ast(`nil`).items[0]).toMatchObject({ kind: "nil" });
	});

	it("does not treat 42.foo as a float (parses as int + field access)", () => {
		const p = ast(`42.foo`);
		expect(p.items[0]).toMatchObject({
			kind: "field_access",
			target: { kind: "int", value: 42 },
			field: "foo",
		});
	});
});

describe("parser: string interpolation", () => {
	it("parses a string template with one interp", () => {
		const p = ast(`"Hola, #{name}!"`);
		expect(p.items[0]).toMatchObject({
			kind: "string",
			parts: [
				"Hola, ",
				{ kind: "ident", name: "name" },
				"!",
			],
		});
	});

	it("parses interp with empty surrounding text", () => {
		const p = ast(`"#{x}"`);
		const item = p.items[0] as { kind: string; parts: unknown[] };
		expect(item.kind).toBe("string");
		expect(item.parts).toEqual([
			"",
			expect.objectContaining({ kind: "ident", name: "x" }),
			"",
		]);
	});

	it("parses interp containing a call", () => {
		const p = ast(`"Hi #{upcase(name)}"`);
		const item = p.items[0] as { parts: unknown[] };
		expect(item.parts[1]).toMatchObject({
			kind: "call",
			callee: { kind: "ident", name: "upcase" },
			args: [{ kind: "ident", name: "name" }],
		});
	});

	it("preserves \\#{ as literal #{", () => {
		const p = ast(`"a \\#{x} b"`);
		expect(p.items[0]).toMatchObject({
			kind: "string",
			parts: ["a #{x} b"],
		});
	});

	it("rejects newline inside interpolation", () => {
		expect(() => ast(`"a #{x\ny}"`)).toThrow(/newline inside interpolation/);
	});
});

describe("parser: assign", () => {
	it("parses x = expr at top level", () => {
		const p = ast(`name = "Mundo"`);
		expect(p.items[0]).toMatchObject({
			kind: "assign",
			name: "name",
			value: { kind: "string", parts: ["Mundo"] },
		});
	});

	it("parses assign followed by expr", () => {
		const p = ast(`x = 42\nx |> print`);
		expect(p.items).toHaveLength(2);
		expect(p.items[0]).toMatchObject({ kind: "assign", name: "x" });
		expect(p.items[1]).toMatchObject({ kind: "pipe" });
	});
});

describe("parser: fn_def", () => {
	it("parses a one-liner def", () => {
		const p = ast(`def grita(s) = s`);
		expect(p.items[0]).toMatchObject({
			kind: "fn_def",
			name: "grita",
			params: ["s"],
			exported: true,
			body: [{ kind: "ident", name: "s" }],
		});
	});

	it("marks defp as not exported", () => {
		const p = ast(`defp helper(x) = x`);
		expect(p.items[0]).toMatchObject({
			kind: "fn_def",
			name: "helper",
			exported: false,
		});
	});

	it("parses a zero-arg def", () => {
		const p = ast(`def now() = "ahora"`);
		expect(p.items[0]).toMatchObject({
			kind: "fn_def",
			name: "now",
			params: [],
		});
	});

	it("parses a multi-arg def", () => {
		const p = ast(`def add(a, b) = a`);
		expect(p.items[0]).toMatchObject({
			kind: "fn_def",
			name: "add",
			params: ["a", "b"],
		});
	});

	it("accepts a pipe expression in the body", () => {
		const p = ast(`def grita(s) = s |> upcase`);
		const fnDef = p.items[0] as { body: unknown[] };
		expect(fnDef.body[0]).toMatchObject({
			kind: "pipe",
			lhs: { kind: "ident", name: "s" },
			rhs: { kind: "call", callee: { kind: "ident", name: "upcase" } },
		});
	});

	it("allows def alongside top-level expressions", () => {
		const p = ast(`def f(x) = x\n"a" |> f`);
		expect(p.items).toHaveLength(2);
		expect(p.items[0]).toMatchObject({ kind: "fn_def" });
		expect(p.items[1]).toMatchObject({ kind: "pipe" });
	});

	it("rejects def without '='", () => {
		expect(() => ast(`def f(x) x`)).toThrow();
	});

	it("rejects def without a name", () => {
		expect(() => ast(`def (x) = x`)).toThrow();
	});

	it("parses def with do/end block of single expr", () => {
		const p = ast(`def f(x) do\n  x\nend`);
		expect(p.items[0]).toMatchObject({
			kind: "fn_def",
			name: "f",
			params: ["x"],
			body: [{ kind: "ident", name: "x" }],
		});
	});

	it("parses def with do/end block containing assigns and last expr", () => {
		const p = ast(`def f(x) do\n  y = x + 1\n  y * 2\nend`);
		expect(p.items[0]).toMatchObject({
			kind: "fn_def",
			name: "f",
			body: [
				{ kind: "assign", name: "y" },
				{ kind: "binop", op: "*" },
			],
		});
	});

	it("rejects empty def block", () => {
		expect(() => ast(`def f() do\nend`)).toThrow(
			/def block must contain at least one statement/,
		);
	});

	it("rejects def block missing 'end'", () => {
		expect(() => ast(`def f() do\n  1`)).toThrow(/eof/);
	});

	it("accepts trailing comma in params", () => {
		const p = ast(`def f(a, b,) = a`);
		expect(p.items[0]).toMatchObject({
			kind: "fn_def",
			params: ["a", "b"],
		});
	});

	it("permits newlines and trailing comma in multi-line params", () => {
		const p = ast(`def f(\n  a,\n  b,\n) = a`);
		expect(p.items[0]).toMatchObject({
			kind: "fn_def",
			params: ["a", "b"],
		});
	});
});

describe("parser: cmd block", () => {
	it("parses an empty cmd", () => {
		const p = ast(`cmd hola do\nend`);
		expect(p.items[0]).toMatchObject({
			kind: "cmd",
			name: "hola",
			meta: [],
			decls: [],
			body: [],
		});
	});

	it("parses a cmd with a body statement", () => {
		const p = ast(`cmd hola do\n  "hi" |> print\nend`);
		const cmd = p.items[0] as { body: unknown[] };
		expect(cmd.body).toHaveLength(1);
		expect(cmd.body[0]).toMatchObject({ kind: "pipe" });
	});

	it("parses arg with type", () => {
		const p = ast(`cmd hi do\n  arg name: str\nend`);
		const cmd = p.items[0] as { decls: unknown[] };
		expect(cmd.decls[0]).toMatchObject({
			kind: "arg_decl",
			name: "name",
			type: "str",
			attrs: {},
		});
	});

	it("parses flag with default", () => {
		const p = ast(`cmd hi do\n  flag loud: bool = false\nend`);
		const cmd = p.items[0] as { decls: { default: unknown }[] };
		expect(cmd.decls[0]).toMatchObject({
			kind: "flag_decl",
			name: "loud",
			type: "bool",
		});
		expect(cmd.decls[0]!.default).toMatchObject({
			kind: "bool",
			value: false,
		});
	});

	it("parses inline attrs (short, desc) on flag", () => {
		const p = ast(
			`cmd hi do\n  flag loud: bool = false, short: "l", desc: "shout"\nend`,
		);
		const cmd = p.items[0] as { decls: { attrs: object }[] };
		expect(cmd.decls[0]!.attrs).toEqual({ short: "l", desc: "shout" });
	});

	it("parses inline desc attr on arg", () => {
		const p = ast(`cmd hi do\n  arg file: str, desc: "path to JSON"\nend`);
		const cmd = p.items[0] as { decls: { attrs: object }[] };
		expect(cmd.decls[0]!.attrs).toEqual({ desc: "path to JSON" });
	});

	it("parses meta desc and version", () => {
		const p = ast(
			`cmd hi do\n  desc "do stuff"\n  version "0.1.0"\n  arg x: str\nend`,
		);
		const cmd = p.items[0] as {
			meta: { kind: string; value: { parts: string[] } }[];
		};
		expect(cmd.meta).toHaveLength(2);
		expect(cmd.meta[0]!.kind).toBe("meta_desc");
		expect(cmd.meta[0]!.value.parts).toEqual(["do stuff"]);
		expect(cmd.meta[1]!.kind).toBe("meta_version");
	});

	it("allows assign and expr in cmd body", () => {
		const p = ast(
			`cmd hi do\n  arg name: str\n  greeting = "Hola, #{name}!"\n  greeting |> print\nend`,
		);
		const cmd = p.items[0] as { body: { kind: string }[] };
		expect(cmd.body[0]!.kind).toBe("assign");
		expect(cmd.body[1]!.kind).toBe("pipe");
	});

	it("rejects meta after a decl", () => {
		expect(() =>
			ast(`cmd hi do\n  arg x: str\n  desc "late"\nend`),
		).toThrow(/meta .* must come before declarations/);
	});

	it("rejects decl after a body statement", () => {
		expect(() =>
			ast(`cmd hi do\n  "x" |> print\n  arg name: str\nend`),
		).toThrow(/declarations .* must come before body/);
	});

	it("rejects unknown attr name", () => {
		expect(() =>
			ast(`cmd hi do\n  flag x: str = "a", weird: "b"\nend`),
		).toThrow(/unknown attr/);
	});

	it("rejects non-string-literal attr value", () => {
		expect(() =>
			ast(`cmd hi do\n  flag x: str = "a", short: foo\nend`),
		).toThrow(/must be a plain string literal/);
	});

	it("rejects unknown decl type", () => {
		expect(() => ast(`cmd hi do\n  arg x: list\nend`)).toThrow(
			/unknown type/,
		);
	});

	it("rejects two cmd blocks in one file", () => {
		expect(() => ast(`cmd a do\nend\ncmd b do\nend`)).toThrow(
			/only one cmd block/,
		);
	});

	it("rejects missing 'end'", () => {
		expect(() => ast(`cmd hi do\n  "x" |> print\n`)).toThrow(
			/expected 'end'/,
		);
	});
});

describe("parser: import", () => {
	it("parses a bare import without 'only'", () => {
		const p = ast(`import "./format"`);
		expect(p.items[0]).toMatchObject({
			kind: "import",
			path: "./format",
		});
		expect((p.items[0] as { only?: unknown }).only).toBeUndefined();
	});

	it("parses an import with 'only [a]'", () => {
		const p = ast(`import "./format" only [bullet]`);
		expect(p.items[0]).toMatchObject({
			kind: "import",
			path: "./format",
			only: [{ name: "bullet" }],
		});
	});

	it("parses 'only [a as b]'", () => {
		const p = ast(`import "./x" only [foo as bar]`);
		expect(p.items[0]).toMatchObject({
			kind: "import",
			only: [{ name: "foo", as: "bar" }],
		});
	});

	it("parses 'only [a, a as b]' (same source, two bindings)", () => {
		const p = ast(`import "./x" only [foo, foo as bar]`);
		expect((p.items[0] as { only: unknown[] }).only).toMatchObject([
			{ name: "foo" },
			{ name: "foo", as: "bar" },
		]);
	});

	it("parses multiple selectors with mixed aliases", () => {
		const p = ast(`import "./x" only [a, b as c, d]`);
		expect((p.items[0] as { only: unknown[] }).only).toMatchObject([
			{ name: "a" },
			{ name: "b", as: "c" },
			{ name: "d" },
		]);
	});

	it("accepts a trailing comma in 'only'", () => {
		const p = ast(`import "./x" only [a, b,]`);
		expect((p.items[0] as { only: unknown[] }).only).toHaveLength(2);
	});

	it("ignores newlines inside 'only [...]'", () => {
		const p = ast(`import "./x" only [\n  a,\n  b as c,\n]`);
		expect((p.items[0] as { only: unknown[] }).only).toMatchObject([
			{ name: "a" },
			{ name: "b", as: "c" },
		]);
	});

	it("accepts '../' relative paths", () => {
		const p = ast(`import "../shared/format"`);
		expect(p.items[0]).toMatchObject({ path: "../shared/format" });
	});

	it("allows multiple imports at the top of the file", () => {
		const p = ast(`import "./a"\nimport "./b" only [x]\ndef f(x) = x`);
		expect(p.items).toHaveLength(3);
		expect(p.items[0]!.kind).toBe("import");
		expect(p.items[1]!.kind).toBe("import");
		expect(p.items[2]!.kind).toBe("fn_def");
	});

	it("accepts a bare package name as import path", () => {
		const p = ast(`import "ansi"`);
		expect(p.items[0]!.kind).toBe("import");
	});

	it("rejects an absolute import path", () => {
		expect(() => ast(`import "/abs/x"`)).toThrow(
			/import path cannot be absolute/,
		);
	});

	it("rejects an empty import path", () => {
		expect(() => ast(`import ""`)).toThrow(/import path cannot be empty/);
	});

	it("rejects a string template as import path", () => {
		expect(() => ast(`import "./x#{y}"`)).toThrow(/plain string literal/);
	});

	it("rejects an empty 'only' list", () => {
		expect(() => ast(`import "./x" only []`)).toThrow(/cannot be empty/);
	});

	it("rejects duplicate names in 'only' (no alias)", () => {
		expect(() => ast(`import "./x" only [a, a]`)).toThrow(
			/duplicate import name 'a'/,
		);
	});

	it("rejects duplicate binding names via alias", () => {
		expect(() => ast(`import "./x" only [a as b, c as b]`)).toThrow(
			/duplicate import name 'b'/,
		);
	});

	it("rejects import after a def", () => {
		expect(() => ast(`def f(x) = x\nimport "./a"`)).toThrow(
			/import must come before declarations/,
		);
	});

	it("rejects import after an assign", () => {
		expect(() => ast(`x = 1\nimport "./a"`)).toThrow(
			/import must come before declarations/,
		);
	});

	it("rejects import after a top-level expression", () => {
		expect(() => ast(`"hi" |> print\nimport "./a"`)).toThrow(
			/import must come before declarations/,
		);
	});

	it("rejects import after a cmd block", () => {
		expect(() => ast(`cmd hi do\nend\nimport "./a"`)).toThrow(
			/import must come before declarations/,
		);
	});

	it("rejects 'only' missing the bracket", () => {
		expect(() => ast(`import "./x" only a`)).toThrow(/'\['/);
	});

	it("rejects 'only [a' missing the closing bracket", () => {
		expect(() => ast(`import "./x" only [a`)).toThrow();
	});

	it("rejects 'as' without an alias name", () => {
		expect(() => ast(`import "./x" only [a as]`)).toThrow(
			/alias name after 'as'/,
		);
	});
});

describe("parser: hito 7a — operators + if", () => {
	it("parses '+' as a binop", () => {
		const p = ast(`1 + 2`);
		expect(p.items[0]).toMatchObject({
			kind: "binop",
			op: "+",
			lhs: { kind: "int", value: 1 },
			rhs: { kind: "int", value: 2 },
		});
	});

	it("respects '*' over '+' precedence", () => {
		const p = ast(`1 + 2 * 3`);
		expect(p.items[0]).toMatchObject({
			kind: "binop",
			op: "+",
			lhs: { kind: "int", value: 1 },
			rhs: {
				kind: "binop",
				op: "*",
				lhs: { kind: "int", value: 2 },
				rhs: { kind: "int", value: 3 },
			},
		});
	});

	it("parses '+'/'-' left-associative", () => {
		const p = ast(`10 - 5 - 3`);
		expect(p.items[0]).toMatchObject({
			kind: "binop",
			op: "-",
			lhs: {
				kind: "binop",
				op: "-",
				lhs: { kind: "int", value: 10 },
				rhs: { kind: "int", value: 5 },
			},
			rhs: { kind: "int", value: 3 },
		});
	});

	it("parses unary minus right-associative", () => {
		const p = ast(`-5`);
		expect(p.items[0]).toMatchObject({
			kind: "unop",
			op: "-",
			operand: { kind: "int", value: 5 },
		});
	});

	it("parses 'not' as unary", () => {
		const p = ast(`not true`);
		expect(p.items[0]).toMatchObject({
			kind: "unop",
			op: "not",
			operand: { kind: "bool", value: true },
		});
	});

	it("parses comparison as a binop", () => {
		const p = ast(`a < b`);
		expect(p.items[0]).toMatchObject({
			kind: "binop",
			op: "<",
			lhs: { kind: "ident", name: "a" },
			rhs: { kind: "ident", name: "b" },
		});
	});

	it("rejects chained comparisons", () => {
		expect(() => ast(`a < b < c`)).toThrow(
			/comparisons cannot be chained, use 'and'/,
		);
	});

	it("parses 'and' below comparison precedence", () => {
		const p = ast(`a < b and c < d`);
		expect(p.items[0]).toMatchObject({
			kind: "binop",
			op: "and",
			lhs: { kind: "binop", op: "<" },
			rhs: { kind: "binop", op: "<" },
		});
	});

	it("parses 'and' tighter than 'or'", () => {
		const p = ast(`a or b and c`);
		expect(p.items[0]).toMatchObject({
			kind: "binop",
			op: "or",
			lhs: { kind: "ident", name: "a" },
			rhs: {
				kind: "binop",
				op: "and",
				lhs: { kind: "ident", name: "b" },
				rhs: { kind: "ident", name: "c" },
			},
		});
	});

	it("parses '|>' tighter than 'or'", () => {
		const p = ast(`x |> f or y`);
		expect(p.items[0]).toMatchObject({
			kind: "binop",
			op: "or",
			lhs: {
				kind: "pipe",
				lhs: { kind: "ident", name: "x" },
				rhs: { kind: "call", callee: { kind: "ident", name: "f" } },
			},
			rhs: { kind: "ident", name: "y" },
		});
	});

	it("parses simple if/end without else", () => {
		const p = ast(`if true do "a" end`);
		expect(p.items[0]).toMatchObject({
			kind: "if",
			branches: [
				{
					cond: { kind: "bool", value: true },
					body: { kind: "string", parts: ["a"] },
				},
			],
		});
		expect((p.items[0] as { elseBody?: unknown }).elseBody).toBeUndefined();
	});

	it("parses if/else", () => {
		const p = ast(`if cond do "yes" else "no" end`);
		expect(p.items[0]).toMatchObject({
			kind: "if",
			branches: [{ cond: { kind: "ident", name: "cond" } }],
			elseBody: { kind: "string", parts: ["no"] },
		});
	});

	it("parses else if as a chain of branches", () => {
		const p = ast(
			`if a < 1 do "x" else if a < 2 do "y" else "z" end`,
		);
		expect(p.items[0]).toMatchObject({
			kind: "if",
			branches: [
				{ cond: { kind: "binop", op: "<" } },
				{ cond: { kind: "binop", op: "<" } },
			],
			elseBody: { kind: "string", parts: ["z"] },
		});
		expect((p.items[0] as { branches: unknown[] }).branches).toHaveLength(2);
	});

	it("permits multi-line continuation after binary operators", () => {
		const p = ast(`x = 1 +\n  2`);
		expect(p.items[0]).toMatchObject({
			kind: "assign",
			value: { kind: "binop", op: "+" },
		});
	});

	it("permits multi-line continuation after '='", () => {
		const p = ast(`x =\n  5`);
		expect(p.items[0]).toMatchObject({
			kind: "assign",
			name: "x",
			value: { kind: "int", value: 5 },
		});
	});

	it("permits multi-line continuation between body and else", () => {
		const p = ast(`if true do\n  "a"\nelse\n  "b"\nend`);
		expect(p.items[0]).toMatchObject({
			kind: "if",
			elseBody: { kind: "string", parts: ["b"] },
		});
	});
});

describe("parser: lambdas", () => {
	it("parses single-arg lambda without parens", () => {
		const p = ast(`fn x => x`);
		expect(p.items[0]).toMatchObject({
			kind: "lambda",
			params: ["x"],
			body: { kind: "ident", name: "x" },
		});
	});

	it("parses zero-arg lambda with parens", () => {
		const p = ast(`fn() => 42`);
		expect(p.items[0]).toMatchObject({
			kind: "lambda",
			params: [],
			body: { kind: "int", value: 42 },
		});
	});

	it("parses multi-arg lambda with parens", () => {
		const p = ast(`fn(a, b) => a + b`);
		expect(p.items[0]).toMatchObject({
			kind: "lambda",
			params: ["a", "b"],
			body: { kind: "binop", op: "+" },
		});
	});

	it("permits multi-line continuation after fat_arrow", () => {
		const p = ast(`fn x =>\n  x + 1`);
		expect(p.items[0]).toMatchObject({
			kind: "lambda",
			params: ["x"],
			body: { kind: "binop", op: "+" },
		});
	});

	it("throws on missing fat_arrow", () => {
		expect(() => ast(`fn x x`)).toThrow(/'=>'/);
	});

	it("throws on bare 'fn' without param", () => {
		expect(() => ast(`fn => x`)).toThrow(/lambda parameter/);
	});

	it("accepts lambda as pipe RHS", () => {
		const p = ast(`5 |> fn n => n + 1`);
		expect(p.items[0]).toMatchObject({
			kind: "pipe",
			lhs: { kind: "int", value: 5 },
			rhs: {
				kind: "call",
				callee: { kind: "lambda", params: ["n"] },
				args: [],
			},
		});
	});

	it("accepts lambda as call argument", () => {
		const p = ast(`map([1, 2], fn x => x * 2)`);
		expect(p.items[0]).toMatchObject({
			kind: "call",
			callee: { kind: "ident", name: "map" },
			args: [
				{ kind: "list" },
				{ kind: "lambda", params: ["x"] },
			],
		});
	});

	it("accepts trailing comma in multi-param lambda", () => {
		const p = ast(`fn(a, b,) => a + b`);
		expect(p.items[0]).toMatchObject({
			kind: "lambda",
			params: ["a", "b"],
		});
	});

	it("permits newlines and trailing comma in multi-line lambda params", () => {
		const p = ast(`fn(\n  a,\n  b,\n) => a`);
		expect(p.items[0]).toMatchObject({
			kind: "lambda",
			params: ["a", "b"],
		});
	});
});

describe("parser: call args trailing comma + multi-line (Phase 3)", () => {
	it("accepts trailing comma in call args", () => {
		const p = ast(`f(1, 2,)`);
		expect(p.items[0]).toMatchObject({
			kind: "call",
			args: [{ kind: "int", value: 1 }, { kind: "int", value: 2 }],
		});
	});

	it("permits newlines and trailing comma in call args", () => {
		const p = ast(`f(\n  1,\n  2,\n)`);
		expect(p.items[0]).toMatchObject({
			kind: "call",
			args: [{ kind: "int", value: 1 }, { kind: "int", value: 2 }],
		});
	});

	it("accepts trailing comma in pipe rhs args", () => {
		const p = ast(`x |> f(a, b,)`);
		expect(p.items[0]).toMatchObject({
			kind: "pipe",
			rhs: { kind: "call", args: [{ name: "a" }, { name: "b" }] },
		});
	});

	it("permits newlines and trailing comma in pipe rhs args", () => {
		const p = ast(`x |> f(\n  a,\n  b,\n)`);
		expect(p.items[0]).toMatchObject({
			kind: "pipe",
			rhs: { kind: "call", args: [{ name: "a" }, { name: "b" }] },
		});
	});

	it("rejects empty call with bare comma", () => {
		expect(() => ast(`f(,)`)).toThrow();
	});
});

describe("parser: lists", () => {
	it("parses an empty list", () => {
		const p = ast(`[]`);
		expect(p.items[0]).toMatchObject({ kind: "list", items: [] });
	});

	it("parses a single-element list", () => {
		const p = ast(`[1]`);
		expect(p.items[0]).toMatchObject({
			kind: "list",
			items: [{ kind: "int", value: 1 }],
		});
	});

	it("parses a multi-element list", () => {
		const p = ast(`[1, 2, 3]`);
		expect(p.items[0]).toMatchObject({
			kind: "list",
			items: [
				{ kind: "int", value: 1 },
				{ kind: "int", value: 2 },
				{ kind: "int", value: 3 },
			],
		});
	});

	it("accepts trailing comma", () => {
		const p = ast(`[1, 2,]`);
		expect(p.items[0]).toMatchObject({
			kind: "list",
			items: [
				{ kind: "int", value: 1 },
				{ kind: "int", value: 2 },
			],
		});
	});

	it("permits newlines inside list", () => {
		const p = ast(`[\n  1,\n  2,\n  3,\n]`);
		expect((p.items[0] as { items: unknown[] }).items).toHaveLength(3);
	});

	it("parses heterogeneous list", () => {
		const p = ast(`[1, "a", true, nil]`);
		const items = (p.items[0] as { items: { kind: string }[] }).items;
		expect(items.map((i) => i.kind)).toEqual(["int", "string", "bool", "nil"]);
	});

	it("parses nested lists", () => {
		const p = ast(`[[1, 2], [3]]`);
		const outer = p.items[0] as { kind: string; items: { kind: string }[] };
		expect(outer.kind).toBe("list");
		expect(outer.items[0]!.kind).toBe("list");
		expect(outer.items[1]!.kind).toBe("list");
	});

	it("throws on missing closing bracket", () => {
		expect(() => ast(`[1, 2`)).toThrow();
	});

	it("throws on missing comma between items", () => {
		expect(() => ast(`[1 2]`)).toThrow();
	});
});

describe("parser: hito 7c — maps + .field", () => {
	it("parses an empty map", () => {
		const p = ast(`{}`);
		expect(p.items[0]).toMatchObject({ kind: "map", entries: [] });
	});

	it("parses a single-entry map", () => {
		const p = ast(`{name: "ana"}`);
		expect(p.items[0]).toMatchObject({
			kind: "map",
			entries: [
				{ key: "name", value: { kind: "string", parts: ["ana"] } },
			],
		});
	});

	it("parses a multi-entry map", () => {
		const p = ast(`{name: "ana", age: 30, active: true}`);
		const entries = (
			p.items[0] as { entries: { key: string }[] }
		).entries;
		expect(entries.map((e) => e.key)).toEqual(["name", "age", "active"]);
	});

	it("permits newlines and trailing comma in map", () => {
		const p = ast(`{\n  a: 1,\n  b: 2,\n}`);
		const entries = (
			p.items[0] as { entries: { key: string }[] }
		).entries;
		expect(entries.map((e) => e.key)).toEqual(["a", "b"]);
	});

	it("parses nested maps", () => {
		const p = ast(`{u: {age: 30}}`);
		const outer = p.items[0] as {
			kind: string;
			entries: { value: { kind: string } }[];
		};
		expect(outer.kind).toBe("map");
		expect(outer.entries[0]!.value.kind).toBe("map");
	});

	it("rejects duplicate keys", () => {
		expect(() => ast(`{a: 1, a: 2}`)).toThrow(/duplicate map key 'a'/);
	});

	it("rejects missing colon", () => {
		expect(() => ast(`{a 1}`)).toThrow();
	});

	it("accepts string-quoted keys (for non-ident keys)", () => {
		const p = ast(`{"foo-bar": 1, baz: 2}`);
		const entries = (
			p.items[0] as { entries: { key: string }[] }
		).entries;
		expect(entries.map((e) => e.key)).toEqual(["foo-bar", "baz"]);
	});

	it("rejects unsupported key type (e.g. int)", () => {
		expect(() => ast(`{1: "a"}`)).toThrow(/expected map key/);
	});

	it("rejects interpolated string as key", () => {
		expect(() => ast(`{"#{x}": 1}`)).toThrow(/expected map key/);
	});

	it("parses field access on identifier", () => {
		const p = ast(`user.name`);
		expect(p.items[0]).toMatchObject({
			kind: "field_access",
			target: { kind: "ident", name: "user" },
			field: "name",
		});
	});

	it("parses chained field access", () => {
		const p = ast(`user.profile.name`);
		const node = p.items[0] as {
			kind: string;
			target: { kind: string; field: string };
			field: string;
		};
		expect(node.kind).toBe("field_access");
		expect(node.field).toBe("name");
		expect(node.target.kind).toBe("field_access");
		expect(node.target.field).toBe("profile");
	});

	it("parses field access after a call", () => {
		const p = ast(`get(m, "u").age`);
		expect(p.items[0]).toMatchObject({
			kind: "field_access",
			target: { kind: "call" },
			field: "age",
		});
	});

	it("parses field access on map literal", () => {
		const p = ast(`{a: 1}.a`);
		expect(p.items[0]).toMatchObject({
			kind: "field_access",
			target: { kind: "map" },
			field: "a",
		});
	});

	it("parses .field standalone as field_shorthand", () => {
		const p = ast(`.name`);
		expect(p.items[0]).toMatchObject({
			kind: "field_shorthand",
			field: "name",
		});
	});

	it("parses .field as argument to call", () => {
		const p = ast(`map(users, .name)`);
		const args = (p.items[0] as { args: { kind: string }[] }).args;
		expect(args[1]!.kind).toBe("field_shorthand");
	});

	it("parses pipe with .field shorthand", () => {
		const p = ast(`users |> map(.name)`);
		expect(p.items[0]).toMatchObject({
			kind: "pipe",
			lhs: { kind: "ident", name: "users" },
			rhs: {
				kind: "call",
				callee: { kind: "ident", name: "map" },
				args: [{ kind: "field_shorthand", field: "name" }],
			},
		});
	});

	it("parses pipe directly into .field shorthand", () => {
		const p = ast(`user |> .name`);
		expect(p.items[0]).toMatchObject({
			kind: "pipe",
			lhs: { kind: "ident", name: "user" },
			rhs: {
				kind: "call",
				callee: { kind: "field_shorthand", field: "name" },
				args: [],
			},
		});
	});

	it("rejects '.field' with no field name", () => {
		expect(() => ast(`.`)).toThrow();
	});

	it("permits map literal inside string interpolation", () => {
		const p = ast(`"m=#{{a: 1}}"`);
		const parts = (p.items[0] as { parts: unknown[] }).parts;
		const interp = parts.find(
			(x): x is { kind: string } =>
				typeof x === "object" && x !== null && "kind" in x,
		);
		expect(interp).toBeDefined();
		expect(interp!.kind).toBe("map");
	});

	it("parses try block with single-stmt body and rescue", () => {
		const p = ast(`try do\n  to_int("42")\nrescue err =>\n  0\nend`);
		expect(p.items[0]).toMatchObject({
			kind: "try",
			tryBody: [{ kind: "call" }],
			errBinding: "err",
			rescueBody: [{ kind: "int", value: 0 }],
		});
	});

	it("parses try block with multi-stmt body and rescue", () => {
		const p = ast(
			`try do\n  x = to_int("42")\n  x + 1\nrescue err =>\n  -1\nend`,
		);
		const node = p.items[0] as {
			kind: string;
			tryBody: unknown[];
			rescueBody: unknown[];
			errBinding: string;
		};
		expect(node.kind).toBe("try");
		expect(node.tryBody).toHaveLength(2);
		expect(node.rescueBody).toHaveLength(1);
		expect(node.errBinding).toBe("err");
	});

	it("parses try with pipe chain in body", () => {
		const p = ast(`try do\n  "42" |> to_int\nrescue err =>\n  0\nend`);
		const node = p.items[0] as {
			kind: string;
			tryBody: { kind: string }[];
		};
		expect(node.kind).toBe("try");
		expect(node.tryBody[0]!.kind).toBe("pipe");
	});

	it("parses try inside an assignment (cmd-like context)", () => {
		const p = ast(
			`x = try do\n  to_int("42")\nrescue err =>\n  0\nend`,
		);
		expect(p.items[0]).toMatchObject({
			kind: "assign",
			name: "x",
			value: { kind: "try" },
		});
	});

	it("parses nested try (inner rescue does not eat outer)", () => {
		const p = ast(
			`try do\n  try do\n    raise("a")\n  rescue e =>\n    raise(e)\n  end\nrescue e =>\n  e\nend`,
		);
		const outer = p.items[0] as {
			kind: string;
			tryBody: { kind: string }[];
			rescueBody: { kind: string }[];
		};
		expect(outer.kind).toBe("try");
		expect(outer.tryBody[0]!.kind).toBe("try");
		expect(outer.rescueBody[0]!.kind).toBe("ident");
	});

	it("rejects try without 'do'", () => {
		expect(() => ast(`try to_int("42")\n`)).toThrow(/'do' after 'try'/);
	});

	it("rejects try block reaching eof without rescue", () => {
		expect(() => ast(`try do\n  1\n  2\n`)).toThrow(
			/expected 'rescue' to close try/,
		);
	});

	it("rejects try block reaching eof without end", () => {
		expect(() => ast(`try do\n  1\nrescue err =>\n  2\n`)).toThrow(
			/expected 'end' to close try/,
		);
	});

	it("rejects rescue without ident", () => {
		expect(() => ast(`try do\n  1\nrescue =>\n  2\nend`)).toThrow(
			/error binding name/,
		);
	});

	it("rejects rescue without =>", () => {
		expect(() => ast(`try do\n  1\nrescue err do\n  2\nend`)).toThrow(
			/'=>' after rescue/,
		);
	});
});

describe("parser: doc-comments on def/defp", () => {
	it("attaches a single ## line to def", () => {
		const p = ast(`## Saluda.\ndef saludar(name) = "Hola"`);
		expect(p.items[0]).toMatchObject({
			kind: "fn_def",
			name: "saludar",
			doc: "Saluda.",
		});
	});

	it("attaches a single ## line to defp", () => {
		const p = ast(`## Helper privado.\ndefp helper(x) = x`);
		expect(p.items[0]).toMatchObject({
			kind: "fn_def",
			name: "helper",
			exported: false,
			doc: "Helper privado.",
		});
	});

	it("joins a run of consecutive ## lines with \\n", () => {
		const p = ast(
			`## first\n## second\n## third\ndef f(x) = x`,
		);
		expect(p.items[0]).toMatchObject({
			kind: "fn_def",
			doc: "first\nsecond\nthird",
		});
	});

	it("preserves blank doc lines as paragraph break", () => {
		const p = ast(`## para 1\n##\n## para 2\ndef f(x) = x`);
		expect(p.items[0]).toMatchObject({
			kind: "fn_def",
			doc: "para 1\n\npara 2",
		});
	});

	it("breaks the run on a blank line — only the closer block attaches", () => {
		const p = ast(`## orphan\n\n## attached\ndef f(x) = x`);
		expect(p.items[0]).toMatchObject({
			kind: "fn_def",
			doc: "attached",
		});
	});

	it("does not attach docs separated from def by a blank line", () => {
		const p = ast(`## orphan\n\ndef f(x) = x`);
		expect(p.items[0]).toMatchObject({ kind: "fn_def", name: "f" });
		expect((p.items[0] as { doc?: string }).doc).toBeUndefined();
	});

	it("breaks the run when a regular # comment is interleaved", () => {
		const p = ast(`## docs\n# nota\ndef f(x) = x`);
		expect(p.items[0]).toMatchObject({ kind: "fn_def", name: "f" });
		expect((p.items[0] as { doc?: string }).doc).toBeUndefined();
	});

	it("silently ignores orphan docs (no def follows)", () => {
		const p = ast(`## orphan doc\n1 + 1`);
		expect(p.items).toHaveLength(1);
		expect(p.items[0]).toMatchObject({ kind: "binop" });
	});

	it("works with do/end def body", () => {
		const p = ast(`## Block form.\ndef f(x) do\n  x\nend`);
		expect(p.items[0]).toMatchObject({
			kind: "fn_def",
			doc: "Block form.",
		});
	});

	it("attaches docs to second def when first has no docs", () => {
		const p = ast(
			`def first(x) = x\n\n## docs for second\ndef second(x) = x`,
		);
		expect(p.items[0]).toMatchObject({ kind: "fn_def", name: "first" });
		expect((p.items[0] as { doc?: string }).doc).toBeUndefined();
		expect(p.items[1]).toMatchObject({
			kind: "fn_def",
			name: "second",
			doc: "docs for second",
		});
	});

	it("preserves markdown headers via `## ###` pattern", () => {
		const p = ast(`## ### Section\n## body\ndef f(x) = x`);
		expect(p.items[0]).toMatchObject({
			kind: "fn_def",
			doc: "### Section\nbody",
		});
	});
});

describe("parser: PipeExpr AST shape", () => {
	it("emits PipeExpr (not Call) for bare-ident RHS", () => {
		const p = ast(`x |> f`);
		const node = p.items[0] as { kind: string };
		expect(node.kind).toBe("pipe");
		expect(node.kind).not.toBe("call");
	});

	it("emits PipeExpr (not Call) for parenthesized RHS", () => {
		const p = ast(`x |> f(y)`);
		const node = p.items[0] as { kind: string };
		expect(node.kind).toBe("pipe");
	});

	it("does not inject lhs into rhs.args when no placeholder", () => {
		const p = ast(`x |> f(a, b)`);
		expect(p.items[0]).toMatchObject({
			kind: "pipe",
			lhs: { kind: "ident", name: "x" },
			rhs: {
				kind: "call",
				callee: { kind: "ident", name: "f" },
				args: [
					{ kind: "ident", name: "a" },
					{ kind: "ident", name: "b" },
				],
			},
		});
	});

	it("preserves `_` placeholder as Identifier literal in rhs.args", () => {
		const p = ast(`x |> f(a, _, b)`);
		expect(p.items[0]).toMatchObject({
			kind: "pipe",
			lhs: { kind: "ident", name: "x" },
			rhs: {
				kind: "call",
				callee: { kind: "ident", name: "f" },
				args: [
					{ kind: "ident", name: "a" },
					{ kind: "ident", name: "_" },
					{ kind: "ident", name: "b" },
				],
			},
		});
	});

	it("rejects multiple `_` placeholders in a single pipe call", () => {
		expect(() => ast(`x |> f(_, _)`)).toThrow(
			/placeholder '_' may appear at most once/,
		);
	});

	it("emits PipeExpr with empty rhs.args for lambda RHS", () => {
		const p = ast(`5 |> fn n => n + 1`);
		expect(p.items[0]).toMatchObject({
			kind: "pipe",
			lhs: { kind: "int", value: 5 },
			rhs: {
				kind: "call",
				callee: { kind: "lambda", params: ["n"] },
				args: [],
			},
		});
	});

	it("emits PipeExpr with field_shorthand callee for `.field` RHS", () => {
		const p = ast(`u |> .name`);
		expect(p.items[0]).toMatchObject({
			kind: "pipe",
			lhs: { kind: "ident", name: "u" },
			rhs: {
				kind: "call",
				callee: { kind: "field_shorthand", field: "name" },
				args: [],
			},
		});
	});

	it("nests PipeExpr left-associatively in chains", () => {
		const p = ast(`a |> b |> c`);
		expect(p.items[0]).toMatchObject({
			kind: "pipe",
			lhs: {
				kind: "pipe",
				lhs: { kind: "ident", name: "a" },
				rhs: { kind: "call", callee: { kind: "ident", name: "b" } },
			},
			rhs: { kind: "call", callee: { kind: "ident", name: "c" } },
		});
	});
});
