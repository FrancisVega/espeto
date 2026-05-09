import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { type BuiltinFn, type Value, typeName } from "../values";
import { wrapResult } from "./errors";
import { valueToStr } from "./numbers";

function expectStr(name: string, label: string, v: Value): string {
	if (typeof v !== "string") {
		throw new Error(`${name}: ${label} must be str, got ${typeName(v)}`);
	}
	return v;
}

/**
 * Write a value to stdout, followed by a newline. Non-string values are
 * stringified via the same rules as `to_str` (lists, maps, ints, floats,
 * bool and nil are rendered).
 *
 * @param {any} v - the value to print
 * @returns {nil} always nil
 *
 * @example
 * print("hello")     // prints: hello
 * print(42)          // prints: 42
 * print([1, 2, 3])   // prints: [1, 2, 3]
 */
export const print: BuiltinFn = {
	kind: "builtin",
	name: "print",
	arity: 1,
	call: (args) => {
		const v = args[0] ?? null;
		process.stdout.write(`${valueToStr(v)}\n`);
		return null;
	},
};

/**
 * Read a UTF-8 file into a string. Errors on missing file, permission denied,
 * or directory paths. Use `try_read` for a result-wrapped variant.
 *
 * @param {str} path - filesystem path
 * @returns {str} the file contents
 *
 * @example
 * read("config.json")
 */
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

/**
 * Result-wrapped variant of `read`. Returns `{ok: true, value: str}`
 * on success or `{ok: false, error: str}` on failure.
 *
 * @param {str} path - filesystem path
 * @returns {map} `{ok, value}` or `{ok, error}`
 *
 * @example
 * try_read("missing.txt") // => {ok: false, error: "read: file not found: missing.txt"}
 */
export const try_read = wrapResult("try_read", read);

/**
 * Write a string to a file as UTF-8, replacing any existing content.
 * Errors if the parent directory does not exist or on permission/path issues.
 *
 * @param {str} path - filesystem path
 * @param {str} content - the content to write
 * @returns {nil} always nil
 *
 * @example
 * write("out.txt", "hello")
 */
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

/**
 * Result-wrapped variant of `write`. Returns `{ok: true, value: nil}`
 * on success or `{ok: false, error: str}` on failure.
 *
 * @param {str} path - filesystem path
 * @param {str} content - the content to write
 * @returns {map} `{ok, value}` or `{ok, error}`
 *
 * @example
 * try_write("out.txt", "hello") // => {ok: true, value: nil}
 */
export const try_write = wrapResult("try_write", write);

/**
 * Test whether a path exists on the filesystem.
 *
 * @param {str} path - filesystem path
 * @returns {bool} true if the path exists
 *
 * @example
 * exists?("config.json") // => true
 */
export const exists: BuiltinFn = {
	kind: "builtin",
	name: "exists?",
	arity: 1,
	call: (args) => {
		const path = expectStr("exists?", "path", args[0] ?? null);
		return existsSync(path);
	},
};

/**
 * Read an environment variable. Errors if the variable is not set.
 * Use `env_or` to provide a fallback.
 *
 * @param {str} name - environment variable name
 * @returns {str} the value
 *
 * @example
 * env("HOME") // => "/Users/hisco"
 */
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

/**
 * Read an environment variable, returning a fallback when unset.
 *
 * @param {str} name - environment variable name
 * @param {str} default - returned when the variable is not set
 * @returns {str} the value or the fallback
 *
 * @example
 * env_or("PORT", "3000") // => "3000" if PORT not set
 */
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

/**
 * Test whether stdout is connected to a terminal (TTY). Returns false when
 * stdout is a pipe or redirected to a file. Useful for deciding whether to
 * emit ANSI escape codes, progress spinners or other terminal-only output.
 *
 * @returns {bool} true if stdout is a TTY
 *
 * @example
 * if tty?(), do: msg |> red |> print, else: msg |> print
 */
export const tty: BuiltinFn = {
	kind: "builtin",
	name: "tty?",
	arity: 0,
	call: () => process.stdout.isTTY === true,
};
