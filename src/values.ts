import type { Stmt } from "./ast";
import type { Env } from "./env";
import type { Span } from "./errors";

export type Value =
	| string
	| number
	| bigint
	| boolean
	| null
	| BuiltinFn
	| UserFn
	| MapValue
	| StreamValue
	| Value[];

export type MapValue = {
	kind: "map";
	entries: Record<string, Value>;
};

export type StreamValue = {
	kind: "stream";
	iter: Iterator<Value>;
	consumed: boolean;
	cleanup: () => void;
};

export type Invoke = (callee: BuiltinFn | UserFn, args: Value[]) => Value;

export type BuiltinCtx = {
	span: Span;
	source: string;
};

export type BuiltinFn = {
	kind: "builtin";
	name: string;
	arity: number;
	call: (args: Value[], invoke: Invoke, ctx: BuiltinCtx | null) => Value;
};

export type UserFn = {
	kind: "userfn";
	name: string;
	params: string[];
	body: Stmt[];
	closure: Env;
	source: string;
};

export function isBuiltin(v: Value): v is BuiltinFn {
	return (
		typeof v === "object" &&
		v !== null &&
		!Array.isArray(v) &&
		"kind" in v &&
		v.kind === "builtin"
	);
}

export function isUserFn(v: Value): v is UserFn {
	return (
		typeof v === "object" &&
		v !== null &&
		!Array.isArray(v) &&
		"kind" in v &&
		v.kind === "userfn"
	);
}

export function isCallable(v: Value): v is BuiltinFn | UserFn {
	return isBuiltin(v) || isUserFn(v);
}

export function isList(v: Value): v is Value[] {
	return Array.isArray(v);
}

export function isMap(v: Value): v is MapValue {
	return (
		typeof v === "object" &&
		v !== null &&
		!Array.isArray(v) &&
		"kind" in v &&
		v.kind === "map"
	);
}

export function isStream(v: Value): v is StreamValue {
	return (
		typeof v === "object" &&
		v !== null &&
		!Array.isArray(v) &&
		"kind" in v &&
		v.kind === "stream"
	);
}

export function typeName(v: Value): string {
	if (v === null) return "nil";
	if (typeof v === "string") return "str";
	if (typeof v === "bigint") return "int";
	if (typeof v === "number") return "float";
	if (typeof v === "boolean") return "bool";
	if (isList(v)) return "list";
	if (isMap(v)) return "map";
	if (isStream(v)) return "stream";
	if (isBuiltin(v) || isUserFn(v)) return "fn";
	return "unknown";
}
