import { spawnSync } from "node:child_process";
import { type BuiltinFn, type Value, typeName } from "../values";

const MAX_BUFFER = 100 * 1024 * 1024;

function expectStr(name: string, label: string, v: Value): string {
	if (typeof v !== "string") {
		throw new Error(`${name}: ${label} must be str, got ${typeName(v)}`);
	}
	return v;
}

type ShellResult = {
	stdout: string;
	stderr: string;
	exitCode: bigint;
	ok: boolean;
};

function runShell(name: string, cmd: string): ShellResult {
	const result = spawnSync("/bin/sh", ["-c", cmd], {
		encoding: "utf-8",
		maxBuffer: MAX_BUFFER,
	});

	if (result.error) {
		const code = (result.error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			throw new Error(
				`${name}: /bin/sh not found (Espeto requires POSIX shell)`,
			);
		}
		if (code === "ENOBUFS") {
			throw new Error(
				`${name}: output exceeded ${MAX_BUFFER / 1024 / 1024}MB buffer`,
			);
		}
		throw new Error(`${name}: ${result.error.message}`);
	}

	if (result.status === null) {
		const sig = result.signal ?? "unknown";
		throw new Error(`${name}: terminated by signal ${sig}: ${cmd}`);
	}

	return {
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		exitCode: BigInt(result.status),
		ok: result.status === 0,
	};
}

/**
 * Run a shell command via `/bin/sh -c`. Captures stdout and stderr; never
 * raises on non-zero exit. Returns a map with the captured output.
 *
 * @param {str} cmd - the shell command line
 * @returns {map} `{stdout: str, stderr: str, exit_code: int, ok: bool}`
 *
 * @example
 * sh("git rev-parse HEAD")
 * // => {stdout: "abc...\n", stderr: "", exit_code: 0, ok: true}
 *
 * @example
 * sh("false")
 * // => {stdout: "", stderr: "", exit_code: 1, ok: false}
 */
export const sh: BuiltinFn = {
	kind: "builtin",
	name: "sh",
	arity: 1,
	call: (args) => {
		const cmd = expectStr("sh", "cmd", args[0] ?? null);
		const r = runShell("sh", cmd);
		const map: Value = {
			kind: "map",
			entries: {
				stdout: r.stdout,
				stderr: r.stderr,
				exit_code: r.exitCode,
				ok: r.ok,
			},
		};
		return map;
	},
};

/**
 * Run a shell command via `/bin/sh -c`. Returns stdout as a string on
 * success. Raises on non-zero exit, with a message that includes the
 * command, exit code, and captured stderr. Stdout is returned raw (no
 * trim) so use `|> trim` when you want to drop the trailing newline.
 *
 * @param {str} cmd - the shell command line
 * @returns {str} captured stdout
 *
 * @example
 * sh!("git rev-parse HEAD") |> trim
 * // => "abc..."
 *
 * @example
 * try sh!("git diff --quiet")
 * rescue _ => "dirty"
 */
export const sh_bang: BuiltinFn = {
	kind: "builtin",
	name: "sh!",
	arity: 1,
	call: (args) => {
		const cmd = expectStr("sh!", "cmd", args[0] ?? null);
		const r = runShell("sh!", cmd);
		if (!r.ok) {
			const stderrIndented = r.stderr
				.replace(/\n+$/, "")
				.split("\n")
				.map((line) => `  ${line}`)
				.join("\n");
			const tail = stderrIndented === "  " ? "" : `\n${stderrIndented}`;
			throw new Error(
				`sh!: command failed (exit ${r.exitCode}):\n  ${cmd}${tail}`,
			);
		}
		return r.stdout;
	},
};
