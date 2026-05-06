import { describe, expect, it } from "vitest";
import { run } from "../src/run";

describe("stdlib/maps: keys", () => {
	it("returns keys in insertion order", () => {
		expect(run(`keys({b: 2, a: 1, c: 3})`, "x.esp")).toEqual(["b", "a", "c"]);
	});

	it("returns empty list for empty map", () => {
		expect(run(`keys({})`, "x.esp")).toEqual([]);
	});

	it("rejects non-map", () => {
		expect(() => run(`keys([1, 2])`, "x.esp")).toThrow(
			/keys: expected map/,
		);
	});
});

describe("stdlib/maps: values", () => {
	it("returns values in insertion order", () => {
		expect(run(`values({a: 1, b: 2})`, "x.esp")).toEqual([1n, 2n]);
	});

	it("rejects non-map", () => {
		expect(() => run(`values("x")`, "x.esp")).toThrow(
			/values: expected map/,
		);
	});
});

describe("stdlib/maps: get", () => {
	it("returns the value for a key", () => {
		expect(run(`get({name: "ana"}, "name")`, "x.esp")).toBe("ana");
	});

	it("throws when key missing", () => {
		expect(() => run(`get({a: 1}, "b")`, "x.esp")).toThrow(
			/get: key not found: b/,
		);
	});

	it("rejects non-map", () => {
		expect(() => run(`get([1, 2], "0")`, "x.esp")).toThrow(
			/get: expected map/,
		);
	});

	it("rejects non-str key", () => {
		expect(() => run(`get({a: 1}, 1)`, "x.esp")).toThrow(
			/get: key must be str/,
		);
	});
});

describe("stdlib/maps: get_or", () => {
	it("returns the value when present", () => {
		expect(run(`get_or({a: 1}, "a", 99)`, "x.esp")).toBe(1n);
	});

	it("returns the default when missing", () => {
		expect(run(`get_or({a: 1}, "b", 99)`, "x.esp")).toBe(99n);
	});

	it("default can be any value, including nil", () => {
		expect(run(`get_or({}, "x", nil)`, "x.esp")).toBe(null);
	});
});

describe("stdlib/maps: put", () => {
	it("returns a new map with the key set", () => {
		expect(run(`put({a: 1}, "b", 2)`, "x.esp")).toEqual({
			kind: "map",
			entries: { a: 1n, b: 2n },
		});
	});

	it("overwrites an existing key", () => {
		expect(run(`put({a: 1}, "a", 99)`, "x.esp")).toEqual({
			kind: "map",
			entries: { a: 99n },
		});
	});

	it("does not mutate original", () => {
		expect(
			run(`m = {a: 1}\nput(m, "b", 2)\nm`, "x.esp"),
		).toEqual({ kind: "map", entries: { a: 1n } });
	});
});

describe("stdlib/maps: delete", () => {
	it("removes a key", () => {
		expect(run(`delete({a: 1, b: 2}, "a")`, "x.esp")).toEqual({
			kind: "map",
			entries: { b: 2n },
		});
	});

	it("is a no-op when key is missing", () => {
		expect(run(`delete({a: 1}, "b")`, "x.esp")).toEqual({
			kind: "map",
			entries: { a: 1n },
		});
	});

	it("does not mutate original", () => {
		expect(
			run(`m = {a: 1, b: 2}\ndelete(m, "a")\nm`, "x.esp"),
		).toEqual({ kind: "map", entries: { a: 1n, b: 2n } });
	});
});

describe("stdlib/maps: has_key?", () => {
	it("true when key is present", () => {
		expect(run(`has_key?({a: 1}, "a")`, "x.esp")).toBe(true);
	});

	it("false when key is missing", () => {
		expect(run(`has_key?({a: 1}, "b")`, "x.esp")).toBe(false);
	});
});

describe("stdlib/maps: merge", () => {
	it("merges two maps", () => {
		expect(run(`merge({a: 1}, {b: 2})`, "x.esp")).toEqual({
			kind: "map",
			entries: { a: 1n, b: 2n },
		});
	});

	it("rhs overrides lhs", () => {
		expect(run(`merge({a: 1, b: 2}, {b: 99})`, "x.esp")).toEqual({
			kind: "map",
			entries: { a: 1n, b: 99n },
		});
	});

	it("merge with empty is identity", () => {
		expect(run(`merge({a: 1}, {})`, "x.esp")).toEqual({
			kind: "map",
			entries: { a: 1n },
		});
	});

	it("rejects non-map args", () => {
		expect(() => run(`merge({a: 1}, [1])`, "x.esp")).toThrow(
			/merge: expected map/,
		);
	});
});

describe("stdlib/maps: is_map?", () => {
	it("true for maps", () => {
		expect(run(`is_map?({a: 1})`, "x.esp")).toBe(true);
		expect(run(`is_map?({})`, "x.esp")).toBe(true);
	});

	it("false for non-maps", () => {
		expect(run(`is_map?([1, 2])`, "x.esp")).toBe(false);
		expect(run(`is_map?("x")`, "x.esp")).toBe(false);
		expect(run(`is_map?(1)`, "x.esp")).toBe(false);
		expect(run(`is_map?(nil)`, "x.esp")).toBe(false);
		expect(run(`is_map?(fn x => x)`, "x.esp")).toBe(false);
	});
});

describe("stdlib/lists: length on maps", () => {
	it("returns number of keys", () => {
		expect(run(`length({})`, "x.esp")).toBe(0n);
		expect(run(`length({a: 1, b: 2, c: 3})`, "x.esp")).toBe(3n);
	});
});

describe("stdlib/maps: pipe usage", () => {
	it("chains put / merge / get via pipe", () => {
		expect(
			run(
				`{a: 1} |> put("b", 2) |> merge({c: 3}) |> get("c")`,
				"x.esp",
			),
		).toBe(3n);
	});

	it("filter + map with .field on user-like records", () => {
		expect(
			run(
				`[{name: "a", age: 10}, {name: "b", age: 30}] |> filter(fn u => u.age > 18) |> map(.name)`,
				"x.esp",
			),
		).toEqual(["b"]);
	});
});
