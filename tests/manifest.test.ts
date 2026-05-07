import { describe, expect, it } from "vitest";
import { Env } from "../src/env";
import { MANIFEST } from "../src/lsp/generated";
import { loadPrelude } from "../src/stdlib/index";

describe("stdlib manifest", () => {
	it("includes every registered builtin", () => {
		const env = new Env();
		loadPrelude(env);
		const registered = env.allNames();
		const documented = new Set(Object.keys(MANIFEST.functions));
		const missing = registered.filter((n) => !documented.has(n));
		expect(missing).toEqual([]);
	});

	it("entries have a non-empty summary", () => {
		for (const [name, fn] of Object.entries(MANIFEST.functions)) {
			expect(fn.summary, `'${name}' has empty summary`).not.toBe("");
		}
	});

	it("entries have at least one example", () => {
		for (const [name, fn] of Object.entries(MANIFEST.functions)) {
			expect(
				fn.examples.length,
				`'${name}' has no @example`,
			).toBeGreaterThanOrEqual(1);
		}
	});

	it("entries have a stub line pointing into stdlib.d.esp", () => {
		for (const [name, fn] of Object.entries(MANIFEST.functions)) {
			expect(fn.stubLine, `'${name}' has stubLine 0`).toBeGreaterThan(0);
		}
	});
});
