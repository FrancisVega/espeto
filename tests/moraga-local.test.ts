import { describe, expect, it } from "vitest";
import { parseLocal } from "../src/moraga/local";

const FILE = "moraga.local.esp";

describe("parseLocal", () => {
	it("parses an empty top-level map", () => {
		const r = parseLocal("{}\n", FILE);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.local.links.size).toBe(0);
	});

	it("parses a map without links field", () => {
		const r = parseLocal("{}\n", FILE);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.local.links.size).toBe(0);
	});

	it("parses an empty links map", () => {
		const r = parseLocal(`{"links": {}}\n`, FILE);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.local.links.size).toBe(0);
	});

	it("parses a single link entry", () => {
		const r = parseLocal(
			`{
  "links": {
    "github.com/foo/mi_pkg": "../mi-pkg"
  }
}
`,
			FILE,
		);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.local.links.size).toBe(1);
			expect(r.local.links.get("github.com/foo/mi_pkg")).toBe("../mi-pkg");
		}
	});

	it("parses multiple link entries", () => {
		const r = parseLocal(
			`{
  "links": {
    "github.com/foo/a": "../a",
    "github.com/foo/b": "/abs/path/b"
  }
}
`,
			FILE,
		);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.local.links.size).toBe(2);
			expect(r.local.links.get("github.com/foo/a")).toBe("../a");
			expect(r.local.links.get("github.com/foo/b")).toBe("/abs/path/b");
		}
	});

	it("rejects empty file", () => {
		const r = parseLocal("", FILE);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors[0]!.message).toMatch(/file is empty/);
	});

	it("rejects non-map top level", () => {
		const r = parseLocal(`"hi"\n`, FILE);
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(r.errors[0]!.message).toMatch(/single map literal at top level/);
	});

	it("rejects unknown top-level field", () => {
		const r = parseLocal(`{"linkz": {}}\n`, FILE);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors[0]!.message).toMatch(/unknown field "linkz"/);
	});

	it("rejects links not being a map", () => {
		const r = parseLocal(`{"links": "no"}\n`, FILE);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors[0]!.message).toMatch(/"links" must be a map/);
	});

	it("rejects link key that is not a valid url", () => {
		const r = parseLocal(`{"links": {"not-a-url": "../x"}}\n`, FILE);
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(r.errors[0]!.message).toMatch(/link key "not-a-url"/);
	});

	it("rejects link value that is not a string", () => {
		const r = parseLocal(
			`{"links": {"github.com/foo/x": 123}}\n`,
			FILE,
		);
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(r.errors[0]!.message).toMatch(/must be a string/);
	});

	it("rejects empty link path", () => {
		const r = parseLocal(
			`{"links": {"github.com/foo/x": ""}}\n`,
			FILE,
		);
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(r.errors[0]!.message).toMatch(/must not be empty/);
	});

	it("rejects extra top-level items", () => {
		const r = parseLocal(`{}\n{}\n`, FILE);
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(r.errors[0]!.message).toMatch(/found additional items/);
	});
});
