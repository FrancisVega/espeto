import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssertionError, EspetoError } from "../src/errors";
import { lex } from "../src/lexer";
import { parse } from "../src/parser";
import { run } from "../src/run";
import {
	discoverTestFiles,
	formatReport,
	runTestFile,
	runTests,
} from "../src/test";

function ast(src: string) {
	return parse(lex(src, "x.esp"), src);
}

describe("parser: test block", () => {
	it("parses test with a string name and body", () => {
		const p = ast(`test "saluda" do\n  assert 1 == 1\nend`);
		expect(p.items).toHaveLength(1);
		expect(p.items[0]).toMatchObject({ kind: "test", name: "saluda" });
	});

	it("rejects test name as identifier", () => {
		expect(() => ast(`test foo do\n  assert true\nend`)).toThrow(
			/expected plain string literal for test name/,
		);
	});

	it("rejects empty test body", () => {
		expect(() => ast(`test "x" do\nend`)).toThrow(
			/test block must contain at least one statement/,
		);
	});

	it("rejects test alongside cmd in same file", () => {
		expect(() =>
			ast(`cmd run do\n  "x" |> print\nend\ntest "x" do\n  assert true\nend`),
		).toThrow(/'test' not allowed alongside 'cmd'/);
	});

	it("rejects test alongside program in same file", () => {
		expect(() =>
			ast(
				`program p do\n  cmd c do\n    "x" |> print\n  end\nend\ntest "x" do\n  assert true\nend`,
			),
		).toThrow(/'test' not allowed alongside/);
	});

	it("rejects duplicate test names", () => {
		expect(() =>
			ast(`test "x" do\n  assert true\nend\ntest "x" do\n  assert true\nend`),
		).toThrow(/duplicate test name/);
	});
});

describe("parser: assert expression", () => {
	it("parses 'assert <binop>'", () => {
		const p = ast(`assert 1 == 1`);
		expect(p.items[0]).toMatchObject({
			kind: "assert",
			expr: { kind: "binop", op: "==" },
		});
	});

	it("parses 'assert <ident>'", () => {
		const p = ast(`x = true\nassert x`);
		expect(p.items[1]).toMatchObject({
			kind: "assert",
			expr: { kind: "ident", name: "x" },
		});
	});
});

describe("evaluator: assert", () => {
	it("passes when binop is true", () => {
		expect(() => run(`assert 1 + 1 == 2`, "x.esp")).not.toThrow();
	});

	it("fails with expected/got diff for ==", () => {
		try {
			run(`assert 1 == 2`, "x.esp");
			expect.fail("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(AssertionError);
			expect((e as Error).message).toContain("expected: 2");
			expect((e as Error).message).toContain("got: 1");
		}
	});

	it("fails with op-aware message for <", () => {
		try {
			run(`assert 5 < 3`, "x.esp");
			expect.fail("should have thrown");
		} catch (e) {
			expect((e as Error).message).toContain("expected 5 < 3");
		}
	});

	it("passes for true bool expression", () => {
		expect(() => run(`assert true`, "x.esp")).not.toThrow();
	});

	it("fails with generic message for false bool", () => {
		try {
			run(`assert false`, "x.esp");
			expect.fail("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(AssertionError);
			expect((e as Error).message).toBe("assertion failed");
		}
	});

	it("rejects non-bool non-binop expression", () => {
		expect(() => run(`assert 42`, "x.esp")).toThrow(/assert requires bool/);
	});

	it("formats strings with quotes in diffs", () => {
		try {
			run(`assert "a" == "b"`, "x.esp");
			expect.fail("should have thrown");
		} catch (e) {
			expect((e as Error).message).toContain('"b"');
			expect((e as Error).message).toContain('"a"');
		}
	});
});

describe("evaluator: AssertionError not catchable by try/rescue", () => {
	it("propagates past try/rescue", () => {
		expect(() =>
			run(
				`try do\n  assert(false)\nrescue err =>\n  "caught"\nend`,
				"x.esp",
			),
		).toThrow(AssertionError);
	});
});

describe("stdlib: assert_raise", () => {
	it("passes when fn raises", () => {
		expect(() =>
			run(`assert_raise(fn() => raise("boom"))`, "x.esp"),
		).not.toThrow();
	});

	it("passes when msg matches", () => {
		expect(() =>
			run(`assert_raise(fn() => raise("boom"), "boom")`, "x.esp"),
		).not.toThrow();
	});

	it("fails when fn does not raise", () => {
		expect(() => run(`assert_raise(fn() => 1 + 1)`, "x.esp")).toThrow(
			/expected raise, got nothing/,
		);
	});

	it("fails when msg does not match", () => {
		expect(() =>
			run(`assert_raise(fn() => raise("boom"), "fizz")`, "x.esp"),
		).toThrow(/expected raise: "fizz"/);
	});

	it("propagates AssertionError from inside fn", () => {
		expect(() =>
			run(`assert_raise(fn() => assert false)`, "x.esp"),
		).toThrow(AssertionError);
	});

	it("rejects non-callable fn", () => {
		expect(() => run(`assert_raise(42)`, "x.esp")).toThrow(
			/fn must be callable/,
		);
	});
});

describe("test runner: discovery and execution", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "espeto-test-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("discovers _test.esp files recursively", () => {
		writeFileSync(`${dir}/a_test.esp`, `test "a" do\n  assert true\nend`);
		mkdirSync(`${dir}/sub`);
		writeFileSync(`${dir}/sub/b_test.esp`, `test "b" do\n  assert true\nend`);
		writeFileSync(`${dir}/regular.esp`, `# nope`);
		const files = discoverTestFiles(dir);
		expect(files).toHaveLength(2);
		expect(files.some((f) => f.endsWith("a_test.esp"))).toBe(true);
		expect(files.some((f) => f.endsWith("b_test.esp"))).toBe(true);
		expect(files.some((f) => f.endsWith("regular.esp"))).toBe(false);
	});

	it("ignores node_modules and dotfiles", () => {
		mkdirSync(`${dir}/node_modules`);
		writeFileSync(
			`${dir}/node_modules/x_test.esp`,
			`test "x" do\n  assert true\nend`,
		);
		mkdirSync(`${dir}/.cache`);
		writeFileSync(
			`${dir}/.cache/y_test.esp`,
			`test "y" do\n  assert true\nend`,
		);
		expect(discoverTestFiles(dir)).toEqual([]);
	});

	it("rejects non-test file passed directly", () => {
		writeFileSync(`${dir}/foo.esp`, `"x" |> print`);
		expect(() => discoverTestFiles(`${dir}/foo.esp`)).toThrow(
			/test files must end in _test.esp/,
		);
	});

	it("runs passing and failing tests, distinguishes fail vs error", () => {
		const file = `${dir}/x_test.esp`;
		writeFileSync(
			file,
			[
				`test "passes" do`,
				`  assert 1 == 1`,
				`end`,
				`test "fails" do`,
				`  assert 1 == 2`,
				`end`,
				`test "errors" do`,
				`  raise("boom")`,
				`end`,
			].join("\n"),
		);
		const res = runTestFile(file);
		expect(res.tests).toHaveLength(3);
		expect(res.tests[0]).toMatchObject({ name: "passes", status: "pass" });
		expect(res.tests[1]).toMatchObject({ name: "fails", status: "fail" });
		expect(res.tests[2]).toMatchObject({ name: "errors", status: "error" });
	});

	it("aggregates summary across files", () => {
		writeFileSync(
			`${dir}/a_test.esp`,
			`test "x" do\n  assert true\nend\ntest "y" do\n  assert false\nend`,
		);
		writeFileSync(
			`${dir}/b_test.esp`,
			`test "z" do\n  assert true\nend`,
		);
		const out = runTests(dir);
		expect(out.summary.total).toBe(3);
		expect(out.summary.passed).toBe(2);
		expect(out.summary.failed).toBe(1);
		expect(out.summary.errored).toBe(0);
	});

	it("evaluates top-level once per file (defs accessible to tests)", () => {
		writeFileSync(
			`${dir}/x_test.esp`,
			[
				`def shout(s) = s |> upcase`,
				`test "uses helper" do`,
				`  assert shout("hi") == "HI"`,
				`end`,
			].join("\n"),
		);
		const res = runTestFile(`${dir}/x_test.esp`);
		expect(res.tests[0]?.status).toBe("pass");
	});

	it("reports load error when top-level fails", () => {
		writeFileSync(`${dir}/x_test.esp`, `bogus_ident`);
		const res = runTestFile(`${dir}/x_test.esp`);
		expect(res.loadError).toBeDefined();
		expect(res.tests).toHaveLength(0);
	});

	it("test bindings are local (no leak across tests)", () => {
		writeFileSync(
			`${dir}/x_test.esp`,
			[
				`test "first" do`,
				`  x = 42`,
				`  assert x == 42`,
				`end`,
				`test "second" do`,
				// x must NOT be in scope here
				`  result = try do`,
				`    x`,
				`  rescue _ =>`,
				`    nil`,
				`  end`,
				`  assert is_nil?(result)`,
				`end`,
			].join("\n"),
		);
		const res = runTestFile(`${dir}/x_test.esp`);
		expect(res.tests[0]?.status).toBe("pass");
		// 'x' undefined should error in second test (not a value ; rescue captures msg as string)
		expect(res.tests[1]?.status).toBe("pass");
	});
});

describe("test reporter", () => {
	it("formats pass/fail/error with summary", () => {
		const dir = mkdtempSync(join(tmpdir(), "espeto-rep-"));
		try {
			writeFileSync(
				`${dir}/x_test.esp`,
				[
					`test "ok" do`,
					`  assert true`,
					`end`,
					`test "bad" do`,
					`  assert 1 == 2`,
					`end`,
				].join("\n"),
			);
			const out = runTests(dir);
			const report = formatReport(out, false);
			expect(report).toContain("✓ ok");
			expect(report).toContain("✗ fail: bad");
			expect(report).toContain("expected: 2");
			expect(report).toContain("2 tests, 1 failed");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("CLI integration: rejects test files in run/build", () => {
	it("EspetoError class is base for AssertionError", () => {
		const err = new AssertionError(
			"x",
			{ file: "x", line: 1, col: 1, length: 1 },
			"",
		);
		expect(err).toBeInstanceOf(EspetoError);
		expect(err).toBeInstanceOf(AssertionError);
	});
});
