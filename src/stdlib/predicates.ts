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

export const is_int = predicate("is_int?", (v) => typeof v === "bigint");
export const is_float = predicate("is_float?", (v) => typeof v === "number");
export const is_str = predicate("is_str?", (v) => typeof v === "string");
export const is_bool = predicate("is_bool?", (v) => typeof v === "boolean");
export const is_nil = predicate("is_nil?", (v) => v === null);
export const is_list = predicate("is_list?", (v) => isList(v));
export const is_map = predicate("is_map?", (v) => isMap(v));
export const is_fn = predicate("is_fn?", (v) => isCallable(v));
