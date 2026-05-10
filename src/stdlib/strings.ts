import { type BuiltinFn, type Value, typeName } from "../values";

function expectStr(name: string, label: string, v: Value): string {
	if (typeof v !== "string") {
		throw new Error(`${name}: ${label} must be str, got ${typeName(v)}`);
	}
	return v;
}

function expectInt(name: string, label: string, v: Value): bigint {
	if (typeof v !== "bigint") {
		throw new Error(`${name}: ${label} must be int, got ${typeName(v)}`);
	}
	return v;
}

function strFn(name: string, fn: (s: string) => string): BuiltinFn {
	return {
		kind: "builtin",
		name,
		arity: 1,
		call: (args) => fn(expectStr(name, "arg", args[0] ?? null)),
	};
}

/**
 * Convert a string to uppercase.
 *
 * @param {str} s - the string to convert
 * @returns {str} the uppercased string
 *
 * @example
 * upcase("hi") // => "HI"
 */
export const upcase = strFn("upcase", (s) => s.toUpperCase());

/**
 * Convert a string to lowercase.
 *
 * @param {str} s - the string to convert
 * @returns {str} the lowercased string
 *
 * @example
 * downcase("HI") // => "hi"
 */
export const downcase = strFn("downcase", (s) => s.toLowerCase());

/**
 * Strip leading and trailing whitespace from a string.
 *
 * @param {str} s - the string to trim
 * @returns {str} the trimmed string
 *
 * @example
 * trim("  hi  ") // => "hi"
 */
export const trim = strFn("trim", (s) => s.trim());

/**
 * Split a string on a separator into a list of strings.
 * Errors if the separator is empty.
 *
 * @param {str} s - the string to split
 * @param {str} sep - the separator (must not be empty)
 * @returns {list} list of substrings
 *
 * @example
 * split("a,b,c", ",") // => ["a", "b", "c"]
 */
export const split: BuiltinFn = {
	kind: "builtin",
	name: "split",
	arity: 2,
	call: (args) => {
		const s = expectStr("split", "str", args[0] ?? null);
		const sep = expectStr("split", "sep", args[1] ?? null);
		if (sep === "") {
			throw new Error("split: separator must not be empty");
		}
		return s.split(sep);
	},
};

/**
 * Join a list of strings into one string with a separator.
 * Errors if any item in the list is not a string.
 *
 * @param {list} list - list of strings
 * @param {str} sep - the separator inserted between items
 * @returns {str} the joined string
 *
 * @example
 * join(["a", "b", "c"], "-") // => "a-b-c"
 */
export const join: BuiltinFn = {
	kind: "builtin",
	name: "join",
	arity: 2,
	call: (args) => {
		const list = args[0] ?? null;
		const sep = expectStr("join", "sep", args[1] ?? null);
		if (!Array.isArray(list)) {
			throw new Error(`join: expected list, got ${typeName(list)}`);
		}
		const parts: string[] = [];
		for (let i = 0; i < list.length; i++) {
			const v = list[i]!;
			if (typeof v !== "string") {
				throw new Error(
					`join: list[${i}] must be str, got ${typeName(v)}`,
				);
			}
			parts.push(v);
		}
		return parts.join(sep);
	},
};

/**
 * Replace every occurrence of a pattern in a string with a replacement.
 * Pattern matching is plain text (not regex). Errors if the pattern is empty.
 *
 * @param {str} s - the source string
 * @param {str} pattern - the substring to match (must not be empty)
 * @param {str} replacement - the replacement string
 * @returns {str} the resulting string
 *
 * @example
 * replace("foo bar foo", "foo", "baz") // => "baz bar baz"
 */
export const replace: BuiltinFn = {
	kind: "builtin",
	name: "replace",
	arity: 3,
	call: (args) => {
		const s = expectStr("replace", "str", args[0] ?? null);
		const pattern = expectStr("replace", "pattern", args[1] ?? null);
		const replacement = expectStr("replace", "replacement", args[2] ?? null);
		if (pattern === "") {
			throw new Error("replace: pattern must not be empty");
		}
		return s.split(pattern).join(replacement);
	},
};

function strPredicate(
	name: string,
	fn: (s: string, needle: string) => boolean,
): BuiltinFn {
	return {
		kind: "builtin",
		name,
		arity: 2,
		call: (args) => {
			const s = expectStr(name, "str", args[0] ?? null);
			const needle = expectStr(name, "needle", args[1] ?? null);
			return fn(s, needle);
		},
	};
}

/**
 * Test whether a string begins with a given prefix.
 *
 * @param {str} s - the string to test
 * @param {str} needle - the prefix to look for
 * @returns {bool} true if `s` starts with `needle`
 *
 * @example
 * starts_with?("hello", "he") // => true
 */
export const starts_with = strPredicate("starts_with?", (s, n) =>
	s.startsWith(n),
);

/**
 * Test whether a string ends with a given suffix.
 *
 * @param {str} s - the string to test
 * @param {str} needle - the suffix to look for
 * @returns {bool} true if `s` ends with `needle`
 *
 * @example
 * ends_with?("hello", "lo") // => true
 */
export const ends_with = strPredicate("ends_with?", (s, n) => s.endsWith(n));

/**
 * Test whether a string contains a given substring.
 *
 * @param {str} s - the string to test
 * @param {str} needle - the substring to look for
 * @returns {bool} true if `s` contains `needle`
 *
 * @example
 * contains?("hello", "ell") // => true
 */
export const contains = strPredicate("contains?", (s, n) => s.includes(n));

/**
 * Extract a substring of `length` characters starting at `start`.
 * Called with two args, takes from `start` to the end. A negative `start`
 * counts from the end (`-1` is the last char). Out-of-range `start` clamps
 * to the nearest end. Errors if `length` is negative.
 *
 * @param {str} s - the source string
 * @param {int} start - zero-based index (negative counts from end)
 * @param {int} length - number of characters to take (optional; must be non-negative)
 * @returns {str} the extracted substring
 *
 * @example
 * slice("sardinas", 0, 3)  // => "sar"
 * slice("sardinas", 3, 3)  // => "din"
 * slice("sardinas", -3, 3) // => "nas"
 * slice("sardinas", 3)     // => "dinas"
 */
export const slice: BuiltinFn = {
	kind: "builtin",
	name: "slice",
	arity: -1,
	call: (args) => {
		if (args.length !== 2 && args.length !== 3) {
			throw new Error(
				`slice: expected 2 or 3 args, got ${args.length}`,
			);
		}
		const s = expectStr("slice", "str", args[0] ?? null);
		const start = Number(expectInt("slice", "start", args[1] ?? null));
		const slen = s.length;
		const actualStart =
			start < 0 ? Math.max(0, slen + start) : Math.min(start, slen);
		if (args.length === 2) {
			return s.slice(actualStart);
		}
		const length = expectInt("slice", "length", args[2] ?? null);
		if (length < 0n) {
			throw new Error("slice: length must be non-negative");
		}
		return s.slice(actualStart, actualStart + Number(length));
	},
};

/**
 * Split a string into a list of single-character strings (Unicode
 * codepoints). Surrogate pairs (e.g. emoji) stay together.
 *
 * @param {str} s - the string to explode
 * @returns {list} list of single-character strings
 *
 * @example
 * chars("hola") // => ["h", "o", "l", "a"]
 * chars("")     // => []
 */
export const chars: BuiltinFn = {
	kind: "builtin",
	name: "chars",
	arity: 1,
	call: (args) => {
		const s = expectStr("chars", "str", args[0] ?? null);
		return Array.from(s);
	},
};
