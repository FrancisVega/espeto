import { type BuiltinFn, typeName, type Value } from "../values";
import { to_float, to_int } from "./numbers";

/**
 * Raise a runtime error with the given message. Caught by `try/rescue` blocks.
 *
 * @param {str} msg - the error message
 * @returns {nil} never returns
 *
 * @example
 * raise("invalid state")
 */
export const raise: BuiltinFn = {
	kind: "builtin",
	name: "raise",
	arity: 1,
	call: (args) => {
		const v = args[0] ?? null;
		if (typeof v !== "string") {
			throw new Error(`raise: expected str, got ${typeName(v)}`);
		}
		throw new Error(v);
	},
};

export function wrapResult(name: string, target: BuiltinFn): BuiltinFn {
	return {
		kind: "builtin",
		name,
		arity: target.arity,
		call: (args, invoke) => {
			try {
				const value = invoke(target, args);
				const ok: Value = {
					kind: "map",
					entries: { ok: true, value },
				};
				return ok;
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				const err: Value = {
					kind: "map",
					entries: { ok: false, error: msg },
				};
				return err;
			}
		},
	};
}

/**
 * Result-wrapped variant of `to_int`. Returns `{ok: true, value: int}`
 * on success or `{ok: false, error: str}` on failure.
 *
 * @param {int|float|str} v - the value to convert
 * @returns {map} `{ok, value}` or `{ok, error}`
 *
 * @example
 * try_to_int("42")  // => {ok: true, value: 42}
 * try_to_int("nan") // => {ok: false, error: "to_int: ..."}
 */
export const try_to_int = wrapResult("try_to_int", to_int);

/**
 * Result-wrapped variant of `to_float`. Returns `{ok: true, value: float}`
 * on success or `{ok: false, error: str}` on failure.
 *
 * @param {int|float|str} v - the value to convert
 * @returns {map} `{ok, value}` or `{ok, error}`
 *
 * @example
 * try_to_float("3.14") // => {ok: true, value: 3.14}
 */
export const try_to_float = wrapResult("try_to_float", to_float);
