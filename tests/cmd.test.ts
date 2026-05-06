import { describe, expect, it } from "vitest";
import type { Cmd } from "../src/ast";
import { CliUsageError, formatHelp, parseCmdArgv } from "../src/cmd";
import { lex } from "../src/lexer";
import { parse } from "../src/parser";

function cmdFrom(src: string): Cmd {
	const program = parse(lex(src, "x.esp"), src);
	const cmd = program.items.find((i) => i.kind === "cmd");
	if (!cmd) throw new Error("no cmd in source");
	return cmd as Cmd;
}

describe("parseCmdArgv: positional args", () => {
	it("binds a single required arg", () => {
		const cmd = cmdFrom(`cmd hi do\n  arg name: str\nend`);
		const r = parseCmdArgv(cmd, ["Mundo"]);
		expect(r).toEqual({
			kind: "values",
			provided: new Map([["name", "Mundo"]]),
		});
	});

	it("coerces int positional", () => {
		const cmd = cmdFrom(`cmd c do\n  arg n: int\nend`);
		const r = parseCmdArgv(cmd, ["42"]);
		expect(r).toMatchObject({
			provided: new Map([["n", 42n]]),
		});
	});

	it("rejects non-int positional for int arg", () => {
		const cmd = cmdFrom(`cmd c do\n  arg n: int\nend`);
		expect(() => parseCmdArgv(cmd, ["abc"])).toThrow(
			CliUsageError,
		);
	});

	it("rejects extra positional args", () => {
		const cmd = cmdFrom(`cmd c do\n  arg n: str\nend`);
		expect(() => parseCmdArgv(cmd, ["a", "b"])).toThrow(/unexpected positional/);
	});

	it("does not require an arg with a default", () => {
		const cmd = cmdFrom(`cmd c do\n  arg n: str = "x"\nend`);
		const r = parseCmdArgv(cmd, []);
		expect(r).toEqual({ kind: "values", provided: new Map() });
	});

	it("accepts negative int as positional", () => {
		const cmd = cmdFrom(`cmd c do\n  arg n: int\nend`);
		const r = parseCmdArgv(cmd, ["-1"]);
		expect(r).toMatchObject({
			provided: new Map([["n", -1n]]),
		});
	});

	it("accepts negative float as positional", () => {
		const cmd = cmdFrom(`cmd c do\n  arg n: float\nend`);
		const r = parseCmdArgv(cmd, ["-1.5"]);
		expect(r).toMatchObject({
			provided: new Map([["n", -1.5]]),
		});
	});
});

describe("parseCmdArgv: flags", () => {
	it("treats a bool flag without value as true", () => {
		const cmd = cmdFrom(`cmd c do\n  flag loud: bool = false\nend`);
		const r = parseCmdArgv(cmd, ["--loud"]);
		expect(r).toMatchObject({
			provided: new Map([["loud", true]]),
		});
	});

	it("accepts --flag=value form", () => {
		const cmd = cmdFrom(`cmd c do\n  flag name: str = "x"\nend`);
		const r = parseCmdArgv(cmd, ["--name=mundo"]);
		expect(r).toMatchObject({
			provided: new Map([["name", "mundo"]]),
		});
	});

	it("accepts --flag value form for non-bool", () => {
		const cmd = cmdFrom(`cmd c do\n  flag age: int = 0\nend`);
		const r = parseCmdArgv(cmd, ["--age", "30"]);
		expect(r).toMatchObject({
			provided: new Map([["age", 30n]]),
		});
	});

	it("uses short alias when defined", () => {
		const cmd = cmdFrom(`cmd c do\n  flag loud: bool = false, short: "l"\nend`);
		const r = parseCmdArgv(cmd, ["-l"]);
		expect(r).toMatchObject({
			provided: new Map([["loud", true]]),
		});
	});

	it("rejects unknown long flag", () => {
		const cmd = cmdFrom(`cmd c do\n  flag x: str = "a"\nend`);
		expect(() => parseCmdArgv(cmd, ["--bogus"])).toThrow(/unknown flag: --bogus/);
	});

	it("rejects unknown short flag", () => {
		const cmd = cmdFrom(`cmd c do\n  flag x: str = "a"\nend`);
		expect(() => parseCmdArgv(cmd, ["-b"])).toThrow(/unknown flag: -b/);
	});

	it("rejects duplicate flag", () => {
		const cmd = cmdFrom(`cmd c do\n  flag x: str = "a"\nend`);
		expect(() => parseCmdArgv(cmd, ["--x", "1", "--x", "2"])).toThrow(
			/duplicate flag/,
		);
	});

	it("rejects flag value missing", () => {
		const cmd = cmdFrom(`cmd c do\n  flag x: str = "a"\nend`);
		expect(() => parseCmdArgv(cmd, ["--x"])).toThrow(/expects a value/);
	});

	it("rejects bool flag with non-bool value", () => {
		const cmd = cmdFrom(`cmd c do\n  flag x: bool = false\nend`);
		expect(() => parseCmdArgv(cmd, ["--x=banana"])).toThrow(
			/expects bool/,
		);
	});

	it("accepts --bool=true / --bool=false", () => {
		const cmd = cmdFrom(`cmd c do\n  flag x: bool = false\nend`);
		const r1 = parseCmdArgv(cmd, ["--x=true"]);
		const r2 = parseCmdArgv(cmd, ["--x=false"]);
		expect(r1).toMatchObject({ provided: new Map([["x", true]]) });
		expect(r2).toMatchObject({ provided: new Map([["x", false]]) });
	});
});

describe("parseCmdArgv: --help", () => {
	it("returns 'help' when --help is present", () => {
		const cmd = cmdFrom(`cmd c do\n  arg n: str\nend`);
		expect(parseCmdArgv(cmd, ["--help"])).toEqual({ kind: "help" });
	});

	it("returns 'help' when -h is present", () => {
		const cmd = cmdFrom(`cmd c do\n  arg n: str\nend`);
		expect(parseCmdArgv(cmd, ["-h"])).toEqual({ kind: "help" });
	});
});

describe("parseCmdArgv: hints", () => {
	it("unknown flag suggests close match", () => {
		const cmd = cmdFrom(`cmd c do\n  flag verbose: bool = false\nend`);
		try {
			parseCmdArgv(cmd, ["--verbos"]);
			throw new Error("expected error");
		} catch (e) {
			expect(e).toBeInstanceOf(CliUsageError);
			expect((e as Error).message).toMatch(
				/unknown flag: --verbos \(did you mean '--verbose'\?\)/,
			);
		}
	});

	it("unknown flag without close match shows no hint", () => {
		const cmd = cmdFrom(`cmd c do\n  flag verbose: bool = false\nend`);
		try {
			parseCmdArgv(cmd, ["--xyzqqq"]);
			throw new Error("expected error");
		} catch (e) {
			expect((e as Error).message).toBe("unknown flag: --xyzqqq");
		}
	});
});

describe("parseCmdArgv: kebab-case flags", () => {
	it("snake_case flag accessible via kebab-case CLI", () => {
		const cmd = cmdFrom(`cmd c do\n  flag min_age: int = 0\nend`);
		const r = parseCmdArgv(cmd, ["--min-age", "22"]);
		expect(r).toMatchObject({
			provided: new Map([["min_age", 22n]]),
		});
	});

	it("rejects snake_case at CLI side", () => {
		const cmd = cmdFrom(`cmd c do\n  flag min_age: int = 0\nend`);
		expect(() => parseCmdArgv(cmd, ["--min_age", "22"])).toThrow(
			CliUsageError,
		);
	});

	it("kebab via = form", () => {
		const cmd = cmdFrom(`cmd c do\n  flag min_age: int = 0\nend`);
		const r = parseCmdArgv(cmd, ["--min-age=5"]);
		expect(r).toMatchObject({
			provided: new Map([["min_age", 5n]]),
		});
	});
});

describe("formatHelp", () => {
	it("displays kebab-case in help for snake_case flags", () => {
		const cmd = cmdFrom(`cmd c do\n  flag min_age: int = 0\nend`);
		const help = formatHelp(cmd);
		expect(help).toContain("--min-age");
		expect(help).not.toContain("--min_age");
	});


	it("renders cmd name + usage line", () => {
		const cmd = cmdFrom(`cmd hi do\nend`);
		const help = formatHelp(cmd);
		expect(help).toContain("hi");
		expect(help).toContain("Usage: hi");
		expect(help).toContain("--help, -h");
	});

	it("renders args section with type", () => {
		const cmd = cmdFrom(
			`cmd hi do\n  arg name: str, desc: "name to greet"\nend`,
		);
		const help = formatHelp(cmd);
		expect(help).toContain("Arguments:");
		expect(help).toContain("<name>");
		expect(help).toContain("(str)");
		expect(help).toContain("name to greet");
	});

	it("renders flag with short alias and default", () => {
		const cmd = cmdFrom(
			`cmd hi do\n  flag loud: bool = false, short: "l", desc: "shout"\nend`,
		);
		const help = formatHelp(cmd);
		expect(help).toContain("--loud, -l");
		expect(help).toContain("default: false");
		expect(help).toContain("shout");
	});

	it("renders meta desc and version", () => {
		const cmd = cmdFrom(
			`cmd hi do\n  desc "say hi"\n  version "1.2.3"\nend`,
		);
		const help = formatHelp(cmd);
		expect(help).toContain("hi v1.2.3");
		expect(help).toContain("say hi");
	});

	it("renders required arg as <name>", () => {
		const cmd = cmdFrom(`cmd hi do\n  arg name: str\nend`);
		const help = formatHelp(cmd);
		expect(help).toMatch(/Usage: hi <name>/);
	});

	it("renders optional arg as [name]", () => {
		const cmd = cmdFrom(`cmd hi do\n  arg name: str = "world"\nend`);
		const help = formatHelp(cmd);
		expect(help).toMatch(/Usage: hi \[name\]/);
	});
});
