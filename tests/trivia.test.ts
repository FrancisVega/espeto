import { describe, expect, it } from "vitest";
import type {
	AssignStmt,
	Cmd,
	FnDef,
	Module,
	ProgramDecl,
	TestBlock,
	TryExpr,
} from "../src/ast";
import { lex } from "../src/lexer";
import { parse } from "../src/parser";

function ast(src: string): Module {
	return parse(lex(src, "x.esp"), src);
}

describe("lexer: comment tokens", () => {
	it("emits a comment token with stripped text", () => {
		const tokens = lex(`# hola mundo`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual(["comment", "eof"]);
		expect(tokens[0]!.value).toBe("hola mundo");
	});

	it("strips a single leading space after #", () => {
		const tokens = lex(`#hola`, "x.esp");
		expect(tokens[0]!.value).toBe("hola");
	});

	it("trims trailing whitespace", () => {
		const tokens = lex(`# hola   \n`, "x.esp");
		expect(tokens[0]!.value).toBe("hola");
	});

	it("span covers the whole source segment including #", () => {
		const tokens = lex(`# hola`, "x.esp");
		const span = tokens[0]!.span;
		expect(span.col).toBe(1);
		expect(span.length).toBe(6);
	});

	it("normalizes CRLF to LF", () => {
		const tokens = lex(`# a\r\n# b\r\n`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual([
			"comment",
			"newline",
			"comment",
			"newline",
			"eof",
		]);
		expect(tokens[0]!.value).toBe("a");
		expect(tokens[2]!.value).toBe("b");
	});

	it("strips BOM at start of source", () => {
		const tokens = lex(`﻿# hola`, "x.esp");
		expect(tokens.map((t) => t.type)).toEqual(["comment", "eof"]);
		expect(tokens[0]!.value).toBe("hola");
	});
});

describe("parser: trivia attachment", () => {
	it("attaches own-line comment as leading of next stmt", () => {
		const m = ast(`# leading\nx = 1`);
		const stmt = m.items[0] as AssignStmt;
		expect(stmt.leadingComments).toHaveLength(1);
		expect(stmt.leadingComments![0]!.text).toBe("leading");
	});

	it("attaches multiple own-line comments to next stmt", () => {
		const m = ast(`# a\n# b\n# c\nx = 1`);
		const stmt = m.items[0] as AssignStmt;
		expect(stmt.leadingComments?.map((c) => c.text)).toEqual(["a", "b", "c"]);
	});

	it("collapses blank line between own-line comments (all leading)", () => {
		const m = ast(`x = 1\n# a\n\n# b\ny = 2`);
		const second = m.items[1] as AssignStmt;
		expect(second.leadingComments?.map((c) => c.text)).toEqual(["a", "b"]);
		expect(second.leadingBlankLine).toBeUndefined();
	});

	it("attaches inline same-line comment as trailingComment", () => {
		const m = ast(`x = 1 # trailing`);
		const stmt = m.items[0] as AssignStmt;
		expect(stmt.trailingComment?.text).toBe("trailing");
		expect(stmt.leadingComments).toBeUndefined();
	});

	it("sets leadingBlankLine when there is a blank line before the stmt", () => {
		const m = ast(`x = 1\n\ny = 2`);
		const second = m.items[1] as AssignStmt;
		expect(second.leadingBlankLine).toBe(true);
		expect(second.leadingComments).toBeUndefined();
	});

	it("does not set leadingBlankLine when only one newline separates stmts", () => {
		const m = ast(`x = 1\ny = 2`);
		const second = m.items[1] as AssignStmt;
		expect(second.leadingBlankLine).toBeUndefined();
	});

	it("sets leadingBlankLine when blank line precedes a leading-comment block", () => {
		const m = ast(`x = 1\n\n# leading\ny = 2`);
		const second = m.items[1] as AssignStmt;
		expect(second.leadingBlankLine).toBe(true);
		expect(second.leadingComments?.map((c) => c.text)).toEqual(["leading"]);
	});

	it("attaches comments at start of file to the first item", () => {
		const m = ast(`# header\nx = 1`);
		const stmt = m.items[0] as AssignStmt;
		expect(stmt.leadingComments?.map((c) => c.text)).toEqual(["header"]);
	});

	it("captures trailing comment of last item at end of file", () => {
		const m = ast(`x = 1 # last`);
		const stmt = m.items[0] as AssignStmt;
		expect(stmt.trailingComment?.text).toBe("last");
	});

	it("dangling comments at end of file land on Module", () => {
		const m = ast(`x = 1\n# trailing dangling`);
		expect(m.danglingComments?.map((c) => c.text)).toEqual([
			"trailing dangling",
		]);
		const stmt = m.items[0] as AssignStmt;
		expect(stmt.trailingComment).toBeUndefined();
	});
});

describe("parser: trivia inside containers", () => {
	it("attaches leading comments inside a def body", () => {
		const m = ast(`def f() do\n  # first\n  x = 1\nend`);
		const fn = m.items[0] as FnDef;
		const stmt = fn.body[0] as AssignStmt;
		expect(stmt.leadingComments?.map((c) => c.text)).toEqual(["first"]);
	});

	it("attaches trailing comment inside a def body", () => {
		const m = ast(`def f() do\n  x = 1 # tr\nend`);
		const fn = m.items[0] as FnDef;
		const stmt = fn.body[0] as AssignStmt;
		expect(stmt.trailingComment?.text).toBe("tr");
	});

	it("dangling-only def body is allowed", () => {
		const m = ast(`def f() do\n  # TODO: implement\nend`);
		const fn = m.items[0] as FnDef;
		expect(fn.body).toHaveLength(0);
		expect(fn.danglingComments?.map((c) => c.text)).toEqual([
			"TODO: implement",
		]);
	});

	it("dangling comments after last stmt before end go to container", () => {
		const m = ast(`def f() do\n  x = 1\n  # post-stmt dangling\nend`);
		const fn = m.items[0] as FnDef;
		expect(fn.body).toHaveLength(1);
		expect(fn.danglingComments?.map((c) => c.text)).toEqual([
			"post-stmt dangling",
		]);
	});

	it("attaches trivia inside test block", () => {
		const m = ast(
			`test "t" do\n  # before assert\n  assert true\nend`,
		);
		const test = m.items[0] as TestBlock;
		expect(test.body[0]!.leadingComments?.map((c) => c.text)).toEqual([
			"before assert",
		]);
	});

	it("attaches trivia inside try / rescue bodies separately", () => {
		const m = ast(
			`x = try do\n  # in try\n  a\nrescue err =>\n  # in rescue\n  b\nend`,
		);
		const stmt = m.items[0] as AssignStmt;
		const tryExpr = stmt.value as TryExpr;
		expect(tryExpr.tryBody[0]!.leadingComments?.map((c) => c.text)).toEqual([
			"in try",
		]);
		expect(tryExpr.rescueBody[0]!.leadingComments?.map((c) => c.text)).toEqual([
			"in rescue",
		]);
	});

	it("attaches leading comments to a cmd inside program", () => {
		const m = ast(
			`program app do\n  # leading for cmd\n  cmd hello do\n    "hi" |> print\n  end\nend`,
		);
		const program = m.items[0] as ProgramDecl;
		expect(program.cmds[0]!.leadingComments?.map((c) => c.text)).toEqual([
			"leading for cmd",
		]);
	});

	it("captures dangling in cmd body with comments only", () => {
		const m = ast(`cmd foo do\n  # only a comment\nend`);
		const cmd = m.items[0] as Cmd;
		expect(cmd.body).toHaveLength(0);
		expect(cmd.danglingComments?.map((c) => c.text)).toEqual([
			"only a comment",
		]);
	});
});

describe("parser: ## doc comments unaffected", () => {
	it("still places ## doc on FnDef.doc, not in trivia", () => {
		const m = ast(`## a doc\ndef f() = 1`);
		const fn = m.items[0] as FnDef;
		expect(fn.doc).toBe("a doc");
		expect(fn.leadingComments).toBeUndefined();
	});

	it("preserves regular # comment before ## doc as leading of def", () => {
		const m = ast(`# before doc\n## doc\ndef f() = 1`);
		const fn = m.items[0] as FnDef;
		expect(fn.doc).toBe("doc");
		expect(fn.leadingComments?.map((c) => c.text)).toEqual(["before doc"]);
	});
});

describe("parser: intra-expression comments error", () => {
	it("errors on comment inside a list literal", () => {
		expect(() => ast(`[1,\n# bad\n2]`)).toThrowError(
			/comments inside expressions/i,
		);
	});

	it("errors on comment inside a parenthesized expression", () => {
		expect(() => ast(`x = (\n# bad\n1\n)`)).toThrowError(
			/comments inside expressions/i,
		);
	});

	it("errors on comment between operator and rhs", () => {
		expect(() => ast(`x = 1 +\n# bad\n2`)).toThrowError(
			/comments inside expressions/i,
		);
	});

	it("errors on comment inside a map literal", () => {
		expect(() => ast(`{\n# bad\na: 1\n}`)).toThrowError(
			/comments inside expressions/i,
		);
	});

	it("errors on comment between pipe stages", () => {
		expect(() => ast(`x\n# bad\n|> f`)).toThrowError(
			/comments inside expressions/i,
		);
	});

	it("error span points to the comment token", () => {
		try {
			ast(`[1,\n# bad\n2]`);
			expect.fail("expected error");
		} catch (e) {
			const err = e as { span?: { line: number; col: number } };
			expect(err.span?.line).toBe(2);
			expect(err.span?.col).toBe(1);
		}
	});
});
