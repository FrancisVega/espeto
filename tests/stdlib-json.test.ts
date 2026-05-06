import { describe, expect, it } from "vitest";
import { run } from "../src/run";

describe("stdlib/json: parse_json scalars", () => {
	it("parses null", () => {
		expect(run(`parse_json("null")`, "x.esp")).toBe(null);
	});

	it("parses true and false", () => {
		expect(run(`parse_json("true")`, "x.esp")).toBe(true);
		expect(run(`parse_json("false")`, "x.esp")).toBe(false);
	});

	it("parses strings with escapes", () => {
		expect(run(`parse_json("\\"hola\\\\nmundo\\"")`, "x.esp")).toBe(
			"hola\nmundo",
		);
	});

	it("parses unicode escape", () => {
		expect(run(`parse_json("\\"\\\\u00e9\\"")`, "x.esp")).toBe("é");
	});
});

describe("stdlib/json: parse_json numbers (int/float distinction)", () => {
	it("integer-looking number → int", () => {
		expect(run(`parse_json("42")`, "x.esp")).toBe(42n);
	});

	it("negative integer → int", () => {
		expect(run(`parse_json("-7")`, "x.esp")).toBe(-7n);
	});

	it("number with decimal → float", () => {
		expect(run(`parse_json("3.14")`, "x.esp")).toBe(3.14);
	});

	it("number with .0 → float (preserves syntactic shape)", () => {
		expect(run(`parse_json("1.0")`, "x.esp")).toBe(1.0);
		expect(typeof run(`parse_json("1.0")`, "x.esp")).toBe("number");
	});

	it("number with exponent → float", () => {
		expect(run(`parse_json("1e3")`, "x.esp")).toBe(1000);
		expect(typeof run(`parse_json("1e3")`, "x.esp")).toBe("number");
	});

	it("rejects leading zeros", () => {
		expect(() => run(`parse_json("01")`, "x.esp")).toThrow(
			/parse_json: unexpected character.*after value/,
		);
	});
});

describe("stdlib/json: parse_json arrays and objects", () => {
	it("parses empty array", () => {
		expect(run(`parse_json("[]")`, "x.esp")).toEqual([]);
	});

	it("parses array of mixed scalars", () => {
		expect(run(`parse_json("[1, 2.0, \\"x\\", true, null]")`, "x.esp")).toEqual([
			1n,
			2.0,
			"x",
			true,
			null,
		]);
	});

	it("parses empty object", () => {
		expect(run(`parse_json("{}")`, "x.esp")).toEqual({
			kind: "map",
			entries: {},
		});
	});

	it("parses nested object", () => {
		expect(
			run(
				`parse_json("{\\"a\\": 1, \\"b\\": [2, 3], \\"c\\": {\\"d\\": true}}")`,
				"x.esp",
			),
		).toEqual({
			kind: "map",
			entries: {
				a: 1n,
				b: [2n, 3n],
				c: { kind: "map", entries: { d: true } },
			},
		});
	});

	it("ignores whitespace", () => {
		expect(run(`parse_json("  [ 1 , 2 ] ")`, "x.esp")).toEqual([1n, 2n]);
	});
});

describe("stdlib/json: parse_json errors", () => {
	it("raises on invalid JSON", () => {
		expect(() => run(`parse_json("{")`, "x.esp")).toThrow(/parse_json:/);
	});

	it("raises on trailing garbage", () => {
		expect(() => run(`parse_json("1 2")`, "x.esp")).toThrow(
			/parse_json: unexpected character/,
		);
	});

	it("raises on empty input", () => {
		expect(() => run(`parse_json("")`, "x.esp")).toThrow(
			/parse_json: unexpected end of input/,
		);
	});

	it("raises on unterminated string", () => {
		expect(() => run(`parse_json("\\"abc")`, "x.esp")).toThrow(
			/parse_json: unterminated string/,
		);
	});

	it("rejects non-str arg", () => {
		expect(() => run(`parse_json(1)`, "x.esp")).toThrow(
			/parse_json: expected str, got int/,
		);
	});
});

describe("stdlib/json: try_parse_json", () => {
	it("returns ok=true on valid JSON", () => {
		expect(run(`try_parse_json("[1, 2]")`, "x.esp")).toEqual({
			kind: "map",
			entries: { ok: true, value: [1n, 2n] },
		});
	});

	it("returns ok=false on invalid JSON", () => {
		const r = run(`try_parse_json("{")`, "x.esp") as {
			kind: "map";
			entries: { ok: boolean; error: string };
		};
		expect(r.entries.ok).toBe(false);
		expect(r.entries.error).toMatch(/parse_json:/);
	});
});

describe("stdlib/json: to_json", () => {
	it("serializes scalars", () => {
		expect(run(`to_json(nil)`, "x.esp")).toBe("null");
		expect(run(`to_json(true)`, "x.esp")).toBe("true");
		expect(run(`to_json(false)`, "x.esp")).toBe("false");
		expect(run(`to_json(42)`, "x.esp")).toBe("42");
		expect(run(`to_json(-7)`, "x.esp")).toBe("-7");
		expect(run(`to_json(3.14)`, "x.esp")).toBe("3.14");
		expect(run(`to_json("hola")`, "x.esp")).toBe('"hola"');
	});

	it("escapes special chars in strings", () => {
		expect(run(`to_json("a\\"b")`, "x.esp")).toBe('"a\\"b"');
		expect(run(`to_json("a\nb")`, "x.esp")).toBe('"a\\nb"');
	});

	it("serializes lists", () => {
		expect(run(`to_json([1, 2, 3])`, "x.esp")).toBe("[1,2,3]");
		expect(run(`to_json([])`, "x.esp")).toBe("[]");
	});

	it("serializes maps", () => {
		expect(run(`to_json({a: 1, b: "x"})`, "x.esp")).toBe('{"a":1,"b":"x"}');
		expect(run(`to_json({})`, "x.esp")).toBe("{}");
	});

	it("serializes nested structures", () => {
		expect(
			run(`to_json({users: [{name: "Ana", age: 22}]})`, "x.esp"),
		).toBe('{"users":[{"name":"Ana","age":22}]}');
	});

	it("raises on int outside safe range", () => {
		// 2^53 = 9007199254740992 — first unsafe int
		expect(() => run(`to_json(9007199254740992)`, "x.esp")).toThrow(
			/to_json: int 9007199254740992 exceeds safe range/,
		);
	});

	it("accepts max safe int", () => {
		expect(run(`to_json(9007199254740991)`, "x.esp")).toBe(
			"9007199254740991",
		);
	});

	it("raises on fn", () => {
		expect(() => run(`to_json(fn x => x)`, "x.esp")).toThrow(
			/to_json: cannot serialize fn/,
		);
	});
});

describe("stdlib/json: roundtrip", () => {
	it("int → str → int", () => {
		expect(run(`to_json(42) |> parse_json`, "x.esp")).toBe(42n);
	});

	it("float → str → float", () => {
		expect(run(`to_json(3.14) |> parse_json`, "x.esp")).toBe(3.14);
	});

	it("nested map roundtrip preserves int/float", () => {
		const code = `to_json({a: 1, b: 2.5, c: [3, 4.0]}) |> parse_json`;
		expect(run(code, "x.esp")).toEqual({
			kind: "map",
			entries: { a: 1n, b: 2.5, c: [3n, 4.0] },
		});
	});
});
