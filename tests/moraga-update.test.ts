import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
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
import { pickLatest, runUpdate, UpdateError } from "../src/moraga/update";

const tmps: string[] = [];

afterEach(() => {
	while (tmps.length > 0) {
		const d = tmps.pop();
		if (d) spawnSync("rm", ["-rf", d]);
	}
});

function mkTmp(prefix = "moraga-update-test-"): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	tmps.push(d);
	return d;
}

function paths(): CachePaths {
	const root = mkTmp("moraga-update-cache-");
	return { root, tmpRoot: join(root, ".tmp") };
}

class FakeAdapter implements HostAdapter {
	readonly host = "github.com";
	readonly tags = new Map<string, string>();
	readonly tarballs = new Map<string, Buffer>();
	readonly availableTags = new Map<string, string[]>();
	listTagsCalls: string[] = [];

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

	async listTags(repoPath: string): Promise<string[]> {
		this.listTagsCalls.push(repoPath);
		return this.availableTags.get(repoPath) ?? [];
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
	const moragaSrc = makeManifestSrc({ name: manifest.name, deps: manifest.deps });
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
	const rootDir = mkTmp("moraga-update-root-");
	writeFileSync(join(rootDir, "moraga.esp"), manifestSrc);
	return { rootDir, cachePaths: paths() };
}

beforeEach(() => {
	shaCounter = 0;
});

describe("pickLatest (unit)", () => {
	it("picks the highest stable semver", () => {
		expect(pickLatest(["v1.0.0", "v1.2.0", "v1.1.0"], false)).toBe("1.2.0");
	});

	it("strips leading v prefix", () => {
		expect(pickLatest(["v1.0.0"], false)).toBe("1.0.0");
		expect(pickLatest(["1.0.0"], false)).toBe("1.0.0");
	});

	it("ignores non-semver tags", () => {
		expect(pickLatest(["release-1", "v1.0.0", "wip"], false)).toBe("1.0.0");
	});

	it("excludes pre-releases by default", () => {
		expect(pickLatest(["v1.0.0", "v2.0.0-beta.1"], false)).toBe("1.0.0");
	});

	it("includes pre-releases when flag set", () => {
		expect(pickLatest(["v1.0.0", "v2.0.0-beta.1"], true)).toBe("2.0.0-beta.1");
	});

	it("returns null when no usable tags", () => {
		expect(pickLatest([], false)).toBeNull();
		expect(pickLatest(["wip", "release-1"], false)).toBeNull();
		expect(pickLatest(["v1.0.0-beta"], false)).toBeNull();
	});

	it("handles 1.10 > 1.9 numerically", () => {
		expect(pickLatest(["v1.9.0", "v1.10.0"], false)).toBe("1.10.0");
	});
});

describe("runUpdate — pre-flight validation", () => {
	it("rejects missing manifest", async () => {
		const rootDir = mkTmp();
		await expect(runUpdate(rootDir, undefined)).rejects.toThrow(
			/no moraga\.esp/,
		);
	});

	it("rejects invalid url", async () => {
		const { rootDir } = setupRoot(makeManifestSrc({}));
		await expect(runUpdate(rootDir, ["not-a-url"])).rejects.toThrow(
			/invalid package url/,
		);
	});

	it("rejects url not in manifest", async () => {
		const { rootDir } = setupRoot(makeManifestSrc({}));
		await expect(
			runUpdate(rootDir, ["github.com/missing/pkg"]),
		).rejects.toThrow(/not in deps or dev_deps/);
	});
});

describe("runUpdate — happy paths", () => {
	it("updates a single dep to latest", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/bar", "1.0.0", { name: "bar" });
		addPackage(adapter, "github.com/foo/bar", "1.2.0", { name: "bar" });
		adapter.availableTags.set("foo/bar", ["v1.0.0", "v1.1.0", "v1.2.0"]);
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/bar", version: "1.0.0" }],
			{ paths: cachePaths, adapter },
		);

		const r = await runUpdate(rootDir, ["github.com/foo/bar"], {
			paths: cachePaths,
			adapter,
		});
		expect(r.changes).toEqual([
			{
				url: "github.com/foo/bar",
				from: "1.0.0",
				to: "1.2.0",
				foundIn: "deps",
			},
		]);
		const manifest = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		expect(manifest).toContain(`"github.com/foo/bar": "1.2.0"`);
	});

	it("updates all deps when called with no urls", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/a", "1.0.0", { name: "a" });
		addPackage(adapter, "github.com/foo/a", "1.1.0", { name: "a" });
		addPackage(adapter, "github.com/foo/b", "2.0.0", { name: "b" });
		addPackage(adapter, "github.com/foo/b", "2.1.0", { name: "b" });
		adapter.availableTags.set("foo/a", ["v1.0.0", "v1.1.0"]);
		adapter.availableTags.set("foo/b", ["v2.0.0", "v2.1.0"]);
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[
				{ url: "github.com/foo/a", version: "1.0.0" },
				{ url: "github.com/foo/b", version: "2.0.0" },
			],
			{ paths: cachePaths, adapter },
		);

		const r = await runUpdate(rootDir, undefined, {
			paths: cachePaths,
			adapter,
		});
		expect(r.changes.length).toBe(2);
		expect(r.changes.map((c) => c.to).sort()).toEqual(["1.1.0", "2.1.0"]);
	});

	it("excludes pre-releases by default", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/bar", "1.0.0", { name: "bar" });
		adapter.availableTags.set("foo/bar", [
			"v1.0.0",
			"v2.0.0-beta.1",
			"v2.0.0-rc.1",
		]);
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/bar", version: "1.0.0" }],
			{ paths: cachePaths, adapter },
		);

		const r = await runUpdate(rootDir, ["github.com/foo/bar"], {
			paths: cachePaths,
			adapter,
		});
		expect(r.changes).toEqual([]);
		expect(r.upToDate).toEqual(["github.com/foo/bar"]);
	});

	it("includes pre-releases with --pre", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/bar", "1.0.0", { name: "bar" });
		addPackage(adapter, "github.com/foo/bar", "2.0.0-beta.1", { name: "bar" });
		adapter.availableTags.set("foo/bar", ["v1.0.0", "v2.0.0-beta.1"]);
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/bar", version: "1.0.0" }],
			{ paths: cachePaths, adapter },
		);

		const r = await runUpdate(rootDir, ["github.com/foo/bar"], {
			paths: cachePaths,
			adapter,
			includePre: true,
		});
		expect(r.changes[0]?.to).toBe("2.0.0-beta.1");
	});

	it("noop when already at latest", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/bar", "1.2.0", { name: "bar" });
		adapter.availableTags.set("foo/bar", ["v1.0.0", "v1.1.0", "v1.2.0"]);
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/bar", version: "1.2.0" }],
			{ paths: cachePaths, adapter },
		);

		const r = await runUpdate(rootDir, ["github.com/foo/bar"], {
			paths: cachePaths,
			adapter,
		});
		expect(r.changes).toEqual([]);
		expect(r.upToDate).toEqual(["github.com/foo/bar"]);
		expect(r.install.installed).toBe(0);
	});

	it("updates dev_deps", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/test_only", "1.0.0", {
			name: "test_only",
		});
		addPackage(adapter, "github.com/foo/test_only", "1.1.0", {
			name: "test_only",
		});
		adapter.availableTags.set("foo/test_only", ["v1.0.0", "v1.1.0"]);
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/test_only", version: "1.0.0" }],
			{ dev: true, paths: cachePaths, adapter },
		);

		const r = await runUpdate(rootDir, undefined, {
			paths: cachePaths,
			adapter,
		});
		expect(r.changes[0]?.foundIn).toBe("dev_deps");
		const manifest = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		const m = parseManifest(manifest, "moraga.esp");
		expect(m.ok).toBe(true);
		if (m.ok) {
			expect(m.manifest.devDeps.get("github.com/foo/test_only")?.version).toBe(
				"1.1.0",
			);
		}
	});

	it("preserves alias when updating extended dep", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/json", "1.0.0", { name: "json" });
		addPackage(adapter, "github.com/foo/json", "1.1.0", { name: "json" });
		adapter.availableTags.set("foo/json", ["v1.0.0", "v1.1.0"]);
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/json", version: "1.0.0", alias: "json_v1" }],
			{ paths: cachePaths, adapter },
		);

		const r = await runUpdate(rootDir, undefined, {
			paths: cachePaths,
			adapter,
		});
		expect(r.changes.length).toBe(1);
		const manifest = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		const m = parseManifest(manifest, "moraga.esp");
		expect(m.ok).toBe(true);
		if (m.ok) {
			const spec = m.manifest.deps.get("github.com/foo/json");
			expect(spec?.version).toBe("1.1.0");
			expect(spec?.alias).toBe("json_v1");
		}
	});
});

describe("runUpdate — error cases", () => {
	it("errors when no semver tags found", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/bar", "1.0.0", { name: "bar" });
		adapter.availableTags.set("foo/bar", ["release-1", "wip"]);
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/bar", version: "1.0.0" }],
			{ paths: cachePaths, adapter },
		);

		await expect(
			runUpdate(rootDir, ["github.com/foo/bar"], {
				paths: cachePaths,
				adapter,
			}),
		).rejects.toThrow(UpdateError);
	});
});

describe("runUpdate — atomicity and rollback", () => {
	it("rolls back when install fails post-write", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/bar", "1.0.0", { name: "bar" });
		adapter.availableTags.set("foo/bar", ["v1.0.0", "v1.1.0"]);
		// Provide tag pointer for v1.1.0 but a tarball that does NOT contain moraga.esp
		const brokenSha = nextSha();
		adapter.tags.set("foo/bar|v1.1.0", brokenSha);
		const brokenTarball = makeTarball("foo-bar-1.1.0", {
			"README.md": "no moraga.esp here",
		});
		adapter.tarballs.set(brokenSha, brokenTarball);

		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/bar", version: "1.0.0" }],
			{ paths: cachePaths, adapter },
		);
		const original = readFileSync(join(rootDir, "moraga.esp"), "utf8");

		await expect(
			runUpdate(rootDir, ["github.com/foo/bar"], {
				paths: cachePaths,
				adapter,
			}),
		).rejects.toThrow();

		const after = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		expect(after).toBe(original);
	});
});
