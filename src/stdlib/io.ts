import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { type BuiltinFn, type Value, typeName } from "../values";
import { wrapResult } from "./errors";

function expectStr(name: string, label: string, v: Value): string {
	if (typeof v !== "string") {
		throw new Error(`${name}: ${label} must be str, got ${typeName(v)}`);
	}
	return v;
}

export const print: BuiltinFn = {
	kind: "builtin",
	name: "print",
	arity: 1,
	call: (args) => {
		const s = args[0] ?? null;
		expectStr("print", "arg", s);
		process.stdout.write(`${s as string}\n`);
		return null;
	},
};

export const read: BuiltinFn = {
	kind: "builtin",
	name: "read",
	arity: 1,
	call: (args) => {
		const path = expectStr("read", "path", args[0] ?? null);
		try {
			return readFileSync(path, { encoding: "utf-8" });
		} catch (e) {
			const code = (e as NodeJS.ErrnoException).code;
			if (code === "ENOENT") {
				throw new Error(`read: file not found: ${path}`);
			}
			if (code === "EACCES") {
				throw new Error(`read: permission denied: ${path}`);
			}
			if (code === "EISDIR") {
				throw new Error(`read: is a directory: ${path}`);
			}
			throw new Error(
				`read: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	},
};

export const try_read = wrapResult("try_read", read);

export const write: BuiltinFn = {
	kind: "builtin",
	name: "write",
	arity: 2,
	call: (args) => {
		const path = expectStr("write", "path", args[0] ?? null);
		const content = expectStr("write", "content", args[1] ?? null);
		try {
			writeFileSync(path, content, { encoding: "utf-8" });
			return null;
		} catch (e) {
			const code = (e as NodeJS.ErrnoException).code;
			if (code === "ENOENT") {
				throw new Error(`write: parent directory not found: ${path}`);
			}
			if (code === "EACCES") {
				throw new Error(`write: permission denied: ${path}`);
			}
			if (code === "EISDIR") {
				throw new Error(`write: is a directory: ${path}`);
			}
			throw new Error(
				`write: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	},
};

export const try_write = wrapResult("try_write", write);

export const exists: BuiltinFn = {
	kind: "builtin",
	name: "exists?",
	arity: 1,
	call: (args) => {
		const path = expectStr("exists?", "path", args[0] ?? null);
		return existsSync(path);
	},
};

export const env_var: BuiltinFn = {
	kind: "builtin",
	name: "env",
	arity: 1,
	call: (args) => {
		const name = expectStr("env", "name", args[0] ?? null);
		const v = process.env[name];
		if (v === undefined) {
			throw new Error(`env: variable not set: ${name}`);
		}
		return v;
	},
};

export const env_or: BuiltinFn = {
	kind: "builtin",
	name: "env_or",
	arity: 2,
	call: (args) => {
		const name = expectStr("env_or", "name", args[0] ?? null);
		const fallback = expectStr("env_or", "default", args[1] ?? null);
		const v = process.env[name];
		return v === undefined ? fallback : v;
	},
};
