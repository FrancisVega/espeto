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

describe("stdlib/lists: length", () => {
	it("returns string length", () => {
		expect(run(`length("hola")`, "x.esp")).toBe(4n);
	});

	it("returns list length", () => {
		expect(run(`length([1, 2, 3])`, "x.esp")).toBe(3n);
	});

	it("returns 0 for empty list/string", () => {
		expect(run(`length([])`, "x.esp")).toBe(0n);
		expect(run(`length("")`, "x.esp")).toBe(0n);
	});

	it("rejects non-str/list/map", () => {
		expect(() => run(`length(1)`, "x.esp")).toThrow(
			/length: expected str, list or map/,
		);
	});
});

describe("stdlib/lists: head", () => {
	it("returns first element", () => {
		expect(run(`head([1, 2, 3])`, "x.esp")).toBe(1n);
	});

	it("rejects empty list", () => {
		expect(() => run(`head([])`, "x.esp")).toThrow(/head: empty list/);
	});

	it("rejects non-list", () => {
		expect(() => run(`head("x")`, "x.esp")).toThrow(
			/head: expected list, got str/,
		);
	});
});

describe("stdlib/lists: tail", () => {
	it("returns rest after first", () => {
		expect(run(`tail([1, 2, 3])`, "x.esp")).toEqual([2n, 3n]);
	});

	it("returns empty list when only one element", () => {
		expect(run(`tail([1])`, "x.esp")).toEqual([]);
	});

	it("rejects empty list", () => {
		expect(() => run(`tail([])`, "x.esp")).toThrow(/tail: empty list/);
	});
});

describe("stdlib/lists: map", () => {
	it("applies fn to every element", () => {
		expect(run(`map([1, 2, 3], fn n => n * 2)`, "x.esp")).toEqual([
			2n,
			4n,
			6n,
		]);
	});

	it("works in pipe form", () => {
		expect(run(`[1, 2, 3] |> map(fn n => n + 10)`, "x.esp")).toEqual([
			11n,
			12n,
			13n,
		]);
	});

	it("returns empty list for empty input", () => {
		expect(run(`map([], fn x => x)`, "x.esp")).toEqual([]);
	});

	it("rejects non-list first arg", () => {
		expect(() => run(`map("hi", fn x => x)`, "x.esp")).toThrow(
			/map: expected list/,
		);
	});

	it("rejects non-callable second arg", () => {
		expect(() => run(`map([1, 2], "x")`, "x.esp")).toThrow(
			/map: fn must be callable/,
		);
	});
});

describe("stdlib/lists: filter", () => {
	it("keeps elements where pred is true", () => {
		expect(run(`filter([1, 2, 3, 4], fn n => n > 2)`, "x.esp")).toEqual([
			3n,
			4n,
		]);
	});

	it("returns empty list when nothing matches", () => {
		expect(run(`filter([1, 2], fn n => n > 100)`, "x.esp")).toEqual([]);
	});

	it("rejects non-bool predicate result", () => {
		expect(() => run(`filter([1, 2], fn n => n)`, "x.esp")).toThrow(
			/filter: predicate must return bool/,
		);
	});
});

describe("stdlib/lists: reduce", () => {
	it("folds left with initial accumulator", () => {
		expect(
			run(`reduce([1, 2, 3, 4], 0, fn(acc, n) => acc + n)`, "x.esp"),
		).toBe(10n);
	});

	it("returns initial when list is empty", () => {
		expect(run(`reduce([], 7, fn(acc, n) => acc + n)`, "x.esp")).toBe(7n);
	});

	it("works in pipe form", () => {
		expect(
			run(`[1, 2, 3] |> reduce(1, fn(acc, n) => acc * n)`, "x.esp"),
		).toBe(6n);
	});
});

describe("stdlib/lists: each", () => {
	it("calls fn for side-effect, returns nil", () => {
		const out = captureStdout(() =>
			run(`each([1, 2, 3], fn n => "n=#{n}" |> print)`, "x.esp"),
		);
		expect(out).toBe("n=1\nn=2\nn=3\n");
	});

	it("each returns nil", () => {
		expect(
			run(`each([1, 2], fn n => n)`, "x.esp"),
		).toBe(null);
	});
});

describe("stdlib/lists: concat", () => {
	it("concatenates two lists", () => {
		expect(run(`concat([1, 2], [3, 4])`, "x.esp")).toEqual([1n, 2n, 3n, 4n]);
	});

	it("works with empty lists", () => {
		expect(run(`concat([], [1])`, "x.esp")).toEqual([1n]);
		expect(run(`concat([1], [])`, "x.esp")).toEqual([1n]);
		expect(run(`concat([], [])`, "x.esp")).toEqual([]);
	});

	it("works in pipe form", () => {
		expect(run(`[1, 2] |> concat([3])`, "x.esp")).toEqual([1n, 2n, 3n]);
	});

	it("rejects non-list arg", () => {
		expect(() => run(`concat("a", [1])`, "x.esp")).toThrow(
			/concat: first must be list, got str/,
		);
	});
});

describe("stdlib/lists: reverse", () => {
	it("reverses a list", () => {
		expect(run(`reverse([1, 2, 3])`, "x.esp")).toEqual([3n, 2n, 1n]);
	});

	it("returns empty for empty input", () => {
		expect(run(`reverse([])`, "x.esp")).toEqual([]);
	});

	it("does not mutate original (rebind safe)", () => {
		expect(
			run(`xs = [1, 2, 3]
ys = reverse(xs)
xs`, "x.esp"),
		).toEqual([1n, 2n, 3n]);
	});

	it("rejects non-list", () => {
		expect(() => run(`reverse("hi")`, "x.esp")).toThrow(
			/reverse: arg must be list, got str/,
		);
	});
});

describe("stdlib/lists: take", () => {
	it("takes first n elements", () => {
		expect(run(`take([1, 2, 3, 4], 2)`, "x.esp")).toEqual([1n, 2n]);
	});

	it("clamps to list length", () => {
		expect(run(`take([1, 2], 5)`, "x.esp")).toEqual([1n, 2n]);
	});

	it("take(0) returns empty", () => {
		expect(run(`take([1, 2], 0)`, "x.esp")).toEqual([]);
	});

	it("rejects negative n", () => {
		expect(() => run(`take([1], -1)`, "x.esp")).toThrow(
			/take: n must be non-negative/,
		);
	});
});

describe("stdlib/lists: drop", () => {
	it("drops first n elements", () => {
		expect(run(`drop([1, 2, 3, 4], 2)`, "x.esp")).toEqual([3n, 4n]);
	});

	it("returns empty when n exceeds length", () => {
		expect(run(`drop([1, 2], 5)`, "x.esp")).toEqual([]);
	});

	it("drop(0) returns full list", () => {
		expect(run(`drop([1, 2], 0)`, "x.esp")).toEqual([1n, 2n]);
	});

	it("rejects negative n", () => {
		expect(() => run(`drop([1], -1)`, "x.esp")).toThrow(
			/drop: n must be non-negative/,
		);
	});
});

describe("stdlib/lists: find", () => {
	it("returns first matching element", () => {
		expect(run(`find([1, 2, 3, 4], fn n => n > 2)`, "x.esp")).toBe(3n);
	});

	it("returns nil when nothing matches", () => {
		expect(run(`find([1, 2], fn n => n > 100)`, "x.esp")).toBe(null);
	});

	it("returns nil for empty list", () => {
		expect(run(`find([], fn n => true)`, "x.esp")).toBe(null);
	});

	it("works in pipe form", () => {
		expect(
			run(`["abc", "x", "yz"] |> find(fn s => length(s) == 2)`, "x.esp"),
		).toBe("yz");
	});

	it("rejects non-bool predicate", () => {
		expect(() => run(`find([1], fn n => n)`, "x.esp")).toThrow(
			/find: predicate must return bool/,
		);
	});
});

describe("stdlib/lists: sort", () => {
	it("sorts ints ascending", () => {
		expect(run(`sort([3, 1, 4, 1, 5, 9, 2, 6])`, "x.esp")).toEqual([
			1n, 1n, 2n, 3n, 4n, 5n, 6n, 9n,
		]);
	});

	it("sorts strings lexically", () => {
		expect(run(`sort(["c", "a", "b"])`, "x.esp")).toEqual(["a", "b", "c"]);
	});

	it("sorts floats", () => {
		expect(run(`sort([2.5, 1.1, 3.0])`, "x.esp")).toEqual([1.1, 2.5, 3.0]);
	});

	it("returns empty for empty list", () => {
		expect(run(`sort([])`, "x.esp")).toEqual([]);
	});

	it("rejects mixed types", () => {
		expect(() => run(`sort([1, "a"])`, "x.esp")).toThrow(
			/sort: cannot compare/,
		);
	});

	it("rejects mixed numeric types (no implicit coercion)", () => {
		expect(() => run(`sort([1, 1.0])`, "x.esp")).toThrow(
			/sort: cannot compare/,
		);
	});
});

describe("stdlib/lists: sort_by", () => {
	it("sorts by key function", () => {
		expect(
			run(`sort_by(["bb", "a", "ccc"], fn s => length(s))`, "x.esp"),
		).toEqual(["a", "bb", "ccc"]);
	});

	it("sorts by .field on maps", () => {
		expect(
			run(
				`sort_by([{age: 30}, {age: 10}, {age: 20}], fn u => u.age)`,
				"x.esp",
			),
		).toEqual([
			{ kind: "map", entries: { age: 10n } },
			{ kind: "map", entries: { age: 20n } },
			{ kind: "map", entries: { age: 30n } },
		]);
	});

	it("rejects non-callable key", () => {
		expect(() => run(`sort_by([1], "x")`, "x.esp")).toThrow(
			/sort_by: fn must be callable/,
		);
	});
});

describe("stdlib/lists: unique", () => {
	it("dedupes scalars preserving order", () => {
		expect(run(`unique([1, 2, 1, 3, 2, 4])`, "x.esp")).toEqual([
			1n, 2n, 3n, 4n,
		]);
	});

	it("uses structural equality on lists", () => {
		expect(run(`unique([[1, 2], [1, 2], [3]])`, "x.esp")).toEqual([
			[1n, 2n],
			[3n],
		]);
	});

	it("returns empty for empty input", () => {
		expect(run(`unique([])`, "x.esp")).toEqual([]);
	});

	it("rejects fn elements", () => {
		expect(() => run(`unique([fn x => x])`, "x.esp")).toThrow(
			/unique: list contains fn/,
		);
	});
});

describe("stdlib/lists: range", () => {
	it("range(stop) is 0..stop exclusive", () => {
		expect(run(`range(5)`, "x.esp")).toEqual([0n, 1n, 2n, 3n, 4n]);
	});

	it("range(start, stop) is half-open", () => {
		expect(run(`range(2, 6)`, "x.esp")).toEqual([2n, 3n, 4n, 5n]);
	});

	it("range(0) is empty", () => {
		expect(run(`range(0)`, "x.esp")).toEqual([]);
	});

	it("range with stop <= start is empty", () => {
		expect(run(`range(5, 3)`, "x.esp")).toEqual([]);
		expect(run(`range(3, 3)`, "x.esp")).toEqual([]);
	});

	it("composes with map/each", () => {
		expect(run(`range(4) |> map(fn n => n * n)`, "x.esp")).toEqual([
			0n, 1n, 4n, 9n,
		]);
	});

	it("rejects float arg", () => {
		expect(() => run(`range(3.0)`, "x.esp")).toThrow(
			/range: stop must be int, got float/,
		);
	});

	it("rejects 0 or 3+ args", () => {
		expect(() => run(`range()`, "x.esp")).toThrow(
			/range: expected 1 or 2 args, got 0/,
		);
		expect(() => run(`range(1, 2, 3)`, "x.esp")).toThrow(
			/range: expected 1 or 2 args, got 3/,
		);
	});
});

describe("stdlib/lists: zip", () => {
	it("pairs elements positionally", () => {
		expect(run(`zip([1, 2, 3], ["a", "b", "c"])`, "x.esp")).toEqual([
			[1n, "a"],
			[2n, "b"],
			[3n, "c"],
		]);
	});

	it("truncates to shorter list", () => {
		expect(run(`zip([1, 2, 3], ["a", "b"])`, "x.esp")).toEqual([
			[1n, "a"],
			[2n, "b"],
		]);
	});

	it("returns empty when either list empty", () => {
		expect(run(`zip([], [1])`, "x.esp")).toEqual([]);
		expect(run(`zip([1], [])`, "x.esp")).toEqual([]);
	});

	it("rejects non-list arg", () => {
		expect(() => run(`zip("ab", [1])`, "x.esp")).toThrow(
			/zip: first must be list, got str/,
		);
	});
});
