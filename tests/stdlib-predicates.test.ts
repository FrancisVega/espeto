import { describe, expect, it } from "vitest";
import { run } from "../src/run";

describe("stdlib/predicates: is_int?", () => {
	it("true for int literals", () => {
		expect(run(`is_int?(42)`, "x.esp")).toBe(true);
		expect(run(`is_int?(0)`, "x.esp")).toBe(true);
		expect(run(`is_int?(-5)`, "x.esp")).toBe(true);
	});

	it("false for float literals with fractional part", () => {
		expect(run(`is_int?(1.5)`, "x.esp")).toBe(false);
	});

	it("false for non-numbers", () => {
		expect(run(`is_int?("x")`, "x.esp")).toBe(false);
		expect(run(`is_int?(true)`, "x.esp")).toBe(false);
		expect(run(`is_int?(nil)`, "x.esp")).toBe(false);
		expect(run(`is_int?([1])`, "x.esp")).toBe(false);
	});
});

describe("stdlib/predicates: is_float?", () => {
	it("true only for non-integer numbers", () => {
		expect(run(`is_float?(1.5)`, "x.esp")).toBe(true);
		expect(run(`is_float?(2)`, "x.esp")).toBe(false);
	});
});

describe("stdlib/predicates: is_str?", () => {
	it("true for strings", () => {
		expect(run(`is_str?("hi")`, "x.esp")).toBe(true);
		expect(run(`is_str?("")`, "x.esp")).toBe(true);
	});

	it("false for non-strings", () => {
		expect(run(`is_str?(1)`, "x.esp")).toBe(false);
		expect(run(`is_str?(nil)`, "x.esp")).toBe(false);
	});
});

describe("stdlib/predicates: is_bool?", () => {
	it("true for bool literals", () => {
		expect(run(`is_bool?(true)`, "x.esp")).toBe(true);
		expect(run(`is_bool?(false)`, "x.esp")).toBe(true);
	});

	it("false for non-bools", () => {
		expect(run(`is_bool?(1)`, "x.esp")).toBe(false);
		expect(run(`is_bool?("true")`, "x.esp")).toBe(false);
	});
});

describe("stdlib/predicates: is_nil?", () => {
	it("true only for nil", () => {
		expect(run(`is_nil?(nil)`, "x.esp")).toBe(true);
		expect(run(`is_nil?(0)`, "x.esp")).toBe(false);
		expect(run(`is_nil?("")`, "x.esp")).toBe(false);
		expect(run(`is_nil?(false)`, "x.esp")).toBe(false);
	});
});

describe("stdlib/predicates: is_list?", () => {
	it("true for lists", () => {
		expect(run(`is_list?([])`, "x.esp")).toBe(true);
		expect(run(`is_list?([1, 2])`, "x.esp")).toBe(true);
	});

	it("false for non-lists", () => {
		expect(run(`is_list?("x")`, "x.esp")).toBe(false);
		expect(run(`is_list?(1)`, "x.esp")).toBe(false);
		expect(run(`is_list?(nil)`, "x.esp")).toBe(false);
	});
});

describe("stdlib/predicates: is_fn?", () => {
	it("true for builtins", () => {
		expect(run(`is_fn?(upcase)`, "x.esp")).toBe(true);
	});

	it("true for lambdas", () => {
		expect(run(`is_fn?(fn x => x)`, "x.esp")).toBe(true);
	});

	it("true for user defs", () => {
		expect(
			run(`def grita(s) = s |> upcase\nis_fn?(grita)`, "x.esp"),
		).toBe(true);
	});

	it("false for non-fns", () => {
		expect(run(`is_fn?(1)`, "x.esp")).toBe(false);
		expect(run(`is_fn?("upcase")`, "x.esp")).toBe(false);
	});
});
