import { describe, expect, it } from "vitest";
import { run } from "../src/run";

describe("stdlib/numbers: abs", () => {
	it("returns int for int", () => {
		expect(run(`abs(-3)`, "x.esp")).toBe(3n);
		expect(run(`abs(3)`, "x.esp")).toBe(3n);
		expect(run(`abs(0)`, "x.esp")).toBe(0n);
	});

	it("returns float for float", () => {
		expect(run(`abs(-1.5)`, "x.esp")).toBe(1.5);
		expect(run(`abs(0.0)`, "x.esp")).toBe(0);
	});

	it("rejects non-number", () => {
		expect(() => run(`abs("x")`, "x.esp")).toThrow(/abs: expected number/);
	});
});

describe("stdlib/numbers: round / floor / ceil", () => {
	it("round rounds half-up to int", () => {
		expect(run(`round(1.5)`, "x.esp")).toBe(2n);
		expect(run(`round(-1.5)`, "x.esp")).toBe(-1n);
		expect(run(`round(1.4)`, "x.esp")).toBe(1n);
	});

	it("floor truncates toward -infinity", () => {
		expect(run(`floor(1.9)`, "x.esp")).toBe(1n);
		expect(run(`floor(-1.1)`, "x.esp")).toBe(-2n);
	});

	it("ceil truncates toward +infinity", () => {
		expect(run(`ceil(1.1)`, "x.esp")).toBe(2n);
		expect(run(`ceil(-1.9)`, "x.esp")).toBe(-1n);
	});

	it("round/floor/ceil on int are identity", () => {
		expect(run(`round(3)`, "x.esp")).toBe(3n);
		expect(run(`floor(3)`, "x.esp")).toBe(3n);
		expect(run(`ceil(3)`, "x.esp")).toBe(3n);
	});

	it("rejects non-number", () => {
		expect(() => run(`round("x")`, "x.esp")).toThrow(/round: expected number/);
	});
});

describe("stdlib/numbers: min / max", () => {
	it("picks the lesser of two ints", () => {
		expect(run(`min(3, 7)`, "x.esp")).toBe(3n);
		expect(run(`min(-1, 0)`, "x.esp")).toBe(-1n);
	});

	it("picks the greater of two ints", () => {
		expect(run(`max(3, 7)`, "x.esp")).toBe(7n);
	});

	it("works on floats", () => {
		expect(run(`min(1.5, 2.5)`, "x.esp")).toBe(1.5);
		expect(run(`max(1.5, 2.5)`, "x.esp")).toBe(2.5);
	});

	it("rejects mixed numeric types", () => {
		expect(() => run(`min(1, 1.0)`, "x.esp")).toThrow(
			/min: requires same numeric type/,
		);
	});
});

describe("stdlib/numbers: to_int", () => {
	it("identity on int", () => {
		expect(run(`to_int(42)`, "x.esp")).toBe(42n);
	});

	it("truncates float toward zero", () => {
		expect(run(`to_int(1.5)`, "x.esp")).toBe(1n);
		expect(run(`to_int(-1.5)`, "x.esp")).toBe(-1n);
		expect(run(`to_int(1.9)`, "x.esp")).toBe(1n);
	});

	it("parses int strings", () => {
		expect(run(`to_int("42")`, "x.esp")).toBe(42n);
		expect(run(`to_int("-7")`, "x.esp")).toBe(-7n);
	});

	it("rejects non-int strings", () => {
		expect(() => run(`to_int("1.5")`, "x.esp")).toThrow(
			/cannot parse '1.5' as int/,
		);
		expect(() => run(`to_int("abc")`, "x.esp")).toThrow(
			/cannot parse 'abc' as int/,
		);
	});

	it("rejects bool / nil / list", () => {
		expect(() => run(`to_int(true)`, "x.esp")).toThrow(/to_int: expected/);
		expect(() => run(`to_int(nil)`, "x.esp")).toThrow(/to_int: expected/);
	});
});

describe("stdlib/numbers: to_float", () => {
	it("identity on float", () => {
		expect(run(`to_float(1.5)`, "x.esp")).toBe(1.5);
	});

	it("converts int to float", () => {
		expect(run(`to_float(42)`, "x.esp")).toBe(42);
	});

	it("parses float strings", () => {
		expect(run(`to_float("1.5")`, "x.esp")).toBe(1.5);
		expect(run(`to_float("42")`, "x.esp")).toBe(42);
	});

	it("rejects non-numeric strings", () => {
		expect(() => run(`to_float("abc")`, "x.esp")).toThrow(
			/cannot parse 'abc' as float/,
		);
	});
});

describe("stdlib/numbers: to_str", () => {
	it("renders ints", () => {
		expect(run(`to_str(42)`, "x.esp")).toBe("42");
		expect(run(`to_str(-7)`, "x.esp")).toBe("-7");
	});

	it("renders floats with .0", () => {
		expect(run(`to_str(1.0)`, "x.esp")).toBe("1.0");
		expect(run(`to_str(1.5)`, "x.esp")).toBe("1.5");
	});

	it("renders bool / nil", () => {
		expect(run(`to_str(true)`, "x.esp")).toBe("true");
		expect(run(`to_str(false)`, "x.esp")).toBe("false");
		expect(run(`to_str(nil)`, "x.esp")).toBe("nil");
	});

	it("renders strings without quotes (interp-aligned)", () => {
		expect(run(`to_str("hi")`, "x.esp")).toBe("hi");
	});

	it("renders lists and maps recursively", () => {
		expect(run(`to_str([1, 2, 3])`, "x.esp")).toBe("[1, 2, 3]");
		expect(run(`to_str({a: 1, b: 2})`, "x.esp")).toBe("{a: 1, b: 2}");
	});
});

describe("evaluator: hito 8a — int/float strict arithmetic", () => {
	it("int + int → int", () => {
		expect(run(`1 + 2`, "x.esp")).toBe(3n);
	});

	it("float + float → float", () => {
		expect(run(`1.5 + 2.5`, "x.esp")).toBe(4);
	});

	it("int + float → error", () => {
		expect(() => run(`1 + 1.0`, "x.esp")).toThrow(
			/'\+' requires same numeric type/,
		);
	});

	it("float - int → error", () => {
		expect(() => run(`1.0 - 1`, "x.esp")).toThrow(
			/'\-' requires same numeric type/,
		);
	});

	it("/ always returns float", () => {
		expect(run(`5 / 2`, "x.esp")).toBe(2.5);
		expect(run(`5.0 / 2.0`, "x.esp")).toBe(2.5);
		expect(run(`5 / 2.0`, "x.esp")).toBe(2.5);
		expect(run(`5.0 / 2`, "x.esp")).toBe(2.5);
	});

	it("int < float → error", () => {
		expect(() => run(`1 < 1.0`, "x.esp")).toThrow(/requires same numeric/);
	});

	it("int == float → false (no coerce)", () => {
		expect(run(`1 == 1.0`, "x.esp")).toBe(false);
		expect(run(`0 == 0.0`, "x.esp")).toBe(false);
	});

	it("typeName distinguishes int and float", () => {
		expect(() => run(`1 + "x"`, "x.esp")).toThrow(/got int and str/);
		expect(() => run(`1.0 + "x"`, "x.esp")).toThrow(/got float and str/);
	});

	it("unary minus preserves type", () => {
		expect(run(`-5`, "x.esp")).toBe(-5n);
		expect(run(`-5.0`, "x.esp")).toBe(-5);
	});
});

describe("evaluator: hito 8a — interp / repr", () => {
	it("int interp without dot", () => {
		expect(run(`"#{1}"`, "x.esp")).toBe("1");
		expect(run(`"#{42}"`, "x.esp")).toBe("42");
	});

	it("float interp always shows .0 minimum", () => {
		expect(run(`"#{1.0}"`, "x.esp")).toBe("1.0");
		expect(run(`"#{1.5}"`, "x.esp")).toBe("1.5");
		expect(run(`"#{0.0}"`, "x.esp")).toBe("0.0");
	});
});

describe("stdlib/predicates: hito 8a updates", () => {
	it("is_int? true only for bigint (not for float 1.0)", () => {
		expect(run(`is_int?(1)`, "x.esp")).toBe(true);
		expect(run(`is_int?(1.0)`, "x.esp")).toBe(false);
		expect(run(`is_int?(1.5)`, "x.esp")).toBe(false);
	});

	it("is_float? true only for number (not for int)", () => {
		expect(run(`is_float?(1.0)`, "x.esp")).toBe(true);
		expect(run(`is_float?(1.5)`, "x.esp")).toBe(true);
		expect(run(`is_float?(1)`, "x.esp")).toBe(false);
	});
});
