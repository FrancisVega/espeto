import { describe, expect, it, vi } from "vitest";
import type { ProgramDecl } from "../src/ast";
import {
	CliUsageError,
	formatProgramHelp,
	parseProgramFlags,
	splitProgramArgv,
} from "../src/cmd";
import { lex } from "../src/lexer";
import { parse } from "../src/parser";
import { run } from "../src/run";

function progFrom(src: string): ProgramDecl {
	const m = parse(lex(src, "x.esp"), src);
	const p = m.items.find((i) => i.kind === "program");
	if (!p) throw new Error("no program in source");
	return p as ProgramDecl;
}

const STD_PROG = `
program todo do
	flag verbose: bool = false
	flag count: int = 1

	cmd add do
		arg item: str
	end

	cmd remove do
		arg id: int
	end
end
`;

describe("splitProgramArgv", () => {
	it("no flags, just subcmd and args", () => {
		const p = progFrom(STD_PROG);
		const s = splitProgramArgv(["add", "hello"], p.flags);
		expect(s).toEqual({ progArgv: [], subcmd: "add", cmdArgv: ["hello"] });
	});

	it("bool program flag before subcmd", () => {
		const p = progFrom(STD_PROG);
		const s = splitProgramArgv(["--verbose", "add", "hello"], p.flags);
		expect(s).toEqual({
			progArgv: ["--verbose"],
			subcmd: "add",
			cmdArgv: ["hello"],
		});
	});

	it("non-bool program flag consumes value", () => {
		const p = progFrom(STD_PROG);
		const s = splitProgramArgv(["--count", "5", "add", "hello"], p.flags);
		expect(s).toEqual({
			progArgv: ["--count", "5"],
			subcmd: "add",
			cmdArgv: ["hello"],
		});
	});

	it("--flag=value form", () => {
		const p = progFrom(STD_PROG);
		const s = splitProgramArgv(["--count=5", "add", "hello"], p.flags);
		expect(s).toEqual({
			progArgv: ["--count=5"],
			subcmd: "add",
			cmdArgv: ["hello"],
		});
	});

	it("-- separator is dropped silently", () => {
		const p = progFrom(STD_PROG);
		const s = splitProgramArgv(["--verbose", "--", "add", "hello"], p.flags);
		expect(s).toEqual({
			progArgv: ["--verbose"],
			subcmd: "add",
			cmdArgv: ["hello"],
		});
	});

	it("no subcmd → empty cmdArgv, null subcmd", () => {
		const p = progFrom(STD_PROG);
		const s = splitProgramArgv(["--verbose"], p.flags);
		expect(s).toEqual({ progArgv: ["--verbose"], subcmd: null, cmdArgv: [] });
	});

	it("empty argv", () => {
		const p = progFrom(STD_PROG);
		const s = splitProgramArgv([], p.flags);
		expect(s).toEqual({ progArgv: [], subcmd: null, cmdArgv: [] });
	});

	it("--help is left as program-level flag", () => {
		const p = progFrom(STD_PROG);
		const s = splitProgramArgv(["--help"], p.flags);
		expect(s).toEqual({ progArgv: ["--help"], subcmd: null, cmdArgv: [] });
	});
});

describe("parseProgramFlags", () => {
	it("parses bool program flag", () => {
		const p = progFrom(STD_PROG);
		const r = parseProgramFlags(p, ["--verbose"]);
		expect(r).toMatchObject({
			kind: "values",
			provided: new Map([["verbose", true]]),
		});
	});

	it("returns help on --help", () => {
		const p = progFrom(STD_PROG);
		expect(parseProgramFlags(p, ["--help"])).toEqual({ kind: "help" });
	});

	it("returns help on -h", () => {
		const p = progFrom(STD_PROG);
		expect(parseProgramFlags(p, ["-h"])).toEqual({ kind: "help" });
	});

	it("rejects --version when program has no version", () => {
		const p = progFrom(STD_PROG);
		expect(() => parseProgramFlags(p, ["--version"])).toThrow(
			/unknown flag: --version/,
		);
	});

	it("returns version when program has version meta", () => {
		const p = progFrom(`
			program todo do
				version "1.0.0"
				cmd add do
					arg item: str
				end
			end
		`);
		expect(parseProgramFlags(p, ["--version"])).toEqual({ kind: "version" });
	});

	it("rejects unknown flag with hint", () => {
		const p = progFrom(STD_PROG);
		expect(() => parseProgramFlags(p, ["--verbos"])).toThrow(
			/did you mean '--verbose'/,
		);
	});

	it("rejects positional in program-flag region", () => {
		const p = progFrom(STD_PROG);
		expect(() => parseProgramFlags(p, ["bogus"])).toThrow(
			/unexpected positional 'bogus' before subcommand/,
		);
	});
});

describe("formatProgramHelp", () => {
	it("includes program name, commands, and flags", () => {
		const p = progFrom(`
			program todo do
				desc "Manages a todo list"
				version "0.3.0"
				flag verbose: bool = false
				cmd add do
					desc "add an item"
					arg item: str
				end
				cmd remove do
					desc "remove an item"
					arg id: int
				end
			end
		`);
		const help = formatProgramHelp(p);
		expect(help).toContain("todo v0.3.0");
		expect(help).toContain("Manages a todo list");
		expect(help).toContain("Usage: todo <command> [options]");
		expect(help).toContain("add");
		expect(help).toContain("add an item");
		expect(help).toContain("remove");
		expect(help).toContain("--verbose");
		expect(help).toContain("--help, -h");
		expect(help).toContain("--version");
	});

	it("omits --version when no version meta", () => {
		const p = progFrom(`
			program todo do
				cmd add do
					arg item: str
				end
			end
		`);
		const help = formatProgramHelp(p);
		expect(help).toContain("todo");
		expect(help).not.toContain("--version");
	});
});

describe("end-to-end program dispatch", () => {
	function captureStdout(fn: () => void): string {
		const writes: string[] = [];
		const spy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk: unknown) => {
				writes.push(typeof chunk === "string" ? chunk : String(chunk));
				return true;
			});
		try {
			fn();
		} finally {
			spy.mockRestore();
		}
		return writes.join("");
	}

	const PROG_HELLO = `
program greeter do
	flag loud: bool = false

	cmd hello do
		arg name: str
		msg = if loud do "HEY #{name}!" else "hello #{name}" end
		msg |> print
	end

	cmd bye do
		arg name: str
		"bye #{name}" |> print
	end
end
`;

	it("dispatches subcmd with positional arg", () => {
		const out = captureStdout(() => {
			run(PROG_HELLO, "x.esp", { cmdArgv: ["hello", "Mundo"] });
		});
		expect(out).toBe("hello Mundo\n");
	});

	it("dispatches different subcmd", () => {
		const out = captureStdout(() => {
			run(PROG_HELLO, "x.esp", { cmdArgv: ["bye", "Mundo"] });
		});
		expect(out).toBe("bye Mundo\n");
	});

	it("inherits program flag in cmd body", () => {
		const out = captureStdout(() => {
			run(PROG_HELLO, "x.esp", { cmdArgv: ["--loud", "hello", "Mundo"] });
		});
		expect(out).toBe("HEY Mundo!\n");
	});

	it("shows help when no subcmd", () => {
		const out = captureStdout(() => {
			run(PROG_HELLO, "x.esp", { cmdArgv: [] });
		});
		expect(out).toContain("Usage: greeter <command>");
		expect(out).toContain("hello");
		expect(out).toContain("bye");
	});

	it("shows help on --help", () => {
		const out = captureStdout(() => {
			run(PROG_HELLO, "x.esp", { cmdArgv: ["--help"] });
		});
		expect(out).toContain("Usage: greeter");
	});

	it("errors on unknown subcmd with typo hint", () => {
		expect(() =>
			run(PROG_HELLO, "x.esp", { cmdArgv: ["helo", "Mundo"] }),
		).toThrow(/unknown subcommand 'helo'.*did you mean 'hello'/s);
	});

	it("prints version when declared and --version requested", () => {
		const src = `
program tool do
	version "2.1.0"
	cmd run do
		arg n: int
		n |> print
	end
end
`;
		const out = captureStdout(() => {
			run(src, "x.esp", { cmdArgv: ["--version"] });
		});
		expect(out).toBe("2.1.0\n");
	});

	it("FE1 — flag in wrong scope: shows hint to put before subcmd", () => {
		expect(() =>
			run(PROG_HELLO, "x.esp", { cmdArgv: ["hello", "--loud", "Mundo"] }),
		).toThrow(/is a flag of program 'greeter'.*write it before the subcommand/s);
	});

	it("AR1 — missing required arg shows usage line", () => {
		expect(() =>
			run(PROG_HELLO, "x.esp", { cmdArgv: ["hello"] }),
		).toThrow(/missing required argument <name>.*usage: greeter hello/s);
	});

	it("cmd help shows '(inherited from program)' for parent flags", () => {
		const out = captureStdout(() => {
			run(PROG_HELLO, "x.esp", { cmdArgv: ["hello", "--help"] });
		});
		expect(out).toContain("--loud");
		expect(out).toContain("(inherited from greeter)");
		expect(out).toContain("Usage: greeter hello");
	});
});
