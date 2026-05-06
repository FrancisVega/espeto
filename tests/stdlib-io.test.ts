import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/run";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "espeto-io-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("stdlib/io: read", () => {
	it("returns file contents as str", () => {
		const path = join(dir, "hi.txt");
		writeFileSync(path, "hola sardinas");
		expect(run(`read("${path}")`, "x.esp")).toBe("hola sardinas");
	});

	it("preserves multiline content", () => {
		const path = join(dir, "multi.txt");
		writeFileSync(path, "a\nb\nc\n");
		expect(run(`read("${path}")`, "x.esp")).toBe("a\nb\nc\n");
	});

	it("raises on missing file", () => {
		const path = join(dir, "nope.txt");
		expect(() => run(`read("${path}")`, "x.esp")).toThrow(
			/read: file not found:/,
		);
	});

	it("raises on directory path", () => {
		expect(() => run(`read("${dir}")`, "x.esp")).toThrow(
			/read: is a directory:/,
		);
	});

	it("rejects non-str path", () => {
		expect(() => run(`read(1)`, "x.esp")).toThrow(
			/read: path must be str, got int/,
		);
	});
});

describe("stdlib/io: try_read", () => {
	it("returns ok=true with value on success", () => {
		const path = join(dir, "hi.txt");
		writeFileSync(path, "ok");
		expect(run(`try_read("${path}")`, "x.esp")).toEqual({
			kind: "map",
			entries: { ok: true, value: "ok" },
		});
	});

	it("returns ok=false with error on failure", () => {
		const path = join(dir, "missing.txt");
		const result = run(`try_read("${path}")`, "x.esp") as {
			kind: "map";
			entries: { ok: boolean; error: string };
		};
		expect(result.kind).toBe("map");
		expect(result.entries.ok).toBe(false);
		expect(result.entries.error).toMatch(/read: file not found/);
	});

	it("composes with try/rescue idiom via map access", () => {
		const path = join(dir, "missing.txt");
		const code = `
			r = try_read("${path}")
			if r.ok do r.value else "fallback" end
		`;
		expect(run(code, "x.esp")).toBe("fallback");
	});
});

describe("stdlib/io: write", () => {
	it("writes content to a file and returns nil", () => {
		const path = join(dir, "out.txt");
		expect(run(`write("${path}", "hola")`, "x.esp")).toBe(null);
		expect(readFileSync(path, "utf-8")).toBe("hola");
	});

	it("overwrites existing file", () => {
		const path = join(dir, "out.txt");
		writeFileSync(path, "old");
		run(`write("${path}", "new")`, "x.esp");
		expect(readFileSync(path, "utf-8")).toBe("new");
	});

	it("preserves multiline content", () => {
		const path = join(dir, "multi.txt");
		run(`write("${path}", "a\nb\nc")`, "x.esp");
		expect(readFileSync(path, "utf-8")).toBe("a\nb\nc");
	});

	it("raises when parent dir missing", () => {
		const path = join(dir, "nope", "x.txt");
		expect(() => run(`write("${path}", "x")`, "x.esp")).toThrow(
			/write: parent directory not found:/,
		);
	});

	it("raises on directory path", () => {
		expect(() => run(`write("${dir}", "x")`, "x.esp")).toThrow(
			/write: is a directory:/,
		);
	});

	it("rejects non-str args", () => {
		expect(() => run(`write(1, "x")`, "x.esp")).toThrow(
			/write: path must be str, got int/,
		);
		expect(() => run(`write("p", 1)`, "x.esp")).toThrow(
			/write: content must be str, got int/,
		);
	});
});

describe("stdlib/io: exists?", () => {
	it("true for existing file", () => {
		const path = join(dir, "f.txt");
		writeFileSync(path, "x");
		expect(run(`exists?("${path}")`, "x.esp")).toBe(true);
	});

	it("true for existing directory", () => {
		expect(run(`exists?("${dir}")`, "x.esp")).toBe(true);
	});

	it("false for missing path", () => {
		const path = join(dir, "ghost.txt");
		expect(run(`exists?("${path}")`, "x.esp")).toBe(false);
	});

	it("rejects non-str", () => {
		expect(() => run(`exists?(1)`, "x.esp")).toThrow(
			/exists\?: path must be str, got int/,
		);
	});
});

describe("stdlib/io: try_write", () => {
	it("returns ok=true on success", () => {
		const path = join(dir, "out.txt");
		expect(run(`try_write("${path}", "ok")`, "x.esp")).toEqual({
			kind: "map",
			entries: { ok: true, value: null },
		});
		expect(readFileSync(path, "utf-8")).toBe("ok");
	});

	it("returns ok=false on missing parent dir", () => {
		const path = join(dir, "nope", "x.txt");
		const result = run(`try_write("${path}", "x")`, "x.esp") as {
			kind: "map";
			entries: { ok: boolean; error: string };
		};
		expect(result.entries.ok).toBe(false);
		expect(result.entries.error).toMatch(/parent directory not found/);
	});
});

describe("stdlib/io: env", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns env var value", () => {
		vi.stubEnv("ESPETO_TEST_VAR", "sardinas");
		expect(run(`env("ESPETO_TEST_VAR")`, "x.esp")).toBe("sardinas");
	});

	it("raises when variable is not set", () => {
		vi.stubEnv("ESPETO_MISSING", undefined as unknown as string);
		expect(() => run(`env("ESPETO_MISSING")`, "x.esp")).toThrow(
			/env: variable not set: ESPETO_MISSING/,
		);
	});

	it("rejects non-str name", () => {
		expect(() => run(`env(1)`, "x.esp")).toThrow(
			/env: name must be str, got int/,
		);
	});
});

describe("stdlib/io: env_or", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns value when set", () => {
		vi.stubEnv("ESPETO_TEST_VAR", "real");
		expect(run(`env_or("ESPETO_TEST_VAR", "fallback")`, "x.esp")).toBe(
			"real",
		);
	});

	it("returns default when missing", () => {
		vi.stubEnv("ESPETO_MISSING", undefined as unknown as string);
		expect(run(`env_or("ESPETO_MISSING", "fallback")`, "x.esp")).toBe(
			"fallback",
		);
	});

	it("treats empty string as set (returns it, not default)", () => {
		vi.stubEnv("ESPETO_EMPTY", "");
		expect(run(`env_or("ESPETO_EMPTY", "fallback")`, "x.esp")).toBe("");
	});

	it("rejects non-str default", () => {
		expect(() => run(`env_or("X", 1)`, "x.esp")).toThrow(
			/env_or: default must be str, got int/,
		);
	});
});
