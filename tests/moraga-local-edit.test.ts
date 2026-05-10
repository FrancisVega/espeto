import { describe, expect, it } from "vitest";
import {
	addLinkToLocal,
	emptyLocalManifest,
	LocalEditError,
	removeLinkFromLocal,
} from "../src/moraga/local-edit";
import { parseLocal } from "../src/moraga/local";

const FILE = "moraga.local.esp";

describe("addLinkToLocal", () => {
	it("creates the manifest from empty source", () => {
		const r = addLinkToLocal("", "github.com/foo/x", "../x");
		expect(r.changed).toBe(true);
		const p = parseLocal(r.source, FILE);
		expect(p.ok).toBe(true);
		if (p.ok) expect(p.local.links.get("github.com/foo/x")).toBe("../x");
	});

	it("adds first entry to {}", () => {
		const r = addLinkToLocal("{}\n", "github.com/foo/x", "../x");
		expect(r.changed).toBe(true);
		const p = parseLocal(r.source, FILE);
		expect(p.ok).toBe(true);
		if (p.ok) expect(p.local.links.get("github.com/foo/x")).toBe("../x");
	});

	it("adds first entry when links is empty map", () => {
		const r = addLinkToLocal(
			`{"links": {}}\n`,
			"github.com/foo/x",
			"../x",
		);
		expect(r.changed).toBe(true);
		const p = parseLocal(r.source, FILE);
		expect(p.ok).toBe(true);
		if (p.ok) expect(p.local.links.get("github.com/foo/x")).toBe("../x");
	});

	it("appends to existing multiline links map", () => {
		const src = `{
  "links": {
    "github.com/foo/a": "../a"
  }
}
`;
		const r = addLinkToLocal(src, "github.com/foo/b", "../b");
		expect(r.changed).toBe(true);
		const p = parseLocal(r.source, FILE);
		expect(p.ok).toBe(true);
		if (p.ok) {
			expect(p.local.links.size).toBe(2);
			expect(p.local.links.get("github.com/foo/a")).toBe("../a");
			expect(p.local.links.get("github.com/foo/b")).toBe("../b");
		}
	});

	it("converts inline-with-entries map to multiline when adding", () => {
		const src = `{"links": {"github.com/foo/a": "../a"}}\n`;
		const r = addLinkToLocal(src, "github.com/foo/b", "../b");
		expect(r.changed).toBe(true);
		expect(r.source).toContain("\n");
		const p = parseLocal(r.source, FILE);
		expect(p.ok).toBe(true);
		if (p.ok) expect(p.local.links.size).toBe(2);
	});

	it("is a no-op when same url is linked to same path", () => {
		const src = `{
  "links": {
    "github.com/foo/a": "../a"
  }
}
`;
		const r = addLinkToLocal(src, "github.com/foo/a", "../a");
		expect(r.changed).toBe(false);
		expect(r.source).toBe(src);
	});

	it("errors when same url is linked to a different path", () => {
		const src = `{
  "links": {
    "github.com/foo/a": "../a"
  }
}
`;
		expect(() =>
			addLinkToLocal(src, "github.com/foo/a", "../different"),
		).toThrow(LocalEditError);
	});

	it("preserves existing links when adding to multiline", () => {
		const src = `{
  "links": {
    "github.com/foo/a": "../a",
    "github.com/foo/b": "../b"
  }
}
`;
		const r = addLinkToLocal(src, "github.com/foo/c", "../c");
		expect(r.changed).toBe(true);
		const p = parseLocal(r.source, FILE);
		expect(p.ok).toBe(true);
		if (p.ok) {
			expect(p.local.links.size).toBe(3);
			expect(p.local.links.get("github.com/foo/a")).toBe("../a");
			expect(p.local.links.get("github.com/foo/b")).toBe("../b");
			expect(p.local.links.get("github.com/foo/c")).toBe("../c");
		}
	});

	it("emptyLocalManifest returns parseable {} with empty links", () => {
		const src = emptyLocalManifest();
		const p = parseLocal(src, FILE);
		expect(p.ok).toBe(true);
		if (p.ok) expect(p.local.links.size).toBe(0);
	});
});

describe("removeLinkFromLocal", () => {
	it("returns no-op when source is empty", () => {
		const r = removeLinkFromLocal("", "github.com/foo/x");
		expect(r.changed).toBe(false);
		expect(r.wasPresent).toBe(false);
	});

	it("returns no-op when url is not linked", () => {
		const src = `{
  "links": {
    "github.com/foo/a": "../a"
  }
}
`;
		const r = removeLinkFromLocal(src, "github.com/foo/missing");
		expect(r.changed).toBe(false);
		expect(r.wasPresent).toBe(false);
		expect(r.source).toBe(src);
	});

	it("collapses links to {} when removing last entry", () => {
		const src = `{
  "links": {
    "github.com/foo/a": "../a"
  }
}
`;
		const r = removeLinkFromLocal(src, "github.com/foo/a");
		expect(r.changed).toBe(true);
		expect(r.wasPresent).toBe(true);
		const p = parseLocal(r.source, FILE);
		expect(p.ok).toBe(true);
		if (p.ok) expect(p.local.links.size).toBe(0);
		expect(r.source).toContain('"links": {}');
	});

	it("removes middle entry from multiline", () => {
		const src = `{
  "links": {
    "github.com/foo/a": "../a",
    "github.com/foo/b": "../b",
    "github.com/foo/c": "../c"
  }
}
`;
		const r = removeLinkFromLocal(src, "github.com/foo/b");
		expect(r.changed).toBe(true);
		const p = parseLocal(r.source, FILE);
		expect(p.ok).toBe(true);
		if (p.ok) {
			expect(p.local.links.size).toBe(2);
			expect(p.local.links.has("github.com/foo/a")).toBe(true);
			expect(p.local.links.has("github.com/foo/b")).toBe(false);
			expect(p.local.links.has("github.com/foo/c")).toBe(true);
		}
	});

	it("removes last entry from multiline and preserves others", () => {
		const src = `{
  "links": {
    "github.com/foo/a": "../a",
    "github.com/foo/b": "../b"
  }
}
`;
		const r = removeLinkFromLocal(src, "github.com/foo/b");
		expect(r.changed).toBe(true);
		const p = parseLocal(r.source, FILE);
		expect(p.ok).toBe(true);
		if (p.ok) {
			expect(p.local.links.size).toBe(1);
			expect(p.local.links.has("github.com/foo/a")).toBe(true);
		}
	});

	it("removes first entry from multiline", () => {
		const src = `{
  "links": {
    "github.com/foo/a": "../a",
    "github.com/foo/b": "../b"
  }
}
`;
		const r = removeLinkFromLocal(src, "github.com/foo/a");
		expect(r.changed).toBe(true);
		const p = parseLocal(r.source, FILE);
		expect(p.ok).toBe(true);
		if (p.ok) {
			expect(p.local.links.size).toBe(1);
			expect(p.local.links.has("github.com/foo/b")).toBe(true);
		}
	});

	it("removes entry from inline-with-entries map", () => {
		const src = `{"links": {"github.com/foo/a": "../a", "github.com/foo/b": "../b"}}\n`;
		const r = removeLinkFromLocal(src, "github.com/foo/a");
		expect(r.changed).toBe(true);
		const p = parseLocal(r.source, FILE);
		expect(p.ok).toBe(true);
		if (p.ok) {
			expect(p.local.links.size).toBe(1);
			expect(p.local.links.has("github.com/foo/b")).toBe(true);
		}
	});
});

describe("addLinkToLocal — round-trip", () => {
	it("adds → removes returns valid manifest", () => {
		let src = "";
		const r1 = addLinkToLocal(src, "github.com/foo/a", "../a");
		src = r1.source;
		const r2 = addLinkToLocal(src, "github.com/foo/b", "../b");
		src = r2.source;
		const r3 = removeLinkFromLocal(src, "github.com/foo/a");
		src = r3.source;
		const p = parseLocal(src, FILE);
		expect(p.ok).toBe(true);
		if (p.ok) {
			expect(p.local.links.size).toBe(1);
			expect(p.local.links.get("github.com/foo/b")).toBe("../b");
		}
	});
});
