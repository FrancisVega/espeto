import {
	type BuiltinFn,
	isCallable,
	isList,
	isMap,
	type Value,
	typeName,
} from "../values";

export const length: BuiltinFn = {
	kind: "builtin",
	name: "length",
	arity: 1,
	call: (args) => {
		const v: Value = args[0] ?? null;
		if (typeof v === "string") return BigInt(v.length);
		if (isList(v)) return BigInt(v.length);
		if (isMap(v)) return BigInt(Object.keys(v.entries).length);
		throw new Error(`length: expected str, list or map, got ${typeName(v)}`);
	},
};

export const head: BuiltinFn = {
	kind: "builtin",
	name: "head",
	arity: 1,
	call: (args) => {
		const v: Value = args[0] ?? null;
		if (!isList(v)) {
			throw new Error(`head: expected list, got ${typeName(v)}`);
		}
		if (v.length === 0) {
			throw new Error("head: empty list");
		}
		return v[0]!;
	},
};

export const tail: BuiltinFn = {
	kind: "builtin",
	name: "tail",
	arity: 1,
	call: (args) => {
		const v: Value = args[0] ?? null;
		if (!isList(v)) {
			throw new Error(`tail: expected list, got ${typeName(v)}`);
		}
		if (v.length === 0) {
			throw new Error("tail: empty list");
		}
		return v.slice(1);
	},
};

export const map: BuiltinFn = {
	kind: "builtin",
	name: "map",
	arity: 2,
	call: (args, invoke) => {
		const list: Value = args[0] ?? null;
		const fn: Value = args[1] ?? null;
		if (!isList(list)) {
			throw new Error(`map: expected list, got ${typeName(list)}`);
		}
		if (!isCallable(fn)) {
			throw new Error(`map: fn must be callable, got ${typeName(fn)}`);
		}
		return list.map((it) => invoke(fn, [it]));
	},
};

export const filter: BuiltinFn = {
	kind: "builtin",
	name: "filter",
	arity: 2,
	call: (args, invoke) => {
		const list: Value = args[0] ?? null;
		const fn: Value = args[1] ?? null;
		if (!isList(list)) {
			throw new Error(`filter: expected list, got ${typeName(list)}`);
		}
		if (!isCallable(fn)) {
			throw new Error(`filter: fn must be callable, got ${typeName(fn)}`);
		}
		const out: Value[] = [];
		for (const it of list) {
			const r = invoke(fn, [it]);
			if (typeof r !== "boolean") {
				throw new Error(
					`filter: predicate must return bool, got ${typeName(r)}`,
				);
			}
			if (r) out.push(it);
		}
		return out;
	},
};

export const reduce: BuiltinFn = {
	kind: "builtin",
	name: "reduce",
	arity: 3,
	call: (args, invoke) => {
		const list: Value = args[0] ?? null;
		let acc: Value = args[1] ?? null;
		const fn: Value = args[2] ?? null;
		if (!isList(list)) {
			throw new Error(`reduce: expected list, got ${typeName(list)}`);
		}
		if (!isCallable(fn)) {
			throw new Error(`reduce: fn must be callable, got ${typeName(fn)}`);
		}
		for (const it of list) {
			acc = invoke(fn, [acc, it]);
		}
		return acc;
	},
};

export const each: BuiltinFn = {
	kind: "builtin",
	name: "each",
	arity: 2,
	call: (args, invoke) => {
		const list: Value = args[0] ?? null;
		const fn: Value = args[1] ?? null;
		if (!isList(list)) {
			throw new Error(`each: expected list, got ${typeName(list)}`);
		}
		if (!isCallable(fn)) {
			throw new Error(`each: fn must be callable, got ${typeName(fn)}`);
		}
		for (const it of list) {
			invoke(fn, [it]);
		}
		return null;
	},
};

function expectList(name: string, label: string, v: Value): Value[] {
	if (!isList(v)) {
		throw new Error(`${name}: ${label} must be list, got ${typeName(v)}`);
	}
	return v;
}

function expectInt(name: string, label: string, v: Value): bigint {
	if (typeof v !== "bigint") {
		throw new Error(`${name}: ${label} must be int, got ${typeName(v)}`);
	}
	return v;
}

export const concat: BuiltinFn = {
	kind: "builtin",
	name: "concat",
	arity: 2,
	call: (args) => {
		const a = expectList("concat", "first", args[0] ?? null);
		const b = expectList("concat", "second", args[1] ?? null);
		return [...a, ...b];
	},
};

export const reverse: BuiltinFn = {
	kind: "builtin",
	name: "reverse",
	arity: 1,
	call: (args) => {
		const list = expectList("reverse", "arg", args[0] ?? null);
		return [...list].reverse();
	},
};

export const take: BuiltinFn = {
	kind: "builtin",
	name: "take",
	arity: 2,
	call: (args) => {
		const list = expectList("take", "list", args[0] ?? null);
		const n = expectInt("take", "n", args[1] ?? null);
		if (n < 0n) {
			throw new Error("take: n must be non-negative");
		}
		return list.slice(0, Number(n));
	},
};

export const drop: BuiltinFn = {
	kind: "builtin",
	name: "drop",
	arity: 2,
	call: (args) => {
		const list = expectList("drop", "list", args[0] ?? null);
		const n = expectInt("drop", "n", args[1] ?? null);
		if (n < 0n) {
			throw new Error("drop: n must be non-negative");
		}
		return list.slice(Number(n));
	},
};

export const find: BuiltinFn = {
	kind: "builtin",
	name: "find",
	arity: 2,
	call: (args, invoke) => {
		const list = expectList("find", "list", args[0] ?? null);
		const fn: Value = args[1] ?? null;
		if (!isCallable(fn)) {
			throw new Error(`find: fn must be callable, got ${typeName(fn)}`);
		}
		for (const it of list) {
			const r = invoke(fn, [it]);
			if (typeof r !== "boolean") {
				throw new Error(
					`find: predicate must return bool, got ${typeName(r)}`,
				);
			}
			if (r) return it;
		}
		return null;
	},
};

function valueEquals(a: Value, b: Value): boolean {
	if (a === null || b === null) return a === b;
	if (isList(a) || isList(b)) {
		if (!isList(a) || !isList(b)) return false;
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!valueEquals(a[i]!, b[i]!)) return false;
		}
		return true;
	}
	if (isMap(a) || isMap(b)) {
		if (!isMap(a) || !isMap(b)) return false;
		const ak = Object.keys(a.entries);
		const bk = Object.keys(b.entries);
		if (ak.length !== bk.length) return false;
		for (const k of ak) {
			if (!Object.prototype.hasOwnProperty.call(b.entries, k)) return false;
			if (!valueEquals(a.entries[k]!, b.entries[k]!)) return false;
		}
		return true;
	}
	if (typeof a !== typeof b) return false;
	return a === b;
}

function compareSortable(name: string, a: Value, b: Value): number {
	if (typeof a === "bigint" && typeof b === "bigint") {
		return a < b ? -1 : a > b ? 1 : 0;
	}
	if (typeof a === "number" && typeof b === "number") {
		return a < b ? -1 : a > b ? 1 : 0;
	}
	if (typeof a === "string" && typeof b === "string") {
		return a < b ? -1 : a > b ? 1 : 0;
	}
	throw new Error(
		`${name}: cannot compare ${typeName(a)} and ${typeName(b)} (sortable types: int, float, str)`,
	);
}

export const sort: BuiltinFn = {
	kind: "builtin",
	name: "sort",
	arity: 1,
	call: (args) => {
		const list = expectList("sort", "arg", args[0] ?? null);
		const copy = [...list];
		copy.sort((a, b) => compareSortable("sort", a, b));
		return copy;
	},
};

export const sort_by: BuiltinFn = {
	kind: "builtin",
	name: "sort_by",
	arity: 2,
	call: (args, invoke) => {
		const list = expectList("sort_by", "list", args[0] ?? null);
		const fn: Value = args[1] ?? null;
		if (!isCallable(fn)) {
			throw new Error(`sort_by: fn must be callable, got ${typeName(fn)}`);
		}
		const keyed = list.map((it) => ({ it, key: invoke(fn, [it]) }));
		keyed.sort((a, b) => compareSortable("sort_by", a.key, b.key));
		return keyed.map((k) => k.it);
	},
};

export const unique: BuiltinFn = {
	kind: "builtin",
	name: "unique",
	arity: 1,
	call: (args) => {
		const list = expectList("unique", "arg", args[0] ?? null);
		const out: Value[] = [];
		for (const it of list) {
			if (isCallable(it)) {
				throw new Error("unique: list contains fn (not comparable)");
			}
			if (!out.some((seen) => valueEquals(seen, it))) {
				out.push(it);
			}
		}
		return out;
	},
};

export const range: BuiltinFn = {
	kind: "builtin",
	name: "range",
	arity: -1,
	call: (args) => {
		let start: bigint;
		let stop: bigint;
		if (args.length === 1) {
			start = 0n;
			stop = expectInt("range", "stop", args[0] ?? null);
		} else if (args.length === 2) {
			start = expectInt("range", "start", args[0] ?? null);
			stop = expectInt("range", "stop", args[1] ?? null);
		} else {
			throw new Error(
				`range: expected 1 or 2 args, got ${args.length}`,
			);
		}
		const out: Value[] = [];
		for (let i = start; i < stop; i++) {
			out.push(i);
		}
		return out;
	},
};

export const zip: BuiltinFn = {
	kind: "builtin",
	name: "zip",
	arity: 2,
	call: (args) => {
		const a = expectList("zip", "first", args[0] ?? null);
		const b = expectList("zip", "second", args[1] ?? null);
		const len = Math.min(a.length, b.length);
		const out: Value[] = [];
		for (let i = 0; i < len; i++) {
			out.push([a[i]!, b[i]!]);
		}
		return out;
	},
};
