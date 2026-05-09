import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
	cacheDirFor,
	type CachePaths,
	computeMerkleHash,
	extractTarballToCache,
	isCached,
} from "../src/moraga/cache";

const tmps: string[] = [];

afterEach(() => {
	while (tmps.length > 0) {
		const d = tmps.pop();
		if (d) spawnSync("rm", ["-rf", d]);
	}
});

function mkTmp(prefix = "moraga-test-"): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	tmps.push(d);
	return d;
}

function paths(): CachePaths {
	const root = mkTmp("moraga-cache-");
	return { root, tmpRoot: join(root, ".tmp") };
}

function makeWrappedTarball(
	wrapperDir: string,
	files: Record<string, string>,
): Readable {
	const work = mkTmp("moraga-tar-src-");
	const inner = join(work, wrapperDir);
	for (const [rel, content] of Object.entries(files)) {
		const abs = join(inner, rel);
		spawnSync("mkdir", ["-p", join(abs, "..")]);
		writeFileSync(abs, content);
	}
	const tarballPath = join(mkTmp("moraga-tar-out-"), "out.tgz");
	const r = spawnSync("tar", ["-czf", tarballPath, "-C", work, wrapperDir]);
	if (r.status !== 0) {
		throw new Error(`failed to create test tarball: ${r.stderr.toString()}`);
	}
	const buf = readFileSync(tarballPath);
	return Readable.from(buf);
}

describe("cacheDirFor", () => {
	it("joins host + path segments + sha", () => {
		const p: CachePaths = { root: "/r", tmpRoot: "/r/.tmp" };
		expect(cacheDirFor(p, "github.com", "foo/bar", "abc")).toBe(
			"/r/github.com/foo/bar/abc",
		);
	});

	it("supports nested paths (gitlab subgroups)", () => {
		const p: CachePaths = { root: "/r", tmpRoot: "/r/.tmp" };
		expect(cacheDirFor(p, "gitlab.com", "g/sub/repo", "abc")).toBe(
			"/r/gitlab.com/g/sub/repo/abc",
		);
	});
});

describe("isCached", () => {
	it("false when sha dir missing", async () => {
		const p = paths();
		expect(await isCached(p, "github.com", "x/y", "abc")).toBe(false);
	});

	it("true when sha dir exists", async () => {
		const p = paths();
		const dir = cacheDirFor(p, "github.com", "x/y", "abc");
		await mkdir(dir, { recursive: true });
		expect(await isCached(p, "github.com", "x/y", "abc")).toBe(true);
	});
});

describe("computeMerkleHash", () => {
	it("is deterministic for identical content", async () => {
		const dir1 = mkTmp();
		const dir2 = mkTmp();
		await writeFile(join(dir1, "a.txt"), "hello");
		await writeFile(join(dir1, "b.txt"), "world");
		await writeFile(join(dir2, "a.txt"), "hello");
		await writeFile(join(dir2, "b.txt"), "world");
		expect(await computeMerkleHash(dir1)).toBe(await computeMerkleHash(dir2));
	});

	it("differs when a byte changes", async () => {
		const dir1 = mkTmp();
		const dir2 = mkTmp();
		await writeFile(join(dir1, "a.txt"), "hello");
		await writeFile(join(dir2, "a.txt"), "hellp");
		expect(await computeMerkleHash(dir1)).not.toBe(
			await computeMerkleHash(dir2),
		);
	});

	it("differs when a file is renamed", async () => {
		const dir1 = mkTmp();
		const dir2 = mkTmp();
		await writeFile(join(dir1, "a.txt"), "hello");
		await writeFile(join(dir2, "b.txt"), "hello");
		expect(await computeMerkleHash(dir1)).not.toBe(
			await computeMerkleHash(dir2),
		);
	});

	it("starts with 'h1:' prefix", async () => {
		const dir = mkTmp();
		await writeFile(join(dir, "a.txt"), "hello");
		expect(await computeMerkleHash(dir)).toMatch(/^h1:[0-9a-f]{64}$/);
	});

	it("walks nested directories", async () => {
		const dir1 = mkTmp();
		const dir2 = mkTmp();
		await mkdir(join(dir1, "sub"));
		await mkdir(join(dir2, "sub"));
		await writeFile(join(dir1, "sub", "x.txt"), "deep");
		await writeFile(join(dir2, "sub", "x.txt"), "deep");
		expect(await computeMerkleHash(dir1)).toBe(await computeMerkleHash(dir2));
	});
});

describe("extractTarballToCache", () => {
	it("strips wrapper dir and lands files in cache dir", async () => {
		const p = paths();
		const stream = makeWrappedTarball("foo-bar-1234567", {
			"package.json": '{"name":"bar"}',
			"src/index.js": "console.log(1)",
		});
		const result = await extractTarballToCache(
			p,
			"github.com",
			"foo/bar",
			"a".repeat(40),
			stream,
		);
		expect(result.cachePath).toBe(
			cacheDirFor(p, "github.com", "foo/bar", "a".repeat(40)),
		);
		const top = readdirSync(result.cachePath).sort();
		expect(top).toEqual(["package.json", "src"]);
		expect(
			readFileSync(join(result.cachePath, "package.json"), "utf8"),
		).toBe('{"name":"bar"}');
		expect(
			readFileSync(join(result.cachePath, "src", "index.js"), "utf8"),
		).toBe("console.log(1)");
	});

	it("returns a Merkle h1: checksum", async () => {
		const p = paths();
		const stream = makeWrappedTarball("x-y-abc1234", {
			"a.txt": "hi",
		});
		const result = await extractTarballToCache(
			p,
			"github.com",
			"x/y",
			"b".repeat(40),
			stream,
		);
		expect(result.checksum).toMatch(/^h1:[0-9a-f]{64}$/);
	});

	it("cleans up tmp dir on tar failure", async () => {
		const p = paths();
		const garbage = Readable.from(Buffer.from("not a tarball"));
		await expect(
			extractTarballToCache(
				p,
				"github.com",
				"x/y",
				"c".repeat(40),
				garbage,
			),
		).rejects.toThrow(/tar extraction failed/);
		expect(await isCached(p, "github.com", "x/y", "c".repeat(40))).toBe(false);
	});
});
