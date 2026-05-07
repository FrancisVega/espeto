import { describe, expect, it } from "vitest";
import { lex } from "../src/lexer";
import { findIdentAt, resolveIdent } from "../src/lsp/analyze";
import { parse } from "../src/parser";

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
  result = try raise("boom") rescue err => err
  result
end
`;
		const found = findAt(src, 2, 44);
		expect(found?.ident.name).toBe("err");
		expect(found?.resolution?.kind).toBe("rescue_err");
		if (found?.resolution?.kind === "rescue_err") {
			expect(found.resolution.name).toBe("err");
		}
	});
});
