import { describe, expect, it, vi } from "vitest";
import { Env } from "../src/env";
import { EspetoError } from "../src/errors";
import { inspectValue, replEval } from "../src/repl";
import { loadPrelude } from "../src/stdlib";

function freshEnv(): Env {
	const prelude = new Env();
	loadPrelude(prelude);
	return prelude.extend();
}

describe("replEval: classification", () => {
	it("returns empty for blank input", () => {
		expect(replEval(freshEnv(), "")).toEqual({ kind: "empty" });
	});

	it("returns empty for whitespace-only input", () => {
		expect(replEval(freshEnv(), "   \n\n  ")).toEqual({ kind: "empty" });
	});

	it("returns empty for comment-only input", () => {
		expect(replEval(freshEnv(), "# just a comment")).toEqual({ kind: "empty" });
	});

	it("classifies a string expression as value", () => {
		expect(replEval(freshEnv(), '"hi"')).toEqual({
			kind: "value",
			value: "hi",
		});
	});

	it("classifies an int expression as value", () => {
		expect(replEval(freshEnv(), "42")).toEqual({ kind: "value", value: 42n });
	});

	it("classifies an assign as binding (no value field)", () => {
		const env = freshEnv();
		const r = replEval(env, "x = 5");
		expect(r).toEqual({ kind: "binding", name: "x" });
		expect(env.lookup("x")).toBe(5n);
	});

	it("classifies a fn def as fn_def with names", () => {
		const env = freshEnv();
		const r = replEval(env, "def grita(s) = s |> upcase");
		expect(r).toEqual({ kind: "fn_def", names: ["grita"] });
	});

	it("classifies a cmd block as empty (skipped silently)", () => {
		const env = freshEnv();
		const r = replEval(env, "cmd hola do\n  arg name: str\n  name |> upcase\nend");
		expect(r).toEqual({ kind: "empty" });
	});

	it("uses last item to classify when input has multiple items", () => {
		expect(replEval(freshEnv(), 'x = 1\n"final"')).toEqual({
			kind: "value",
			value: "final",
		});
		expect(replEval(freshEnv(), '"hi"\nx = 5')).toEqual({
			kind: "binding",
			name: "x",
		});
		expect(replEval(freshEnv(), '"hi"\ndef f(x) = x')).toEqual({
			kind: "fn_def",
			names: ["f"],
		});
	});
});

describe("replEval: persistence across calls", () => {
	it("persists bindings", () => {
		const env = freshEnv();
		replEval(env, "x = 5");
		expect(replEval(env, "x")).toEqual({ kind: "value", value: 5n });
	});

	it("persists fn defs", () => {
		const env = freshEnv();
		replEval(env, "def grita(s) = s |> upcase");
		expect(replEval(env, 'grita("hi")')).toEqual({
			kind: "value",
			value: "HI",
		});
	});

	it("rebinds existing names", () => {
		const env = freshEnv();
		replEval(env, "x = 1");
		replEval(env, "x = 2");
		expect(replEval(env, "x")).toEqual({ kind: "value", value: 2n });
	});

	it("does not corrupt env when an evaluation fails", () => {
		const env = freshEnv();
		replEval(env, "x = 5");
		const failed = replEval(env, "undefined_var");
		expect(failed.kind).toBe("error");
		expect(replEval(env, "x")).toEqual({ kind: "value", value: 5n });
	});
});

describe("replEval: incomplete detection", () => {
	it("flags unterminated string as incomplete", () => {
		expect(replEval(freshEnv(), '"unfinished').kind).toBe("incomplete");
	});

	it("flags unterminated string template as incomplete", () => {
		expect(replEval(freshEnv(), '"hello #{x').kind).toBe("incomplete");
	});

	it("flags missing 'end' in cmd as incomplete", () => {
		expect(replEval(freshEnv(), "cmd hola do").kind).toBe("incomplete");
		expect(
			replEval(freshEnv(), "cmd hola do\n  arg name: str").kind,
		).toBe("incomplete");
	});

	it("flags incomplete def (eof after '=') as incomplete", () => {
		expect(replEval(freshEnv(), "def f(x) =").kind).toBe("incomplete");
	});

	it("flags trailing pipe (eof after '|>') as incomplete", () => {
		expect(replEval(freshEnv(), '"hi" |>').kind).toBe("incomplete");
	});

	it("flags missing 'end' in if as incomplete", () => {
		expect(replEval(freshEnv(), "if true do").kind).toBe("incomplete");
		expect(replEval(freshEnv(), "if true do\n  5").kind).toBe("incomplete");
	});

	it("completes a multi-line if/end across two inputs", () => {
		const env = freshEnv();
		expect(replEval(env, "if true do\n  5").kind).toBe("incomplete");
		expect(replEval(env, "if true do\n  5\nend")).toEqual({
			kind: "value",
			value: 5n,
		});
	});

	it("flags missing 'rescue' in try block as incomplete", () => {
		expect(replEval(freshEnv(), "try do\n  1").kind).toBe("incomplete");
	});

	it("flags missing 'end' in try block as incomplete", () => {
		expect(
			replEval(freshEnv(), "try do\n  1\nrescue err =>\n  2").kind,
		).toBe("incomplete");
	});

	it("completes a multi-line try block across two inputs", () => {
		const env = freshEnv();
		expect(
			replEval(env, "try do\n  raise(\"x\")\nrescue err =>\n  err").kind,
		).toBe("incomplete");
		expect(
			replEval(env, "try do\n  raise(\"x\")\nrescue err =>\n  err\nend"),
		).toEqual({ kind: "value", value: "x" });
	});

	it("does NOT flag valid input as incomplete", () => {
		expect(replEval(freshEnv(), '"hi"').kind).toBe("value");
	});

	it("does NOT flag genuine syntax error as incomplete", () => {
		expect(replEval(freshEnv(), "1 = 2").kind).toBe("error");
	});

	it("completes after appending the missing closer", () => {
		const env = freshEnv();
		expect(replEval(env, '"hello').kind).toBe("incomplete");
		expect(replEval(env, '"hello"')).toEqual({ kind: "value", value: "hello" });
	});
});

describe("replEval: error reporting", () => {
	it("returns error for undefined ident", () => {
		const r = replEval(freshEnv(), "missing_var");
		expect(r.kind).toBe("error");
		if (r.kind === "error") {
			expect(r.error).toBeInstanceOf(EspetoError);
			expect((r.error as EspetoError).message).toBe("undefined: missing_var");
		}
	});

	it("returns error for wrong-arity call", () => {
		const r = replEval(freshEnv(), "upcase()");
		expect(r.kind).toBe("error");
	});
});

describe("replEval: imports forbidden (D7)", () => {
	it("returns an error when input contains an import", () => {
		const r = replEval(freshEnv(), 'import "./fmt"');
		expect(r.kind).toBe("error");
		if (r.kind === "error") {
			expect(r.error).toBeInstanceOf(EspetoError);
			expect((r.error as EspetoError).message).toBe(
				"import not supported in REPL — use ':load' (coming soon) or run a script with 'espeto run'",
			);
		}
	});

	it("rejects import even when followed by other items", () => {
		const r = replEval(freshEnv(), 'import "./fmt"\n"hi"');
		expect(r.kind).toBe("error");
		if (r.kind === "error") {
			expect((r.error as EspetoError).message).toMatch(
				/import not supported in REPL/,
			);
		}
	});

	it("env is not corrupted by a rejected import line", () => {
		const env = freshEnv();
		replEval(env, "x = 5");
		const r = replEval(env, 'import "./x"');
		expect(r.kind).toBe("error");
		expect(replEval(env, "x")).toEqual({ kind: "value", value: 5n });
	});
});

describe("replEval: side effects", () => {
	it("runs print() side effects via the prelude", () => {
		const writes: string[] = [];
		const spy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk: unknown) => {
				writes.push(String(chunk));
				return true;
			});
		try {
			const r = replEval(freshEnv(), '"hi" |> print');
			expect(r).toEqual({ kind: "value", value: null });
			expect(writes.join("")).toBe("hi\n");
		} finally {
			spy.mockRestore();
		}
	});
});

describe("inspectValue", () => {
	it("renders nil", () => {
		expect(inspectValue(null)).toBe("nil");
	});

	it("quotes strings", () => {
		expect(inspectValue("hi")).toBe('"hi"');
		expect(inspectValue('with "quotes"')).toBe('"with \\"quotes\\""');
	});

	it("renders numbers without quotes", () => {
		expect(inspectValue(42n)).toBe("42");
		expect(inspectValue(3.14)).toBe("3.14");
		expect(inspectValue(1.0)).toBe("1.0");
	});

	it("renders bools as keywords", () => {
		expect(inspectValue(true)).toBe("true");
		expect(inspectValue(false)).toBe("false");
	});

	it("renders fns with the #fn<name> sigil", () => {
		const env = freshEnv();
		const upcase = env.lookup("upcase");
		expect(upcase).toBeDefined();
		expect(inspectValue(upcase!)).toBe("#fn<upcase>");
	});
});
