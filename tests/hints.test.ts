import { describe, expect, it } from "vitest";
import { findSimilar } from "../src/hints";

describe("findSimilar", () => {
	it("returns close match within default threshold", () => {
		expect(findSimilar("printr", ["print", "trim"])).toBe("print");
	});

	it("returns null when no candidate is close enough", () => {
		expect(findSimilar("xyzqqq", ["print", "trim"])).toBe(null);
	});

	it("scales threshold with target length (uppercase → upcase)", () => {
		expect(findSimilar("uppercase", ["upcase", "downcase"])).toBe("upcase");
	});

	it("ignores exact matches (target is not its own suggestion)", () => {
		expect(findSimilar("print", ["print", "trim"])).toBe(null);
	});

	it("picks closest among multiple candidates", () => {
		expect(findSimilar("upcse", ["upcase", "downcase"])).toBe("upcase");
	});

	it("respects explicit maxDist override", () => {
		// distance(uppercase, upcase) = 3; with maxDist=2 it should NOT match
		expect(findSimilar("uppercase", ["upcase"], 2)).toBe(null);
	});
});
