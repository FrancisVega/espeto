import {
	type BuiltinFn,
	isMap,
	type MapValue,
	type Value,
	typeName,
} from "../values";

function expectMap(name: string, v: Value): MapValue {
	if (!isMap(v)) {
		throw new Error(`${name}: expected map, got ${typeName(v)}`);
	}
	return v;
}

function expectStr(name: string, v: Value, what: string): string {
	if (typeof v !== "string") {
		throw new Error(`${name}: ${what} must be str, got ${typeName(v)}`);
	}
	return v;
}

/**
 * List of keys in a map, in insertion order.
 *
 * @param {map} m - the map
 * @returns {list} list of string keys
 *
 * @example
 * keys({name: "ana", age: 30}) // => ["name", "age"]
 */
export const keys: BuiltinFn = {
	kind: "builtin",
	name: "keys",
	arity: 1,
	call: (args) => {
		const m = expectMap("keys", args[0] ?? null);
		return Object.keys(m.entries);
	},
};

/**
 * List of values in a map, in insertion order.
 *
 * @param {map} m - the map
 * @returns {list} list of values
 *
 * @example
 * values({name: "ana", age: 30}) // => ["ana", 30]
 */
export const values: BuiltinFn = {
	kind: "builtin",
	name: "values",
	arity: 1,
	call: (args) => {
		const m = expectMap("values", args[0] ?? null);
		return Object.keys(m.entries).map((k) => m.entries[k]!);
	},
};

/**
 * Look up a key in a map. Errors if the key is missing.
 * For a safe lookup with a fallback, use `get_or`.
 *
 * @param {map} m - the map
 * @param {str} key - the key to look up
 * @returns {any} the value at `key`
 *
 * @example
 * get({a: 1, b: 2}, "a") // => 1
 */
export const get: BuiltinFn = {
	kind: "builtin",
	name: "get",
	arity: 2,
	call: (args) => {
		const m = expectMap("get", args[0] ?? null);
		const k = expectStr("get", args[1] ?? null, "key");
		if (!Object.prototype.hasOwnProperty.call(m.entries, k)) {
			throw new Error(`get: key not found: ${k}`);
		}
		return m.entries[k]!;
	},
};

/**
 * Look up a key in a map, returning a fallback when the key is missing.
 *
 * @param {map} m - the map
 * @param {str} key - the key to look up
 * @param {any} fallback - returned when `key` is not in `m`
 * @returns {any} the value at `key`, or `fallback`
 *
 * @example
 * get_or({a: 1}, "b", 0) // => 0
 */
export const get_or: BuiltinFn = {
	kind: "builtin",
	name: "get_or",
	arity: 3,
	call: (args) => {
		const m = expectMap("get_or", args[0] ?? null);
		const k = expectStr("get_or", args[1] ?? null, "key");
		if (Object.prototype.hasOwnProperty.call(m.entries, k)) {
			return m.entries[k]!;
		}
		return args[2] ?? null;
	},
};

/**
 * Return a new map with `key` set to `value` (immutable update).
 *
 * @param {map} m - the source map
 * @param {str} key - the key to set
 * @param {any} value - the value to associate
 * @returns {map} a new map with the entry added or replaced
 *
 * @example
 * put({a: 1}, "b", 2) // => {a: 1, b: 2}
 */
export const put: BuiltinFn = {
	kind: "builtin",
	name: "put",
	arity: 3,
	call: (args) => {
		const m = expectMap("put", args[0] ?? null);
		const k = expectStr("put", args[1] ?? null, "key");
		const next: Record<string, Value> = { ...m.entries };
		next[k] = args[2] ?? null;
		return { kind: "map", entries: next };
	},
};

/**
 * Return a new map without `key` (immutable update). No-op if the key is missing.
 *
 * @param {map} m - the source map
 * @param {str} key - the key to remove
 * @returns {map} a new map without the entry
 *
 * @example
 * delete({a: 1, b: 2}, "a") // => {b: 2}
 */
export const del: BuiltinFn = {
	kind: "builtin",
	name: "delete",
	arity: 2,
	call: (args) => {
		const m = expectMap("delete", args[0] ?? null);
		const k = expectStr("delete", args[1] ?? null, "key");
		if (!Object.prototype.hasOwnProperty.call(m.entries, k)) {
			return m;
		}
		const next: Record<string, Value> = { ...m.entries };
		delete next[k];
		return { kind: "map", entries: next };
	},
};

/**
 * Test whether a map has the given key.
 *
 * @param {map} m - the map
 * @param {str} key - the key to look for
 * @returns {bool} true if `key` is present
 *
 * @example
 * has_key?({a: 1}, "a") // => true
 */
export const has_key: BuiltinFn = {
	kind: "builtin",
	name: "has_key?",
	arity: 2,
	call: (args) => {
		const m = expectMap("has_key?", args[0] ?? null);
		const k = expectStr("has_key?", args[1] ?? null, "key");
		return Object.prototype.hasOwnProperty.call(m.entries, k);
	},
};

/**
 * Merge two maps. Keys from `b` overwrite those in `a`.
 *
 * @param {map} a - the base map
 * @param {map} b - the overriding map
 * @returns {map} a new merged map
 *
 * @example
 * merge({a: 1, b: 2}, {b: 3, c: 4}) // => {a: 1, b: 3, c: 4}
 */
export const merge: BuiltinFn = {
	kind: "builtin",
	name: "merge",
	arity: 2,
	call: (args) => {
		const a = expectMap("merge", args[0] ?? null);
		const b = expectMap("merge", args[1] ?? null);
		return { kind: "map", entries: { ...a.entries, ...b.entries } };
	},
};
