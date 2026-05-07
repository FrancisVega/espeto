import {
	type BuiltinFn,
	isCallable,
	isList,
	isMap,
	isStream,
	type Value,
	typeName,
} from "../values";
import {
	streamDrop,
	streamDropWhile,
	streamEach,
	streamFilter,
	streamFind,
	streamMap,
	streamReduce,
	streamTake,
	streamTakeWhile,
} from "./streams";

function rejectStream(name: string, suggestion: string, v: Value): void {
	if (isStream(v)) {
		throw new Error(`${name}: stream not supported. ${suggestion}`);
	}
}

/**
 * Number of elements in a list, characters in a string, or entries in a map.
 *
 * @param {str|list|map} v - the collection
 * @returns {int} number of items
 *
 * @example
 * length([1, 2, 3]) // => 3
 * length("hi")      // => 2
 */
export const length: BuiltinFn = {
	kind: "builtin",
	name: "length",
	arity: 1,
	call: (args) => {
		const v: Value = args[0] ?? null;
		rejectStream("length", "use count(s) or collect(s) |> length", v);
		if (typeof v === "string") return BigInt(v.length);
		if (isList(v)) return BigInt(v.length);
		if (isMap(v)) return BigInt(Object.keys(v.entries).length);
		throw new Error(`length: expected str, list or map, got ${typeName(v)}`);
	},
};

/**
 * First element of a list. Errors if the list is empty.
 *
 * @param {list} list - the list
 * @returns {any} the first element
 *
 * @example
 * head([1, 2, 3]) // => 1
 */
export const head: BuiltinFn = {
	kind: "builtin",
	name: "head",
	arity: 1,
	call: (args) => {
		const v: Value = args[0] ?? null;
		rejectStream("head", "use collect(s) |> head", v);
		if (!isList(v)) {
			throw new Error(`head: expected list, got ${typeName(v)}`);
		}
		if (v.length === 0) {
			throw new Error("head: empty list");
		}
		return v[0]!;
	},
};

/**
 * All elements of a list except the first. Errors if the list is empty.
 *
 * @param {list} list - the list
 * @returns {list} list without its first element
 *
 * @example
 * tail([1, 2, 3]) // => [2, 3]
 */
export const tail: BuiltinFn = {
	kind: "builtin",
	name: "tail",
	arity: 1,
	call: (args) => {
		const v: Value = args[0] ?? null;
		rejectStream("tail", "use collect(s) |> tail", v);
		if (!isList(v)) {
			throw new Error(`tail: expected list, got ${typeName(v)}`);
		}
		if (v.length === 0) {
			throw new Error("tail: empty list");
		}
		return v.slice(1);
	},
};

/**
 * Apply a function to each element, producing a new list (or a lazy stream
 * when the input is a stream).
 *
 * @param {list|stream} src - source list or stream
 * @param {fn} fn - function called with `(item)` per element
 * @returns {list|stream} list of results, or a stream when `src` is a stream
 *
 * @example
 * map([1, 2, 3], fn(x) -> x * 2 end) // => [2, 4, 6]
 */
export const map: BuiltinFn = {
	kind: "builtin",
	name: "map",
	arity: 2,
	call: (args, invoke) => {
		const v: Value = args[0] ?? null;
		const fn: Value = args[1] ?? null;
		if (isStream(v)) {
			if (!isCallable(fn)) {
				throw new Error(`map: fn must be callable, got ${typeName(fn)}`);
			}
			return streamMap(v, fn, invoke);
		}
		if (!isList(v)) {
			throw new Error(`map: expected list or stream, got ${typeName(v)}`);
		}
		if (!isCallable(fn)) {
			throw new Error(`map: fn must be callable, got ${typeName(fn)}`);
		}
		return v.map((it) => invoke(fn, [it]));
	},
};

/**
 * Keep only elements for which the predicate returns true. Predicate must
 * return a bool.
 *
 * @param {list|stream} src - source list or stream
 * @param {fn} fn - predicate `(item) -> bool`
 * @returns {list|stream} filtered items, lazy when `src` is a stream
 *
 * @example
 * filter([1, 2, 3, 4], fn(x) -> mod(x, 2) == 0 end) // => [2, 4]
 */
export const filter: BuiltinFn = {
	kind: "builtin",
	name: "filter",
	arity: 2,
	call: (args, invoke) => {
		const v: Value = args[0] ?? null;
		const fn: Value = args[1] ?? null;
		if (isStream(v)) {
			if (!isCallable(fn)) {
				throw new Error(`filter: fn must be callable, got ${typeName(fn)}`);
			}
			return streamFilter(v, fn, invoke);
		}
		if (!isList(v)) {
			throw new Error(`filter: expected list or stream, got ${typeName(v)}`);
		}
		if (!isCallable(fn)) {
			throw new Error(`filter: fn must be callable, got ${typeName(fn)}`);
		}
		const out: Value[] = [];
		for (const it of v) {
			const r = invoke(fn, [it]);
			if (typeof r !== "boolean") {
				throw new Error(
					`filter: predicate must return bool, got ${typeName(r)}`,
				);
			}
			if (r) out.push(it);
		}
		return out;
	},
};

/**
 * Fold a list or stream into a single accumulated value.
 *
 * @param {list|stream} src - source list or stream
 * @param {any} init - initial accumulator
 * @param {fn} fn - reducer `(acc, item) -> acc`
 * @returns {any} the final accumulator
 *
 * @example
 * reduce([1, 2, 3], 0, fn(acc, x) -> acc + x end) // => 6
 */
export const reduce: BuiltinFn = {
	kind: "builtin",
	name: "reduce",
	arity: 3,
	call: (args, invoke) => {
		const v: Value = args[0] ?? null;
		const init: Value = args[1] ?? null;
		const fn: Value = args[2] ?? null;
		if (isStream(v)) {
			if (!isCallable(fn)) {
				throw new Error(`reduce: fn must be callable, got ${typeName(fn)}`);
			}
			return streamReduce(v, init, fn, invoke);
		}
		if (!isList(v)) {
			throw new Error(`reduce: expected list or stream, got ${typeName(v)}`);
		}
		if (!isCallable(fn)) {
			throw new Error(`reduce: fn must be callable, got ${typeName(fn)}`);
		}
		let acc: Value = init;
		for (const it of v) {
			acc = invoke(fn, [acc, it]);
		}
		return acc;
	},
};

/**
 * Call a function for each element for its side effects. Returns nil. Works
 * on lists and streams; on streams the iteration is lazy and cleanup runs
 * automatically.
 *
 * @param {list|stream} src - source list or stream
 * @param {fn} fn - function called with `(item)` per element
 * @returns {nil} always nil
 *
 * @example
 * each(["a", "b"], print) // prints "a" then "b", returns nil
 */
export const each: BuiltinFn = {
	kind: "builtin",
	name: "each",
	arity: 2,
	call: (args, invoke) => {
		const v: Value = args[0] ?? null;
		const fn: Value = args[1] ?? null;
		if (isStream(v)) {
			if (!isCallable(fn)) {
				throw new Error(`each: fn must be callable, got ${typeName(fn)}`);
			}
			return streamEach(v, fn, invoke);
		}
		if (!isList(v)) {
			throw new Error(`each: expected list or stream, got ${typeName(v)}`);
		}
		if (!isCallable(fn)) {
			throw new Error(`each: fn must be callable, got ${typeName(fn)}`);
		}
		for (const it of v) {
			invoke(fn, [it]);
		}
		return null;
	},
};

function expectList(name: string, label: string, v: Value): Value[] {
	if (!isList(v)) {
		throw new Error(`${name}: ${label} must be list, got ${typeName(v)}`);
	}
	return v;
}

function expectInt(name: string, label: string, v: Value): bigint {
	if (typeof v !== "bigint") {
		throw new Error(`${name}: ${label} must be int, got ${typeName(v)}`);
	}
	return v;
}

/**
 * Concatenate two lists into one.
 *
 * @param {list} a - first list
 * @param {list} b - second list
 * @returns {list} all items of `a` followed by all items of `b`
 *
 * @example
 * concat([1, 2], [3, 4]) // => [1, 2, 3, 4]
 */
export const concat: BuiltinFn = {
	kind: "builtin",
	name: "concat",
	arity: 2,
	call: (args) => {
		const a0: Value = args[0] ?? null;
		const b0: Value = args[1] ?? null;
		rejectStream("concat", "use collect first", a0);
		rejectStream("concat", "use collect first", b0);
		const a = expectList("concat", "first", a0);
		const b = expectList("concat", "second", b0);
		return [...a, ...b];
	},
};

/**
 * Reverse the order of a list.
 *
 * @param {list} list - the list to reverse
 * @returns {list} a new list with elements in reverse order
 *
 * @example
 * reverse([1, 2, 3]) // => [3, 2, 1]
 */
export const reverse: BuiltinFn = {
	kind: "builtin",
	name: "reverse",
	arity: 1,
	call: (args) => {
		const v: Value = args[0] ?? null;
		rejectStream("reverse", "use collect(s) |> reverse", v);
		const list = expectList("reverse", "arg", v);
		return [...list].reverse();
	},
};

/**
 * Take the first `n` elements of a list or stream. Errors if `n` is negative;
 * if `n` exceeds list length, returns the whole list. On a stream, take is
 * lazy: only the first `n` items are pulled and the source is then closed.
 *
 * @param {list|stream} src - source list or stream
 * @param {int} n - number of elements to take (must be non-negative)
 * @returns {list|stream} the prefix of length `n` (or a stream when `src` is a stream)
 *
 * @example
 * take([1, 2, 3, 4], 2) // => [1, 2]
 */
export const take: BuiltinFn = {
	kind: "builtin",
	name: "take",
	arity: 2,
	call: (args) => {
		const v: Value = args[0] ?? null;
		const n0: Value = args[1] ?? null;
		if (isStream(v)) {
			const n = expectInt("take", "n", n0);
			return streamTake(v, n);
		}
		const list = expectList("take", "list", v);
		const n = expectInt("take", "n", n0);
		if (n < 0n) {
			throw new Error("take: n must be non-negative");
		}
		return list.slice(0, Number(n));
	},
};

/**
 * Drop the first `n` elements of a list or stream. Errors if `n` is negative;
 * if `n` exceeds list length, returns an empty list. On a stream, drop is
 * lazy: the first `n` items are pulled and discarded.
 *
 * @param {list|stream} src - source list or stream
 * @param {int} n - number of elements to drop (must be non-negative)
 * @returns {list|stream} the rest after the first `n` elements
 *
 * @example
 * drop([1, 2, 3, 4], 2) // => [3, 4]
 */
export const drop: BuiltinFn = {
	kind: "builtin",
	name: "drop",
	arity: 2,
	call: (args) => {
		const v: Value = args[0] ?? null;
		const n0: Value = args[1] ?? null;
		if (isStream(v)) {
			const n = expectInt("drop", "n", n0);
			return streamDrop(v, n);
		}
		const list = expectList("drop", "list", v);
		const n = expectInt("drop", "n", n0);
		if (n < 0n) {
			throw new Error("drop: n must be non-negative");
		}
		return list.slice(Number(n));
	},
};

/**
 * Take elements from the front while the predicate returns true. Stops at
 * the first element where the predicate is false. Predicate must return a
 * bool.
 *
 * @param {list|stream} src - source list or stream
 * @param {fn} fn - predicate `(item) -> bool`
 * @returns {list|stream} prefix of elements satisfying the predicate
 *
 * @example
 * take_while([1, 2, 3, 1], fn(x) -> x < 3 end) // => [1, 2]
 */
export const take_while: BuiltinFn = {
	kind: "builtin",
	name: "take_while",
	arity: 2,
	call: (args, invoke) => {
		const v: Value = args[0] ?? null;
		const fn: Value = args[1] ?? null;
		if (isStream(v)) {
			if (!isCallable(fn)) {
				throw new Error(
					`take_while: fn must be callable, got ${typeName(fn)}`,
				);
			}
			return streamTakeWhile(v, fn, invoke);
		}
		const list = expectList("take_while", "list", v);
		if (!isCallable(fn)) {
			throw new Error(`take_while: fn must be callable, got ${typeName(fn)}`);
		}
		const out: Value[] = [];
		for (const it of list) {
			const r = invoke(fn, [it]);
			if (typeof r !== "boolean") {
				throw new Error(
					`take_while: predicate must return bool, got ${typeName(r)}`,
				);
			}
			if (!r) break;
			out.push(it);
		}
		return out;
	},
};

/**
 * Drop elements from the front while the predicate returns true. Returns
 * the rest starting at the first element where the predicate is false.
 * Predicate must return a bool.
 *
 * @param {list|stream} src - source list or stream
 * @param {fn} fn - predicate `(item) -> bool`
 * @returns {list|stream} suffix starting at first failing item
 *
 * @example
 * drop_while([1, 2, 3, 1], fn(x) -> x < 3 end) // => [3, 1]
 */
export const drop_while: BuiltinFn = {
	kind: "builtin",
	name: "drop_while",
	arity: 2,
	call: (args, invoke) => {
		const v: Value = args[0] ?? null;
		const fn: Value = args[1] ?? null;
		if (isStream(v)) {
			if (!isCallable(fn)) {
				throw new Error(
					`drop_while: fn must be callable, got ${typeName(fn)}`,
				);
			}
			return streamDropWhile(v, fn, invoke);
		}
		const list = expectList("drop_while", "list", v);
		if (!isCallable(fn)) {
			throw new Error(`drop_while: fn must be callable, got ${typeName(fn)}`);
		}
		let dropping = true;
		const out: Value[] = [];
		for (const it of list) {
			if (dropping) {
				const r = invoke(fn, [it]);
				if (typeof r !== "boolean") {
					throw new Error(
						`drop_while: predicate must return bool, got ${typeName(r)}`,
					);
				}
				if (r) continue;
				dropping = false;
			}
			out.push(it);
		}
		return out;
	},
};

/**
 * Return the first element matching the predicate, or nil if none match.
 * Predicate must return a bool. Works on lists and streams; on streams,
 * iteration stops at the first match and the source is closed.
 *
 * @param {list|stream} src - source list or stream
 * @param {fn} fn - predicate `(item) -> bool`
 * @returns {any} the first matching item, or nil
 *
 * @example
 * find([1, 2, 3], fn(x) -> x > 1 end) // => 2
 */
export const find: BuiltinFn = {
	kind: "builtin",
	name: "find",
	arity: 2,
	call: (args, invoke) => {
		const v: Value = args[0] ?? null;
		const fn: Value = args[1] ?? null;
		if (isStream(v)) {
			if (!isCallable(fn)) {
				throw new Error(`find: fn must be callable, got ${typeName(fn)}`);
			}
			return streamFind(v, fn, invoke);
		}
		const list = expectList("find", "list", v);
		if (!isCallable(fn)) {
			throw new Error(`find: fn must be callable, got ${typeName(fn)}`);
		}
		for (const it of list) {
			const r = invoke(fn, [it]);
			if (typeof r !== "boolean") {
				throw new Error(
					`find: predicate must return bool, got ${typeName(r)}`,
				);
			}
			if (r) return it;
		}
		return null;
	},
};

function valueEquals(a: Value, b: Value): boolean {
	if (a === null || b === null) return a === b;
	if (isList(a) || isList(b)) {
		if (!isList(a) || !isList(b)) return false;
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!valueEquals(a[i]!, b[i]!)) return false;
		}
		return true;
	}
	if (isMap(a) || isMap(b)) {
		if (!isMap(a) || !isMap(b)) return false;
		const ak = Object.keys(a.entries);
		const bk = Object.keys(b.entries);
		if (ak.length !== bk.length) return false;
		for (const k of ak) {
			if (!Object.prototype.hasOwnProperty.call(b.entries, k)) return false;
			if (!valueEquals(a.entries[k]!, b.entries[k]!)) return false;
		}
		return true;
	}
	if (typeof a !== typeof b) return false;
	return a === b;
}

function compareSortable(name: string, a: Value, b: Value): number {
	if (typeof a === "bigint" && typeof b === "bigint") {
		return a < b ? -1 : a > b ? 1 : 0;
	}
	if (typeof a === "number" && typeof b === "number") {
		return a < b ? -1 : a > b ? 1 : 0;
	}
	if (typeof a === "string" && typeof b === "string") {
		return a < b ? -1 : a > b ? 1 : 0;
	}
	throw new Error(
		`${name}: cannot compare ${typeName(a)} and ${typeName(b)} (sortable types: int, float, str)`,
	);
}

/**
 * Sort a list in ascending order. All items must share a sortable type
 * (int, float or str).
 *
 * @param {list} list - the list to sort
 * @returns {list} a new sorted list
 *
 * @example
 * sort([3, 1, 2])           // => [1, 2, 3]
 * sort(["b", "a", "c"])     // => ["a", "b", "c"]
 */
export const sort: BuiltinFn = {
	kind: "builtin",
	name: "sort",
	arity: 1,
	call: (args) => {
		const v: Value = args[0] ?? null;
		rejectStream("sort", "use collect(s) |> sort", v);
		const list = expectList("sort", "arg", v);
		const copy = [...list];
		copy.sort((a, b) => compareSortable("sort", a, b));
		return copy;
	},
};

/**
 * Sort a list by a key extracted from each item. The keys must share
 * a sortable type (int, float or str).
 *
 * @param {list} list - source list
 * @param {fn} fn - key function `(item) -> int|float|str`
 * @returns {list} list sorted by the key
 *
 * @example
 * sort_by([{age: 30}, {age: 20}], fn(p) -> p.age end) // => [{age: 20}, {age: 30}]
 */
export const sort_by: BuiltinFn = {
	kind: "builtin",
	name: "sort_by",
	arity: 2,
	call: (args, invoke) => {
		const v: Value = args[0] ?? null;
		rejectStream("sort_by", "use collect(s) |> sort_by", v);
		const list = expectList("sort_by", "list", v);
		const fn: Value = args[1] ?? null;
		if (!isCallable(fn)) {
			throw new Error(`sort_by: fn must be callable, got ${typeName(fn)}`);
		}
		const keyed = list.map((it) => ({ it, key: invoke(fn, [it]) }));
		keyed.sort((a, b) => compareSortable("sort_by", a.key, b.key));
		return keyed.map((k) => k.it);
	},
};

/**
 * Remove duplicate items, preserving order of first occurrence.
 * Items must be comparable by value (no functions allowed).
 *
 * @param {list} list - source list
 * @returns {list} list with duplicates removed
 *
 * @example
 * unique([1, 2, 2, 3, 1]) // => [1, 2, 3]
 */
export const unique: BuiltinFn = {
	kind: "builtin",
	name: "unique",
	arity: 1,
	call: (args) => {
		const v: Value = args[0] ?? null;
		rejectStream("unique", "use collect(s) |> unique", v);
		const list = expectList("unique", "arg", v);
		const out: Value[] = [];
		for (const it of list) {
			if (isCallable(it)) {
				throw new Error("unique: list contains fn (not comparable)");
			}
			if (!out.some((seen) => valueEquals(seen, it))) {
				out.push(it);
			}
		}
		return out;
	},
};

/**
 * Build a list of consecutive integers `[start, stop)`.
 * Called with one arg, `start` defaults to 0. Returns an empty list if
 * `start >= stop`.
 *
 * @param {int} start - inclusive lower bound (or `stop` when called with 1 arg)
 * @param {int} stop - exclusive upper bound (optional)
 * @returns {list} list of ints from `start` to `stop - 1`
 *
 * @example
 * range(3)    // => [0, 1, 2]
 * range(2, 5) // => [2, 3, 4]
 */
export const range: BuiltinFn = {
	kind: "builtin",
	name: "range",
	arity: -1,
	call: (args) => {
		let start: bigint;
		let stop: bigint;
		if (args.length === 1) {
			start = 0n;
			stop = expectInt("range", "stop", args[0] ?? null);
		} else if (args.length === 2) {
			start = expectInt("range", "start", args[0] ?? null);
			stop = expectInt("range", "stop", args[1] ?? null);
		} else {
			throw new Error(
				`range: expected 1 or 2 args, got ${args.length}`,
			);
		}
		const out: Value[] = [];
		for (let i = start; i < stop; i++) {
			out.push(i);
		}
		return out;
	},
};

/**
 * Pair up corresponding elements from two lists into a list of [a, b] pairs.
 * Result length is `min(length(a), length(b))`.
 *
 * @param {list} a - first list
 * @param {list} b - second list
 * @returns {list} list of two-element pairs
 *
 * @example
 * zip([1, 2, 3], ["a", "b"]) // => [[1, "a"], [2, "b"]]
 */
export const zip: BuiltinFn = {
	kind: "builtin",
	name: "zip",
	arity: 2,
	call: (args) => {
		const a0: Value = args[0] ?? null;
		const b0: Value = args[1] ?? null;
		rejectStream("zip", "use collect first", a0);
		rejectStream("zip", "use collect first", b0);
		const a = expectList("zip", "first", a0);
		const b = expectList("zip", "second", b0);
		const len = Math.min(a.length, b.length);
		const out: Value[] = [];
		for (let i = 0; i < len; i++) {
			out.push([a[i]!, b[i]!]);
		}
		return out;
	},
};
