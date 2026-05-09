import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseManifest } from "../src/moraga";

const FILE = "moraga.esp";

function ok(source: string) {
	const r = parseManifest(source, FILE);
	if (!r.ok) {
		throw new Error(
			`expected ok, got errors:\n${r.errors.map((e) => e.message).join("\n")}`,
		);
	}
	return r.manifest;
}

function fail(source: string) {
	const r = parseManifest(source, FILE);
	if (r.ok) throw new Error("expected failure, got ok");
	return r.errors;
}

const MIN = `{
  "name": "x",
  "version": "0.1.0",
  "espeto": ">= 0.1.0",
  "deps": {},
  "dev_deps": {}
}`;

describe("parseManifest — happy paths", () => {
	it("parses the real ansi/moraga.esp", () => {
		const source = readFileSync("packages/ansi/moraga.esp", "utf8");
		const m = ok(source);
		expect(m.name).toBe("ansi");
		expect(m.version).toBe("0.1.0");
		expect(m.espeto).toBe(">= 0.1.0");
		expect(m.deps.size).toBe(0);
		expect(m.devDeps.size).toBe(0);
		expect(m.overrides.size).toBe(0);
	});

	it("parses the minimal manifest", () => {
		const m = ok(MIN);
		expect(m.name).toBe("x");
	});

	it("captures spans for top-level fields", () => {
		const m = ok(MIN);
		expect(m.nameSpan.line).toBe(2);
		expect(m.versionSpan.line).toBe(3);
		expect(m.espetoSpan.line).toBe(4);
	});

	it("accepts compound espeto constraint with comma", () => {
		const src = MIN.replace('"espeto": ">= 0.1.0"', '"espeto": ">= 0.1.0, < 0.2.0"');
		const m = ok(src);
		expect(m.espeto).toBe(">= 0.1.0, < 0.2.0");
	});

	it("accepts compact dep entries", () => {
		const src = MIN.replace(
			'"deps": {}',
			'"deps": { "github.com/foo/json": "1.2.3" }',
		);
		const m = ok(src);
		const dep = m.deps.get("github.com/foo/json");
		expect(dep?.version).toBe("1.2.3");
		expect(dep?.alias).toBeUndefined();
	});

	it("accepts extended dep entries with alias", () => {
		const src = MIN.replace(
			'"deps": {}',
			'"deps": { "github.com/bar/json": {"version": "1.0.0", "as": "bar_json"} }',
		);
		const m = ok(src);
		const dep = m.deps.get("github.com/bar/json");
		expect(dep?.version).toBe("1.0.0");
		expect(dep?.alias).toBe("bar_json");
	});

	it("accepts overrides", () => {
		const src = MIN.replace(
			'"dev_deps": {}',
			'"dev_deps": {},\n  "overrides": { "github.com/foo/bar": "1.1.0" }',
		);
		const m = ok(src);
		expect(m.overrides.get("github.com/foo/bar")?.version).toBe("1.1.0");
	});

	it("accepts semver with prerelease and build metadata", () => {
		const src = MIN.replace('"version": "0.1.0"', '"version": "1.0.0-beta.1+build.42"');
		const m = ok(src);
		expect(m.version).toBe("1.0.0-beta.1+build.42");
	});
});

describe("parseManifest — structural errors", () => {
	it("rejects empty file", () => {
		const errors = fail("");
		expect(errors[0].message).toMatch(/file is empty/);
	});

	it("rejects non-map top level", () => {
		const errors = fail("def foo() do 1 end");
		expect(errors[0].message).toMatch(/single map literal/);
	});

	it("rejects multiple top-level items", () => {
		const errors = fail(`${MIN}\n{}`);
		expect(errors.some((e) => /additional items/.test(e.message))).toBe(true);
	});

	it("propagates parser syntax errors", () => {
		const errors = fail("{ name: ");
		expect(errors).toHaveLength(1);
		expect(errors[0].span.line).toBeGreaterThan(0);
	});
});

describe("parseManifest — required fields", () => {
	it("consolidates missing required fields into one error", () => {
		const errors = fail("{}");
		expect(errors).toHaveLength(1);
		const msg = errors[0].message;
		expect(msg).toMatch(/missing required fields/);
		expect(msg).toMatch(/"name"/);
		expect(msg).toMatch(/"version"/);
		expect(msg).toMatch(/"espeto"/);
		expect(msg).toMatch(/"deps"/);
		expect(msg).toMatch(/"dev_deps"/);
	});

	it("uses singular 'field' when only one is missing", () => {
		const src = `{
  "name": "x",
  "version": "0.1.0",
  "espeto": ">= 0.1.0",
  "deps": {}
}`;
		const errors = fail(src);
		expect(errors[0].message).toMatch(/missing required field: "dev_deps"/);
	});

	it("rejects unknown top-level fields", () => {
		const src = MIN.replace(
			'"dev_deps": {}',
			'"dev_deps": {},\n  "extra": "nope"',
		);
		const errors = fail(src);
		expect(errors.some((e) => /unknown field "extra"/.test(e.message))).toBe(true);
	});
});

describe("parseManifest — value validation", () => {
	it("rejects wrong type for name", () => {
		const src = MIN.replace('"name": "x"', '"name": 123');
		const errors = fail(src);
		expect(errors.some((e) => /"name".*must be a string/.test(e.message))).toBe(true);
	});

	it("rejects bad name pattern (uppercase)", () => {
		const src = MIN.replace('"name": "x"', '"name": "Bad"');
		const errors = fail(src);
		expect(errors.some((e) => /"name".*\[a-z\]/.test(e.message))).toBe(true);
	});

	it("rejects bad name pattern (hyphen)", () => {
		const src = MIN.replace('"name": "x"', '"name": "bad-name"');
		const errors = fail(src);
		expect(errors.some((e) => /"name"/.test(e.message))).toBe(true);
	});

	it("rejects non-semver version", () => {
		const src = MIN.replace('"version": "0.1.0"', '"version": "1.0"');
		const errors = fail(src);
		expect(errors.some((e) => /"version".*semver/.test(e.message))).toBe(true);
	});

	it("rejects string interpolation in fields", () => {
		const src = MIN.replace('"name": "x"', '"name": "x#{1}"');
		const errors = fail(src);
		expect(errors.some((e) => /interpolation/.test(e.message))).toBe(true);
	});
});

describe("parseManifest — espeto constraint", () => {
	it("rejects ^ operator", () => {
		const src = MIN.replace('"espeto": ">= 0.1.0"', '"espeto": "^0.1.0"');
		const errors = fail(src);
		expect(errors.some((e) => /"espeto".*">=" or "<"/.test(e.message))).toBe(true);
	});

	it("rejects ~ operator", () => {
		const src = MIN.replace('"espeto": ">= 0.1.0"', '"espeto": "~ 0.1.0"');
		const errors = fail(src);
		expect(errors.some((e) => /"espeto"/.test(e.message))).toBe(true);
	});

	it("rejects bare semver without operator", () => {
		const src = MIN.replace('"espeto": ">= 0.1.0"', '"espeto": "0.1.0"');
		const errors = fail(src);
		expect(errors.some((e) => /"espeto"/.test(e.message))).toBe(true);
	});

	it("rejects empty constraint", () => {
		const src = MIN.replace('"espeto": ">= 0.1.0"', '"espeto": ""');
		const errors = fail(src);
		expect(errors.some((e) => /"espeto".*empty/.test(e.message))).toBe(true);
	});

	it("rejects partial semver inside constraint", () => {
		const src = MIN.replace('"espeto": ">= 0.1.0"', '"espeto": ">= 0.1"');
		const errors = fail(src);
		expect(errors.some((e) => /"espeto".*semver/.test(e.message))).toBe(true);
	});
});

describe("parseManifest — deps validation", () => {
	it("rejects bad dep URL", () => {
		const src = MIN.replace(
			'"deps": {}',
			'"deps": { "not-a-url": "1.0.0" }',
		);
		const errors = fail(src);
		expect(errors.some((e) => /"not-a-url".*<host>/.test(e.message))).toBe(true);
	});

	it("rejects URL with only host and one segment", () => {
		const src = MIN.replace(
			'"deps": {}',
			'"deps": { "github.com/foo": "1.0.0" }',
		);
		const errors = fail(src);
		expect(errors.some((e) => /"github\.com\/foo".*<host>/.test(e.message))).toBe(true);
	});

	it("accepts GitLab nested group URLs", () => {
		const src = MIN.replace(
			'"deps": {}',
			'"deps": { "gitlab.com/group/subgroup/repo": "1.0.0" }',
		);
		const m = ok(src);
		expect(m.deps.get("gitlab.com/group/subgroup/repo")?.version).toBe("1.0.0");
	});

	it("rejects non-exact dep version", () => {
		const src = MIN.replace(
			'"deps": {}',
			'"deps": { "github.com/foo/bar": "^1.0.0" }',
		);
		const errors = fail(src);
		expect(errors.some((e) => /exact semver/.test(e.message))).toBe(true);
	});

	it("rejects extended dep without version", () => {
		const src = MIN.replace(
			'"deps": {}',
			'"deps": { "github.com/foo/bar": {"as": "alias"} }',
		);
		const errors = fail(src);
		expect(errors.some((e) => /must have a "version" field/.test(e.message))).toBe(true);
	});

	it("rejects extended dep with bad alias", () => {
		const src = MIN.replace(
			'"deps": {}',
			'"deps": { "github.com/foo/bar": {"version": "1.0.0", "as": "Bad-Alias"} }',
		);
		const errors = fail(src);
		expect(errors.some((e) => /"as".*\[a-z\]/.test(e.message))).toBe(true);
	});

	it("rejects extended dep with unknown field", () => {
		const src = MIN.replace(
			'"deps": {}',
			'"deps": { "github.com/foo/bar": {"version": "1.0.0", "weird": true} }',
		);
		const errors = fail(src);
		expect(errors.some((e) => /unknown field "weird"/.test(e.message))).toBe(true);
	});

	it("rejects non-string non-map dep value", () => {
		const src = MIN.replace(
			'"deps": {}',
			'"deps": { "github.com/foo/bar": [1, 2] }',
		);
		const errors = fail(src);
		expect(errors.some((e) => /compact.*extended/.test(e.message))).toBe(true);
	});

	it("validates dev_deps the same way", () => {
		const src = MIN.replace(
			'"dev_deps": {}',
			'"dev_deps": { "bad-url": "1.0.0" }',
		);
		const errors = fail(src);
		expect(errors.some((e) => /<host>/.test(e.message))).toBe(true);
	});
});

describe("parseManifest — error collection", () => {
	it("collects multiple errors in one pass", () => {
		const src = `{
  "name": "Bad-Name",
  "version": "1.0",
  "espeto": "^0.1.0",
  "deps": { "not-a-url": "^1.0" },
  "dev_deps": {}
}`;
		const errors = fail(src);
		expect(errors.length).toBeGreaterThanOrEqual(4);
	});
});
