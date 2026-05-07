import { describe, expect, it, vi } from "vitest";
import { EspetoError } from "../src/errors";
import type { Resolver, ResolvedModule } from "../src/imports";
import { run } from "../src/run";

function memResolver(files: Record<string, string>): Resolver {
	return (importer, importPath): ResolvedModule => {
		// Resolve relative path against importer dir, then strip leading "/" so
		// keys can be plain "format.esp" / "lib/util.esp".
		const importerDir = importer.includes("/")
			? importer.slice(0, importer.lastIndexOf("/"))
			: "";
		const segments = `${importerDir}/${importPath}.esp`.split("/");
		const stack: string[] = [];
		for (const seg of segments) {
			if (seg === "" || seg === ".") continue;
			if (seg === "..") {
				stack.pop();
				continue;
			}
			stack.push(seg);
		}
		const absPath = `/${stack.join("/")}`;
		const key = absPath.replace(/^\//, "");
		const source = files[key];
		if (source === undefined) {
			throw new Error(`memResolver: not found ${absPath} (key=${key})`);
		}
		return { absPath, source };
	};
}

function captureStdout(fn: () => void): string {
	const writes: string[] = [];
	const spy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk: unknown) => {
			writes.push(String(chunk));
			return true;
		});
	try {
		fn();
	} finally {
		spy.mockRestore();
	}
	return writes.join("");
}

function runWith(
	files: Record<string, string>,
	entryKey: string,
	cmdArgv: string[] | null = null,
): string {
	const resolver = memResolver(files);
	const source = files[entryKey];
	if (source === undefined) throw new Error(`entry not found: ${entryKey}`);
	return captureStdout(() => {
		run(source, entryKey, {
			resolver,
			entryAbsPath: `/${entryKey}`,
			cmdArgv,
		});
	});
}

describe("imports: cross-module errors preserve source", () => {
	it("error in imported fn shows the imported file's source line", () => {
		const resolver = memResolver({
			"main.esp": `import "./lib" only [boom]\nboom(1)\n`,
			"lib.esp": `def boom(x) = x + "z"\n`,
		});
		const source = `import "./lib" only [boom]\nboom(1)\n`;
		try {
			run(source, "main.esp", {
				resolver,
				entryAbsPath: "/main.esp",
			});
			throw new Error("expected error");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			const err = e as EspetoError;
			expect(err.span.file).toBe("/lib.esp");
			expect(err.source).toBe(`def boom(x) = x + "z"\n`);
			expect(err.message).toMatch(/'\+' requires numbers/);
		}
	});
});

describe("imports: only [name]", () => {
	it("imports a named function and calls it", () => {
		const out = runWith(
			{
				"entry.esp": `import "./format" only [bullet]\n"hi" |> bullet |> print\n`,
				"format.esp": `def bullet(s) = "* #{s}"\n`,
			},
			"entry.esp",
		);
		expect(out).toBe("* hi\n");
	});

	it("aliases via 'as'", () => {
		const out = runWith(
			{
				"entry.esp": `import "./fmt" only [bullet as b]\n"hi" |> b |> print\n`,
				"fmt.esp": `def bullet(s) = "* #{s}"\n`,
			},
			"entry.esp",
		);
		expect(out).toBe("* hi\n");
	});

	it("imports both name and aliased binding from same source", () => {
		const out = runWith(
			{
				"entry.esp": `import "./fmt" only [bullet, bullet as b]\n"a" |> bullet |> print\n"b" |> b |> print\n`,
				"fmt.esp": `def bullet(s) = "* #{s}"\n`,
			},
			"entry.esp",
		);
		expect(out).toBe("* a\n* b\n");
	});
});

describe("imports: no 'only' (all exports)", () => {
	it("imports every exported def", () => {
		const out = runWith(
			{
				"entry.esp": `import "./fmt"\n"hi" |> bullet |> print\n"hi" |> star |> print\n`,
				"fmt.esp": `def bullet(s) = "* #{s}"\ndef star(s) = "[#{s}]"\n`,
			},
			"entry.esp",
		);
		expect(out).toBe("* hi\n[hi]\n");
	});

	it("does not expose defp (private) functions", () => {
		expect(() =>
			runWith(
				{
					"entry.esp": `import "./fmt"\n"hi" |> hidden |> print\n`,
					"fmt.esp": `defp hidden(s) = "X#{s}X"\n`,
				},
				"entry.esp",
			),
		).toThrow(/undefined: hidden/);
	});

	it("exported def can call defp from same module", () => {
		const out = runWith(
			{
				"entry.esp": `import "./fmt"\n"hi" |> visible |> print\n`,
				"fmt.esp": `defp wrap(s) = "<#{s}>"\ndef visible(s) = wrap(s)\n`,
			},
			"entry.esp",
		);
		expect(out).toBe("<hi>\n");
	});
});

describe("imports: transitivity", () => {
	it("A imports B, B imports C — A sees only B's exports", () => {
		const out = runWith(
			{
				"a.esp": `import "./b" only [from_b]\n"hi" |> from_b |> print\n`,
				"b.esp": `import "./c" only [from_c]\ndef from_b(s) = from_c(s)\n`,
				"c.esp": `def from_c(s) = "C(#{s})"\n`,
			},
			"a.esp",
		);
		expect(out).toBe("C(hi)\n");
	});

	it("A does NOT see C's exports through B", () => {
		expect(() =>
			runWith(
				{
					"a.esp": `import "./b"\n"hi" |> from_c |> print\n`,
					"b.esp": `import "./c"\ndef from_b(s) = from_c(s)\n`,
					"c.esp": `def from_c(s) = "C(#{s})"\n`,
				},
				"a.esp",
			),
		).toThrow(/undefined: from_c/);
	});
});

describe("imports: shadowing (D6 priority)", () => {
	it("local def shadows imported binding silently", () => {
		const out = runWith(
			{
				"entry.esp": `import "./fmt" only [bullet]\ndef bullet(s) = "L:#{s}"\n"hi" |> bullet |> print\n`,
				"fmt.esp": `def bullet(s) = "I:#{s}"\n`,
			},
			"entry.esp",
		);
		expect(out).toBe("L:hi\n");
	});

	it("imported binding shadows prelude builtin silently", () => {
		const out = runWith(
			{
				"entry.esp": `import "./fmt" only [upcase]\n"hi" |> upcase |> print\n`,
				"fmt.esp": `def upcase(s) = "OVERRIDE(#{s})"\n`,
			},
			"entry.esp",
		);
		expect(out).toBe("OVERRIDE(hi)\n");
	});
});

describe("imports: cache", () => {
	it("loads each module once even if imported by multiple files", () => {
		const calls: string[] = [];
		const files: Record<string, string> = {
			"a.esp": `import "./shared" only [tag]\ndef relay(s) = tag(s)\n`,
			"b.esp": `import "./shared" only [tag]\ndef wrap(s) = tag(s)\n`,
			"shared.esp": `def tag(s) = "T:#{s}"\n`,
			"entry.esp": `import "./a" only [relay]\nimport "./b" only [wrap]\n"b" |> wrap |> print\n`,
		};
		const baseResolver = memResolver(files);
		const resolver: Resolver = (importer, importPath) => {
			const r = baseResolver(importer, importPath);
			calls.push(r.absPath);
			return r;
		};
		captureStdout(() => {
			run(files["entry.esp"]!, "entry.esp", {
				resolver,
				entryAbsPath: "/entry.esp",
			});
		});
		// shared.esp resolved twice (once per importer) but loaded once.
		const sharedCalls = calls.filter((p) => p === "/shared.esp");
		expect(sharedCalls.length).toBe(2);
	});
});

describe("imports: cmd integration", () => {
	it("cmd body can call an imported function", () => {
		const out = runWith(
			{
				"entry.esp": `import "./fmt" only [bullet]\ncmd greet do\n  arg name: str\n  "Hi, #{name}" |> bullet |> print\nend\n`,
				"fmt.esp": `def bullet(s) = "* #{s}"\n`,
			},
			"entry.esp",
			["Mundo"],
		);
		expect(out).toBe("* Hi, Mundo\n");
	});
});

describe("imports: file-not-found (D5)", () => {
	it("throws EspetoError when resolver cannot find the module", () => {
		try {
			runWith(
				{ "entry.esp": `import "./missing"\n"hi" |> print\n` },
				"entry.esp",
			);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			expect((e as EspetoError).message).toMatch(
				/cannot resolve import '\.\/missing'/,
			);
		}
	});
});

describe("imports: cycles (D5)", () => {
	it("detects self-import cycle", () => {
		try {
			runWith(
				{
					"entry.esp": `import "./a"\n"hi" |> print\n`,
					"a.esp": `import "./a"\n`,
				},
				"entry.esp",
			);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			expect((e as EspetoError).message).toBe("circular import: a.esp -> a.esp");
		}
	});

	it("detects A → B → A cycle", () => {
		try {
			runWith(
				{
					"entry.esp": `import "./a"\n"hi" |> print\n`,
					"a.esp": `import "./b"\ndef from_a(s) = s\n`,
					"b.esp": `import "./a"\ndef from_b(s) = s\n`,
				},
				"entry.esp",
			);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			expect((e as EspetoError).message).toBe(
				"circular import: a.esp -> b.esp -> a.esp",
			);
		}
	});

	it("detects A → B → C → A cycle", () => {
		try {
			runWith(
				{
					"entry.esp": `import "./a"\n"hi" |> print\n`,
					"a.esp": `import "./b"\ndef fa(s) = s\n`,
					"b.esp": `import "./c"\ndef fb(s) = s\n`,
					"c.esp": `import "./a"\ndef fc(s) = s\n`,
				},
				"entry.esp",
			);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			expect((e as EspetoError).message).toBe(
				"circular import: a.esp -> b.esp -> c.esp -> a.esp",
			);
		}
	});
});

describe("imports: importable module validation (D2)", () => {
	it("rejects a module with top-level cmd", () => {
		try {
			runWith(
				{
					"entry.esp": `import "./mod"\n"hi" |> print\n`,
					"mod.esp": `cmd foo do\n  "x" |> print\nend\n`,
				},
				"entry.esp",
			);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			expect((e as EspetoError).message).toMatch(
				/importable module cannot contain cmd/,
			);
		}
	});

	it("rejects a module with top-level assignment", () => {
		try {
			runWith(
				{
					"entry.esp": `import "./mod"\n"hi" |> print\n`,
					"mod.esp": `x = 5\n`,
				},
				"entry.esp",
			);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			expect((e as EspetoError).message).toMatch(
				/importable module cannot contain top-level assignment/,
			);
		}
	});

	it("rejects a module with a top-level expression", () => {
		try {
			runWith(
				{
					"entry.esp": `import "./mod"\n"hi" |> print\n`,
					"mod.esp": `"side effect" |> print\n`,
				},
				"entry.esp",
			);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			expect((e as EspetoError).message).toMatch(
				/importable module cannot contain top-level expression/,
			);
		}
	});

	it("entry point is NOT subject to D2 (top-level expressions allowed)", () => {
		const out = runWith(
			{
				"entry.esp": `import "./mod"\n"hi" |> print\n`,
				"mod.esp": `def noop(s) = s\n`,
			},
			"entry.esp",
		);
		expect(out).toBe("hi\n");
	});

	it("module with only imports + def/defp is allowed", () => {
		const out = runWith(
			{
				"entry.esp": `import "./mid"\n"hi" |> wrap |> print\n`,
				"mid.esp": `import "./inner" only [tag]\ndef wrap(s) = tag(s)\n`,
				"inner.esp": `def tag(s) = "<#{s}>"\n`,
			},
			"entry.esp",
		);
		expect(out).toBe("<hi>\n");
	});
});

describe("imports: only-selector validation (D8)", () => {
	it("errors on 'only [foo]' when name doesn't exist in module", () => {
		try {
			runWith(
				{
					"entry.esp": `import "./mod" only [foo]\n"hi" |> print\n`,
					"mod.esp": `def bar(s) = s\n`,
				},
				"entry.esp",
			);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			expect((e as EspetoError).message).toBe(
				"name 'foo' not defined in './mod'",
			);
		}
	});

	it("errors on 'only [foo]' when foo is private (defp)", () => {
		try {
			runWith(
				{
					"entry.esp": `import "./mod" only [hidden]\n"hi" |> print\n`,
					"mod.esp": `defp hidden(s) = s\n`,
				},
				"entry.esp",
			);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			expect((e as EspetoError).message).toBe(
				"'hidden' is not exported by './mod' (private)",
			);
		}
	});

	it("error span points to the selector name in 'only'", () => {
		try {
			runWith(
				{
					"entry.esp": `import "./mod" only [missing]\n`,
					"mod.esp": `def other(s) = s\n`,
				},
				"entry.esp",
			);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			const err = e as EspetoError;
			expect(err.span.line).toBe(1);
			expect(err.span.col).toBe(22);
			expect(err.span.length).toBe(7);
		}
	});
});

describe("imports: collisions (D6)", () => {
	it("rejects duplicate import of the same path (literal match)", () => {
		try {
			runWith(
				{
					"entry.esp": `import "./mod" only [foo]\nimport "./mod" only [bar]\n"hi" |> print\n`,
					"mod.esp": `def foo(s) = s\ndef bar(s) = s\n`,
				},
				"entry.esp",
			);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			expect((e as EspetoError).message).toBe(
				"duplicate import './mod'; merge into single 'only [...]'",
			);
		}
	});

	it("rejects duplicate import even when literals differ but resolve identically", () => {
		try {
			runWith(
				{
					"entry.esp": `import "./mod"\nimport "./../mod"\n"hi" |> print\n`,
					"mod.esp": `def foo(s) = s\n`,
				},
				"entry.esp",
			);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			expect((e as EspetoError).message).toMatch(/duplicate import/);
		}
	});

	it("rejects two imports exposing the same name (no 'only')", () => {
		try {
			runWith(
				{
					"entry.esp": `import "./a"\nimport "./b"\n"hi" |> print\n`,
					"a.esp": `def foo(s) = s\n`,
					"b.esp": `def foo(s) = s\n`,
				},
				"entry.esp",
			);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			expect((e as EspetoError).message).toBe(
				"name 'foo' imported from both './a' and './b'; resolve with 'only [foo as ...]'",
			);
		}
	});

	it("rejects two imports exposing the same name (both with 'only')", () => {
		try {
			runWith(
				{
					"entry.esp": `import "./a" only [foo]\nimport "./b" only [foo]\n"hi" |> print\n`,
					"a.esp": `def foo(s) = s\n`,
					"b.esp": `def foo(s) = s\n`,
				},
				"entry.esp",
			);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			expect((e as EspetoError).message).toMatch(
				/name 'foo' imported from both '\.\/a' and '\.\/b'/,
			);
		}
	});

	it("rejects collision induced by alias", () => {
		try {
			runWith(
				{
					"entry.esp": `import "./a" only [foo]\nimport "./b" only [bar as foo]\n"hi" |> print\n`,
					"a.esp": `def foo(s) = s\n`,
					"b.esp": `def bar(s) = s\n`,
				},
				"entry.esp",
			);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EspetoError);
			expect((e as EspetoError).message).toMatch(
				/name 'foo' imported from both '\.\/a' and '\.\/b'/,
			);
		}
	});

	it("aliases avoid collisions when used correctly", () => {
		const out = runWith(
			{
				"entry.esp": `import "./a" only [foo]\nimport "./b" only [foo as foo_b]\n"hi" |> foo |> print\n"hi" |> foo_b |> print\n`,
				"a.esp": `def foo(s) = "A:#{s}"\n`,
				"b.esp": `def foo(s) = "B:#{s}"\n`,
			},
			"entry.esp",
		);
		expect(out).toBe("A:hi\nB:hi\n");
	});
});

describe("imports: __file__ / __dir__ are definition-site (closure)", () => {
	it("imported fn returning __dir__ resolves to lib's dir, not entry's", () => {
		const out = runWith(
			{
				"main.esp": `import "./sub/lib" only [where]\nprint(where())\n`,
				"sub/lib.esp": `def where() = __dir__\n`,
			},
			"main.esp",
		);
		expect(out).toBe("/sub\n");
	});

	it("imported fn returning __file__ resolves to lib's path", () => {
		const out = runWith(
			{
				"main.esp": `import "./sub/lib" only [which]\nprint(which())\n`,
				"sub/lib.esp": `def which() = __file__\n`,
			},
			"main.esp",
		);
		expect(out).toBe("/sub/lib.esp\n");
	});

	it("imported fn composing path with interpolation uses lib's dir", () => {
		const out = runWith(
			{
				"main.esp": `import "./sub/lib" only [data_path]\nprint(data_path("users.json"))\n`,
				"sub/lib.esp": `def data_path(name) = "#{__dir__}/#{name}"\n`,
			},
			"main.esp",
		);
		expect(out).toBe("/sub/users.json\n");
	});

	it("entry's own __dir__ is unaffected by imports", () => {
		const out = runWith(
			{
				"main.esp": `import "./sub/lib" only [where]\nprint(__dir__)\nprint(where())\n`,
				"sub/lib.esp": `def where() = __dir__\n`,
			},
			"main.esp",
		);
		expect(out).toBe("/\n/sub\n");
	});
});
