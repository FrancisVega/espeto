import { describe, expect, it } from "vitest";
import { addDepToManifest, EditError } from "../src/moraga/edit";
import { parseManifest } from "../src/moraga/manifest";

const baseEmpty = `{
  "name": "myapp",
  "version": "0.1.0",
  "espeto": ">= 0.1.0",
  "deps": {},
  "dev_deps": {}
}
`;

function withDeps(body: string): string {
	return `{
  "name": "myapp",
  "version": "0.1.0",
  "espeto": ">= 0.1.0",
  "deps": ${body},
  "dev_deps": {}
}
`;
}

function withDevDeps(body: string): string {
	return `{
  "name": "myapp",
  "version": "0.1.0",
  "espeto": ">= 0.1.0",
  "deps": {},
  "dev_deps": ${body}
}
`;
}

function parseAndUnwrap(source: string) {
	const r = parseManifest(source, "<test>");
	if (!r.ok) {
		throw new Error(
			`unexpected parse failure:\n${r.errors.map((e) => e.message).join("\n")}`,
		);
	}
	return r.manifest;
}

describe("addDepToManifest — heuristic by input shape", () => {
	it("expands empty inline deps `{}` to multiline with new entry", () => {
		const r = addDepToManifest(baseEmpty, "github.com/foo/bar", "1.0.0");
		expect(r.changed).toBe(true);
		expect(r.source).toContain(`"deps": {\n    "github.com/foo/bar": "1.0.0"\n  }`);
		const m = parseAndUnwrap(r.source);
		expect(m.deps.get("github.com/foo/bar")?.version).toBe("1.0.0");
	});

	it("expands inline-with-entries to multiline", () => {
		const src = withDeps(`{ "github.com/a/x": "1.0.0" }`);
		const r = addDepToManifest(src, "github.com/b/y", "2.0.0");
		expect(r.changed).toBe(true);
		const m = parseAndUnwrap(r.source);
		expect(m.deps.get("github.com/a/x")?.version).toBe("1.0.0");
		expect(m.deps.get("github.com/b/y")?.version).toBe("2.0.0");
		expect(r.source).toContain(`"github.com/a/x": "1.0.0",\n    "github.com/b/y": "2.0.0"`);
	});

	it("inserts into multiline deps without trailing comma (adds comma)", () => {
		const src = withDeps(`{
    "github.com/a/x": "1.0.0"
  }`);
		const r = addDepToManifest(src, "github.com/b/y", "2.0.0");
		expect(r.changed).toBe(true);
		const m = parseAndUnwrap(r.source);
		expect(m.deps.size).toBe(2);
		expect(m.deps.get("github.com/b/y")?.version).toBe("2.0.0");
		expect(r.source).toContain(`"github.com/a/x": "1.0.0",\n    "github.com/b/y": "2.0.0"`);
	});

	it("inserts into multiline deps with trailing comma (no extra comma)", () => {
		const src = withDeps(`{
    "github.com/a/x": "1.0.0",
  }`);
		const r = addDepToManifest(src, "github.com/b/y", "2.0.0");
		expect(r.changed).toBe(true);
		const m = parseAndUnwrap(r.source);
		expect(m.deps.size).toBe(2);
		expect(r.source).not.toMatch(/,,/);
	});

	it("handles extended-dep nested map without breaking brace-match", () => {
		const src = withDeps(`{
    "github.com/a/x": {
      "version": "1.0.0",
      "as": "x_alias"
    }
  }`);
		const r = addDepToManifest(src, "github.com/b/y", "2.0.0");
		expect(r.changed).toBe(true);
		const m = parseAndUnwrap(r.source);
		expect(m.deps.size).toBe(2);
		expect(m.deps.get("github.com/a/x")?.alias).toBe("x_alias");
		expect(m.deps.get("github.com/b/y")?.version).toBe("2.0.0");
	});
});

describe("addDepToManifest — compact vs extended", () => {
	it("emits compact form by default", () => {
		const r = addDepToManifest(baseEmpty, "github.com/foo/bar", "1.0.0");
		expect(r.source).toContain(`"github.com/foo/bar": "1.0.0"`);
		const m = parseAndUnwrap(r.source);
		expect(m.deps.get("github.com/foo/bar")?.alias).toBeUndefined();
	});

	it("emits extended form when alias is set", () => {
		const r = addDepToManifest(baseEmpty, "github.com/foo/bar", "1.0.0", {
			alias: "bar_alias",
		});
		expect(r.source).toContain(`"github.com/foo/bar": {`);
		expect(r.source).toContain(`"version": "1.0.0"`);
		expect(r.source).toContain(`"as": "bar_alias"`);
		const m = parseAndUnwrap(r.source);
		expect(m.deps.get("github.com/foo/bar")?.alias).toBe("bar_alias");
	});
});

describe("addDepToManifest — idempotence and conflicts", () => {
	it("returns changed:false when same url+version+no-alias already present", () => {
		const src = withDeps(`{\n    "github.com/foo/bar": "1.0.0"\n  }`);
		const r = addDepToManifest(src, "github.com/foo/bar", "1.0.0");
		expect(r.changed).toBe(false);
		expect(r.source).toBe(src);
	});

	it("returns changed:false when same url+version+same-alias already present", () => {
		const src = withDeps(
			`{\n    "github.com/foo/bar": {\n      "version": "1.0.0",\n      "as": "bar2"\n    }\n  }`,
		);
		const r = addDepToManifest(src, "github.com/foo/bar", "1.0.0", {
			alias: "bar2",
		});
		expect(r.changed).toBe(false);
	});

	it("errors when url already present at different version", () => {
		const src = withDeps(`{\n    "github.com/foo/bar": "1.0.0"\n  }`);
		expect(() =>
			addDepToManifest(src, "github.com/foo/bar", "2.0.0"),
		).toThrowError(EditError);
		expect(() =>
			addDepToManifest(src, "github.com/foo/bar", "2.0.0"),
		).toThrowError(/already in "deps" at 1\.0\.0/);
	});

	it("errors when url already present with different alias", () => {
		const src = withDeps(
			`{\n    "github.com/foo/bar": {\n      "version": "1.0.0",\n      "as": "old"\n    }\n  }`,
		);
		expect(() =>
			addDepToManifest(src, "github.com/foo/bar", "1.0.0", { alias: "new" }),
		).toThrowError(/alias "old"/);
	});

	it("errors when url is in dev_deps and trying to add to deps", () => {
		const src = withDevDeps(`{\n    "github.com/foo/bar": "1.0.0"\n  }`);
		expect(() =>
			addDepToManifest(src, "github.com/foo/bar", "1.0.0"),
		).toThrowError(/already in "dev_deps"/);
	});

	it("errors when url is in deps and trying to add with --dev", () => {
		const src = withDeps(`{\n    "github.com/foo/bar": "1.0.0"\n  }`);
		expect(() =>
			addDepToManifest(src, "github.com/foo/bar", "1.0.0", { dev: true }),
		).toThrowError(/already in "deps"/);
	});
});

describe("addDepToManifest — dev_deps target", () => {
	it("inserts into empty dev_deps with --dev", () => {
		const r = addDepToManifest(baseEmpty, "github.com/foo/test", "1.0.0", {
			dev: true,
		});
		expect(r.changed).toBe(true);
		const m = parseAndUnwrap(r.source);
		expect(m.devDeps.get("github.com/foo/test")?.version).toBe("1.0.0");
		expect(m.deps.has("github.com/foo/test")).toBe(false);
	});

	it("does not touch deps when adding to dev_deps", () => {
		const src = withDeps(`{\n    "github.com/a/x": "1.0.0"\n  }`);
		const r = addDepToManifest(src, "github.com/b/y", "2.0.0", { dev: true });
		const m = parseAndUnwrap(r.source);
		expect(m.deps.size).toBe(1);
		expect(m.devDeps.size).toBe(1);
	});
});

describe("addDepToManifest — round-trip and validity", () => {
	it("rejects invalid manifest with EditError", () => {
		expect(() =>
			addDepToManifest("not a map", "github.com/foo/bar", "1.0.0"),
		).toThrowError(EditError);
	});

	it("preserves other top-level fields", () => {
		const r = addDepToManifest(baseEmpty, "github.com/foo/bar", "1.0.0");
		const m = parseAndUnwrap(r.source);
		expect(m.name).toBe("myapp");
		expect(m.version).toBe("0.1.0");
		expect(m.espeto).toBe(">= 0.1.0");
	});

	it("preserves overrides field if present", () => {
		const src = `{
  "name": "myapp",
  "version": "0.1.0",
  "espeto": ">= 0.1.0",
  "deps": {},
  "dev_deps": {},
  "overrides": {
    "github.com/x/y": "1.2.3"
  }
}
`;
		const r = addDepToManifest(src, "github.com/foo/bar", "1.0.0");
		const m = parseAndUnwrap(r.source);
		expect(m.overrides.get("github.com/x/y")?.version).toBe("1.2.3");
	});
});
