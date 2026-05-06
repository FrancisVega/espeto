import { describe, expect, it } from "vitest";
import { EspetoError, formatError } from "../src/errors";

describe("EspetoError", () => {
	it("carries span, source and message", () => {
		const err = new EspetoError(
			"oops",
			{ file: "x.esp", line: 1, col: 1, length: 1 },
			"x",
		);
		expect(err.message).toBe("oops");
		expect(err.span).toEqual({ file: "x.esp", line: 1, col: 1, length: 1 });
		expect(err.source).toBe("x");
		expect(err.name).toBe("EspetoError");
	});

	it("is an instance of Error", () => {
		const err = new EspetoError(
			"x",
			{ file: "x.esp", line: 1, col: 1, length: 1 },
			"",
		);
		expect(err).toBeInstanceOf(Error);
	});
});

describe("formatError", () => {
	it("formats header + line + caret under span", () => {
		const source = ["cmd hola do", "  arg name str", "end"].join("\n");
		const err = new EspetoError(
			"expected ':' before type",
			{ file: "hola.esp", line: 2, col: 12, length: 3 },
			source,
		);
		expect(formatError(err)).toBe(
			[
				"hola.esp:2:12: error: expected ':' before type",
				"2 |   arg name str",
				"  |            ^^^",
			].join("\n"),
		);
	});

	it("uses caret length 1 when span length is 0", () => {
		const err = new EspetoError(
			"unexpected EOF",
			{ file: "x.esp", line: 1, col: 4, length: 0 },
			"abc",
		);
		expect(formatError(err)).toBe(
			["x.esp:1:4: error: unexpected EOF", "1 | abc", "  |    ^"].join("\n"),
		);
	});

	it("aligns gutter width with multi-digit line numbers", () => {
		const source = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join(
			"\n",
		);
		const err = new EspetoError(
			"boom",
			{ file: "big.esp", line: 12, col: 1, length: 4 },
			source,
		);
		expect(formatError(err)).toBe(
			[
				"big.esp:12:1: error: boom",
				"12 | line 12",
				"   | ^^^^",
			].join("\n"),
		);
	});

	it("handles empty source line gracefully", () => {
		const err = new EspetoError(
			"missing token",
			{ file: "x.esp", line: 1, col: 1, length: 1 },
			"",
		);
		expect(formatError(err)).toBe(
			["x.esp:1:1: error: missing token", "1 | ", "  | ^"].join("\n"),
		);
	});

	it("includes call chain frames when present", () => {
		const err = new EspetoError(
			"boom",
			{ file: "lib.esp", line: 1, col: 5, length: 3 },
			"def f() = boom",
		);
		err.frames.push({
			name: "f",
			callSpan: { file: "main.esp", line: 2, col: 1, length: 3 },
			callerSource: "import\nf()",
		});
		expect(formatError(err)).toBe(
			[
				"lib.esp:1:5: error: boom",
				"1 | def f() = boom",
				"  |     ^^^",
				"  called from main.esp:2:1 in f",
				"2 | f()",
				"  | ^^^",
			].join("\n"),
		);
	});

	it("truncates frames beyond MAX_FRAMES with summary", () => {
		const err = new EspetoError(
			"x",
			{ file: "a.esp", line: 1, col: 1, length: 1 },
			"a",
		);
		for (let i = 0; i < 5; i++) {
			err.frames.push({
				name: `f${i}`,
				callSpan: { file: "a.esp", line: 1, col: 1, length: 1 },
				callerSource: "a",
			});
		}
		const out = formatError(err);
		expect(out).toMatch(/in f0/);
		expect(out).toMatch(/in f1/);
		expect(out).toMatch(/in f2/);
		expect(out).not.toMatch(/in f3/);
		expect(out).toMatch(/\.\.\. and 2 more frame\(s\)/);
	});
});

describe("formatError with color", () => {
	it("wraps error label and caret in ANSI when color: true", () => {
		const err = new EspetoError(
			"oops",
			{ file: "x.esp", line: 1, col: 1, length: 3 },
			"abc",
		);
		const out = formatError(err, { color: true });
		expect(out).toMatch(/\x1b\[31m\x1b\[1merror\x1b\[0m: oops/);
		expect(out).toContain("\x1b[31m\x1b[1m^^^\x1b[0m");
	});

	it("does not include any ANSI when color: false (default)", () => {
		const err = new EspetoError(
			"oops",
			{ file: "x.esp", line: 1, col: 1, length: 1 },
			"a",
		);
		const out = formatError(err);
		expect(out).not.toMatch(/\x1b\[/);
	});
});

describe("call chain capture", () => {
	it("captures frame when user fn errors", async () => {
		const { run } = await import("../src/run");
		try {
			run(`def f(x) = x + "z"\nf(1)\n`, "main.esp");
			throw new Error("expected error");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			const err = e as EspetoError;
			expect(err.frames.length).toBe(1);
			expect(err.frames[0]?.name).toBe("f");
			expect(err.frames[0]?.callSpan.line).toBe(2);
		}
	});

	it("captures multiple frames in nested user fns", async () => {
		const { run } = await import("../src/run");
		try {
			run(
				`def a(x) = x + "z"\ndef b(x) = a(x)\ndef c(x) = b(x)\nc(1)\n`,
				"main.esp",
			);
			throw new Error("expected error");
		} catch (e) {
			const err = e as EspetoError;
			expect(err.frames.map((f) => f.name)).toEqual(["a", "b", "c"]);
		}
	});
});
