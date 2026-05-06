import { describe, expect, it } from "vitest";
import { run } from "../src/run";

describe("stdlib/errors: raise", () => {
	it("raises a string and is catchable by try/rescue", () => {
		const v = run(`try raise("boom") rescue err => err`, "x.esp");
		expect(v).toBe("boom");
	});

	it("rejects non-string payload (int)", () => {
		expect(() => run(`raise(42)`, "x.esp")).toThrow(
			/raise: expected str, got int/,
		);
	});

	it("rejects non-string payload (nil)", () => {
		expect(() => run(`raise(nil)`, "x.esp")).toThrow(
			/raise: expected str, got nil/,
		);
	});

	it("rejects non-string payload (map)", () => {
		expect(() => run(`raise({a: 1})`, "x.esp")).toThrow(
			/raise: expected str, got map/,
		);
	});

	it("propagates uncaught raise as a runtime error", () => {
		expect(() => run(`raise("oops")`, "x.esp")).toThrow(/oops/);
	});
});

describe("stdlib/errors: try_to_int", () => {
	it("returns ok=true with bigint value when parse succeeds", () => {
		const v = run(`try_to_int("42")`, "x.esp");
		expect(v).toEqual({
			kind: "map",
			entries: { ok: true, value: 42n },
		});
	});

	it("returns ok=false with error message when parse fails", () => {
		const v = run(`try_to_int("nope")`, "x.esp") as unknown as {
			entries: { ok: boolean; error: string };
		};
		expect(v.entries.ok).toBe(false);
		expect(v.entries.error).toMatch(/cannot parse 'nope' as int/);
	});

	it("ok branch is consumable via .field access", () => {
		const v = run(
			`r = try_to_int("9")\nif r.ok do r.value else 0 end`,
			"x.esp",
		);
		expect(v).toBe(9n);
	});

	it("error branch is consumable via .field access", () => {
		const v = run(
			`r = try_to_int("nope")\nif r.ok do "won't run" else r.error end`,
			"x.esp",
		);
		expect(v).toMatch(/cannot parse 'nope' as int/);
	});
});

describe("stdlib/errors: try_to_float", () => {
	it("returns ok=true with float value when parse succeeds", () => {
		const v = run(`try_to_float("3.14")`, "x.esp");
		expect(v).toEqual({
			kind: "map",
			entries: { ok: true, value: 3.14 },
		});
	});

	it("returns ok=false on bad parse", () => {
		const v = run(`try_to_float("nope")`, "x.esp") as unknown as {
			entries: { ok: boolean };
		};
		expect(v.entries.ok).toBe(false);
	});
});
