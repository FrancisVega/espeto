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

export const keys: BuiltinFn = {
	kind: "builtin",
	name: "keys",
	arity: 1,
	call: (args) => {
		const m = expectMap("keys", args[0] ?? null);
		return Object.keys(m.entries);
	},
};

export const values: BuiltinFn = {
	kind: "builtin",
	name: "values",
	arity: 1,
	call: (args) => {
		const m = expectMap("values", args[0] ?? null);
		return Object.keys(m.entries).map((k) => m.entries[k]!);
	},
};

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
