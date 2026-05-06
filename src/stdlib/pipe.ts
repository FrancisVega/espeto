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

export const when = gate("when", (cond) => cond);
export const unless = gate("unless", (cond) => !cond);

export const id: BuiltinFn = {
	kind: "builtin",
	name: "id",
	arity: 1,
	call: (args) => args[0] ?? null,
};
