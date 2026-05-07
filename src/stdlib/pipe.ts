import { type BuiltinFn, isCallable, type Value, typeName } from "../values";

function gate(name: string, takeFn: (cond: boolean) => boolean): BuiltinFn {
	return {
		kind: "builtin",
		name,
		arity: 3,
		call: (args, invoke) => {
			const value: Value = args[0] ?? null;
			const cond: Value = args[1] ?? null;
			const fn: Value = args[2] ?? null;
			if (typeof cond !== "boolean") {
				throw new Error(`${name}: cond must be bool, got ${typeName(cond)}`);
			}
			if (!isCallable(fn)) {
				throw new Error(`${name}: fn must be callable, got ${typeName(fn)}`);
			}
			if (takeFn(cond)) {
				return invoke(fn, [value]);
			}
			return value;
		},
	};
}

/**
 * Pipeline gate: apply `fn` to `value` when `cond` is true, otherwise pass
 * `value` through unchanged.
 *
 * @param {any} value - the value to pass through or transform
 * @param {bool} cond - apply `fn` only if true
 * @param {fn} fn - function called with `(value)` when `cond` is true
 * @returns {any} `fn(value)` when `cond` is true, else `value`
 *
 * @example
 * 42 |> when(true, fn(x) -> x * 2 end) // => 84
 */
export const when = gate("when", (cond) => cond);

/**
 * Pipeline gate: apply `fn` to `value` when `cond` is false, otherwise pass
 * `value` through unchanged. Inverse of `when`.
 *
 * @param {any} value - the value to pass through or transform
 * @param {bool} cond - apply `fn` only if false
 * @param {fn} fn - function called with `(value)` when `cond` is false
 * @returns {any} `fn(value)` when `cond` is false, else `value`
 *
 * @example
 * 42 |> unless(false, fn(x) -> x * 2 end) // => 84
 */
export const unless = gate("unless", (cond) => !cond);

/**
 * Identity function. Returns its argument unchanged. Useful as a default
 * key function or placeholder.
 *
 * @param {any} v - the value
 * @returns {any} `v`
 *
 * @example
 * id(42) // => 42
 */
export const id: BuiltinFn = {
	kind: "builtin",
	name: "id",
	arity: 1,
	call: (args) => args[0] ?? null,
};
