import { AssertionError } from "../errors";
import { type BuiltinFn, isCallable, typeName } from "../values";

/**
 * Assert that calling `fn` raises. Optionally check the raise message exactly.
 * Re-throws AssertionError from inside `fn` (so nested asserts still fail the test).
 *
 * @param {fn} fn - zero-arity callable expected to raise
 * @param {str} expected_msg - optional exact match for the raise message
 * @returns {nil} nil on success
 *
 * @example
 * assert_raise(fn => parse(""), "expected non-empty")
 * assert_raise(fn => raise("boom"))
 */
export const assert_raise: BuiltinFn = {
	kind: "builtin",
	name: "assert_raise",
	arity: -1,
	call: (args, invoke, ctx) => {
		if (args.length !== 1 && args.length !== 2) {
			throw new Error(
				`assert_raise: expected 1 or 2 args, got ${args.length}`,
			);
		}
		const fn = args[0] ?? null;
		const expectedMsg = args[1];
		if (!isCallable(fn)) {
			throw new Error(
				`assert_raise: fn must be callable, got ${typeName(fn)}`,
			);
		}
		if (expectedMsg !== undefined && typeof expectedMsg !== "string") {
			throw new Error(
				`assert_raise: expected_msg must be str, got ${typeName(expectedMsg)}`,
			);
		}
		const span = ctx?.span;
		const source = ctx?.source ?? "";
		try {
			invoke(fn, []);
		} catch (e) {
			if (e instanceof AssertionError) throw e;
			const msg = e instanceof Error ? e.message : String(e);
			if (expectedMsg !== undefined && msg !== expectedMsg) {
				throw new AssertionError(
					`assertion failed\n   expected raise: ${JSON.stringify(expectedMsg)}\n        got raise: ${JSON.stringify(msg)}`,
					span ?? { file: "<unknown>", line: 0, col: 0, length: 0 },
					source,
				);
			}
			return null;
		}
		throw new AssertionError(
			"assertion failed: expected raise, got nothing",
			span ?? { file: "<unknown>", line: 0, col: 0, length: 0 },
			source,
		);
	},
};
