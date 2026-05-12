import { describe, expect, it } from "vitest";
import type { Module } from "../src/ast";
import { EspetoError } from "../src/errors";
import { format, formatSource } from "../src/format";
import { lex } from "../src/lexer";
import { parse } from "../src/parser";

function ast(src: string): Module {
	return parse(lex(src, "x.esp"), src);
}

function fmt(src: string): string {
	return format(ast(src));
}

describe("format: literals & idents", () => {
	it("int", () => {
		expect(fmt("42")).toBe("42\n");
	});

	it("float preserves trailing zero", () => {
		expect(fmt("1.0")).toBe("1.0\n");
	});

	it("float with fractional", () => {
		expect(fmt("3.14")).toBe("3.14\n");
	});

	it("float whole-number value", () => {
		expect(fmt("5.0")).toBe("5.0\n");
	});

	it("bool true/false", () => {
		expect(fmt("true")).toBe("true\n");
		expect(fmt("false")).toBe("false\n");
	});

	it("nil", () => {
		expect(fmt("nil")).toBe("nil\n");
	});

	it("identifier", () => {
		expect(fmt("foo")).toBe("foo\n");
	});

	it("string plain", () => {
		expect(fmt(`"hola"`)).toBe(`"hola"\n`);
	});

	it("string with escapes", () => {
		expect(fmt(`"a\\nb\\tc"`)).toBe(`"a\\nb\\tc"\n`);
	});

	it("string with quote escape", () => {
		expect(fmt(`"a\\"b"`)).toBe(`"a\\"b"\n`);
	});

	it("string with backslash escape", () => {
		expect(fmt(`"a\\\\b"`)).toBe(`"a\\\\b"\n`);
	});

	it("string with interp", () => {
		expect(fmt(`"hi #{name}"`)).toBe(`"hi #{name}"\n`);
	});

	it("string with multiple interps", () => {
		expect(fmt(`"#{a} y #{b}"`)).toBe(`"#{a} y #{b}"\n`);
	});

	it("string with escaped interp", () => {
		expect(fmt(`"a\\#{b}"`)).toBe(`"a\\#{b}"\n`);
	});
});

describe("format: binops naive", () => {
	it("simple addition", () => {
		expect(fmt("1 + 2")).toBe("1 + 2\n");
	});

	it("left-assoc chain", () => {
		expect(fmt("1 + 2 + 3")).toBe("1 + 2 + 3\n");
	});

	it("mixed precedence", () => {
		expect(fmt("1 + 2 * 3")).toBe("1 + 2 * 3\n");
	});

	it("parens required: lower prec lhs", () => {
		expect(fmt("(a + b) * c")).toBe("(a + b) * c\n");
	});

	it("no parens: same-prec lhs (left-assoc)", () => {
		expect(fmt("a + b + c")).toBe("a + b + c\n");
	});

	it("parens for non-canonical right-leaning", () => {
		expect(fmt("a + (b + c)")).toBe("a + (b + c)\n");
	});

	it("comparison no chain", () => {
		expect(fmt("a < b")).toBe("a < b\n");
	});

	it("and/or", () => {
		expect(fmt("a and b or c")).toBe("a and b or c\n");
	});

	it("equality", () => {
		expect(fmt("a == b")).toBe("a == b\n");
	});
});

describe("format: unop", () => {
	it("unary minus", () => {
		expect(fmt("-x")).toBe("-x\n");
	});

	it("not", () => {
		expect(fmt("not x")).toBe("not x\n");
	});

	it("unary on parens", () => {
		expect(fmt("-(a + b)")).toBe("-(a + b)\n");
	});

	it("not on parens", () => {
		expect(fmt("not (a and b)")).toBe("not (a and b)\n");
	});

	it("double negation", () => {
		expect(fmt("not not x")).toBe("not not x\n");
	});

	it("unary inside binop wraps if needed", () => {
		expect(fmt("a + -b")).toBe("a + -b\n");
	});
});

describe("format: pipe naive", () => {
	it("simple pipe", () => {
		expect(fmt("a |> b")).toBe("a |> b\n");
	});

	it("pipe with args", () => {
		expect(fmt("a |> b(c)")).toBe("a |> b(c)\n");
	});

	it("pipe with placeholder", () => {
		expect(fmt("a |> b(_, c)")).toBe("a |> b(_, c)\n");
	});

	it("pipe chain", () => {
		expect(fmt("a |> b |> c")).toBe("a |> b |> c\n");
	});

	it("pipe with field shorthand", () => {
		expect(fmt("xs |> map(.name)")).toBe("xs |> map(.name)\n");
	});

	it("pipe rhs is bare .field shortcut", () => {
		expect(fmt("xs |> .name")).toBe("xs |> .name\n");
	});

	it("pipe with lambda rhs", () => {
		expect(fmt("xs |> fn x => x + 1")).toBe("xs |> fn x => x + 1\n");
	});

	it("pipe lhs with binop needs parens", () => {
		expect(fmt("(a + b) |> f")).toBe("(a + b) |> f\n");
	});

	it("pipe inside additive — no parens (pipe > add)", () => {
		expect(fmt("a + b |> f")).toBe("a + b |> f\n");
	});
});

describe("format: call & field access", () => {
	it("plain call", () => {
		expect(fmt("f(x)")).toBe("f(x)\n");
	});

	it("call no args", () => {
		expect(fmt("f()")).toBe("f()\n");
	});

	it("call many args", () => {
		expect(fmt("f(a, b, c)")).toBe("f(a, b, c)\n");
	});

	it("chained call", () => {
		expect(fmt("f(x)(y)")).toBe("f(x)(y)\n");
	});

	it("field access", () => {
		expect(fmt("a.b")).toBe("a.b\n");
	});

	it("nested field access", () => {
		expect(fmt("a.b.c")).toBe("a.b.c\n");
	});

	it("field on call", () => {
		expect(fmt("f(x).name")).toBe("f(x).name\n");
	});

	it("field shorthand as expr", () => {
		expect(fmt(".name")).toBe(".name\n");
	});
});

describe("format: list", () => {
	it("empty list", () => {
		expect(fmt("[]")).toBe("[]\n");
	});

	it("inline list", () => {
		expect(fmt("[1, 2, 3]")).toBe("[1, 2, 3]\n");
	});

	it("nested list inline", () => {
		expect(fmt("[[1, 2], [3, 4]]")).toBe("[[1, 2], [3, 4]]\n");
	});

	it("list wraps multi-line when too wide", () => {
		const longList = `[${"abcdefghij, ".repeat(10).slice(0, -2)}]`;
		const out = fmt(longList);
		expect(out).toContain("[\n\t");
		expect(out).toContain(",\n]");
	});
});

describe("format: map", () => {
	it("empty map", () => {
		expect(fmt("{}")).toBe("{}\n");
	});

	it("inline map", () => {
		expect(fmt(`{a: 1, b: 2}`)).toBe(`{a: 1, b: 2}\n`);
	});

	it("map with various values", () => {
		expect(fmt(`{name: "foo", price: 10}`)).toBe(
			`{name: "foo", price: 10}\n`,
		);
	});
});

describe("format: lambda", () => {
	it("single-param no parens", () => {
		expect(fmt("fn x => x + 1")).toBe("fn x => x + 1\n");
	});

	it("multi-param with parens", () => {
		expect(fmt("fn(a, b) => a + b")).toBe("fn(a, b) => a + b\n");
	});

	it("zero-param", () => {
		expect(fmt("fn() => 42")).toBe("fn() => 42\n");
	});

	it("normalizes single-param paren form", () => {
		// User wrote with parens; canonical is no parens for single.
		expect(fmt("fn(x) => x")).toBe("fn x => x\n");
	});
});

describe("format: if", () => {
	it("inline single-branch with else", () => {
		expect(fmt("if c do a else b end")).toBe("if c do a else b end\n");
	});

	it("inline single-branch no else", () => {
		expect(fmt("if c do a end")).toBe("if c do a end\n");
	});

	it("else-if chain always multi-line", () => {
		const src = `if a do 1 else if b do 2 else 3 end`;
		const out = fmt(src);
		expect(out).toBe(
			[
				"if a do",
				"\t1",
				"else if b do",
				"\t2",
				"else",
				"\t3",
				"end",
				"",
			].join("\n"),
		);
	});

	it("breaks when too wide", () => {
		const src = `if some_really_really_long_condition_here do "a_long_branch_value_indeed" else "another_really_long_branch_value" end`;
		const out = fmt(src);
		expect(out).toContain("\n\t");
		expect(out).toContain("\nend");
	});
});

describe("format: try", () => {
	it("inline try when both bodies single expr", () => {
		expect(fmt("try do read(f) rescue err => 0 end")).toBe(
			"try do read(f) rescue err => 0 end\n",
		);
	});

	it("multi-line when tryBody has assignment", () => {
		const src = ["try do", "x = 1", "x + 1", "rescue err =>", "0", "end"].join(
			"\n",
		);
		const out = fmt(src);
		expect(out).toContain("try do\n");
		expect(out).toContain("rescue err =>");
		expect(out).toMatch(/\nend\n$/);
	});
});

describe("format: assert", () => {
	it("assert with simple expr", () => {
		expect(fmt("assert 1 == 1")).toBe("assert 1 == 1\n");
	});

	it("assert with call", () => {
		expect(fmt("assert f(x)")).toBe("assert f(x)\n");
	});
});

describe("format: def", () => {
	it("inline single-expr def", () => {
		expect(fmt("def f(x) = x + 1")).toBe("def f(x) = x + 1\n");
	});

	it("multi-stmt def uses do/end", () => {
		const src = ["def f(x) do", "y = x + 1", "y * 2", "end"].join("\n");
		expect(fmt(src)).toBe(
			["def f(x) do", "\ty = x + 1", "\ty * 2", "end", ""].join("\n"),
		);
	});

	it("defp emits private form", () => {
		expect(fmt("defp f(x) = x")).toBe("defp f(x) = x\n");
	});

	it("def with doc comment", () => {
		const src = `## Saluda a alguien.\ndef saludar(name) = "Hola, #{name}!"`;
		expect(fmt(src)).toBe(
			[
				"## Saluda a alguien.",
				`def saludar(name) = "Hola, #{name}!"`,
				"",
			].join("\n"),
		);
	});

	it("def with multi-line doc", () => {
		const src = `## Line 1.\n## \n## Line 3.\ndef f(x) = x`;
		expect(fmt(src)).toBe(
			["## Line 1.", "##", "## Line 3.", "def f(x) = x", ""].join("\n"),
		);
	});

	it("def with long inline body breaks to do/end", () => {
		const src = `def f(x) = some_really_really_long_function_name(another_really_long_arg_value_here, yet_more_args_here)`;
		const out = fmt(src);
		expect(out).toContain("def f(x) do\n\t");
		expect(out).toContain("\nend");
	});
});

describe("format: assign", () => {
	it("simple assign", () => {
		expect(fmt("x = 1")).toBe("x = 1\n");
	});

	it("assign with multi-line if", () => {
		const src = `x = if a do 1 else if b do 2 else 3 end`;
		const out = fmt(src);
		expect(out).toBe(
			[
				"x = if a do",
				"\t1",
				"else if b do",
				"\t2",
				"else",
				"\t3",
				"end",
				"",
			].join("\n"),
		);
	});
});

describe("format: cmd", () => {
	it("simple cmd", () => {
		const src = `cmd hello do "hi" |> print end`;
		expect(fmt(src)).toBe(
			["cmd hello do", `\t"hi" |> print`, "end", ""].join("\n"),
		);
	});

	it("cmd with meta and decls", () => {
		const src = [
			"cmd greet do",
			`desc "say hi"`,
			"arg name: str",
			`msg = "Hola, #{name}!"`,
			"msg |> print",
			"end",
		].join("\n");
		const out = fmt(src);
		expect(out).toContain("cmd greet do");
		expect(out).toContain(`\tdesc "say hi"`);
		expect(out).toContain("\targ name: str");
		expect(out).toContain(`\tmsg = "Hola, #{name}!"`);
		expect(out).toContain("\tmsg |> print");
		expect(out).toMatch(/\nend\n$/);
	});

	it("flag decl with attrs", () => {
		const src = [
			"cmd c do",
			`flag loud: bool = false, short: "l", desc: "loud"`,
			`"x"`,
			"end",
		].join("\n");
		const out = fmt(src);
		expect(out).toContain(
			`\tflag loud: bool = false, short: "l", desc: "loud"`,
		);
	});
});

describe("format: program", () => {
	it("program with cmds", () => {
		const src = [
			"program todo do",
			`desc "x"`,
			"cmd a do",
			`"1"`,
			"end",
			"cmd b do",
			`"2"`,
			"end",
			"end",
		].join("\n");
		const out = fmt(src);
		expect(out).toContain("program todo do");
		expect(out).toContain(`\tdesc "x"`);
		expect(out).toContain("\tcmd a do");
		expect(out).toContain("\tcmd b do");
		expect(out).toMatch(/\nend\n$/);
	});
});

describe("format: test", () => {
	it("test block", () => {
		const src = `test "x" do assert 1 == 1 end`;
		expect(fmt(src)).toBe(
			[`test "x" do`, "\tassert 1 == 1", "end", ""].join("\n"),
		);
	});
});

describe("format: import", () => {
	it("import without only", () => {
		expect(fmt(`import "./foo"`)).toBe(`import "./foo"\n`);
	});

	it("import with only", () => {
		expect(fmt(`import "./foo" only [a, b]`)).toBe(
			`import "./foo" only [a, b]\n`,
		);
	});

	it("import with alias", () => {
		expect(fmt(`import "./foo" only [a as b]`)).toBe(
			`import "./foo" only [a as b]\n`,
		);
	});

	it("import wraps when too wide", () => {
		const src = `import "./very_long_path_name_here_yes_yes" only [abc, ddd, ggg, jjj, mmm, ppp, sss, vvv, www, zzz, qqq]`;
		const out = fmt(src);
		expect(out).toContain("only [\n\t");
		expect(out).toContain(",\n]");
	});
});

describe("format: top-level", () => {
	it("blank line between items", () => {
		const src = `import "./x"\ncmd hi do "hi" end`;
		expect(fmt(src)).toBe(
			[`import "./x"`, "", "cmd hi do", `\t"hi"`, "end", ""].join("\n"),
		);
	});

	it("multiple defs separated by blank lines", () => {
		const src = `def f(x) = x\ndef g(y) = y`;
		expect(fmt(src)).toBe(
			["def f(x) = x", "", "def g(y) = y", ""].join("\n"),
		);
	});
});

describe("format: idempotency on canonical inputs", () => {
	const canonical = [
		"42\n",
		"1.0\n",
		`"hola"\n`,
		`"hi #{name}"\n`,
		"a + b * c\n",
		"(a + b) * c\n",
		"a |> b |> c\n",
		"a |> map(fn x => x + 1)\n",
		"xs |> filter(.activo)\n",
		"[1, 2, 3]\n",
		"{a: 1, b: 2}\n",
		"if c do a else b end\n",
		"fn x => x + 1\n",
		"fn(a, b) => a + b\n",
		"def f(x) = x + 1\n",
		`def saludar(name) = "Hola, #{name}!"\n`,
		"x = 1\n",
		`import "./foo" only [a, b]\n`,
		[
			"if a do",
			"\t1",
			"else if b do",
			"\t2",
			"else",
			"\t3",
			"end",
			"",
		].join("\n"),
		["cmd hello do", `\t"hi" |> print`, "end", ""].join("\n"),
		[`test "adds" do`, "\tassert 1 + 1 == 2", "end", ""].join("\n"),
		// Phase 3 — multi-line wrap
		[
			"f(",
			"\tvery_long_arg_a,",
			"\tvery_long_arg_b,",
			"\tvery_long_arg_c,",
			"\tvery_long_arg_d,",
			"\tvery_long_arg_e,",
			"\tvery_long_arg_f,",
			")",
			"",
		].join("\n"),
		[
			"fn(",
			"\tvery_long_param_a,",
			"\tvery_long_param_b,",
			"\tvery_long_param_c,",
			"\tvery_long_param_d,",
			"\tvery_long_param_e,",
			") => 1",
			"",
		].join("\n"),
		// Phase 3 — chain flatten
		[
			"very_long_aaa",
			"+ very_long_bbb",
			"+ very_long_ccc",
			"+ very_long_ddd",
			"+ very_long_eee",
			"+ very_long_fff",
			"+ very_long_ggg",
			"",
		].join("\n"),
		[
			"xs",
			"|> filter(fn x => x > 0)",
			"|> map(fn x => x * 2)",
			"|> reduce(fn(acc, x) => acc + x, 0)",
			"|> debug_dump(label)",
			"",
		].join("\n"),
	];

	for (const src of canonical) {
		const preview = src.replace(/\n/g, "\\n").slice(0, 50);
		it(`canonical: ${preview}`, () => {
			expect(fmt(src)).toBe(src);
		});
	}
});

describe("format: round-trip stability", () => {
	const inputs = [
		"1+2",
		"a+b+c",
		"a |> b |> c",
		"if c do a else b end",
		`if a do 1 else if b do 2 else 3 end`,
		"def f(x)=x+1",
		"[ 1 , 2 , 3 ]",
		"{ a : 1 , b : 2 }",
		`import "./foo"  only  [ a , b ]`,
		"fn(x)=>x",
		"cmd hello do\n\"hi\"|>print\nend",
		// Phase 3 — trailing comma + multi-line variations
		`f(1, 2, 3,)`,
		`f( 1 , 2 , 3 )`,
		`def f(a,b,)=a+b`,
		`fn(a,b,)=>a+b`,
		`a |> b |> c |> d`,
		`a + b + c + d + e`,
	];

	for (const src of inputs) {
		const preview = src.replace(/\n/g, "\\n").slice(0, 50);
		it(`stable: ${preview}`, () => {
			const once = fmt(src);
			const twice = fmt(once);
			expect(twice).toBe(once);
		});
	}
});

describe("Lindig core: render", () => {
	// We exercise the core indirectly via format(). These tests check the
	// observable shape: width breaks, indent, group flat-vs-break.

	it("respects 100-col width: short list inline", () => {
		const src = "[1, 2, 3]";
		expect(fmt(src)).toBe("[1, 2, 3]\n");
	});

	it("forces break when content exceeds width", () => {
		const items = Array.from(
			{ length: 14 },
			(_, i) => `long_item_name_${i}`,
		).join(", ");
		const src = `[${items}]`;
		const out = fmt(src);
		const lines = out.split("\n");
		expect(lines.length).toBeGreaterThan(2);
		expect(lines[0]).toBe("[");
		for (let i = 1; i < lines.length - 2; i++) {
			expect(lines[i]!.startsWith("\t")).toBe(true);
		}
	});

	it("uses tabs not spaces for indent", () => {
		const src = `cmd c do
\t\t"a"
end`;
		const out = fmt(src);
		expect(out).toContain("\n\t");
		expect(out).not.toMatch(/\n  [^\t]/); // no two-space indent
	});

	it("trailing newline always exactly one", () => {
		expect(fmt("1").endsWith("\n")).toBe(true);
		expect(fmt("1").endsWith("\n\n")).toBe(false);
	});
});

describe("format: Phase 3 — wrap call args", () => {
	it("short call stays inline", () => {
		expect(fmt("f(1, 2, 3)")).toBe("f(1, 2, 3)\n");
	});

	it("call wraps with trailing comma when too wide", () => {
		const src = `f(very_long_arg_a, very_long_arg_b, very_long_arg_c, very_long_arg_d, very_long_arg_e, very_long_arg_f)`;
		expect(fmt(src)).toBe(
			[
				"f(",
				"\tvery_long_arg_a,",
				"\tvery_long_arg_b,",
				"\tvery_long_arg_c,",
				"\tvery_long_arg_d,",
				"\tvery_long_arg_e,",
				"\tvery_long_arg_f,",
				")",
				"",
			].join("\n"),
		);
	});

	it("call no args stays as ()", () => {
		expect(fmt("now()")).toBe("now()\n");
	});

	it("nested call: outer wraps but inner stays inline", () => {
		const src = `outer(short, inner(a, b), longer_arg_to_force_a_wrap_eventually_for_the_outer_call)`;
		const out = fmt(src);
		expect(out).toContain("inner(a, b)");
	});
});

describe("format: Phase 3 — wrap def/lambda params", () => {
	it("short def params stay inline", () => {
		expect(fmt("def f(a, b) = a + b")).toBe("def f(a, b) = a + b\n");
	});

	it("def wraps params with trailing comma when too wide", () => {
		const src = `def some_long_name(very_long_param_a, very_long_param_b, very_long_param_c, very_long_param_d, very_long_param_e) = 1`;
		const out = fmt(src);
		expect(out).toContain("def some_long_name(\n\tvery_long_param_a,");
		expect(out).toContain(",\n) do");
		expect(out).toContain("\nend\n");
	});

	it("multi-param lambda wraps params with trailing comma", () => {
		const src = `fn(very_long_param_a, very_long_param_b, very_long_param_c, very_long_param_d, very_long_param_e) => 1`;
		expect(fmt(src)).toBe(
			[
				"fn(",
				"\tvery_long_param_a,",
				"\tvery_long_param_b,",
				"\tvery_long_param_c,",
				"\tvery_long_param_d,",
				"\tvery_long_param_e,",
				") => 1",
				"",
			].join("\n"),
		);
	});

	it("single-param lambda never wraps", () => {
		expect(fmt("fn x => x + 1")).toBe("fn x => x + 1\n");
	});
});

describe("format: Phase 3 — chain flatten binop", () => {
	it("short + chain stays inline", () => {
		expect(fmt("a + b + c + d")).toBe("a + b + c + d\n");
	});

	it("long + chain breaks before each operator", () => {
		const src = `very_long_aaa + very_long_bbb + very_long_ccc + very_long_ddd + very_long_eee + very_long_fff + very_long_ggg`;
		expect(fmt(src)).toBe(
			[
				"very_long_aaa",
				"+ very_long_bbb",
				"+ very_long_ccc",
				"+ very_long_ddd",
				"+ very_long_eee",
				"+ very_long_fff",
				"+ very_long_ggg",
				"",
			].join("\n"),
		);
	});

	it("long and/or chain breaks before each operator", () => {
		const src = `condition_one and condition_two and condition_three and condition_four and condition_five and condition_six`;
		expect(fmt(src)).toContain("condition_one\nand condition_two");
	});

	it("cross-precedence: a + b * c + d not flattened across *", () => {
		expect(fmt("a + b * c + d")).toBe("a + b * c + d\n");
	});

	it("cmp ops never flatten (parser rejects chain anyway)", () => {
		expect(fmt("a < b")).toBe("a < b\n");
	});
});

describe("format: Phase 3 — chain flatten pipe", () => {
	it("short pipe chain stays inline", () => {
		expect(fmt("a |> b |> c")).toBe("a |> b |> c\n");
	});

	it("long pipe chain breaks before each |>", () => {
		const src = `xs |> filter(fn x => x > 0) |> map(fn x => x * 2) |> reduce(fn(acc, x) => acc + x, 0) |> debug_dump(label)`;
		expect(fmt(src)).toBe(
			[
				"xs",
				"|> filter(fn x => x > 0)",
				"|> map(fn x => x * 2)",
				"|> reduce(fn(acc, x) => acc + x, 0)",
				"|> debug_dump(label)",
				"",
			].join("\n"),
		);
	});

	it("single pipe (2 ops) stays inline form even if long", () => {
		expect(fmt("a |> b")).toBe("a |> b\n");
	});
});

describe("format: Phase 3 — field access never wraps", () => {
	it("long field access chain stays inline", () => {
		expect(fmt("very_long_obj.very_long_field_a.very_long_field_b")).toBe(
			"very_long_obj.very_long_field_a.very_long_field_b\n",
		);
	});
});

describe("format: Phase 4 — leading comments", () => {
	it("own-line comment before top-level stmt", () => {
		expect(fmt("# leading\nx = 1")).toBe("# leading\nx = 1\n");
	});

	it("multiple own-line comments before stmt", () => {
		expect(fmt("# a\n# b\n# c\nx = 1")).toBe("# a\n# b\n# c\nx = 1\n");
	});

	it("leading comment inside def body", () => {
		const src = "def f() do\n  # before\n  x = 1\n  x\nend";
		expect(fmt(src)).toBe(
			["def f() do", "\t# before", "\tx = 1", "\tx", "end", ""].join("\n"),
		);
	});

	it("leading comment inside cmd body", () => {
		const src = `cmd hello do\n  # before\n  "hi" |> print\nend`;
		expect(fmt(src)).toBe(
			["cmd hello do", "\t# before", `\t"hi" |> print`, "end", ""].join("\n"),
		);
	});

	it("leading comment inside test body", () => {
		const src = `test "t" do\n  # note\n  assert true\nend`;
		expect(fmt(src)).toBe(
			[`test "t" do`, "\t# note", "\tassert true", "end", ""].join("\n"),
		);
	});

	it("empty leading comment renders as just #", () => {
		expect(fmt("#\nx = 1")).toBe("#\nx = 1\n");
	});
});

describe("format: Phase 4 — trailing comments", () => {
	it("trailing comment on assign", () => {
		expect(fmt("x = 1 # trailing")).toBe("x = 1 # trailing\n");
	});

	it("trailing comment on call", () => {
		expect(fmt(`"hi" |> print # log it`)).toBe(`"hi" |> print # log it\n`);
	});

	it("trailing comment on inline def", () => {
		expect(fmt("def f() = 1 # see RFC")).toBe("def f() = 1 # see RFC\n");
	});

	it("trailing comment on do/end def lands after end", () => {
		const src = "def f() do\n  x = 1\n  x\nend # done";
		expect(fmt(src)).toBe(
			["def f() do", "\tx = 1", "\tx", "end # done", ""].join("\n"),
		);
	});

	it("trailing comment inside def body", () => {
		const src = "def f() do\n  x = 1 # ok\n  x\nend";
		expect(fmt(src)).toBe(
			["def f() do", "\tx = 1 # ok", "\tx", "end", ""].join("\n"),
		);
	});

	it("empty trailing comment renders as ' #'", () => {
		expect(fmt("x = 1 #")).toBe("x = 1 #\n");
	});
});

describe("format: Phase 4 — blank lines", () => {
	it("preserves single blank line between stmts in body", () => {
		const src = "def f() do\n  x = 1\n\n  y = 2\n  y\nend";
		expect(fmt(src)).toBe(
			["def f() do", "\tx = 1", "", "\ty = 2", "\ty", "end", ""].join("\n"),
		);
	});

	it("collapses 2+ blank lines to 1 between stmts", () => {
		const src = "def f() do\n  x = 1\n\n\n\n  y = 2\n  y\nend";
		expect(fmt(src)).toBe(
			["def f() do", "\tx = 1", "", "\ty = 2", "\ty", "end", ""].join("\n"),
		);
	});

	it("strips blank line at start of body", () => {
		const src = "def f() do\n\n  x = 1\n  x\nend";
		expect(fmt(src)).toBe(
			["def f() do", "\tx = 1", "\tx", "end", ""].join("\n"),
		);
	});

	it("strips blank line at end of body", () => {
		const src = "def f() do\n  x = 1\n  x\n\nend";
		expect(fmt(src)).toBe(
			["def f() do", "\tx = 1", "\tx", "end", ""].join("\n"),
		);
	});

	it("always exactly 1 blank between top-level items (input: many blanks)", () => {
		const src = "x = 1\n\n\n\ny = 2";
		expect(fmt(src)).toBe("x = 1\n\ny = 2\n");
	});

	it("always exactly 1 blank between top-level items (input: no blanks)", () => {
		const src = "x = 1\ny = 2";
		expect(fmt(src)).toBe("x = 1\n\ny = 2\n");
	});

	it("blank line in body has no trailing tab", () => {
		const src = "def f() do\n  x = 1\n\n  y = 2\n  y\nend";
		const out = fmt(src);
		// The blank line should be just "\n", not "\t\n"
		expect(out).not.toMatch(/\t\n/);
	});
});

describe("format: Phase 4 — dangling comments", () => {
	it("def with only a dangling comment", () => {
		const src = "def f() do\n  # TODO: implement\nend";
		expect(fmt(src)).toBe(
			["def f() do", "\t# TODO: implement", "end", ""].join("\n"),
		);
	});

	it("def with body then dangling", () => {
		const src = "def f() do\n  x = 1\n  x\n  # after stmt\nend";
		expect(fmt(src)).toBe(
			["def f() do", "\tx = 1", "\tx", "\t# after stmt", "end", ""].join("\n"),
		);
	});

	it("cmd with only dangling comment", () => {
		const src = "cmd foo do\n  # only comment\nend";
		expect(fmt(src)).toBe(
			["cmd foo do", "\t# only comment", "end", ""].join("\n"),
		);
	});

	it("test with only dangling comment", () => {
		const src = `test "t" do\n  # nothing yet\nend`;
		expect(fmt(src)).toBe(
			[`test "t" do`, "\t# nothing yet", "end", ""].join("\n"),
		);
	});

	it("try/rescue with separate dangling per body", () => {
		const src = [
			"x = try do",
			"  a",
			"  # try dangling",
			"rescue err =>",
			"  b",
			"  # rescue dangling",
			"end",
		].join("\n");
		const out = fmt(src);
		expect(out).toContain("\ta");
		expect(out).toContain("\t# try dangling");
		expect(out).toContain("\tb");
		expect(out).toContain("\t# rescue dangling");
	});

	it("module-level dangling at end of file", () => {
		const src = "x = 1\n# trailing dangling";
		expect(fmt(src)).toBe("x = 1\n# trailing dangling\n");
	});
});

describe("format: Phase 4 — doc + leading comments", () => {
	it("regular # before ## doc, both pegado al def", () => {
		const src = "# before doc\n## doc line\ndef f() = 1";
		expect(fmt(src)).toBe("# before doc\n## doc line\ndef f() = 1\n");
	});

	it("multiple regular comments + multi-line doc + def", () => {
		const src = "# c1\n# c2\n## doc 1\n## doc 2\ndef f() = 1";
		expect(fmt(src)).toBe(
			["# c1", "# c2", "## doc 1", "## doc 2", "def f() = 1", ""].join("\n"),
		);
	});
});

describe("format: Phase 4 — force multi-line on trivia", () => {
	it("def with trailing comment on inner expr forces do/end", () => {
		const src = "def f() do\n  1 # see RFC\nend";
		expect(fmt(src)).toBe(
			["def f() do", "\t1 # see RFC", "end", ""].join("\n"),
		);
	});

	it("def with leading comment in body forces do/end", () => {
		const src = "def f() do\n  # note\n  1\nend";
		expect(fmt(src)).toBe(
			["def f() do", "\t# note", "\t1", "end", ""].join("\n"),
		);
	});

	it("try with comment in body forces multi-line", () => {
		const src = "x = try do\n  # note\n  a\nrescue err =>\n  b\nend";
		const out = fmt(src);
		expect(out).toContain("try do\n");
		expect(out).toContain("\t# note");
		expect(out).toMatch(/\nend\n$/);
	});
});

describe("format: Phase 4 — idempotency with trivia", () => {
	const cases: string[] = [
		"# leading\nx = 1\n",
		"x = 1 # trailing\n",
		"x = 1\n\ny = 2\n",
		["def f() do", "\t# before", "\tx = 1", "\tx", "end", ""].join("\n"),
		["def f() do", "\tx = 1 # inline", "\tx", "end", ""].join("\n"),
		["def f() do", "\tx = 1", "", "\ty = 2", "\ty", "end", ""].join("\n"),
		["def f() do", "\t# TODO: implement", "end", ""].join("\n"),
		"# before doc\n## doc\ndef f() = 1\n",
		"x = 1\n# trailing dangling\n",
		[`test "t" do`, "\t# nothing yet", "end", ""].join("\n"),
		["cmd foo do", "\t# only comment", "end", ""].join("\n"),
		["def f() do", "\t1 # inline trailing", "end", ""].join("\n"),
	];

	for (const src of cases) {
		const preview = src.replace(/\n/g, "\\n").slice(0, 60);
		it(`idempotent: ${preview}`, () => {
			const once = fmt(src);
			expect(once).toBe(src);
			const twice = fmt(once);
			expect(twice).toBe(once);
		});
	}
});

describe("format: Phase 4 — round-trip stability with trivia", () => {
	const inputs: string[] = [
		"#leading\nx=1",
		"x=1#trailing",
		"x=1\n\n\n\ny=2",
		"def f() do\n# note\nx = 1\nx\nend",
		"def f() do\n  # only\nend",
		"def f() do\nx=1\n\n\ny=2\ny\nend",
		"# before doc\n## doc\ndef f()=1",
		"x = 1\n\n# dangling",
	];

	for (const src of inputs) {
		const preview = src.replace(/\n/g, "\\n").slice(0, 60);
		it(`stable: ${preview}`, () => {
			const once = fmt(src);
			const twice = fmt(once);
			expect(twice).toBe(once);
		});
	}
});

describe("formatSource", () => {
	it("formats a valid program", () => {
		const r = formatSource("x=1", "test.esp");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.output).toBe("x = 1\n");
	});

	it("returns EspetoError for unparseable source", () => {
		const r = formatSource("if c do", "test.esp");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toBeInstanceOf(EspetoError);
	});

	it("strips UTF-8 BOM before lexing", () => {
		const r = formatSource("﻿x=1", "test.esp");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.output).toBe("x = 1\n");
	});

	it("normalizes CRLF to LF (CRLF input gives same output as LF)", () => {
		const crlf = formatSource("x = 1\r\ny = 2\r\n", "test.esp");
		const lf = formatSource("x = 1\ny = 2\n", "test.esp");
		expect(crlf.ok).toBe(true);
		expect(lf.ok).toBe(true);
		if (crlf.ok && lf.ok) {
			expect(crlf.output).toBe(lf.output);
			expect(crlf.output.includes("\r")).toBe(false);
		}
	});

	it("is idempotent on already-formatted source", () => {
		const r1 = formatSource("x=1\ny=2", "test.esp");
		expect(r1.ok).toBe(true);
		if (!r1.ok) return;
		const r2 = formatSource(r1.output, "test.esp");
		expect(r2.ok).toBe(true);
		if (r2.ok) expect(r2.output).toBe(r1.output);
	});
});
