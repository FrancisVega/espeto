import { describe, expect, it } from "vitest";
import {
	type Lock,
	type LockEntry,
	parseLock,
	serializeLock,
} from "../src/moraga/lock";

const FILE = "moraga.lock";

const SHA = "a".repeat(40);
const SHB = "b".repeat(40);
const CHK_A = `h1:${"c".repeat(64)}`;
const CHK_B = `h1:${"d".repeat(64)}`;

function ok(source: string): Lock {
	const r = parseLock(source, FILE);
	if (!r.ok) {
		throw new Error(
			`expected ok, got errors:\n${r.errors.map((e) => e.message).join("\n")}`,
		);
	}
	return r.lock;
}

function fail(source: string): string[] {
	const r = parseLock(source, FILE);
	if (r.ok) throw new Error("expected failure, got ok");
	return r.errors.map((e) => e.message);
}

function lockEntry(partial: Partial<LockEntry> & { url: string }): LockEntry {
	return {
		url: partial.url,
		urlSpan: { file: FILE, line: 1, col: 1, length: 1 },
		version: partial.version ?? "1.0.0",
		sha: partial.sha ?? SHA,
		checksum: partial.checksum ?? CHK_A,
		deps: partial.deps ?? [],
	};
}

describe("parseLock — happy paths", () => {
	it("parses an empty map", () => {
		const lock = ok("{}");
		expect(lock.size).toBe(0);
	});

	it("parses a single entry", () => {
		const src = `{
  "github.com/foo/ansi": {
    "version": "1.0.0",
    "sha": "${SHA}",
    "checksum": "${CHK_A}",
    "deps": []
  }
}`;
		const lock = ok(src);
		expect(lock.size).toBe(1);
		const e = lock.get("github.com/foo/ansi")!;
		expect(e.version).toBe("1.0.0");
		expect(e.sha).toBe(SHA);
		expect(e.checksum).toBe(CHK_A);
		expect(e.deps).toEqual([]);
	});

	it("parses entries with deps[] referencing other urls", () => {
		const src = `{
  "github.com/foo/ansi": {
    "version": "1.0.0",
    "sha": "${SHA}",
    "checksum": "${CHK_A}",
    "deps": ["github.com/foo/json"]
  },
  "github.com/foo/json": {
    "version": "2.0.0",
    "sha": "${SHB}",
    "checksum": "${CHK_B}",
    "deps": []
  }
}`;
		const lock = ok(src);
		expect(lock.size).toBe(2);
		expect(lock.get("github.com/foo/ansi")!.deps).toEqual([
			"github.com/foo/json",
		]);
	});
});

describe("parseLock — errors", () => {
	it("rejects non-map top-level", () => {
		const errs = fail(`"hello"`);
		expect(errs[0]).toMatch(/single map literal/);
	});

	it("rejects bad url keys", () => {
		const errs = fail(`{
  "not-a-url": {
    "version": "1.0.0",
    "sha": "${SHA}",
    "checksum": "${CHK_A}",
    "deps": []
  }
}`);
		expect(errs[0]).toMatch(/lock key "not-a-url"/);
	});

	it("rejects entries missing required fields", () => {
		const errs = fail(`{
  "github.com/foo/ansi": {
    "version": "1.0.0"
  }
}`);
		expect(errs[0]).toMatch(/missing required fields/);
	});

	it("rejects bad sha", () => {
		const errs = fail(`{
  "github.com/foo/ansi": {
    "version": "1.0.0",
    "sha": "deadbeef",
    "checksum": "${CHK_A}",
    "deps": []
  }
}`);
		expect(errs[0]).toMatch(/40 hex chars/);
	});

	it("rejects bad checksum", () => {
		const errs = fail(`{
  "github.com/foo/ansi": {
    "version": "1.0.0",
    "sha": "${SHA}",
    "checksum": "sha256-bad",
    "deps": []
  }
}`);
		expect(errs[0]).toMatch(/h1:<64-hex>/);
	});

	it("rejects deps[] non-list", () => {
		const errs = fail(`{
  "github.com/foo/ansi": {
    "version": "1.0.0",
    "sha": "${SHA}",
    "checksum": "${CHK_A}",
    "deps": "github.com/foo/json"
  }
}`);
		expect(errs[0]).toMatch(/\.deps must be a list/);
	});

	it("rejects deps[] entries that aren't valid urls", () => {
		const errs = fail(`{
  "github.com/foo/ansi": {
    "version": "1.0.0",
    "sha": "${SHA}",
    "checksum": "${CHK_A}",
    "deps": ["bad"]
  }
}`);
		expect(errs[0]).toMatch(/must be a package url/);
	});

	it("rejects unknown fields", () => {
		const errs = fail(`{
  "github.com/foo/ansi": {
    "version": "1.0.0",
    "sha": "${SHA}",
    "checksum": "${CHK_A}",
    "deps": [],
    "weird": "x"
  }
}`);
		expect(errs[0]).toMatch(/unknown field "weird"/);
	});
});

describe("serializeLock", () => {
	it("serializes an empty lock", () => {
		expect(serializeLock(new Map())).toBe("{}\n");
	});

	it("serializes entries alphabetically by url", () => {
		const lock: Lock = new Map();
		lock.set("github.com/foo/zebra", lockEntry({ url: "github.com/foo/zebra" }));
		lock.set("github.com/foo/ansi", lockEntry({ url: "github.com/foo/ansi" }));
		const out = serializeLock(lock);
		const ansiIdx = out.indexOf('"github.com/foo/ansi"');
		const zebraIdx = out.indexOf('"github.com/foo/zebra"');
		expect(ansiIdx).toBeGreaterThan(0);
		expect(zebraIdx).toBeGreaterThan(ansiIdx);
	});

	it("serializes deps[] alphabetically", () => {
		const lock: Lock = new Map();
		lock.set(
			"github.com/foo/ansi",
			lockEntry({
				url: "github.com/foo/ansi",
				deps: ["github.com/foo/zebra", "github.com/foo/json"],
			}),
		);
		const out = serializeLock(lock);
		const jsonIdx = out.indexOf('"github.com/foo/json"');
		const zebraIdx = out.indexOf('"github.com/foo/zebra"');
		expect(jsonIdx).toBeGreaterThan(0);
		expect(zebraIdx).toBeGreaterThan(jsonIdx);
	});

	it("round-trips parse → serialize → parse", () => {
		const original: Lock = new Map();
		original.set(
			"github.com/foo/ansi",
			lockEntry({
				url: "github.com/foo/ansi",
				version: "1.0.0",
				sha: SHA,
				checksum: CHK_A,
				deps: ["github.com/foo/json"],
			}),
		);
		original.set(
			"github.com/foo/json",
			lockEntry({
				url: "github.com/foo/json",
				version: "2.0.0",
				sha: SHB,
				checksum: CHK_B,
				deps: [],
			}),
		);
		const serialized = serializeLock(original);
		const parsed = ok(serialized);
		expect(parsed.size).toBe(2);
		expect(parsed.get("github.com/foo/ansi")!.version).toBe("1.0.0");
		expect(parsed.get("github.com/foo/json")!.deps).toEqual([]);
		expect(parsed.get("github.com/foo/ansi")!.deps).toEqual([
			"github.com/foo/json",
		]);
	});

	it("produces deterministic output", () => {
		const lock: Lock = new Map();
		lock.set(
			"github.com/foo/ansi",
			lockEntry({
				url: "github.com/foo/ansi",
				deps: ["github.com/foo/json"],
			}),
		);
		lock.set("github.com/foo/json", lockEntry({ url: "github.com/foo/json" }));
		const a = serializeLock(lock);
		const b = serializeLock(lock);
		expect(a).toBe(b);
	});
});
