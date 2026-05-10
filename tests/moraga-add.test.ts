import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CachePaths } from "../src/moraga/cache";
import { AddError, runAdd } from "../src/moraga/add";
import { type HostAdapter, MoragaFetchError } from "../src/moraga/fetch";
import { parseManifest } from "../src/moraga/manifest";

const tmps: string[] = [];

afterEach(() => {
	while (tmps.length > 0) {
		const d = tmps.pop();
		if (d) spawnSync("rm", ["-rf", d]);
	}
});

function mkTmp(prefix = "moraga-add-test-"): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	tmps.push(d);
	return d;
}

function paths(): CachePaths {
	const root = mkTmp("moraga-add-cache-");
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
		if (!sha) {
			throw new MoragaFetchError("not_found", `no such tag ${key}`);
		}
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
): string {
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
	return sha;
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
	const rootDir = mkTmp("moraga-add-root-");
	writeFileSync(join(rootDir, "moraga.esp"), manifestSrc);
	return { rootDir, cachePaths: paths() };
}

beforeEach(() => {
	shaCounter = 0;
});

describe("runAdd — pre-flight validation", () => {
	it("rejects empty specs list", async () => {
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await expect(
			runAdd(rootDir, [], { paths: cachePaths, adapter: new FakeAdapter() }),
		).rejects.toThrow(/no packages specified/);
	});

	it("rejects missing manifest", async () => {
		const rootDir = mkTmp();
		await expect(
			runAdd(rootDir, [{ url: "github.com/foo/bar", version: "1.0.0" }]),
		).rejects.toThrow(/no moraga\.esp/);
	});

	it("rejects invalid URL", async () => {
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await expect(
			runAdd(rootDir, [{ url: "not-a-url", version: "1.0.0" }], {
				paths: cachePaths,
				adapter: new FakeAdapter(),
			}),
		).rejects.toThrow(/invalid package url/);
	});

	it("rejects invalid version", async () => {
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await expect(
			runAdd(
				rootDir,
				[{ url: "github.com/foo/bar", version: "v1.0.0" }],
				{ paths: cachePaths, adapter: new FakeAdapter() },
			),
		).rejects.toThrow(/exact semver/);
	});

	it("rejects invalid alias", async () => {
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await expect(
			runAdd(
				rootDir,
				[{ url: "github.com/foo/bar", version: "1.0.0", alias: "Bad-Name" }],
				{ paths: cachePaths, adapter: new FakeAdapter() },
			),
		).rejects.toThrow(/invalid alias/);
	});

	it("rejects duplicate URLs in same command", async () => {
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await expect(
			runAdd(
				rootDir,
				[
					{ url: "github.com/foo/bar", version: "1.0.0" },
					{ url: "github.com/foo/bar", version: "2.0.0" },
				],
				{ paths: cachePaths, adapter: new FakeAdapter() },
			),
		).rejects.toThrow(/more than once/);
	});

	it("rejects unresolvable remote (network preflight)", async () => {
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		const adapter = new FakeAdapter();
		await expect(
			runAdd(
				rootDir,
				[{ url: "github.com/foo/bar", version: "1.0.0" }],
				{ paths: cachePaths, adapter },
			),
		).rejects.toThrow(/cannot resolve/);
		const manifest = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		expect(manifest).not.toContain("github.com/foo/bar");
	});
});

describe("runAdd — conflicts", () => {
	it("errors when url already at different version", async () => {
		const { rootDir, cachePaths } = setupRoot(
			makeManifestSrc({ deps: { "github.com/foo/bar": "1.0.0" } }),
		);
		const adapter = new FakeAdapter();
		await expect(
			runAdd(
				rootDir,
				[{ url: "github.com/foo/bar", version: "2.0.0" }],
				{ paths: cachePaths, adapter },
			),
		).rejects.toThrow(/already in "deps" at 1\.0\.0/);
	});

	it("errors when url is in dev_deps and adding without --dev", async () => {
		const { rootDir, cachePaths } = setupRoot(
			makeManifestSrc({ devDeps: { "github.com/foo/bar": "1.0.0" } }),
		);
		await expect(
			runAdd(
				rootDir,
				[{ url: "github.com/foo/bar", version: "1.0.0" }],
				{ paths: cachePaths, adapter: new FakeAdapter() },
			),
		).rejects.toThrow(/already in "dev_deps"/);
	});

	it("is a no-op (skipped) when same url+version already present", async () => {
		const { rootDir, cachePaths } = setupRoot(
			makeManifestSrc({ deps: { "github.com/foo/bar": "1.0.0" } }),
		);
		const adapter = new FakeAdapter();
		const r = await runAdd(
			rootDir,
			[{ url: "github.com/foo/bar", version: "1.0.0" }],
			{ paths: cachePaths, adapter },
		);
		expect(r.added).toEqual([]);
		expect(r.skipped).toEqual(["github.com/foo/bar"]);
		expect(adapter.resolveCalls.length).toBe(0);
	});
});

describe("runAdd — happy paths", () => {
	it("adds a single dep, writes manifest, runs install", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/bar", "1.0.0", { name: "bar" });
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		const r = await runAdd(
			rootDir,
			[{ url: "github.com/foo/bar", version: "1.0.0" }],
			{ paths: cachePaths, adapter },
		);
		expect(r.added).toEqual(["github.com/foo/bar"]);
		expect(r.install.installed).toBe(1);
		const manifest = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		expect(manifest).toContain(`"github.com/foo/bar": "1.0.0"`);
		const m = parseManifest(manifest, "moraga.esp");
		expect(m.ok).toBe(true);
		expect(existsSync(join(rootDir, ".espetos", "bar"))).toBe(true);
		expect(existsSync(join(rootDir, "moraga.lock"))).toBe(true);
	});

	it("adds multiple deps in a single call", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/a", "1.0.0", { name: "a" });
		addPackage(adapter, "github.com/foo/b", "2.0.0", { name: "b" });
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		const r = await runAdd(
			rootDir,
			[
				{ url: "github.com/foo/a", version: "1.0.0" },
				{ url: "github.com/foo/b", version: "2.0.0" },
			],
			{ paths: cachePaths, adapter },
		);
		expect(r.added.length).toBe(2);
		const manifest = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		expect(manifest).toContain("github.com/foo/a");
		expect(manifest).toContain("github.com/foo/b");
		expect(existsSync(join(rootDir, ".espetos", "a"))).toBe(true);
		expect(existsSync(join(rootDir, ".espetos", "b"))).toBe(true);
	});

	it("adds to dev_deps with dev flag", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/test_only", "1.0.0", {
			name: "test_only",
		});
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		const r = await runAdd(
			rootDir,
			[{ url: "github.com/foo/test_only", version: "1.0.0" }],
			{ dev: true, paths: cachePaths, adapter },
		);
		expect(r.added).toEqual(["github.com/foo/test_only"]);
		const manifest = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		const m = parseManifest(manifest, "moraga.esp");
		expect(m.ok).toBe(true);
		if (m.ok) {
			expect(m.manifest.deps.has("github.com/foo/test_only")).toBe(false);
			expect(m.manifest.devDeps.has("github.com/foo/test_only")).toBe(true);
		}
	});

	it("adds with alias produces extended form", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/json", "1.0.0", { name: "json" });
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		const r = await runAdd(
			rootDir,
			[{ url: "github.com/foo/json", version: "1.0.0", alias: "json_v1" }],
			{ paths: cachePaths, adapter },
		);
		expect(r.added.length).toBe(1);
		const manifest = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		expect(manifest).toContain(`"as": "json_v1"`);
		expect(existsSync(join(rootDir, ".espetos", "json_v1"))).toBe(true);
	});
});

describe("runAdd — atomicity and rollback", () => {
	it("does not modify manifest when one of multiple specs fails preflight", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/a", "1.0.0", { name: "a" });
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		const original = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		await expect(
			runAdd(
				rootDir,
				[
					{ url: "github.com/foo/a", version: "1.0.0" },
					{ url: "github.com/foo/missing", version: "9.9.9" },
				],
				{ paths: cachePaths, adapter },
			),
		).rejects.toThrow(AddError);
		const after = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		expect(after).toBe(original);
		expect(existsSync(join(rootDir, ".espetos"))).toBe(false);
	});

	it("rolls back manifest when install fails after manifest write", async () => {
		const adapter = new FakeAdapter();
		const sha = nextSha();
		const repoPath = "foo/broken";
		adapter.tags.set(`${repoPath}|v1.0.0`, sha);
		const tarball = makeTarball("foo-broken-1.0.0", {
			"README.md": "no moraga.esp here",
		});
		adapter.tarballs.set(sha, tarball);

		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		const original = readFileSync(join(rootDir, "moraga.esp"), "utf8");

		await expect(
			runAdd(
				rootDir,
				[{ url: "github.com/foo/broken", version: "1.0.0" }],
				{ paths: cachePaths, adapter },
			),
		).rejects.toThrow(/install failed/);

		const after = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		expect(after).toBe(original);
	});
});
