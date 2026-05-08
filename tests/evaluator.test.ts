import { describe, expect, it, vi } from "vitest";
import { CliUsageError } from "../src/cmd";
import { CmdRuntimeError } from "../src/evaluator";
import { run } from "../src/run";

function captureStdout(fn: () => void): string {
	const writes: string[] = [];
	const spy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk: unknown) => {
			writes.push(String(chunk));
			return true;
		});
	try {
		fn();
	} finally {
		spy.mockRestore();
	}
	return writes.join("");
}

describe("evaluator (milestone 1)", () => {
	it('runs `"hola" |> print`', () => {
		const out = captureStdout(() => run(`"hola" |> print`, "x.esp"));
		expect(out).toBe("hola\n");
	});

	it('runs direct call print("x")', () => {
		const out = captureStdout(() => run(`print("x")`, "x.esp"));
		expect(out).toBe("x\n");
	});

	it("returns null from a print", () => {
		const result = captureStdout(() => {
			expect(run(`"a" |> print`, "x.esp")).toBe(null);
		});
		expect(result).toBe("a\n");
	});

	it("evaluates the last expression of a multi-statement program", () => {
		const out = captureStdout(() => run(`"a" |> print\n"b" |> print`, "x.esp"));
		expect(out).toBe("a\nb\n");
	});

	it("throws on undefined identifier", () => {
		expect(() => run(`bogus`, "x.esp")).toThrow(/undefined: bogus/);
	});

	it("throws when print receives the wrong arity", () => {
		expect(() => run(`print("a", "b")`, "x.esp")).toThrow(
			/print: expected 1 args, got 2/,
		);
	});

	it("ignores comments at runtime", () => {
		const out = captureStdout(() =>
			run(`# leading comment\n"hi" |> print # trailing`, "x.esp"),
		);
		expect(out).toBe("hi\n");
	});
});

describe("evaluator: user-defined functions", () => {
	it("defines and calls a one-liner def", () => {
		const out = captureStdout(() =>
			run(`def shout(s) = s |> upcase\n"hola" |> shout |> print`, "x.esp"),
		);
		expect(out).toBe("HOLA\n");
	});

	it("supports forward references (call before def in source)", () => {
		const out = captureStdout(() =>
			run(`"hola" |> shout |> print\ndef shout(s) = s |> upcase`, "x.esp"),
		);
		expect(out).toBe("HOLA\n");
	});

	it("treats defp the same as def at runtime (privacy is for imports)", () => {
		const out = captureStdout(() =>
			run(`defp shout(s) = s |> upcase\n"hi" |> shout |> print`, "x.esp"),
		);
		expect(out).toBe("HI\n");
	});

	it("enforces arity on user fns", () => {
		expect(() => run(`def f(x) = x\nf("a", "b")`, "x.esp")).toThrow(
			/f: expected 1 args, got 2/,
		);
	});

	it("handles zero-arg user fn", () => {
		const out = captureStdout(() =>
			run(`def greeting() = "ahoj"\ngreeting() |> print`, "x.esp"),
		);
		expect(out).toBe("ahoj\n");
	});

	it("isolates parameter scope across user fns", () => {
		expect(() =>
			run(`def f(x) = x\ndef g(y) = x\ng("a") |> print`, "x.esp"),
		).toThrow(/undefined: x/);
	});

	it("def block returns last expression", () => {
		expect(run(`def f(x) do\n  x + 1\nend\nf(2)`, "x.esp")).toBe(3n);
	});

	it("undefined ident suggests close match", () => {
		expect(() => run(`def saludar(name) = name\nsaludo("ana")`, "x.esp")).toThrow(
			/undefined: saludo \(did you mean 'saludar'\?\)/,
		);
	});

	it("undefined ident with no close match has no hint", () => {
		expect(() => run(`xyz_abc_qqq`, "x.esp")).toThrow(
			/^(?!.*did you mean).*undefined: xyz_abc_qqq/s,
		);
	});

	it("def block allows local assignments visible inside", () => {
		const out = captureStdout(() =>
			run(
				`def saludar(name) do\n  greeting = "Hola, #{name}!"\n  upcase(greeting)\nend\nsaludar("ana") |> print`,
				"x.esp",
			),
		);
		expect(out).toBe("HOLA, ANA!\n");
	});

	it("def block local assigns do not leak to caller", () => {
		expect(() =>
			run(
				`def f() do\n  x = 1\n  x\nend\nf()\nprint(x)`,
				"x.esp",
			),
		).toThrow(/undefined: x/);
	});

	it("def block returns nil if last stmt is assign", () => {
		expect(run(`def f() do\n  x = 1\nend\nf()`, "x.esp")).toBe(null);
	});

	it("allows user fn to compose other user fns", () => {
		const out = captureStdout(() =>
			run(
				`def shout(s) = s |> upcase\ndef loud(s) = s |> shout\n"hi" |> loud |> print`,
				"x.esp",
			),
		);
		expect(out).toBe("HI\n");
	});

	it("does not leak user defs into the prelude env", () => {
		// First run: define `print` shadow at user level.
		// `print` redefinition stays scoped to its run; second run starts fresh.
		expect(() => run(`def print(s) = s\n"x" |> print`, "x.esp")).not.toThrow();
		const out = captureStdout(() => run(`"x" |> print`, "y.esp"));
		expect(out).toBe("x\n");
	});
});

describe("evaluator: literals (milestone 4a)", () => {
	it("evaluates a string with interpolation", () => {
		const out = captureStdout(() =>
			run(`name = "Mundo"\n"Hola, #{name}!" |> print`, "x.esp"),
		);
		expect(out).toBe("Hola, Mundo!\n");
	});

	it("interp coerces int to its string repr", () => {
		const out = captureStdout(() =>
			run(`n = 42\n"n=#{n}" |> print`, "x.esp"),
		);
		expect(out).toBe("n=42\n");
	});

	it("interp coerces float / bool / nil", () => {
		const out = captureStdout(() =>
			run(
				`"f=#{3.14} b=#{true} n=#{nil}" |> print`,
				"x.esp",
			),
		);
		expect(out).toBe("f=3.14 b=true n=nil\n");
	});

	it("supports nested interp with a call", () => {
		const out = captureStdout(() =>
			run(`name = "ana"\n"Hi #{upcase(name)}" |> print`, "x.esp"),
		);
		expect(out).toBe("Hi ANA\n");
	});

	it("preserves literal #{ when escaped", () => {
		const out = captureStdout(() => run(`"a \\#{b}" |> print`, "x.esp"));
		expect(out).toBe("a #{b}\n");
	});
});

describe("evaluator: assign (milestone 4a)", () => {
	it("binds a value and reads it back via pipe", () => {
		const out = captureStdout(() =>
			run(`s = "hola"\ns |> upcase |> print`, "x.esp"),
		);
		expect(out).toBe("HOLA\n");
	});

	it("rebinds an existing name (last write wins)", () => {
		const out = captureStdout(() =>
			run(`x = "first"\nx = "second"\nx |> print`, "x.esp"),
		);
		expect(out).toBe("second\n");
	});

	it("assign is sequential (no forward ref)", () => {
		expect(() => run(`y |> print\ny = "later"`, "x.esp")).toThrow(
			/undefined: y/,
		);
	});

	it("assign is not an expression (cannot be inside a call)", () => {
		expect(() => run(`print(x = 5)`, "x.esp")).toThrow();
	});
});

describe("evaluator: cmd execution (milestone 4b)", () => {
	const greet = `cmd hola do\n  arg name: str\n  flag loud: bool = false\n  "Hola, #{name}!" |> print\nend\n`;

	it("binds positional arg and runs body", () => {
		const out = captureStdout(() =>
			run(greet, "x.esp", { cmdArgv: ["Mundo"] }),
		);
		expect(out).toBe("Hola, Mundo!\n");
	});

	it("uses flag default when not provided", () => {
		const src = `cmd c do\n  flag n: int = 7\n  "n=#{n}" |> print\nend\n`;
		const out = captureStdout(() => run(src, "x.esp", { cmdArgv: [] }));
		expect(out).toBe("n=7\n");
	});

	it("uses provided flag overriding default", () => {
		const src = `cmd c do\n  flag n: int = 7\n  "n=#{n}" |> print\nend\n`;
		const out = captureStdout(() =>
			run(src, "x.esp", { cmdArgv: ["--n", "42"] }),
		);
		expect(out).toBe("n=42\n");
	});

	it("throws CliUsageError when required arg missing", () => {
		expect(() => run(greet, "x.esp", { cmdArgv: [] })).toThrow(CliUsageError);
	});

	it("auto-rescues body errors as CmdRuntimeError", () => {
		const src = `cmd c do\n  arg n: str\n  bogus |> print\nend\n`;
		expect(() => run(src, "x.esp", { cmdArgv: ["x"] })).toThrow(
			CmdRuntimeError,
		);
	});

	it("does not run cmd when cmdArgv is null", () => {
		const out = captureStdout(() => run(greet, "x.esp"));
		expect(out).toBe("");
	});

	it("--help prints help to stdout and returns null", () => {
		const out = captureStdout(() => {
			const r = run(greet, "x.esp", { cmdArgv: ["--help"] });
			expect(r).toBe(null);
		});
		expect(out).toContain("Usage: hola");
		expect(out).toContain("<name>");
		expect(out).toContain("--loud");
	});

	it("cmd body sees user defs (forward ref ok)", () => {
		const src = `cmd c do\n  arg n: str\n  greet(n) |> print\nend\ndef greet(s) = "Hi #{s}"\n`;
		const out = captureStdout(() => run(src, "x.esp", { cmdArgv: ["Ana"] }));
		expect(out).toBe("Hi Ana\n");
	});

	it("cmd body assigns work", () => {
		const src = `cmd c do\n  arg n: str\n  g = "Hola, #{n}!"\n  g |> print\nend\n`;
		const out = captureStdout(() => run(src, "x.esp", { cmdArgv: ["Sol"] }));
		expect(out).toBe("Hola, Sol!\n");
	});

	it("hola example: --loud applies upcase via when", () => {
		const src = `cmd hola do\n  arg name: str\n  flag loud: bool = false\n  greeting = "Hola, #{name}!"\n  greeting |> when(loud, upcase) |> print\nend\n`;
		const quiet = captureStdout(() =>
			run(src, "x.esp", { cmdArgv: ["Mundo"] }),
		);
		expect(quiet).toBe("Hola, Mundo!\n");
		const loud = captureStdout(() =>
			run(src, "x.esp", { cmdArgv: ["Mundo", "--loud"] }),
		);
		expect(loud).toBe("HOLA, MUNDO!\n");
	});
});

describe("evaluator: hito 7a — operators + if", () => {
	it("evaluates arithmetic with precedence", () => {
		expect(run(`1 + 2 * 3`, "x.esp")).toBe(7n);
		expect(run(`(1 + 2) * 3`, "x.esp")).toBe(9n);
	});

	it("evaluates left-assoc subtraction", () => {
		expect(run(`10 - 5 - 3`, "x.esp")).toBe(2n);
	});

	it("'/' produces a float (JS double)", () => {
		expect(run(`5 / 2`, "x.esp")).toBe(2.5);
	});

	it("rejects arithmetic on non-numbers", () => {
		expect(() => run(`1 + "x"`, "x.esp")).toThrow(/'\+' requires numbers/);
	});

	it("evaluates unary minus", () => {
		expect(run(`-5`, "x.esp")).toBe(-5n);
		expect(run(`- -5`, "x.esp")).toBe(5n);
	});

	it("rejects unary minus on non-number", () => {
		expect(() => run(`-"x"`, "x.esp")).toThrow(/unary '-' requires number/);
	});

	it("evaluates 'not'", () => {
		expect(run(`not true`, "x.esp")).toBe(false);
		expect(run(`not false`, "x.esp")).toBe(true);
	});

	it("rejects 'not' on non-bool", () => {
		expect(() => run(`not 5`, "x.esp")).toThrow(/'not' requires bool/);
	});

	it("evaluates comparisons on numbers", () => {
		expect(run(`1 < 2`, "x.esp")).toBe(true);
		expect(run(`2 <= 2`, "x.esp")).toBe(true);
		expect(run(`3 > 2`, "x.esp")).toBe(true);
		expect(run(`3 >= 4`, "x.esp")).toBe(false);
	});

	it("evaluates comparisons on strings (lex)", () => {
		expect(run(`"a" < "b"`, "x.esp")).toBe(true);
		expect(run(`"b" >= "a"`, "x.esp")).toBe(true);
	});

	it("rejects mixed-type comparisons", () => {
		expect(() => run(`1 < "x"`, "x.esp")).toThrow(/requires same numeric/);
	});

	it("evaluates structural '=='", () => {
		expect(run(`1 == 1`, "x.esp")).toBe(true);
		expect(run(`"a" == "a"`, "x.esp")).toBe(true);
		expect(run(`true == true`, "x.esp")).toBe(true);
		expect(run(`nil == nil`, "x.esp")).toBe(true);
		expect(run(`1 == "1"`, "x.esp")).toBe(false);
		expect(run(`true == 1`, "x.esp")).toBe(false);
		expect(run(`1 == 1.0`, "x.esp")).toBe(false);
	});

	it("rejects '==' on functions", () => {
		expect(() => run(`print == print`, "x.esp")).toThrow(
			/functions are not comparable/,
		);
	});

	it("evaluates 'and' / 'or' with short-circuit", () => {
		expect(run(`true and false`, "x.esp")).toBe(false);
		expect(run(`true or false`, "x.esp")).toBe(true);
		expect(run(`false and bogus`, "x.esp")).toBe(false);
		expect(run(`true or bogus`, "x.esp")).toBe(true);
	});

	it("rejects 'and' / 'or' on non-bool LHS", () => {
		expect(() => run(`5 and true`, "x.esp")).toThrow(/'and' requires bool/);
	});

	it("rejects 'and' / 'or' on non-bool RHS", () => {
		expect(() => run(`true and 5`, "x.esp")).toThrow(/'and' requires bool/);
	});

	it("evaluates if/else as expression", () => {
		expect(run(`if true do "a" else "b" end`, "x.esp")).toBe("a");
		expect(run(`if false do "a" else "b" end`, "x.esp")).toBe("b");
	});

	it("evaluates if without else as nil when false", () => {
		expect(run(`if false do "a" end`, "x.esp")).toBe(null);
	});

	it("evaluates else if chains", () => {
		const src = `if 5 < 1 do "x" else if 5 < 10 do "y" else "z" end`;
		expect(run(src, "x.esp")).toBe("y");
	});

	it("rejects if with non-bool condition", () => {
		expect(() => run(`if 5 do "x" end`, "x.esp")).toThrow(
			/if condition must be bool, got int/,
		);
	});

	it("if can be used as the value of an assign and then printed", () => {
		const out = captureStdout(() =>
			run(`m = if true do "yes" else "no" end\nm |> print`, "x.esp"),
		);
		expect(out).toBe("yes\n");
	});
});

describe("evaluator: hito 7a — div / mod", () => {
	it("div truncates toward zero", () => {
		expect(run(`div(7, 2)`, "x.esp")).toBe(3n);
		expect(run(`div(-7, 2)`, "x.esp")).toBe(-3n);
	});

	it("mod returns sign of the divisor (Elixir-style)", () => {
		expect(run(`mod(7, 3)`, "x.esp")).toBe(1n);
		expect(run(`mod(-1, 3)`, "x.esp")).toBe(2n);
	});

	it("rejects div by zero", () => {
		expect(() => run(`div(1, 0)`, "x.esp")).toThrow(/division by zero/);
	});

	it("rejects mod by zero", () => {
		expect(() => run(`mod(1, 0)`, "x.esp")).toThrow(/division by zero/);
	});

	it("div rejects non-int arguments", () => {
		expect(() => run(`div(1.5, 2)`, "x.esp")).toThrow(/dividend must be int/);
	});
});

describe("evaluator: hito 7b — lambdas", () => {
	it("lambda is a callable value", () => {
		const out = captureStdout(() =>
			run(`f = fn x => x\n"hi" |> f |> print`, "x.esp"),
		);
		expect(out).toBe("hi\n");
	});

	it("lambda body uses bound param", () => {
		expect(run(`(fn x => x + 1)(5)`, "x.esp")).toBe(6n);
	});

	it("multi-arg lambda", () => {
		expect(run(`(fn(a, b) => a + b)(2, 3)`, "x.esp")).toBe(5n);
	});

	it("zero-arg lambda (thunk)", () => {
		expect(run(`(fn() => 42)()`, "x.esp")).toBe(42n);
	});

	it("closure captures outer binding", () => {
		expect(run(`x = 10\nadd_x = fn n => n + x\nadd_x(5)`, "x.esp")).toBe(15n);
	});

	it("closure looks up bindings at call time (by reference)", () => {
		expect(
			run(
				`x = 10\nadd_x = fn n => n + x\nx = 99\nadd_x(5)`,
				"x.esp",
			),
		).toBe(104n);
	});

	it("rejects wrong arity at call site", () => {
		expect(() => run(`(fn x => x)(1, 2)`, "x.esp")).toThrow(
			/expected 1 args, got 2/,
		);
	});

	it("lambdas are not comparable with ==", () => {
		expect(() => run(`(fn x => x) == (fn x => x)`, "x.esp")).toThrow(
			/functions are not comparable/,
		);
	});
});

describe("evaluator: hito 7b — lists", () => {
	it("evaluates an empty list", () => {
		expect(run(`[]`, "x.esp")).toEqual([]);
	});

	it("evaluates list of literals", () => {
		expect(run(`[1, 2, 3]`, "x.esp")).toEqual([1n, 2n, 3n]);
	});

	it("evaluates list with computed values", () => {
		expect(run(`[1 + 1, 2 * 3]`, "x.esp")).toEqual([2n, 6n]);
	});

	it("nested lists", () => {
		expect(run(`[[1, 2], [3, 4]]`, "x.esp")).toEqual([
			[1n, 2n],
			[3n, 4n],
		]);
	});

	it("== deep on lists", () => {
		expect(run(`[1, 2, 3] == [1, 2, 3]`, "x.esp")).toBe(true);
		expect(run(`[1, 2] == [1, 2, 3]`, "x.esp")).toBe(false);
		expect(run(`[1, 2, 3] == [1, 2, 4]`, "x.esp")).toBe(false);
	});

	it("== distinguishes list from non-list", () => {
		expect(run(`[1] == 1`, "x.esp")).toBe(false);
		expect(run(`[] == nil`, "x.esp")).toBe(false);
	});

	it("== nested deep equality", () => {
		expect(run(`[[1, 2], [3]] == [[1, 2], [3]]`, "x.esp")).toBe(true);
		expect(run(`[[1, 2], [3]] == [[1, 2], [4]]`, "x.esp")).toBe(false);
	});

	it("interpolates list as repr", () => {
		const out = captureStdout(() =>
			run(`x = [1, 2, 3]\n"v=#{x}" |> print`, "x.esp"),
		);
		expect(out).toBe("v=[1, 2, 3]\n");
	});

	it("interpolates nested list", () => {
		const out = captureStdout(() =>
			run(`"#{[[1, 2], [3]]}" |> print`, "x.esp"),
		);
		expect(out).toBe("[[1, 2], [3]]\n");
	});
});

describe("evaluator: hito 7c — maps + .field", () => {
	it("evaluates an empty map", () => {
		expect(run(`{}`, "x.esp")).toEqual({ kind: "map", entries: {} });
	});

	it("evaluates a map literal", () => {
		expect(run(`{name: "ana", age: 30}`, "x.esp")).toEqual({
			kind: "map",
			entries: { name: "ana", age: 30n },
		});
	});

	it("evaluates map with computed values", () => {
		expect(run(`{a: 1 + 1, b: "x" |> upcase}`, "x.esp")).toEqual({
			kind: "map",
			entries: { a: 2n, b: "X" },
		});
	});

	it("evaluates field access on map", () => {
		expect(run(`{name: "ana"}.name`, "x.esp")).toBe("ana");
	});

	it("evaluates chained field access", () => {
		expect(run(`{u: {age: 30}}.u.age`, "x.esp")).toBe(30n);
	});

	it("throws when key not found", () => {
		expect(() => run(`{a: 1}.b`, "x.esp")).toThrow(/key not found: b/);
	});

	it("throws when target is not a map", () => {
		expect(() => run(`1.foo`, "x.esp")).toThrow(/'\.foo' requires map/);
	});

	it(".field shorthand applied directly to map", () => {
		expect(run(`{name: "ana"} |> .name`, "x.esp")).toBe("ana");
	});

	it(".field shorthand inside map(...)", () => {
		expect(
			run(`[{name: "a"}, {name: "b"}] |> map(.name)`, "x.esp"),
		).toEqual(["a", "b"]);
	});

	it(".field shorthand inside filter(...)", () => {
		expect(
			run(
				`[{age: 10}, {age: 20}, {age: 5}] |> filter(fn u => u.age > 9) |> map(.age)`,
				"x.esp",
			),
		).toEqual([10n, 20n]);
	});

	it("== deep on maps (key-order independent)", () => {
		expect(run(`{a: 1, b: 2} == {b: 2, a: 1}`, "x.esp")).toBe(true);
		expect(run(`{a: 1} == {a: 1, b: 2}`, "x.esp")).toBe(false);
		expect(run(`{a: 1} == {a: 2}`, "x.esp")).toBe(false);
	});

	it("== nested map deep equality", () => {
		expect(
			run(`{u: {age: 30}} == {u: {age: 30}}`, "x.esp"),
		).toBe(true);
		expect(
			run(`{u: {age: 30}} == {u: {age: 31}}`, "x.esp"),
		).toBe(false);
	});

	it("== distinguishes map from non-map", () => {
		expect(run(`{a: 1} == 1`, "x.esp")).toBe(false);
		expect(run(`{} == nil`, "x.esp")).toBe(false);
		expect(run(`{} == []`, "x.esp")).toBe(false);
	});

	it("interpolates map as repr", () => {
		const out = captureStdout(() =>
			run(`m = {a: 1, b: 2}\n"v=#{m}" |> print`, "x.esp"),
		);
		expect(out).toBe("v={a: 1, b: 2}\n");
	});

	it("rejects duplicate keys at parse time", () => {
		expect(() => run(`{a: 1, a: 2}`, "x.esp")).toThrow(
			/duplicate map key/,
		);
	});

	it("supports map literal inside string interpolation", () => {
		const out = captureStdout(() =>
			run(`"m=#{{a: 1}}" |> print`, "x.esp"),
		);
		expect(out).toBe("m={a: 1}\n");
	});
});

describe("evaluator: hito 8b — try / rescue / raise", () => {
	it("evaluates one-liner try with successful body", () => {
		const v = run(`try to_int("42") rescue err => 0`, "x.esp");
		expect(v).toBe(42n);
	});

	it("evaluates one-liner try and falls through to rescue", () => {
		const v = run(`try to_int("nope") rescue err => 0`, "x.esp");
		expect(v).toBe(0n);
	});

	it("binds the raised message to err as a string", () => {
		const v = run(`try to_int("nope") rescue err => err`, "x.esp");
		expect(v).toBe("to_int: cannot parse 'nope' as int");
	});

	it("raise(str) with rescue captures the message", () => {
		const v = run(`try raise("boom") rescue err => err`, "x.esp");
		expect(v).toBe("boom");
	});

	it("raise on a non-string argument is an error", () => {
		expect(() => run(`raise(42)`, "x.esp")).toThrow(
			/raise: expected str, got int/,
		);
	});

	it("evaluates try block with multi-stmt body and rescue body", () => {
		const v = run(
			`try do
  x = to_int("42")
  x + 1
rescue err do
  -1
end`,
			"x.esp",
		);
		expect(v).toBe(43n);
	});

	it("evaluates try block where body raises, returns rescue value", () => {
		const v = run(
			`try do
  x = to_int("oops")
  x + 1
rescue err do
  err |> upcase
end`,
			"x.esp",
		);
		expect(v).toBe("TO_INT: CANNOT PARSE 'OOPS' AS INT");
	});

	it("rescue body assigns scoped to rescueEnv (not leaked)", () => {
		expect(() =>
			run(
				`try raise("a") rescue err => err\nerr |> print`,
				"x.esp",
			),
		).toThrow(/undefined: err/);
	});

	it("nested try: inner rescue catches, outer ignored", () => {
		const v = run(
			`try (try raise("inner") rescue e => e) rescue e => "outer"`,
			"x.esp",
		);
		expect(v).toBe("inner");
	});

	it("nested try: inner re-raises, outer catches", () => {
		const v = run(
			`try (try raise("a") rescue e => raise("b")) rescue e => e`,
			"x.esp",
		);
		expect(v).toBe("b");
	});

	it("try inside a cmd body lets the cmd continue", () => {
		const out = captureStdout(() =>
			run(
				`cmd c do
  arg val: str
  n = try to_int(val) rescue err => 0
  "n=#{n}" |> print
end`,
				"x.esp",
				{ cmdArgv: ["pepino"] },
			),
		);
		expect(out).toBe("n=0\n");
	});

	it("uncaught raise inside cmd hits auto-rescue (CmdRuntimeError)", () => {
		expect(() =>
			run(
				`cmd c do
  raise("boom")
end`,
				"x.esp",
				{ cmdArgv: [] },
			),
		).toThrow(CmdRuntimeError);
	});

	it("rescue body sees outer bindings", () => {
		const v = run(
			`fallback = 99\ntry raise("x") rescue err => fallback`,
			"x.esp",
		);
		expect(v).toBe(99n);
	});
});
