import { type BuiltinFn, typeName, type Value } from "../values";
import { to_float, to_int } from "./numbers";

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

export const try_to_int = wrapResult("try_to_int", to_int);
export const try_to_float = wrapResult("try_to_float", to_float);
