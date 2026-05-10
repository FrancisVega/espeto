import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CachePaths } from "../src/moraga/cache";
import { runAdd } from "../src/moraga/add";
import { type HostAdapter, MoragaFetchError } from "../src/moraga/fetch";
import { parseManifest } from "../src/moraga/manifest";
import { RemoveError, runRemove } from "../src/moraga/remove";

const tmps: string[] = [];

afterEach(() => {
	while (tmps.length > 0) {
		const d = tmps.pop();
		if (d) spawnSync("rm", ["-rf", d]);
	}
});

function mkTmp(prefix = "moraga-remove-test-"): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	tmps.push(d);
	return d;
}

function paths(): CachePaths {
	const root = mkTmp("moraga-remove-cache-");
	return { root, tmpRoot: join(root, ".tmp") };
}

class FakeAdapter implements HostAdapter {
	readonly host = "github.com";
	readonly tags = new Map<string, string>();
	readonly tarballs = new Map<string, Buffer>();
	resolveCalls: Array<{ repoPath: string; ref: string }> = [];

	async resolveSha(repoPath: string, ref: string): Promise<string> {
		this.resolveCalls.push({ repoPath, ref });
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
	devDeps?: Record<string, string>;
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
  "dev_deps": ${fmtMap(opts.devDeps)}
}
`;
}

function addPackage(
	adapter: FakeAdapter,
	url: string,
	version: string,
	manifest: { name: string; deps?: Record<string, string> },
): void {
	const sha = nextSha();
	const repoPath = url.replace(/^github\.com\//, "");
	const wrapperDir = `${repoPath.replace(/\//g, "-")}-${version}`;
	const moragaSrc = makeManifestSrc({
		name: manifest.name,
		deps: manifest.deps,
	});
	const entrypoint = `def hello() do\n  "${manifest.name}"\nend\n`;
	const files: Record<string, string> = {
		"moraga.esp": moragaSrc,
		[`${manifest.name}.esp`]: entrypoint,
	};
	const tarball = makeTarball(wrapperDir, files);
	adapter.tags.set(`${repoPath}|v${version}`, sha);
	adapter.tarballs.set(sha, tarball);
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

function setupRoot(manifestSrc: string): {
	rootDir: string;
	cachePaths: CachePaths;
} {
	const rootDir = mkTmp("moraga-remove-root-");
	writeFileSync(join(rootDir, "moraga.esp"), manifestSrc);
	return { rootDir, cachePaths: paths() };
}

beforeEach(() => {
	shaCounter = 0;
});

describe("runRemove — pre-flight validation", () => {
	it("rejects empty urls list", async () => {
		const { rootDir } = setupRoot(makeManifestSrc({}));
		await expect(runRemove(rootDir, [])).rejects.toThrow(/no packages specified/);
	});

	it("rejects missing manifest", async () => {
		const rootDir = mkTmp();
		await expect(runRemove(rootDir, ["github.com/foo/bar"])).rejects.toThrow(
			/no moraga\.esp/,
		);
	});

	it("rejects invalid url", async () => {
		const { rootDir } = setupRoot(makeManifestSrc({}));
		await expect(runRemove(rootDir, ["not-a-url"])).rejects.toThrow(
			/invalid package url/,
		);
	});

	it("rejects duplicate urls in same command", async () => {
		const { rootDir } = setupRoot(makeManifestSrc({}));
		await expect(
			runRemove(rootDir, ["github.com/foo/bar", "github.com/foo/bar"]),
		).rejects.toThrow(/more than once/);
	});
});

describe("runRemove — happy paths", () => {
	it("removes a single dep, runs install, prunes lock + .espetos/", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/bar", "1.0.0", { name: "bar" });
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/bar", version: "1.0.0" }],
			{ paths: cachePaths, adapter },
		);
		expect(existsSync(join(rootDir, ".espetos", "bar"))).toBe(true);

		const r = await runRemove(rootDir, ["github.com/foo/bar"], {
			paths: cachePaths,
			adapter,
		});
		expect(r.removed).toEqual(["github.com/foo/bar"]);
		expect(r.install.installed).toBe(0);
		expect(existsSync(join(rootDir, ".espetos", "bar"))).toBe(false);

		const manifest = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		const m = parseManifest(manifest, "moraga.esp");
		expect(m.ok).toBe(true);
		if (m.ok) expect(m.manifest.deps.size).toBe(0);

		const lock = readFileSync(join(rootDir, "moraga.lock"), "utf8");
		expect(lock).not.toContain("github.com/foo/bar");
	});

	it("removes from dev_deps via autodetect (no --dev flag needed)", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/test_only", "1.0.0", {
			name: "test_only",
		});
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/test_only", version: "1.0.0" }],
			{ dev: true, paths: cachePaths, adapter },
		);

		const r = await runRemove(rootDir, ["github.com/foo/test_only"], {
			paths: cachePaths,
			adapter,
		});
		expect(r.removed).toEqual(["github.com/foo/test_only"]);
		const manifest = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		const m = parseManifest(manifest, "moraga.esp");
		expect(m.ok).toBe(true);
		if (m.ok) {
			expect(m.manifest.devDeps.size).toBe(0);
		}
	});

	it("removes multiple deps in a single call", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/a", "1.0.0", { name: "a" });
		addPackage(adapter, "github.com/foo/b", "2.0.0", { name: "b" });
		addPackage(adapter, "github.com/foo/c", "3.0.0", { name: "c" });
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[
				{ url: "github.com/foo/a", version: "1.0.0" },
				{ url: "github.com/foo/b", version: "2.0.0" },
				{ url: "github.com/foo/c", version: "3.0.0" },
			],
			{ paths: cachePaths, adapter },
		);

		const r = await runRemove(
			rootDir,
			["github.com/foo/a", "github.com/foo/c"],
			{ paths: cachePaths, adapter },
		);
		expect(r.removed.sort()).toEqual(["github.com/foo/a", "github.com/foo/c"]);
		const manifest = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		const m = parseManifest(manifest, "moraga.esp");
		expect(m.ok).toBe(true);
		if (m.ok) {
			expect([...m.manifest.deps.keys()]).toEqual(["github.com/foo/b"]);
		}
	});

	it("skips urls not present (does not error)", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/bar", "1.0.0", { name: "bar" });
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/bar", version: "1.0.0" }],
			{ paths: cachePaths, adapter },
		);

		const r = await runRemove(
			rootDir,
			["github.com/foo/bar", "github.com/notinstalled/pkg"],
			{ paths: cachePaths, adapter },
		);
		expect(r.removed).toEqual(["github.com/foo/bar"]);
		expect(r.skipped).toEqual(["github.com/notinstalled/pkg"]);
	});

	it("noop (skipped only) when nothing to remove — does not run install", async () => {
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		const adapter = new FakeAdapter();
		const r = await runRemove(rootDir, ["github.com/missing/pkg"], {
			paths: cachePaths,
			adapter,
		});
		expect(r.removed).toEqual([]);
		expect(r.skipped).toEqual(["github.com/missing/pkg"]);
		expect(r.install.installed).toBe(0);
		expect(existsSync(join(rootDir, ".espetos"))).toBe(false);
	});
});

describe("runRemove — atomicity and rollback", () => {
	it("rolls back manifest when install fails post-write", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/a", "1.0.0", { name: "a" });
		addPackage(adapter, "github.com/foo/b", "2.0.0", { name: "b" });
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[
				{ url: "github.com/foo/a", version: "1.0.0" },
				{ url: "github.com/foo/b", version: "2.0.0" },
			],
			{ paths: cachePaths, adapter },
		);

		const bDir = join(cachePaths.root, "github.com", "foo", "b");
		const shas = readdirSync(bDir);
		writeFileSync(join(bDir, shas[0]!, "moraga.esp"), "this is not valid");

		const original = readFileSync(join(rootDir, "moraga.esp"), "utf8");

		await expect(
			runRemove(rootDir, ["github.com/foo/a"], {
				paths: cachePaths,
				adapter,
			}),
		).rejects.toThrow();

		const after = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		expect(after).toBe(original);
	});
});

describe("runRemove — error type", () => {
	it("throws RemoveError for invalid url", async () => {
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await expect(
			runRemove(rootDir, ["bad"], {
				paths: cachePaths,
				adapter: new FakeAdapter(),
			}),
		).rejects.toThrow(RemoveError);
	});
});
