import { floatToString } from "../evaluator";
import {
	type BuiltinFn,
	isList,
	isMap,
	isBuiltin,
	isStream,
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

/**
 * Integer division (truncated toward zero).
 * Errors on division by zero.
 *
 * @param {int} a - dividend
 * @param {int} b - divisor (must not be zero)
 * @returns {int} the integer quotient
 *
 * @example
 * div(7, 2) // => 3
 */
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

/**
 * Modulo (always non-negative for positive divisor).
 * Errors on division by zero.
 *
 * @param {int} a - dividend
 * @param {int} b - divisor (must not be zero)
 * @returns {int} the remainder
 *
 * @example
 * mod(7, 3)  // => 1
 * mod(-1, 3) // => 2
 */
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

/**
 * Absolute value of a number. Returns the same numeric type as the input.
 *
 * @param {int|float} v - the number
 * @returns {int|float} non-negative magnitude of `v`
 *
 * @example
 * abs(-3)    // => 3
 * abs(-2.5)  // => 2.5
 */
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

/**
 * Round a number to the nearest integer (half away from zero).
 * Ints are returned as-is.
 *
 * @param {int|float} v - the number to round
 * @returns {int} the rounded integer
 *
 * @example
 * round(2.5) // => 3
 * round(2.4) // => 2
 */
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

/**
 * Round down toward negative infinity.
 * Ints are returned as-is.
 *
 * @param {int|float} v - the number to floor
 * @returns {int} the floored integer
 *
 * @example
 * floor(2.9)  // => 2
 * floor(-2.1) // => -3
 */
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

/**
 * Round up toward positive infinity.
 * Ints are returned as-is.
 *
 * @param {int|float} v - the number to ceil
 * @returns {int} the ceil integer
 *
 * @example
 * ceil(2.1)  // => 3
 * ceil(-2.9) // => -2
 */
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

/**
 * Smaller of two numbers. Both args must be the same numeric type.
 *
 * @param {int|float} a - first number
 * @param {int|float} b - second number
 * @returns {int|float} the smaller value
 *
 * @example
 * min(2, 5) // => 2
 */
export const min: BuiltinFn = {
	kind: "builtin",
	name: "min",
	arity: 2,
	call: (args) => pickExtreme("min", args, true),
};

/**
 * Larger of two numbers. Both args must be the same numeric type.
 *
 * @param {int|float} a - first number
 * @param {int|float} b - second number
 * @returns {int|float} the larger value
 *
 * @example
 * max(2, 5) // => 5
 */
export const max: BuiltinFn = {
	kind: "builtin",
	name: "max",
	arity: 2,
	call: (args) => pickExtreme("max", args, false),
};

/**
 * Convert a number or numeric string to int (truncated).
 * Errors on NaN/Infinity or unparsable strings.
 *
 * @param {int|float|str} v - the value to convert
 * @returns {int} the integer value
 *
 * @example
 * to_int("42")  // => 42
 * to_int(3.7)   // => 3
 */
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

/**
 * Convert a number or numeric string to float.
 * Errors on unparsable strings.
 *
 * @param {int|float|str} v - the value to convert
 * @returns {float} the float value
 *
 * @example
 * to_float("3.14") // => 3.14
 * to_float(2)      // => 2.0
 */
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

export function valueToStr(v: Value): string {
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
	if (isStream(v)) {
		throw new Error(
			"to_str: streams cannot be stringified (consume with each/collect first)",
		);
	}
	if (isBuiltin(v) || isUserFn(v)) return `#fn<${v.name}>`;
	return "?";
}

/**
 * Convert any value to its string representation.
 * Lists and maps recurse; functions render as `#fn<name>`.
 *
 * @param {any} v - the value to stringify
 * @returns {str} the textual representation
 *
 * @example
 * to_str(42)         // => "42"
 * to_str([1, 2])     // => "[1, 2]"
 * to_str(nil)        // => "nil"
 */
export const to_str: BuiltinFn = {
	kind: "builtin",
	name: "to_str",
	arity: 1,
	call: (args) => valueToStr(args[0] ?? null),
};
