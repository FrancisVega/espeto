import { describe, expect, it } from "vitest";
import { buildDocs } from "../src/docs";
import { MANIFEST } from "../src/lsp/generated";

describe("docs", () => {
	it("includes header with version", () => {
		const out = buildDocs();
		expect(out.startsWith(`# Espeto v${MANIFEST.version} reference\n`)).toBe(
			true,
		);
		expect(out).toMatch(/Generated \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
	});

	it("includes Syntax section with core keywords", () => {
		const out = buildDocs();
		expect(out).toContain("## Syntax");
		expect(out).toContain("|>");
		expect(out).toContain("fn x => x + 1");
		expect(out).toContain("def name(a, b) do");
		expect(out).toContain("try do");
		expect(out).toContain("cmd greet do");
		expect(out).toContain("program todo do");
		expect(out).toContain("test \"two plus two");
	});

	it("lists every module from the manifest as a `## ` header", () => {
		const out = buildDocs();
		const fns = Object.values(MANIFEST.functions);
		const modules = [...new Set(fns.map((f) => f.module))].sort();
		for (const m of modules) {
			expect(out).toContain(`## ${m}\n`);
		}
		expect(modules.length).toBeGreaterThanOrEqual(11);
	});

	it("lists every function from the manifest with signature and example", () => {
		const out = buildDocs();
		const fns = Object.values(MANIFEST.functions);
		expect(fns.length).toBeGreaterThanOrEqual(73);
		for (const fn of fns) {
			const params = fn.params.map((p) => `${p.name}: ${p.type}`).join(", ");
			const sig = `### \`${fn.name}(${params}) -> ${fn.returns.type}\``;
			expect(out).toContain(sig);
			expect(out).toContain(fn.summary);
		}
	});
});
