import { type BuiltinFn, type Value, typeName } from "../values";

function expectStr(name: string, label: string, v: Value): string {
	if (typeof v !== "string") {
		throw new Error(`${name}: ${label} must be str, got ${typeName(v)}`);
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

export const upcase = strFn("upcase", (s) => s.toUpperCase());
export const downcase = strFn("downcase", (s) => s.toLowerCase());
export const trim = strFn("trim", (s) => s.trim());

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

export const starts_with = strPredicate("starts_with?", (s, n) =>
	s.startsWith(n),
);
export const ends_with = strPredicate("ends_with?", (s, n) => s.endsWith(n));
export const contains = strPredicate("contains?", (s, n) => s.includes(n));
