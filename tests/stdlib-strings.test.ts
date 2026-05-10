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

describe("stdlib/strings", () => {
	it("upcase uppercases a string", () => {
		expect(captureStdout(() => run(`"sardinas" |> upcase |> print`, "x.esp"))).toBe(
			"SARDINAS\n",
		);
	});

	it("downcase lowercases a string", () => {
		expect(captureStdout(() => run(`"HOLA" |> downcase |> print`, "x.esp"))).toBe(
			"hola\n",
		);
	});

	it("trim strips leading/trailing whitespace", () => {
		expect(
			captureStdout(() => run(`"  hola  " |> trim |> print`, "x.esp")),
		).toBe("hola\n");
	});

	it("chains trim |> upcase |> print", () => {
		expect(
			captureStdout(() =>
				run(`"  sardinas frescas  " |> trim |> upcase |> print`, "x.esp"),
			),
		).toBe("SARDINAS FRESCAS\n");
	});

	it("upcase rejects non-string", () => {
		// `print` returns nil; piping nil into upcase must error.
		const out: string[] = [];
		const spy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk: unknown) => {
				out.push(String(chunk));
				return true;
			});
		try {
			expect(() => run(`"x" |> print |> upcase`, "x.esp")).toThrow(
				/upcase: arg must be str, got nil/,
			);
		} finally {
			spy.mockRestore();
		}
	});
});

describe("stdlib/strings: split", () => {
	it("splits on separator", () => {
		expect(run(`split("a,b,c", ",")`, "x.esp")).toEqual(["a", "b", "c"]);
	});

	it("returns single-element list when separator absent", () => {
		expect(run(`split("hola", ",")`, "x.esp")).toEqual(["hola"]);
	});

	it("returns empty fragments around separator", () => {
		expect(run(`split(",a,", ",")`, "x.esp")).toEqual(["", "a", ""]);
	});

	it("rejects empty separator", () => {
		expect(() => run(`split("hi", "")`, "x.esp")).toThrow(
			/split: separator must not be empty/,
		);
	});

	it("rejects non-str", () => {
		expect(() => run(`split(1, ",")`, "x.esp")).toThrow(
			/split: str must be str, got int/,
		);
	});
});

describe("stdlib/strings: join", () => {
	it("joins list with separator", () => {
		expect(run(`join(["a", "b", "c"], ",")`, "x.esp")).toBe("a,b,c");
	});

	it("returns empty string for empty list", () => {
		expect(run(`join([], ",")`, "x.esp")).toBe("");
	});

	it("works in pipe form", () => {
		expect(
			run(`["sar", "din", "as"] |> join("-")`, "x.esp"),
		).toBe("sar-din-as");
	});

	it("rejects non-str element", () => {
		expect(() => run(`join(["a", 1], ",")`, "x.esp")).toThrow(
			/join: list\[1\] must be str, got int/,
		);
	});

	it("rejects non-list", () => {
		expect(() => run(`join("hola", ",")`, "x.esp")).toThrow(
			/join: expected list, got str/,
		);
	});
});

describe("stdlib/strings: replace", () => {
	it("replaces all occurrences", () => {
		expect(run(`replace("a,b,c", ",", "-")`, "x.esp")).toBe("a-b-c");
	});

	it("returns input unchanged when pattern absent", () => {
		expect(run(`replace("hola", "x", "y")`, "x.esp")).toBe("hola");
	});

	it("supports multi-char pattern", () => {
		expect(run(`replace("foo bar foo", "foo", "baz")`, "x.esp")).toBe(
			"baz bar baz",
		);
	});

	it("rejects empty pattern", () => {
		expect(() => run(`replace("hi", "", "x")`, "x.esp")).toThrow(
			/replace: pattern must not be empty/,
		);
	});
});

describe("stdlib/strings: starts_with?", () => {
	it("true when prefix matches", () => {
		expect(run(`starts_with?("hola", "ho")`, "x.esp")).toBe(true);
	});

	it("false when prefix does not match", () => {
		expect(run(`starts_with?("hola", "la")`, "x.esp")).toBe(false);
	});

	it("empty needle is always true", () => {
		expect(run(`starts_with?("hola", "")`, "x.esp")).toBe(true);
	});
});

describe("stdlib/strings: ends_with?", () => {
	it("true when suffix matches", () => {
		expect(run(`ends_with?("hola", "la")`, "x.esp")).toBe(true);
	});

	it("false when suffix does not match", () => {
		expect(run(`ends_with?("hola", "ho")`, "x.esp")).toBe(false);
	});
});

describe("stdlib/strings: contains?", () => {
	it("true when substring found", () => {
		expect(run(`contains?("sardinas", "din")`, "x.esp")).toBe(true);
	});

	it("false when substring absent", () => {
		expect(run(`contains?("sardinas", "xyz")`, "x.esp")).toBe(false);
	});

	it("empty needle is always true", () => {
		expect(run(`contains?("hola", "")`, "x.esp")).toBe(true);
	});

	it("rejects non-str needle", () => {
		expect(() => run(`contains?("x", 1)`, "x.esp")).toThrow(
			/contains\?: needle must be str, got int/,
		);
	});
});

describe("stdlib/strings: slice", () => {
	it("3-arity extracts a substring of length n", () => {
		expect(run(`slice("sardinas", 0, 3)`, "x.esp")).toBe("sar");
		expect(run(`slice("sardinas", 3, 3)`, "x.esp")).toBe("din");
	});

	it("2-arity takes from start to end", () => {
		expect(run(`slice("sardinas", 3)`, "x.esp")).toBe("dinas");
		expect(run(`slice("sardinas", 0)`, "x.esp")).toBe("sardinas");
	});

	it("negative start counts from the end", () => {
		expect(run(`slice("sardinas", -3, 3)`, "x.esp")).toBe("nas");
		expect(run(`slice("sardinas", -3)`, "x.esp")).toBe("nas");
		expect(run(`slice("sardinas", -1, 1)`, "x.esp")).toBe("s");
	});

	it("clamps start beyond bounds", () => {
		expect(run(`slice("hi", 100, 3)`, "x.esp")).toBe("");
		expect(run(`slice("hi", 100)`, "x.esp")).toBe("");
		expect(run(`slice("hi", -100, 1)`, "x.esp")).toBe("h");
		expect(run(`slice("hi", -100)`, "x.esp")).toBe("hi");
	});

	it("clamps length when it exceeds the string", () => {
		expect(run(`slice("hi", 0, 100)`, "x.esp")).toBe("hi");
		expect(run(`slice("hi", 1, 100)`, "x.esp")).toBe("i");
	});

	it("length 0 returns empty string", () => {
		expect(run(`slice("sardinas", 2, 0)`, "x.esp")).toBe("");
	});

	it("works in pipe form", () => {
		expect(run(`"sardinas" |> slice(0, 3)`, "x.esp")).toBe("sar");
		expect(run(`"sardinas" |> slice(-3)`, "x.esp")).toBe("nas");
	});

	it("rejects negative length", () => {
		expect(() => run(`slice("hi", 0, -1)`, "x.esp")).toThrow(
			/slice: length must be non-negative/,
		);
	});

	it("rejects wrong arity", () => {
		expect(() => run(`slice("hi")`, "x.esp")).toThrow(
			/slice: expected 2 or 3 args, got 1/,
		);
		expect(() => run(`slice("hi", 0, 1, 2)`, "x.esp")).toThrow(
			/slice: expected 2 or 3 args, got 4/,
		);
	});

	it("rejects non-str input", () => {
		expect(() => run(`slice(1, 0, 1)`, "x.esp")).toThrow(
			/slice: str must be str, got int/,
		);
	});

	it("rejects non-int start", () => {
		expect(() => run(`slice("hi", 1.5, 1)`, "x.esp")).toThrow(
			/slice: start must be int, got float/,
		);
	});

	it("rejects non-int length", () => {
		expect(() => run(`slice("hi", 0, 1.5)`, "x.esp")).toThrow(
			/slice: length must be int, got float/,
		);
	});
});

describe("stdlib/strings: chars", () => {
	it("explodes a word into single-char strings", () => {
		expect(run(`chars("hola")`, "x.esp")).toEqual(["h", "o", "l", "a"]);
	});

	it("returns empty list for empty string", () => {
		expect(run(`chars("")`, "x.esp")).toEqual([]);
	});

	it("keeps surrogate pairs together (codepoint-aware)", () => {
		expect(run(`chars("a😀b")`, "x.esp")).toEqual(["a", "😀", "b"]);
	});

	it("works in pipe form", () => {
		expect(run(`"hi" |> chars`, "x.esp")).toEqual(["h", "i"]);
	});

	it("rejects non-str", () => {
		expect(() => run(`chars(1)`, "x.esp")).toThrow(
			/chars: str must be str, got int/,
		);
	});
});
