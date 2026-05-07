import { describe, expect, it, vi } from "vitest";
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

describe("stdlib: when", () => {
	it("applies fn when cond is true", () => {
		const out = captureStdout(() =>
			run(`"hi" |> when(true, upcase) |> print`, "x.esp"),
		);
		expect(out).toBe("HI\n");
	});

	it("returns value unchanged when cond is false", () => {
		const out = captureStdout(() =>
			run(`"hi" |> when(false, upcase) |> print`, "x.esp"),
		);
		expect(out).toBe("hi\n");
	});

	it("works with a userfn as fn arg", () => {
		const out = captureStdout(() =>
			run(
				`def shout(s) = s |> upcase\n"hi" |> when(true, shout) |> print`,
				"x.esp",
			),
		);
		expect(out).toBe("HI\n");
	});

	it("rejects non-bool cond", () => {
		expect(() => run(`"hi" |> when("yes", upcase)`, "x.esp")).toThrow(
			/when: cond must be bool/,
		);
	});

	it("rejects non-callable fn", () => {
		expect(() => run(`"hi" |> when(true, "upcase")`, "x.esp")).toThrow(
			/when: fn must be callable/,
		);
	});

	it("enforces 3-arg arity", () => {
		expect(() => run(`when("hi", true)`, "x.esp")).toThrow(
			/when: expected 3 args/,
		);
	});
});

describe("stdlib: unless", () => {
	it("applies fn when cond is false", () => {
		const out = captureStdout(() =>
			run(`"hi" |> unless(false, upcase) |> print`, "x.esp"),
		);
		expect(out).toBe("HI\n");
	});

	it("returns value unchanged when cond is true", () => {
		const out = captureStdout(() =>
			run(`"hi" |> unless(true, upcase) |> print`, "x.esp"),
		);
		expect(out).toBe("hi\n");
	});

	it("rejects non-bool cond", () => {
		expect(() => run(`"hi" |> unless(nil, upcase)`, "x.esp")).toThrow(
			/unless: cond must be bool/,
		);
	});
});

describe("stdlib: id", () => {
	it("returns its argument", () => {
		const out = captureStdout(() => run(`"hi" |> id |> print`, "x.esp"));
		expect(out).toBe("hi\n");
	});

	it("works in pipes as a no-op", () => {
		const out = captureStdout(() =>
			run(`"hi" |> id |> upcase |> print`, "x.esp"),
		);
		expect(out).toBe("HI\n");
	});
});

describe("pipe placeholder '_'", () => {
	it("substitutes _ at the requested position", () => {
		const out = captureStdout(() =>
			run(`6 |> div(30, _) |> print`, "x.esp"),
		);
		expect(out).toBe("5\n");
	});

	it("falls back to first-arg injection when no _ is present", () => {
		const out = captureStdout(() =>
			run(`"hello" |> replace("l", "L") |> print`, "x.esp"),
		);
		expect(out).toBe("heLLo\n");
	});

	it("works when _ is the middle arg of a 3-arg call", () => {
		const out = captureStdout(() =>
			run(`"l" |> replace("hello", _, "L") |> print`, "x.esp"),
		);
		expect(out).toBe("heLLo\n");
	});

	it("errors when _ appears more than once", () => {
		expect(() => run(`6 |> div(_, _)`, "x.esp")).toThrow(
			/pipe placeholder '_' may appear at most once per call/,
		);
	});

	it("treats _ outside a piped call as a normal undefined ident", () => {
		expect(() => run(`div(30, _)`, "x.esp")).toThrow(/undefined: _/);
	});
});
