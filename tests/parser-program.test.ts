import { describe, expect, it } from "vitest";
import { lex } from "../src/lexer";
import { parse } from "../src/parser";

function ast(src: string) {
	return parse(lex(src, "x.esp"), src);
}

describe("parser: program block", () => {
	it("parses minimal program with one cmd", () => {
		const m = ast(`
			program todo do
				cmd add do
					arg item: str
					item |> print
				end
			end
		`);
		expect(m.items).toHaveLength(1);
		const prog = m.items[0]!;
		expect(prog).toMatchObject({
			kind: "program",
			name: "todo",
			meta: [],
			flags: [],
		});
		expect((prog as { cmds: unknown[] }).cmds).toHaveLength(1);
	});

	it("parses program with desc, version, flags, and multiple cmds", () => {
		const m = ast(`
			program todo do
				desc "Gestor de listas"
				version "0.3.0"
				flag verbose: bool = false

				cmd add do
					arg item: str
				end

				cmd remove do
					arg id: int
				end
			end
		`);
		const prog = m.items[0] as {
			kind: string;
			name: string;
			meta: { kind: string }[];
			flags: { name: string }[];
			cmds: { name: string }[];
		};
		expect(prog.kind).toBe("program");
		expect(prog.name).toBe("todo");
		expect(prog.meta.map((m) => m.kind)).toEqual(["meta_desc", "meta_version"]);
		expect(prog.flags.map((f) => f.name)).toEqual(["verbose"]);
		expect(prog.cmds.map((c) => c.name)).toEqual(["add", "remove"]);
	});

	it("rejects empty program (no cmds)", () => {
		expect(() =>
			ast(`
			program todo do
				desc "empty"
			end
		`),
		).toThrow(/no commands/);
	});

	it("rejects duplicate cmd names within program", () => {
		expect(() =>
			ast(`
			program todo do
				cmd add do
					arg x: str
				end
				cmd add do
					arg y: str
				end
			end
		`),
		).toThrow(/duplicate command 'add'/);
	});

	it("rejects shadow flag (program flag name == cmd flag name)", () => {
		expect(() =>
			ast(`
			program todo do
				flag verbose: bool = false
				cmd add do
					flag verbose: int = 1
				end
			end
		`),
		).toThrow(/shadows program-level flag/);
	});

	it("rejects 'arg' at program level", () => {
		expect(() =>
			ast(`
			program todo do
				arg foo: str
				cmd add do
					arg item: str
				end
			end
		`),
		).toThrow(/'arg' not allowed at program level/);
	});

	it("rejects unexpected statement in program body", () => {
		expect(() =>
			ast(`
			program todo do
				x = 1
				cmd add do
					arg item: str
				end
			end
		`),
		).toThrow(/unexpected statement in program body/);
	});

	it("rejects flag after cmd (ordering)", () => {
		expect(() =>
			ast(`
			program todo do
				cmd add do
					arg item: str
				end
				flag verbose: bool = false
			end
		`),
		).toThrow(/flag declarations must come before cmd declarations/);
	});

	it("rejects mixed top-level: program + cmd", () => {
		expect(() =>
			ast(`
			program todo do
				cmd add do
					arg item: str
				end
			end

			cmd loose do
				arg x: str
			end
		`),
		).toThrow(/'cmd' not allowed alongside 'program'/);
	});

	it("rejects mixed top-level: cmd + program", () => {
		expect(() =>
			ast(`
			cmd loose do
				arg x: str
			end

			program todo do
				cmd add do
					arg item: str
				end
			end
		`),
		).toThrow(/'program' not allowed alongside top-level 'cmd'/);
	});

	it("rejects two program blocks", () => {
		expect(() =>
			ast(`
			program a do
				cmd x do
					arg val: str
				end
			end

			program b do
				cmd y do
					arg val: str
				end
			end
		`),
		).toThrow(/only one 'program' block allowed/);
	});

	it("backwards compat: standalone cmd still parses", () => {
		const m = ast(`
			cmd edad do
				arg years: int
				years |> print
			end
		`);
		expect(m.items).toHaveLength(1);
		expect(m.items[0]).toMatchObject({ kind: "cmd", name: "edad" });
	});
});
