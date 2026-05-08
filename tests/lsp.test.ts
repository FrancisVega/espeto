import { describe, expect, it } from "vitest";
import { EspetoError } from "../src/errors";
import { lex } from "../src/lexer";
import {
	findIdentAt,
	findReferences,
	findResolvableAt,
	resolveIdent,
	sameBinding,
} from "../src/lsp/analyze";
import { buildCompletions } from "../src/lsp/completion";
import { buildDiagnostics } from "../src/lsp/diagnostics";
import {
	buildSemanticTokens,
	SEMANTIC_TOKEN_TYPES,
} from "../src/lsp/semantic";
import {
	findCallContext,
	lookupSignature,
} from "../src/lsp/signature";
import {
	buildDocumentSymbols,
	buildFoldingRanges,
} from "../src/lsp/symbols";
import { parse } from "../src/parser";
import { renderResolutionHover } from "../src/lsp/server";

const BUILTINS = new Set(["upcase", "map", "filter", "to_str", "print"]);

function setup(source: string) {
	const tokens = lex(source, "test.esp");
	const program = parse(tokens, source);
	return program;
}

function findAt(source: string, line: number, col: number) {
	const program = setup(source);
	const ident = findIdentAt(program, line, col);
	if (!ident) return null;
	const resolution = resolveIdent(program, ident, BUILTINS);
	return { ident, resolution };
}

describe("findIdentAt", () => {
	it("finds identifier at exact position", () => {
		const src = `cmd run do
  arg name: str
  upcase(name)
end
`;
		const found = findAt(src, 3, 3);
		expect(found?.ident.name).toBe("upcase");
	});

	it("returns null outside any identifier", () => {
		const src = `x = 1\n`;
		const program = setup(src);
		expect(findIdentAt(program, 1, 3)).toBeNull();
	});
});

describe("resolveIdent — builtins", () => {
	it("resolves a stdlib builtin call", () => {
		const src = `cmd run do
  upcase("hi") |> print
end
`;
		const found = findAt(src, 2, 3);
		expect(found?.resolution).toEqual({ kind: "builtin", name: "upcase" });
	});

	it("does not resolve unknown names", () => {
		const src = `cmd run do
  notabuiltin(42)
end
`;
		const found = findAt(src, 2, 3);
		expect(found?.resolution).toBeNull();
	});
});

describe("resolveIdent — local fn defs", () => {
	it("resolves a call to a top-level fn", () => {
		const src = `def double(x) = x * 2

cmd run do
  double(21)
end
`;
		const found = findAt(src, 4, 3);
		expect(found?.resolution?.kind).toBe("fn");
		if (found?.resolution?.kind === "fn") {
			expect(found.resolution.node.name).toBe("double");
			expect(found.resolution.node.params).toEqual(["x"]);
		}
	});
});

describe("resolveIdent — args and flags", () => {
	it("resolves a positional arg", () => {
		const src = `cmd greet do
  arg name: str
  upcase(name)
end
`;
		const found = findAt(src, 3, 10);
		expect(found?.resolution?.kind).toBe("arg");
		if (found?.resolution?.kind === "arg") {
			expect(found.resolution.node.name).toBe("name");
			expect(found.resolution.node.type).toBe("str");
		}
	});

	it("resolves a flag", () => {
		const src = `cmd run do
  flag verbose: bool = false
  verbose
end
`;
		const found = findAt(src, 3, 3);
		expect(found?.resolution?.kind).toBe("flag");
		if (found?.resolution?.kind === "flag") {
			expect(found.resolution.node.name).toBe("verbose");
			expect(found.resolution.node.type).toBe("bool");
		}
	});
});

describe("resolveIdent — locals (let)", () => {
	it("resolves a local assignment used after declaration", () => {
		const src = `cmd run do
  greeting = "hello"
  upcase(greeting)
end
`;
		const found = findAt(src, 3, 10);
		expect(found?.resolution?.kind).toBe("let");
		if (found?.resolution?.kind === "let") {
			expect(found.resolution.name).toBe("greeting");
		}
	});

	it("resolves a top-level assignment", () => {
		const src = `pi = 3.14

cmd run do
  pi
end
`;
		const found = findAt(src, 4, 3);
		expect(found?.resolution?.kind).toBe("let");
	});
});

describe("resolveIdent — lambda and fn params", () => {
	it("resolves a lambda param", () => {
		const src = `cmd run do
  [1, 2, 3] |> map(fn(x) => x * 2)
end
`;
		const found = findAt(src, 2, 29);
		expect(found?.ident.name).toBe("x");
		expect(found?.resolution?.kind).toBe("lambda_param");
		if (found?.resolution?.kind === "lambda_param") {
			expect(found.resolution.name).toBe("x");
		}
	});

	it("resolves a fn param inside fn body", () => {
		const src = `def double(x) = x * 2
`;
		const found = findAt(src, 1, 17);
		expect(found?.resolution?.kind).toBe("fn_param");
	});
});

describe("resolveIdent — try/rescue", () => {
	it("resolves the rescue err binding", () => {
		const src = `cmd run do
  result = try do
    raise("boom")
  rescue err =>
    err
  end
  result
end
`;
		const found = findAt(src, 5, 5);
		expect(found?.ident.name).toBe("err");
		expect(found?.resolution?.kind).toBe("rescue_err");
		if (found?.resolution?.kind === "rescue_err") {
			expect(found.resolution.name).toBe("err");
		}
	});
});

describe("buildDiagnostics", () => {
	it("returns no diagnostics for non-EspetoError", () => {
		expect(buildDiagnostics(null)).toEqual([]);
		expect(buildDiagnostics(new Error("plain"))).toEqual([]);
	});

	it("maps an EspetoError to a single Error diagnostic with span range", () => {
		const err = new EspetoError(
			"unexpected token",
			{ file: "test.esp", line: 3, col: 5, length: 4 },
			"source",
		);
		const diags = buildDiagnostics(err);
		expect(diags).toHaveLength(1);
		const d = diags[0]!;
		expect(d.severity).toBe(1);
		expect(d.source).toBe("espeto");
		expect(d.message).toBe("unexpected token");
		expect(d.range).toEqual({
			start: { line: 2, character: 4 },
			end: { line: 2, character: 8 },
		});
	});

	it("uses real parse errors from the lexer/parser", () => {
		const src = `cmd run do\n  arg :::\nend\n`;
		try {
			parse(lex(src, "test.esp"), src);
			throw new Error("expected parse to fail");
		} catch (e) {
			const diags = buildDiagnostics(e);
			expect(diags).toHaveLength(1);
			expect(diags[0]!.range.start.line).toBeGreaterThanOrEqual(0);
			expect(diags[0]!.message.length).toBeGreaterThan(0);
		}
	});
});

describe("resolveIdent — source bindings", () => {
	it("resolves __file__ as source_binding", () => {
		const src = `cmd run do
  print(__file__)
end
`;
		const found = findAt(src, 2, 10);
		expect(found?.ident.name).toBe("__file__");
		expect(found?.resolution).toEqual({
			kind: "source_binding",
			name: "__file__",
		});
	});

	it("resolves __dir__ as source_binding", () => {
		const src = `cmd run do
  print(__dir__)
end
`;
		const found = findAt(src, 2, 10);
		expect(found?.ident.name).toBe("__dir__");
		expect(found?.resolution).toEqual({
			kind: "source_binding",
			name: "__dir__",
		});
	});

	it("source_binding takes precedence over user-supplied builtin set", () => {
		const src = `__file__\n`;
		const program = setup(src);
		const ident = findIdentAt(program, 1, 1);
		expect(ident).not.toBeNull();
		const resolution = resolveIdent(
			program,
			ident!,
			new Set<string>(["__file__"]),
		);
		expect(resolution).toEqual({
			kind: "source_binding",
			name: "__file__",
		});
	});
});

describe("buildCompletions", () => {
	function labels(items: { label: string }[]): Set<string> {
		return new Set(items.map((i) => i.label));
	}

	it("returns keywords and builtins when module is null", () => {
		const items = buildCompletions(null, 1);
		const ls = labels(items);
		expect(ls.has("cmd")).toBe(true);
		expect(ls.has("do")).toBe(true);
		expect(ls.has("end")).toBe(true);
		expect(ls.has("fn")).toBe(true);
		expect(ls.has("upcase")).toBe(true);
	});

	it("includes top-level fn defs and assigns from module", () => {
		const src = `def double(x) = x * 2\npi = 3.14\n`;
		const program = setup(src);
		const ls = labels(buildCompletions(program, 1));
		expect(ls.has("double")).toBe(true);
		expect(ls.has("pi")).toBe(true);
	});

	it("exposes args, flags and locals when cursor is inside a cmd", () => {
		const src = `cmd greet do
  arg name: str
  flag loud: bool = false
  greeting = "hi"

end
`;
		const program = setup(src);
		const ls = labels(buildCompletions(program, 5));
		expect(ls.has("name")).toBe(true);
		expect(ls.has("loud")).toBe(true);
		expect(ls.has("greeting")).toBe(true);
	});

	it("does not expose args of a cmd when cursor is on an unrelated top-level fn", () => {
		const src = `def helper(x) = x
cmd greet do
  arg name: str
end
`;
		const program = setup(src);
		const ls = labels(buildCompletions(program, 1));
		expect(ls.has("helper")).toBe(true);
		expect(ls.has("name")).toBe(false);
	});

	it("exposes fn params when cursor is inside fn body", () => {
		const src = `def double(x) do
  x * 2
end
`;
		const program = setup(src);
		const ls = labels(buildCompletions(program, 2));
		expect(ls.has("x")).toBe(true);
	});

	it("descends into program -> cmds and exposes the right cmd's args", () => {
		const src = `program myapp do
  flag verbose: bool = false
  cmd a do
    arg foo: str
  end
  cmd b do
    arg bar: str
  end
end
`;
		const program = setup(src);
		const ls = labels(buildCompletions(program, 7));
		expect(ls.has("verbose")).toBe(true);
		expect(ls.has("bar")).toBe(true);
		expect(ls.has("foo")).toBe(false);
	});

	it("attaches detail and markdown docs to builtins", () => {
		const items = buildCompletions(null, 1);
		const upcase = items.find((i) => i.label === "upcase");
		expect(upcase).toBeDefined();
		expect(upcase!.detail).toMatch(/^upcase\(/);
		const docs = upcase!.documentation;
		expect(typeof docs === "object" && docs !== null && "kind" in docs).toBe(
			true,
		);
	});
});

describe("findReferences", () => {
	function refsAt(source: string, line: number, col: number) {
		const program = setup(source);
		const ident = findIdentAt(program, line, col);
		if (!ident) throw new Error("no ident");
		const res = resolveIdent(program, ident, BUILTINS);
		if (!res) throw new Error("no resolution");
		return findReferences(program, res, BUILTINS);
	}

	it("collects definition + usages of a let", () => {
		const src = `cmd run do
  greeting = "hi"
  upcase(greeting)
  upcase(greeting)
end
`;
		const spans = refsAt(src, 3, 10);
		expect(spans).toHaveLength(3);
		const lines = spans.map((s) => s.line).sort((a, b) => a - b);
		expect(lines).toEqual([2, 3, 4]);
	});

	it("collects definition + usages of an arg", () => {
		const src = `cmd greet do
  arg name: str
  upcase(name)
  print(name)
end
`;
		const spans = refsAt(src, 3, 10);
		expect(spans).toHaveLength(3);
		expect(spans.map((s) => s.line).sort()).toEqual([2, 3, 4]);
	});

	it("collects definition + usages of a flag", () => {
		const src = `cmd run do
  flag verbose: bool = false
  if verbose do
    print(verbose)
  end
end
`;
		const spans = refsAt(src, 3, 6);
		expect(spans.length).toBeGreaterThanOrEqual(3);
		expect(spans[0]!.line).toBe(2);
	});

	it("collects definition + usages of a top-level fn", () => {
		const src = `def double(x) = x * 2

cmd run do
  double(21)
  double(42)
end
`;
		const spans = refsAt(src, 4, 3);
		expect(spans).toHaveLength(3);
		expect(spans[0]!.line).toBe(1);
	});

	it("collects fn param refs by definition site", () => {
		const src = `def double(x) = x * 2
`;
		const spans = refsAt(src, 1, 17);
		expect(spans).toHaveLength(2);
		expect(spans.map((s) => s.line).sort()).toEqual([1, 1]);
	});

	it("collects lambda param refs scoped to the lambda", () => {
		const src = `cmd run do
  [1, 2] |> map(fn(x) => x + x)
end
`;
		const spans = refsAt(src, 2, 26);
		expect(spans).toHaveLength(3);
	});

	it("collects rescue err binding refs", () => {
		const src = `cmd run do
  try do
    raise("x")
  rescue err =>
    print(err)
  end
end
`;
		const spans = refsAt(src, 5, 11);
		expect(spans).toHaveLength(2);
	});

	it("does not include the declaration for builtins", () => {
		const src = `cmd run do
  upcase("hi")
  upcase("ho")
end
`;
		const spans = refsAt(src, 2, 3);
		expect(spans).toHaveLength(2);
		expect(spans.every((s) => s.line >= 2)).toBe(true);
	});

	it("does not return duplicate spans (invariant for rename WorkspaceEdit)", () => {
		const src = `def double(x) = x * 2

cmd run do
  double(double(1))
end
`;
		const program = setup(src);
		const id = findIdentAt(program, 4, 3);
		const res = resolveIdent(program, id!, BUILTINS);
		const spans = findReferences(program, res!, BUILTINS);
		const keys = new Set(
			spans.map((s) => `${s.file}:${s.line}:${s.col}:${s.length}`),
		);
		expect(keys.size).toBe(spans.length);
	});

	it("scopes lambda params to their lambda only", () => {
		const src = `cmd run do
  a = fn(x) => x + 1
  b = fn(x) => x + 2
  a(1)
  b(2)
end
`;
		const program = setup(src);
		const idA = findIdentAt(program, 2, 16);
		const resA = resolveIdent(program, idA!, BUILTINS);
		const spans = findReferences(program, resA!, BUILTINS);
		expect(spans).toHaveLength(2);
		expect(spans.every((s) => s.line === 2)).toBe(true);
	});
});

describe("findResolvableAt", () => {
	it("matches a let binding at its declaration site", () => {
		const src = `cmd run do
  greeting = "hi"
  print(greeting)
end
`;
		const found = findResolvableAt(setup(src), 2, 3, BUILTINS);
		expect(found).not.toBeNull();
		expect(found!.name).toBe("greeting");
		expect(found!.resolution.kind).toBe("let");
	});

	it("matches an arg at its declaration site", () => {
		const src = `cmd greet do
  arg name: str
  upcase(name)
end
`;
		const found = findResolvableAt(setup(src), 2, 7, BUILTINS);
		expect(found).not.toBeNull();
		expect(found!.name).toBe("name");
		expect(found!.resolution.kind).toBe("arg");
	});

	it("matches a flag at its declaration site", () => {
		const src = `cmd run do
  flag verbose: bool = false
  verbose
end
`;
		const found = findResolvableAt(setup(src), 2, 8, BUILTINS);
		expect(found).not.toBeNull();
		expect(found!.name).toBe("verbose");
		expect(found!.resolution.kind).toBe("flag");
	});

	it("matches a fn name at its declaration site", () => {
		const src = `def double(x) = x * 2
`;
		const found = findResolvableAt(setup(src), 1, 5, BUILTINS);
		expect(found).not.toBeNull();
		expect(found!.name).toBe("double");
		expect(found!.resolution.kind).toBe("fn");
	});

	it("matches a fn param at its declaration site", () => {
		const src = `def double(x) = x * 2
`;
		const found = findResolvableAt(setup(src), 1, 12, BUILTINS);
		expect(found).not.toBeNull();
		expect(found!.name).toBe("x");
		expect(found!.resolution.kind).toBe("fn_param");
	});

	it("matches a lambda param at its declaration site", () => {
		const src = `cmd run do
  [1, 2] |> map(fn(x) => x + 1)
end
`;
		const found = findResolvableAt(setup(src), 2, 20, BUILTINS);
		expect(found).not.toBeNull();
		expect(found!.name).toBe("x");
		expect(found!.resolution.kind).toBe("lambda_param");
	});

	it("matches a rescue err at its declaration site", () => {
		const src = `cmd run do
  try do
    raise("x")
  rescue err =>
    print(err)
  end
end
`;
		const found = findResolvableAt(setup(src), 4, 10, BUILTINS);
		expect(found).not.toBeNull();
		expect(found!.name).toBe("err");
		expect(found!.resolution.kind).toBe("rescue_err");
	});

	it("falls back to a usage Identifier when not on a declaration", () => {
		const src = `cmd run do
  upcase("hi")
end
`;
		const found = findResolvableAt(setup(src), 2, 3, BUILTINS);
		expect(found).not.toBeNull();
		expect(found!.name).toBe("upcase");
		expect(found!.resolution.kind).toBe("builtin");
	});

	it("returns null when not on any name", () => {
		const src = `cmd run do
  greeting = "hi"
end
`;
		const found = findResolvableAt(setup(src), 1, 1, BUILTINS);
		expect(found).toBeNull();
	});
});

describe("sameBinding", () => {
	it("returns true for two resolutions of the same let", () => {
		const src = `cmd run do
  x = 1
  x + x
end
`;
		const program = setup(src);
		const id1 = findIdentAt(program, 3, 3);
		const id2 = findIdentAt(program, 3, 7);
		const r1 = resolveIdent(program, id1!, BUILTINS);
		const r2 = resolveIdent(program, id2!, BUILTINS);
		expect(sameBinding(r1!, r2!)).toBe(true);
	});

	it("returns false across different let bindings", () => {
		const src = `cmd run do
  a = 1
  b = 2
  a + b
end
`;
		const program = setup(src);
		const idA = findIdentAt(program, 4, 3);
		const idB = findIdentAt(program, 4, 7);
		const rA = resolveIdent(program, idA!, BUILTINS);
		const rB = resolveIdent(program, idB!, BUILTINS);
		expect(sameBinding(rA!, rB!)).toBe(false);
	});
});

describe("buildDocumentSymbols", () => {
	it("returns a Method symbol for a top-level cmd with arg/flag children", () => {
		const src = `cmd greet do
  arg name: str
  flag loud: bool = false
  upcase(name)
end
`;
		const program = setup(src);
		const syms = buildDocumentSymbols(program);
		expect(syms).toHaveLength(1);
		const cmd = syms[0]!;
		expect(cmd.name).toBe("greet");
		expect(cmd.kind).toBe(6);
		expect(cmd.children).toHaveLength(2);
		expect(cmd.children![0]!.name).toBe("name");
		expect(cmd.children![1]!.name).toBe("loud");
	});

	it("returns a Function symbol for a top-level fn_def", () => {
		const src = `def double(x) = x * 2
`;
		const syms = buildDocumentSymbols(setup(src));
		expect(syms).toHaveLength(1);
		expect(syms[0]!.name).toBe("double");
		expect(syms[0]!.kind).toBe(12);
		expect(syms[0]!.detail).toBe("fn(x)");
	});

	it("returns a Module for program with flags and cmds as children", () => {
		const src = `program myapp do
  flag verbose: bool = false
  cmd a do
    arg foo: str
  end
  cmd b do
    arg bar: str
  end
end
`;
		const syms = buildDocumentSymbols(setup(src));
		expect(syms).toHaveLength(1);
		const p = syms[0]!;
		expect(p.name).toBe("myapp");
		expect(p.kind).toBe(2);
		const childNames = p.children!.map((c) => c.name);
		expect(childNames).toEqual(["verbose", "a", "b"]);
		const cmdA = p.children!.find((c) => c.name === "a");
		expect(cmdA!.children!.map((c) => c.name)).toEqual(["foo"]);
	});

	it("returns a symbol for test blocks", () => {
		const src = `test "double works" do
  assert 1 == 1
end
`;
		const syms = buildDocumentSymbols(setup(src));
		expect(syms).toHaveLength(1);
		expect(syms[0]!.name).toBe("double works");
		expect(syms[0]!.detail).toBe("test");
	});

	it("ignores import items and bare expressions", () => {
		const src = `pi = 3.14
cmd a do
  arg x: str
end
`;
		const syms = buildDocumentSymbols(setup(src));
		expect(syms).toHaveLength(1);
		expect(syms[0]!.name).toBe("a");
	});
});

describe("buildFoldingRanges", () => {
	it("folds a multi-line cmd block", () => {
		const src = `cmd greet do
  arg name: str
  upcase(name)
end
`;
		const folds = buildFoldingRanges(setup(src));
		expect(folds).toHaveLength(1);
		expect(folds[0]).toEqual({ startLine: 0, endLine: 3 });
	});

	it("does not fold a single-line shorthand fn", () => {
		const src = `def double(x) = x * 2
`;
		expect(buildFoldingRanges(setup(src))).toEqual([]);
	});

	it("folds a multi-line fn def with do/end", () => {
		const src = `def double(x) do
  x * 2
end
`;
		const folds = buildFoldingRanges(setup(src));
		expect(folds).toHaveLength(1);
		expect(folds[0]!.startLine).toBe(0);
		expect(folds[0]!.endLine).toBe(2);
	});

	it("folds program and each inner cmd", () => {
		const src = `program myapp do
  cmd a do
    arg foo: str
  end
  cmd b do
    arg bar: str
  end
end
`;
		const folds = buildFoldingRanges(setup(src));
		expect(folds.length).toBeGreaterThanOrEqual(3);
		const startLines = folds.map((f) => f.startLine).sort((a, b) => a - b);
		expect(startLines[0]).toBe(0);
	});
});

describe("findCallContext", () => {
	function ctxAt(text: string, marker: string) {
		const offset = text.indexOf(marker);
		if (offset < 0) throw new Error("marker not found");
		return findCallContext(text, offset);
	}

	it("finds the enclosing builtin call at param 0", () => {
		const ctx = ctxAt(`upcase(<HERE>)`, "<HERE>");
		expect(ctx).toEqual({ name: "upcase", activeParam: 0 });
	});

	it("counts commas to advance activeParam", () => {
		const ctx = ctxAt(`foo(a, b, <HERE>)`, "<HERE>");
		expect(ctx).toEqual({ name: "foo", activeParam: 2 });
	});

	it("returns the innermost call when nested", () => {
		const ctx = ctxAt(`outer(inner(<HERE>))`, "<HERE>");
		expect(ctx).toEqual({ name: "inner", activeParam: 0 });
	});

	it("returns null when not in a call", () => {
		expect(findCallContext(`x = 1<HERE>`, "x = 1".length)).toBeNull();
	});

	it("ignores commas inside string literals", () => {
		const ctx = ctxAt(`f("a, b, c", <HERE>)`, "<HERE>");
		expect(ctx).toEqual({ name: "f", activeParam: 1 });
	});

	it("ignores parens inside string literals", () => {
		const ctx = ctxAt(`f("(", <HERE>)`, "<HERE>");
		expect(ctx).toEqual({ name: "f", activeParam: 1 });
	});

	it("skips line comments", () => {
		const ctx = ctxAt(`f(\n  # noisy , ( ) line\n  <HERE>)`, "<HERE>");
		expect(ctx).toEqual({ name: "f", activeParam: 0 });
	});

	it("treats `if(...)` as not a call (keyword)", () => {
		const ctx = ctxAt(`if (<HERE>x)`, "<HERE>");
		expect(ctx).toBeNull();
	});

	it("returns null after the closing paren", () => {
		expect(findCallContext(`foo(1)`, 6)).toBeNull();
	});
});

describe("lookupSignature", () => {
	it("returns a SignatureHelp for a known builtin", () => {
		const help = lookupSignature({ name: "upcase", activeParam: 0 }, []);
		expect(help).not.toBeNull();
		expect(help!.signatures).toHaveLength(1);
		expect(help!.signatures[0]!.label).toMatch(/^upcase\(/);
		expect(help!.activeParameter).toBe(0);
	});

	it("clamps activeParameter to the last parameter", () => {
		const help = lookupSignature({ name: "upcase", activeParam: 99 }, []);
		expect(help).not.toBeNull();
		expect(help!.activeParameter).toBe(0);
	});

	it("returns a SignatureHelp for a user-defined fn", () => {
		const src = `def double(x) = x * 2
`;
		const program = setup(src);
		const userFns = program.items.flatMap((it) =>
			it.kind === "fn_def" ? [it] : [],
		);
		const help = lookupSignature({ name: "double", activeParam: 0 }, userFns);
		expect(help).not.toBeNull();
		expect(help!.signatures[0]!.label).toBe("fn double(x)");
	});

	it("returns null for unknown names", () => {
		expect(
			lookupSignature({ name: "notabuiltin", activeParam: 0 }, []),
		).toBeNull();
	});
});

describe("buildSemanticTokens", () => {
	function tokensFor(src: string) {
		const program = setup(src);
		const result = buildSemanticTokens(program, BUILTINS);
		const tokens: {
			line: number;
			char: number;
			len: number;
			type: number;
			mod: number;
		}[] = [];
		let line = 0;
		let char = 0;
		for (let i = 0; i < result.data.length; i += 5) {
			const dLine = result.data[i]!;
			const dChar = result.data[i + 1]!;
			const len = result.data[i + 2]!;
			const type = result.data[i + 3]!;
			const mod = result.data[i + 4]!;
			line += dLine;
			char = dLine === 0 ? char + dChar : dChar;
			tokens.push({ line, char, len, type, mod });
		}
		return tokens;
	}

	it("emits a function token with defaultLibrary modifier for builtins", () => {
		const tokens = tokensFor(`cmd run do
  upcase("hi")
end
`);
		expect(tokens).toHaveLength(1);
		const t = tokens[0]!;
		expect(SEMANTIC_TOKEN_TYPES[t.type]).toBe("function");
		expect(t.mod).toBe(1);
		expect(t.line).toBe(1);
		expect(t.char).toBe(2);
		expect(t.len).toBe(6);
	});

	it("emits a parameter token for cmd args", () => {
		const tokens = tokensFor(`cmd greet do
  arg name: str
  upcase(name)
end
`);
		const arg = tokens.find((t) => t.line === 2 && t.char === 9);
		expect(arg).toBeDefined();
		expect(SEMANTIC_TOKEN_TYPES[arg!.type]).toBe("parameter");
	});

	it("emits a variable token for let bindings", () => {
		const tokens = tokensFor(`cmd run do
  greeting = "hi"
  print(greeting)
end
`);
		const ref = tokens.find((t) => t.line === 2 && t.char === 8);
		expect(ref).toBeDefined();
		expect(SEMANTIC_TOKEN_TYPES[ref!.type]).toBe("variable");
	});

	it("emits a function token without defaultLibrary for user fns", () => {
		const tokens = tokensFor(`def double(x) = x * 2

cmd run do
  double(21)
end
`);
		const callTok = tokens.find((t) => t.line === 3 && t.char === 2);
		expect(callTok).toBeDefined();
		expect(SEMANTIC_TOKEN_TYPES[callTok!.type]).toBe("function");
		expect(callTok!.mod).toBe(0);
	});

	it("emits tokens in source order (delta encoding stays monotonic)", () => {
		const tokens = tokensFor(`cmd run do
  upcase("a")
  upcase("b")
end
`);
		expect(tokens.length).toBeGreaterThanOrEqual(2);
		for (let i = 1; i < tokens.length; i++) {
			const prev = tokens[i - 1]!;
			const cur = tokens[i]!;
			const ok = cur.line > prev.line ||
				(cur.line === prev.line && cur.char >= prev.char);
			expect(ok).toBe(true);
		}
	});
});

describe("hover for def/defp with doc-comments", () => {
	function fnHoverFor(src: string, fnName: string) {
		const program = setup(src);
		const node = program.items.find(
			(i) => i.kind === "fn_def" && i.name === fnName,
		);
		if (!node || node.kind !== "fn_def")
			throw new Error(`fn ${fnName} not found`);
		return renderResolutionHover({ kind: "fn", node });
	}

	it("renders hover without doc when fn has none", () => {
		const hover = fnHoverFor(`def saludar(name) = "Hola"`, "saludar");
		expect(hover).toBe(
			"```espeto\nexport fn saludar(name)\n```\n\n*local function*",
		);
	});

	it("inserts doc between signature and footer", () => {
		const hover = fnHoverFor(
			`## Saluda a alguien.\ndef saludar(name) = "Hola"`,
			"saludar",
		);
		expect(hover).toBe(
			"```espeto\nexport fn saludar(name)\n```\n\nSaluda a alguien.\n\n*local function*",
		);
	});

	it("preserves multi-line doc with paragraph breaks", () => {
		const hover = fnHoverFor(
			`## First paragraph.\n##\n## Second paragraph.\ndef f(x) = x`,
			"f",
		);
		expect(hover).toContain(
			"```espeto\nexport fn f(x)\n```\n\nFirst paragraph.\n\nSecond paragraph.\n\n*local function*",
		);
	});

	it("uses *private function* footer for defp", () => {
		const hover = fnHoverFor(
			`## Helper privado.\ndefp helper(x) = x`,
			"helper",
		);
		expect(hover).toBe(
			"```espeto\nfn helper(x)\n```\n\nHelper privado.\n\n*private function*",
		);
	});

	it("renders defp without doc with private footer", () => {
		const hover = fnHoverFor(`defp helper(x) = x`, "helper");
		expect(hover).toBe(
			"```espeto\nfn helper(x)\n```\n\n*private function*",
		);
	});
});
