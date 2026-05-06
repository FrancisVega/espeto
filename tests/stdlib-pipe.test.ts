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
