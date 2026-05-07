import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import {
	type BuiltinFn,
	type Invoke,
	isStream,
	type StreamValue,
	type UserFn,
	type Value,
	typeName,
} from "../values";

type Callable = BuiltinFn | UserFn;

const CHUNK_SIZE = 64 * 1024;

function expectStr(name: string, label: string, v: Value): string {
	if (typeof v !== "string") {
		throw new Error(`${name}: ${label} must be str, got ${typeName(v)}`);
	}
	return v;
}

export function expectStream(
	name: string,
	label: string,
	v: Value,
): StreamValue {
	if (!isStream(v)) {
		throw new Error(`${name}: ${label} must be stream, got ${typeName(v)}`);
	}
	return v;
}

export function acquire(s: StreamValue, name: string): void {
	if (s.consumed) {
		throw new Error(
			`${name}: stream already consumed. to re-iterate, use collect first: list = read_lines(...) |> collect`,
		);
	}
	s.consumed = true;
}

function makeFdLineIter(fd: number, cleanup: () => void): Iterator<Value> {
	const buf = Buffer.alloc(CHUNK_SIZE);
	let leftover = "";
	let eof = false;
	let closed = false;

	const doCleanup = (): void => {
		if (!closed) {
			closed = true;
			cleanup();
		}
	};

	return {
		next(): IteratorResult<Value> {
			while (true) {
				const nl = leftover.indexOf("\n");
				if (nl !== -1) {
					const line = leftover.slice(0, nl);
					leftover = leftover.slice(nl + 1);
					return { value: line, done: false };
				}
				if (eof) {
					if (leftover.length > 0) {
						const line = leftover;
						leftover = "";
						return { value: line, done: false };
					}
					doCleanup();
					return { value: undefined as unknown as Value, done: true };
				}
				let bytesRead: number;
				try {
					bytesRead = readSync(fd, buf, 0, CHUNK_SIZE, null);
				} catch (e) {
					doCleanup();
					throw new Error(
						`stream read error: ${e instanceof Error ? e.message : String(e)}`,
					);
				}
				if (bytesRead === 0) {
					eof = true;
					continue;
				}
				leftover += buf.toString("utf-8", 0, bytesRead);
			}
		},
		return(): IteratorResult<Value> {
			doCleanup();
			return { value: undefined as unknown as Value, done: true };
		},
	};
}

function makeFdStream(fd: number, cleanup: () => void): StreamValue {
	return {
		kind: "stream",
		iter: makeFdLineIter(fd, cleanup),
		consumed: false,
		cleanup,
	};
}

function wrapIter(
	upstream: StreamValue,
	name: string,
	makeIter: (inner: Iterator<Value>) => Iterator<Value>,
): StreamValue {
	acquire(upstream, name);
	const wrapped = makeIter(upstream.iter);
	return {
		kind: "stream",
		iter: wrapped,
		consumed: false,
		cleanup: upstream.cleanup,
	};
}

export function streamMap(
	s: StreamValue,
	fn: Callable,
	invoke: Invoke,
): StreamValue {
	return wrapIter(s, "map", (inner) => ({
		next(): IteratorResult<Value> {
			const r = inner.next();
			if (r.done) return r;
			return { value: invoke(fn, [r.value]), done: false };
		},
		return(): IteratorResult<Value> {
			return (
				inner.return?.() ?? {
					value: undefined as unknown as Value,
					done: true,
				}
			);
		},
	}));
}

export function streamFilter(
	s: StreamValue,
	fn: Callable,
	invoke: Invoke,
): StreamValue {
	return wrapIter(s, "filter", (inner) => ({
		next(): IteratorResult<Value> {
			while (true) {
				const r = inner.next();
				if (r.done) return r;
				const ok = invoke(fn, [r.value]);
				if (typeof ok !== "boolean") {
					throw new Error(
						`filter: predicate must return bool, got ${typeName(ok)}`,
					);
				}
				if (ok) return r;
			}
		},
		return(): IteratorResult<Value> {
			return (
				inner.return?.() ?? {
					value: undefined as unknown as Value,
					done: true,
				}
			);
		},
	}));
}

export function streamTake(s: StreamValue, n: bigint): StreamValue {
	if (n < 0n) {
		throw new Error("take: n must be non-negative");
	}
	const limit = Number(n);
	let yielded = 0;
	return wrapIter(s, "take", (inner) => ({
		next(): IteratorResult<Value> {
			if (yielded >= limit) {
				inner.return?.();
				return { value: undefined as unknown as Value, done: true };
			}
			const r = inner.next();
			if (r.done) return r;
			yielded++;
			return r;
		},
		return(): IteratorResult<Value> {
			return (
				inner.return?.() ?? {
					value: undefined as unknown as Value,
					done: true,
				}
			);
		},
	}));
}

export function streamDrop(s: StreamValue, n: bigint): StreamValue {
	if (n < 0n) {
		throw new Error("drop: n must be non-negative");
	}
	const limit = Number(n);
	let dropped = 0;
	return wrapIter(s, "drop", (inner) => ({
		next(): IteratorResult<Value> {
			while (dropped < limit) {
				const r = inner.next();
				if (r.done) return r;
				dropped++;
			}
			return inner.next();
		},
		return(): IteratorResult<Value> {
			return (
				inner.return?.() ?? {
					value: undefined as unknown as Value,
					done: true,
				}
			);
		},
	}));
}

export function streamTakeWhile(
	s: StreamValue,
	fn: Callable,
	invoke: Invoke,
): StreamValue {
	let stopped = false;
	return wrapIter(s, "take_while", (inner) => ({
		next(): IteratorResult<Value> {
			if (stopped) {
				return { value: undefined as unknown as Value, done: true };
			}
			const r = inner.next();
			if (r.done) return r;
			const ok = invoke(fn, [r.value]);
			if (typeof ok !== "boolean") {
				throw new Error(
					`take_while: predicate must return bool, got ${typeName(ok)}`,
				);
			}
			if (!ok) {
				stopped = true;
				inner.return?.();
				return { value: undefined as unknown as Value, done: true };
			}
			return r;
		},
		return(): IteratorResult<Value> {
			return (
				inner.return?.() ?? {
					value: undefined as unknown as Value,
					done: true,
				}
			);
		},
	}));
}

export function streamDropWhile(
	s: StreamValue,
	fn: Callable,
	invoke: Invoke,
): StreamValue {
	let dropping = true;
	return wrapIter(s, "drop_while", (inner) => ({
		next(): IteratorResult<Value> {
			while (dropping) {
				const r = inner.next();
				if (r.done) return r;
				const ok = invoke(fn, [r.value]);
				if (typeof ok !== "boolean") {
					throw new Error(
						`drop_while: predicate must return bool, got ${typeName(ok)}`,
					);
				}
				if (!ok) {
					dropping = false;
					return r;
				}
			}
			return inner.next();
		},
		return(): IteratorResult<Value> {
			return (
				inner.return?.() ?? {
					value: undefined as unknown as Value,
					done: true,
				}
			);
		},
	}));
}

function consumeStream(
	s: StreamValue,
	name: string,
	visit: (v: Value) => void,
): void {
	acquire(s, name);
	try {
		while (true) {
			const r = s.iter.next();
			if (r.done) break;
			visit(r.value);
		}
	} finally {
		s.iter.return?.();
	}
}

export function streamEach(
	s: StreamValue,
	fn: Callable,
	invoke: Invoke,
): null {
	consumeStream(s, "each", (v) => {
		invoke(fn, [v]);
	});
	return null;
}

export function streamReduce(
	s: StreamValue,
	init: Value,
	fn: Callable,
	invoke: Invoke,
): Value {
	let acc: Value = init;
	consumeStream(s, "reduce", (v) => {
		acc = invoke(fn, [acc, v]);
	});
	return acc;
}

export function streamFind(
	s: StreamValue,
	fn: Callable,
	invoke: Invoke,
): Value {
	let result: Value = null;
	let found = false;
	acquire(s, "find");
	try {
		while (!found) {
			const r = s.iter.next();
			if (r.done) break;
			const ok = invoke(fn, [r.value]);
			if (typeof ok !== "boolean") {
				throw new Error(
					`find: predicate must return bool, got ${typeName(ok)}`,
				);
			}
			if (ok) {
				result = r.value;
				found = true;
			}
		}
	} finally {
		s.iter.return?.();
	}
	return result;
}

/**
 * Read a UTF-8 file as a stream of lines, lazily. The file handle is opened
 * when the stream is first consumed and closed automatically at end-of-input
 * or early termination (e.g. via `take(n)`). Lines are split on `\n`; the
 * trailing newline is stripped.
 *
 * @param {str} path - filesystem path
 * @returns {stream} a stream of strings
 *
 * @example
 * read_lines("access.log")
 *   |> filter(fn line => contains?(line, "ERROR"))
 *   |> take(10)
 *   |> each(print)
 */
export const read_lines: BuiltinFn = {
	kind: "builtin",
	name: "read_lines",
	arity: 1,
	call: (args) => {
		const path = expectStr("read_lines", "path", args[0] ?? null);
		let fd: number;
		try {
			fd = openSync(path, "r");
		} catch (e) {
			const code = (e as NodeJS.ErrnoException).code;
			if (code === "ENOENT") {
				throw new Error(`read_lines: file not found: ${path}`);
			}
			if (code === "EACCES") {
				throw new Error(`read_lines: permission denied: ${path}`);
			}
			if (code === "EISDIR") {
				throw new Error(`read_lines: is a directory: ${path}`);
			}
			throw new Error(
				`read_lines: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
		const cleanup = () => {
			try {
				closeSync(fd);
			} catch {
				// ignore
			}
		};
		return makeFdStream(fd, cleanup);
	},
};

/**
 * Read stdin as a stream of lines, lazily. Useful for piping input into an
 * Espeto CLI: `tail -f log | espeto run filter.esp`. The stream ends on EOF.
 *
 * @returns {stream} a stream of strings
 *
 * @example
 * stdin_lines() |> map(upcase) |> each(print)
 */
export const stdin_lines: BuiltinFn = {
	kind: "builtin",
	name: "stdin_lines",
	arity: 0,
	call: () => {
		return makeFdStream(0, () => {
			// don't close stdin — it's not ours
		});
	},
};

function getReadableFd(stream: NodeJS.ReadableStream): number | null {
	const handle = (
		stream as unknown as {
			_handle?: { fd?: number; setBlocking?: (b: boolean) => void };
		}
	)._handle;
	if (handle && typeof handle.fd === "number") {
		// libuv pipes default to non-blocking for the event loop; we want sync
		// readSync to block until bytes are available.
		if (typeof handle.setBlocking === "function") {
			handle.setBlocking(true);
		}
		return handle.fd;
	}
	const directFd = (stream as unknown as { fd?: number }).fd;
	if (typeof directFd === "number") return directFd;
	return null;
}

/**
 * Run a shell command via `/bin/sh -c` and stream its stdout as lines. The
 * child process is spawned when the stream is first consumed. Cleanup
 * (SIGTERM + close pipe) runs on end-of-input, early termination, or raise.
 * Stderr is inherited (printed to the parent's stderr).
 *
 * @param {str} cmd - the shell command line
 * @returns {stream} a stream of stdout lines
 *
 * @example
 * sh_lines("ls -1")
 *   |> filter(fn n => ends_with?(n, ".log"))
 *   |> each(print)
 */
export const sh_lines: BuiltinFn = {
	kind: "builtin",
	name: "sh_lines",
	arity: 1,
	call: (args) => {
		const cmd = expectStr("sh_lines", "cmd", args[0] ?? null);
		let child: ChildProcess;
		try {
			child = spawn("/bin/sh", ["-c", cmd], {
				stdio: ["ignore", "pipe", "inherit"],
			});
		} catch (e) {
			throw new Error(
				`sh_lines: spawn failed: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
		if (!child.stdout) {
			try {
				child.kill("SIGTERM");
			} catch {
				// ignore
			}
			throw new Error("sh_lines: failed to capture stdout");
		}
		const fd = getReadableFd(child.stdout);
		if (fd === null) {
			try {
				child.kill("SIGTERM");
			} catch {
				// ignore
			}
			throw new Error("sh_lines: could not access stdout fd");
		}
		const cleanup = () => {
			if (!child.killed && child.exitCode === null) {
				try {
					child.kill("SIGTERM");
				} catch {
					// ignore
				}
			}
			try {
				child.stdout?.destroy();
			} catch {
				// ignore
			}
		};
		return makeFdStream(fd, cleanup);
	},
};

/**
 * Materialize a stream into a list. Consumes the stream fully and runs
 * cleanup. After collect, the stream cannot be re-iterated.
 *
 * @param {stream} s - the stream to materialize
 * @returns {list} all items
 *
 * @example
 * read_lines("data.txt") |> collect // => ["line1", "line2", ...]
 */
export const collect: BuiltinFn = {
	kind: "builtin",
	name: "collect",
	arity: 1,
	call: (args) => {
		const s = expectStream("collect", "arg", args[0] ?? null);
		const out: Value[] = [];
		consumeStream(s, "collect", (v) => {
			out.push(v);
		});
		return out;
	},
};

/**
 * Count the items in a stream, consuming it. For lists, use `length` instead.
 *
 * @param {stream} s - the stream to count
 * @returns {int} number of items
 *
 * @example
 * read_lines("data.txt") |> count // => 42
 */
export const count: BuiltinFn = {
	kind: "builtin",
	name: "count",
	arity: 1,
	call: (args) => {
		const s = expectStream("count", "arg", args[0] ?? null);
		let n = 0n;
		consumeStream(s, "count", () => {
			n++;
		});
		return n;
	},
};

