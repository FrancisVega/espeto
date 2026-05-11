import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InitError, runInit } from "../src/moraga/init";
import { parseManifest } from "../src/moraga/manifest";
import { VERSION } from "../src/version";

const tmps: string[] = [];

afterEach(() => {
	while (tmps.length > 0) {
		const d = tmps.pop();
		if (d) spawnSync("rm", ["-rf", d]);
	}
});

async function mkPkgDir(name: string): Promise<string> {
	const root = mkdtempSync(join(tmpdir(), "moraga-init-test-"));
	tmps.push(root);
	const dir = join(root, name);
	await mkdir(dir);
	return dir;
}

describe("runInit", () => {
	it("creates moraga.esp + main.esp + main_test.esp with defaults", async () => {
		const dir = await mkPkgDir("my_pkg");
		const r = await runInit(dir);

		expect(r.name).toBe("my_pkg");
		expect(r.files).toEqual([
			join(dir, "moraga.esp"),
			join(dir, "main.esp"),
			join(dir, "main_test.esp"),
		]);
		expect(existsSync(join(dir, "moraga.esp"))).toBe(true);
		expect(existsSync(join(dir, "main.esp"))).toBe(true);
		expect(existsSync(join(dir, "main_test.esp"))).toBe(true);
	});

	it("generates a parseable manifest with VERSION compat range", async () => {
		const dir = await mkPkgDir("widget");
		await runInit(dir);

		const src = readFileSync(join(dir, "moraga.esp"), "utf8");
		const parsed = parseManifest(src, join(dir, "moraga.esp"));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.manifest.name).toBe("widget");
		expect(parsed.manifest.version).toBe("0.1.0");
		expect(parsed.manifest.espeto).toBe(`>= ${VERSION}`);
		expect(parsed.manifest.deps.size).toBe(0);
	});

	it("respects --name and --version flags", async () => {
		const dir = await mkPkgDir("ignored");
		const r = await runInit(dir, { name: "custom", version: "2.0.0" });

		expect(r.name).toBe("custom");
		expect(existsSync(join(dir, "main.esp"))).toBe(true);
		const src = readFileSync(join(dir, "moraga.esp"), "utf8");
		expect(src).toContain('"name": "custom"');
		expect(src).toContain('"version": "2.0.0"');
	});

	it("sanitizes basename: hyphens → underscores, lowercase", async () => {
		const dir = await mkPkgDir("My-Cool-Pkg");
		const r = await runInit(dir);

		expect(r.name).toBe("my_cool_pkg");
		const src = readFileSync(join(dir, "moraga.esp"), "utf8");
		expect(src).toContain('"name": "my_cool_pkg"');
	});

	it("rejects invalid names (must start with a letter, snake_case)", async () => {
		const dir = await mkPkgDir("ok");
		await expect(runInit(dir, { name: "123bad" })).rejects.toBeInstanceOf(
			InitError,
		);
		await expect(runInit(dir, { name: "Bad-Name" })).rejects.toBeInstanceOf(
			InitError,
		);
	});

	it("fails if moraga.esp already exists without --force", async () => {
		const dir = await mkPkgDir("once");
		await runInit(dir);
		await expect(runInit(dir)).rejects.toBeInstanceOf(InitError);
	});

	it("overwrites existing files with --force", async () => {
		const dir = await mkPkgDir("overwrite");
		await runInit(dir);
		const original = readFileSync(join(dir, "moraga.esp"), "utf8");

		await runInit(dir, { version: "9.9.9", force: true });
		const updated = readFileSync(join(dir, "moraga.esp"), "utf8");
		expect(updated).not.toBe(original);
		expect(updated).toContain('"version": "9.9.9"');
	});

	it("generated test file imports ./main", async () => {
		const dir = await mkPkgDir("greeter");
		await runInit(dir);

		const testSrc = readFileSync(join(dir, "main_test.esp"), "utf8");
		expect(testSrc).toContain('import "./main"');
		expect(testSrc).toContain("test ");
		expect(testSrc).toContain("assert ");
	});
});
