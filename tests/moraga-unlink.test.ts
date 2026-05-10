import { spawnSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdd } from "../src/moraga/add";
import type { CachePaths } from "../src/moraga/cache";
import { type HostAdapter, MoragaFetchError } from "../src/moraga/fetch";
import { runLink } from "../src/moraga/link";
import { parseLocal } from "../src/moraga/local";
import { UnlinkError, runUnlink } from "../src/moraga/unlink";

const tmps: string[] = [];

afterEach(() => {
	while (tmps.length > 0) {
		const d = tmps.pop();
		if (d) spawnSync("rm", ["-rf", d]);
	}
});

function mkTmp(prefix = "moraga-unlink-test-"): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	tmps.push(d);
	return d;
}

function paths(): CachePaths {
	const root = mkTmp("moraga-unlink-cache-");
	return { root, tmpRoot: join(root, ".tmp") };
}

class FakeAdapter implements HostAdapter {
	readonly host = "github.com";
	readonly tags = new Map<string, string>();
	readonly tarballs = new Map<string, Buffer>();

	async resolveSha(repoPath: string, ref: string): Promise<string> {
		const key = `${repoPath}|${ref}`;
		const sha = this.tags.get(key);
		if (!sha) throw new MoragaFetchError("not_found", `no such tag ${key}`);
		return sha;
	}

	async downloadTarball(_repoPath: string, sha: string): Promise<Readable> {
		const buf = this.tarballs.get(sha);
		if (!buf) throw new MoragaFetchError("not_found", `no such sha ${sha}`);
		return Readable.from(buf);
	}

	async listTags(_repoPath: string): Promise<string[]> {
		return [];
	}
}

let shaCounter = 0;
function nextSha(): string {
	shaCounter++;
	return shaCounter.toString(16).padStart(40, "0");
}

function makeManifestSrc(opts: {
	name?: string;
	deps?: Record<string, string>;
}): string {
	const name = opts.name ?? "myapp";
	const fmtMap = (m?: Record<string, string>): string => {
		if (!m || Object.keys(m).length === 0) return "{}";
		const entries = Object.entries(m).map(
			([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`,
		);
		return `{\n${entries.join(",\n")}\n  }`;
	};
	return `{
  "name": ${JSON.stringify(name)},
  "version": "0.1.0",
  "espeto": ">= 0.1.0",
  "deps": ${fmtMap(opts.deps)},
  "dev_deps": {}
}
`;
}

function makeTarball(
	wrapperDir: string,
	files: Record<string, string>,
): Buffer {
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
		throw new Error(`failed to build tarball: ${r.stderr.toString()}`);
	}
	return readFileSync(tarballPath);
}

function addPackageToAdapter(
	adapter: FakeAdapter,
	url: string,
	version: string,
	manifest: { name: string },
): void {
	const sha = nextSha();
	const repoPath = url.replace(/^github\.com\//, "");
	const wrapperDir = `${repoPath.replace(/\//g, "-")}-${version}`;
	const moragaSrc = makeManifestSrc({ name: manifest.name });
	const entrypoint = `def hello() do\n  "${manifest.name}"\nend\n`;
	const files: Record<string, string> = {
		"moraga.esp": moragaSrc,
		[`${manifest.name}.esp`]: entrypoint,
	};
	const tarball = makeTarball(wrapperDir, files);
	adapter.tags.set(`${repoPath}|v${version}`, sha);
	adapter.tarballs.set(sha, tarball);
}

function setupRoot(manifestSrc: string): {
	rootDir: string;
	cachePaths: CachePaths;
} {
	const rootDir = mkTmp("moraga-unlink-root-");
	writeFileSync(join(rootDir, "moraga.esp"), manifestSrc);
	return { rootDir, cachePaths: paths() };
}

function setupLinkedPackage(name: string): string {
	const dir = mkTmp(`moraga-unlink-pkg-${name}-`);
	writeFileSync(join(dir, "moraga.esp"), makeManifestSrc({ name }));
	writeFileSync(
		join(dir, `${name}.esp`),
		`def hello() do\n  "${name} (linked)"\nend\n`,
	);
	return dir;
}

beforeEach(() => {
	shaCounter = 0;
});

describe("runUnlink — validation", () => {
	it("rejects empty urls", async () => {
		const { rootDir } = setupRoot(makeManifestSrc({}));
		await expect(runUnlink(rootDir, [])).rejects.toThrow(
			/no packages specified/,
		);
	});

	it("rejects invalid url", async () => {
		const { rootDir } = setupRoot(makeManifestSrc({}));
		await expect(runUnlink(rootDir, ["bad-url"])).rejects.toThrow(
			UnlinkError,
		);
	});

	it("rejects missing manifest", async () => {
		const rootDir = mkTmp();
		await expect(runUnlink(rootDir, ["github.com/foo/bar"])).rejects.toThrow(
			/no moraga\.esp/,
		);
	});

	it("rejects duplicate urls in same command", async () => {
		const { rootDir } = setupRoot(makeManifestSrc({}));
		await expect(
			runUnlink(rootDir, ["github.com/foo/bar", "github.com/foo/bar"]),
		).rejects.toThrow(/more than once/);
	});
});

describe("runUnlink — happy paths", () => {
	it("unlinks a single package and re-symlinks .espetos to the cache", async () => {
		const adapter = new FakeAdapter();
		addPackageToAdapter(adapter, "github.com/foo/bar", "1.0.0", {
			name: "bar",
		});
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/bar", version: "1.0.0" }],
			{ paths: cachePaths, adapter },
		);
		const linkedDir = setupLinkedPackage("bar");
		await runLink(rootDir, "github.com/foo/bar", linkedDir, {
			paths: cachePaths,
			adapter,
		});
		expect(readlinkSync(join(rootDir, ".espetos", "bar"))).toBe(linkedDir);

		const r = await runUnlink(rootDir, ["github.com/foo/bar"], {
			paths: cachePaths,
			adapter,
		});
		expect(r.unlinked).toEqual(["github.com/foo/bar"]);
		expect(r.skipped).toEqual([]);

		const target = readlinkSync(join(rootDir, ".espetos", "bar"));
		expect(target).toContain(cachePaths.root);
		expect(target).not.toBe(linkedDir);

		const localSrc = readFileSync(
			join(rootDir, "moraga.local.esp"),
			"utf8",
		);
		const lp = parseLocal(localSrc, "moraga.local.esp");
		expect(lp.ok).toBe(true);
		if (lp.ok) expect(lp.local.links.size).toBe(0);
	});

	it("skips urls not currently linked", async () => {
		const adapter = new FakeAdapter();
		addPackageToAdapter(adapter, "github.com/foo/bar", "1.0.0", {
			name: "bar",
		});
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/bar", version: "1.0.0" }],
			{ paths: cachePaths, adapter },
		);

		const r = await runUnlink(rootDir, ["github.com/foo/bar"], {
			paths: cachePaths,
			adapter,
		});
		expect(r.unlinked).toEqual([]);
		expect(r.skipped).toEqual(["github.com/foo/bar"]);
		expect(r.install.installed).toBe(0);
	});

	it("unlinks multiple packages in a single call, skipping unknown", async () => {
		const adapter = new FakeAdapter();
		addPackageToAdapter(adapter, "github.com/foo/a", "1.0.0", { name: "a" });
		addPackageToAdapter(adapter, "github.com/foo/b", "2.0.0", { name: "b" });
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[
				{ url: "github.com/foo/a", version: "1.0.0" },
				{ url: "github.com/foo/b", version: "2.0.0" },
			],
			{ paths: cachePaths, adapter },
		);

		const linkedA = setupLinkedPackage("a");
		const linkedB = setupLinkedPackage("b");
		await runLink(rootDir, "github.com/foo/a", linkedA, {
			paths: cachePaths,
			adapter,
		});
		await runLink(rootDir, "github.com/foo/b", linkedB, {
			paths: cachePaths,
			adapter,
		});

		const r = await runUnlink(
			rootDir,
			[
				"github.com/foo/a",
				"github.com/foo/c",
				"github.com/foo/b",
			],
			{ paths: cachePaths, adapter },
		);
		expect(r.unlinked.sort()).toEqual([
			"github.com/foo/a",
			"github.com/foo/b",
		]);
		expect(r.skipped).toEqual(["github.com/foo/c"]);
	});

	it("does not modify moraga.esp", async () => {
		const adapter = new FakeAdapter();
		addPackageToAdapter(adapter, "github.com/foo/bar", "1.0.0", {
			name: "bar",
		});
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/bar", version: "1.0.0" }],
			{ paths: cachePaths, adapter },
		);
		const linkedDir = setupLinkedPackage("bar");
		await runLink(rootDir, "github.com/foo/bar", linkedDir, {
			paths: cachePaths,
			adapter,
		});
		const before = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		await runUnlink(rootDir, ["github.com/foo/bar"], {
			paths: cachePaths,
			adapter,
		});
		const after = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		expect(after).toBe(before);
	});

	it("re-adds unlinked package to moraga.lock", async () => {
		const adapter = new FakeAdapter();
		addPackageToAdapter(adapter, "github.com/foo/bar", "1.0.0", {
			name: "bar",
		});
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/bar", version: "1.0.0" }],
			{ paths: cachePaths, adapter },
		);
		const linkedDir = setupLinkedPackage("bar");
		await runLink(rootDir, "github.com/foo/bar", linkedDir, {
			paths: cachePaths,
			adapter,
		});

		const lockWhileLinked = readFileSync(
			join(rootDir, "moraga.lock"),
			"utf8",
		);
		expect(lockWhileLinked).not.toContain("github.com/foo/bar");

		await runUnlink(rootDir, ["github.com/foo/bar"], {
			paths: cachePaths,
			adapter,
		});

		const lockAfter = readFileSync(join(rootDir, "moraga.lock"), "utf8");
		expect(lockAfter).toContain("github.com/foo/bar");
	});
});

describe("runUnlink — symlink verification", () => {
	it(".espetos/<name> is a regular symlink (not a directory)", async () => {
		const adapter = new FakeAdapter();
		addPackageToAdapter(adapter, "github.com/foo/bar", "1.0.0", {
			name: "bar",
		});
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/bar", version: "1.0.0" }],
			{ paths: cachePaths, adapter },
		);
		const linkedDir = setupLinkedPackage("bar");
		await runLink(rootDir, "github.com/foo/bar", linkedDir, {
			paths: cachePaths,
			adapter,
		});
		expect(lstatSync(join(rootDir, ".espetos", "bar")).isSymbolicLink()).toBe(
			true,
		);
		await runUnlink(rootDir, ["github.com/foo/bar"], {
			paths: cachePaths,
			adapter,
		});
		expect(lstatSync(join(rootDir, ".espetos", "bar")).isSymbolicLink()).toBe(
			true,
		);
	});
});

describe("runUnlink — without an existing moraga.local.esp", () => {
	it("skips silently if file does not exist", async () => {
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		expect(existsSync(join(rootDir, "moraga.local.esp"))).toBe(false);
		const r = await runUnlink(rootDir, ["github.com/foo/bar"], {
			paths: cachePaths,
			adapter: new FakeAdapter(),
		});
		expect(r.unlinked).toEqual([]);
		expect(r.skipped).toEqual(["github.com/foo/bar"]);
	});
});
