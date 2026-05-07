import {
	type BuiltinFn,
	isCallable,
	isList,
	isMap,
	type Value,
} from "../values";

function predicate(name: string, test: (v: Value) => boolean): BuiltinFn {
	return {
		kind: "builtin",
		name,
		arity: 1,
		call: (args) => test(args[0] ?? null),
	};
}

/**
 * Test whether a value is an int.
 *
 * @param {any} v - the value to test
 * @returns {bool} true if `v` is an int
 *
 * @example
 * is_int?(42) // => true
 */
export const is_int = predicate("is_int?", (v) => typeof v === "bigint");

/**
 * Test whether a value is a float.
 *
 * @param {any} v - the value to test
 * @returns {bool} true if `v` is a float
 *
 * @example
 * is_float?(3.14) // => true
 */
export const is_float = predicate("is_float?", (v) => typeof v === "number");

/**
 * Test whether a value is a string.
 *
 * @param {any} v - the value to test
 * @returns {bool} true if `v` is a string
 *
 * @example
 * is_str?("hi") // => true
 */
export const is_str = predicate("is_str?", (v) => typeof v === "string");

/**
 * Test whether a value is a bool.
 *
 * @param {any} v - the value to test
 * @returns {bool} true if `v` is a bool
 *
 * @example
 * is_bool?(true) // => true
 */
export const is_bool = predicate("is_bool?", (v) => typeof v === "boolean");

/**
 * Test whether a value is nil.
 *
 * @param {any} v - the value to test
 * @returns {bool} true if `v` is nil
 *
 * @example
 * is_nil?(nil) // => true
 */
export const is_nil = predicate("is_nil?", (v) => v === null);

/**
 * Test whether a value is a list.
 *
 * @param {any} v - the value to test
 * @returns {bool} true if `v` is a list
 *
 * @example
 * is_list?([1, 2]) // => true
 */
export const is_list = predicate("is_list?", (v) => isList(v));

/**
 * Test whether a value is a map.
 *
 * @param {any} v - the value to test
 * @returns {bool} true if `v` is a map
 *
 * @example
 * is_map?({a: 1}) // => true
 */
export const is_map = predicate("is_map?", (v) => isMap(v));

/**
 * Test whether a value is a function (builtin or user-defined).
 *
 * @param {any} v - the value to test
 * @returns {bool} true if `v` is callable
 *
 * @example
 * is_fn?(upcase) // => true
 */
export const is_fn = predicate("is_fn?", (v) => isCallable(v));
