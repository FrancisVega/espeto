import { floatToString } from "../evaluator";
import {
	type BuiltinFn,
	isList,
	isMap,
	isBuiltin,
	isUserFn,
	type Value,
	typeName,
} from "../values";

function asInt(name: string, label: string, v: Value): bigint {
	if (typeof v !== "bigint") {
		throw new Error(`${name}: ${label} must be int, got ${typeName(v)}`);
	}
	return v;
}

export const div: BuiltinFn = {
	kind: "builtin",
	name: "div",
	arity: 2,
	call: (args) => {
		const a = asInt("div", "dividend", args[0] ?? null);
		const b = asInt("div", "divisor", args[1] ?? null);
		if (b === 0n) {
			throw new Error("div: division by zero");
		}
		return a / b;
	},
};

export const mod: BuiltinFn = {
	kind: "builtin",
	name: "mod",
	arity: 2,
	call: (args) => {
		const a = asInt("mod", "dividend", args[0] ?? null);
		const b = asInt("mod", "divisor", args[1] ?? null);
		if (b === 0n) {
			throw new Error("mod: division by zero");
		}
		return ((a % b) + b) % b;
	},
};

export const abs: BuiltinFn = {
	kind: "builtin",
	name: "abs",
	arity: 1,
	call: (args) => {
		const v = args[0] ?? null;
		if (typeof v === "bigint") return v < 0n ? -v : v;
		if (typeof v === "number") return Math.abs(v);
		throw new Error(`abs: expected number, got ${typeName(v)}`);
	},
};

export const round: BuiltinFn = {
	kind: "builtin",
	name: "round",
	arity: 1,
	call: (args) => {
		const v = args[0] ?? null;
		if (typeof v === "bigint") return v;
		if (typeof v === "number") return BigInt(Math.round(v));
		throw new Error(`round: expected number, got ${typeName(v)}`);
	},
};

export const floor: BuiltinFn = {
	kind: "builtin",
	name: "floor",
	arity: 1,
	call: (args) => {
		const v = args[0] ?? null;
		if (typeof v === "bigint") return v;
		if (typeof v === "number") return BigInt(Math.floor(v));
		throw new Error(`floor: expected number, got ${typeName(v)}`);
	},
};

export const ceil: BuiltinFn = {
	kind: "builtin",
	name: "ceil",
	arity: 1,
	call: (args) => {
		const v = args[0] ?? null;
		if (typeof v === "bigint") return v;
		if (typeof v === "number") return BigInt(Math.ceil(v));
		throw new Error(`ceil: expected number, got ${typeName(v)}`);
	},
};

function pickExtreme(name: string, args: Value[], pickLess: boolean): Value {
	const a = args[0] ?? null;
	const b = args[1] ?? null;
	if (typeof a !== typeof b) {
		throw new Error(
			`${name}: requires same numeric type, got ${typeName(a)} and ${typeName(b)}`,
		);
	}
	if (typeof a === "bigint" || typeof a === "number") {
		const aLess = a < (b as typeof a);
		return (pickLess ? aLess : !aLess) ? a : (b as Value);
	}
	throw new Error(`${name}: expected number, got ${typeName(a)}`);
}

export const min: BuiltinFn = {
	kind: "builtin",
	name: "min",
	arity: 2,
	call: (args) => pickExtreme("min", args, true),
};

export const max: BuiltinFn = {
	kind: "builtin",
	name: "max",
	arity: 2,
	call: (args) => pickExtreme("max", args, false),
};

export const to_int: BuiltinFn = {
	kind: "builtin",
	name: "to_int",
	arity: 1,
	call: (args) => {
		const v = args[0] ?? null;
		if (typeof v === "bigint") return v;
		if (typeof v === "number") {
			if (!Number.isFinite(v)) {
				throw new Error("to_int: cannot convert NaN or Infinity to int");
			}
			return BigInt(Math.trunc(v));
		}
		if (typeof v === "string") {
			if (!/^-?\d+$/.test(v)) {
				throw new Error(`to_int: cannot parse '${v}' as int`);
			}
			return BigInt(v);
		}
		throw new Error(`to_int: expected int, float or str, got ${typeName(v)}`);
	},
};

export const to_float: BuiltinFn = {
	kind: "builtin",
	name: "to_float",
	arity: 1,
	call: (args) => {
		const v = args[0] ?? null;
		if (typeof v === "number") return v;
		if (typeof v === "bigint") return Number(v);
		if (typeof v === "string") {
			if (!/^-?\d+(\.\d+)?$/.test(v)) {
				throw new Error(`to_float: cannot parse '${v}' as float`);
			}
			return Number(v);
		}
		throw new Error(
			`to_float: expected int, float or str, got ${typeName(v)}`,
		);
	},
};

function valueToStr(v: Value): string {
	if (v === null) return "nil";
	if (typeof v === "string") return v;
	if (typeof v === "bigint") return v.toString();
	if (typeof v === "number") return floatToString(v);
	if (typeof v === "boolean") return v ? "true" : "false";
	if (isList(v)) return `[${v.map(valueToStr).join(", ")}]`;
	if (isMap(v)) {
		const parts = Object.keys(v.entries).map(
			(k) => `${k}: ${valueToStr(v.entries[k]!)}`,
		);
		return `{${parts.join(", ")}}`;
	}
	if (isBuiltin(v) || isUserFn(v)) return `#fn<${v.name}>`;
	return "?";
}

export const to_str: BuiltinFn = {
	kind: "builtin",
	name: "to_str",
	arity: 1,
	call: (args) => valueToStr(args[0] ?? null),
};
