import { spawnSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
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
import { LinkError, runLink } from "../src/moraga/link";
import { parseLocal } from "../src/moraga/local";
import { parseManifest } from "../src/moraga/manifest";

const tmps: string[] = [];

afterEach(() => {
	while (tmps.length > 0) {
		const d = tmps.pop();
		if (d) spawnSync("rm", ["-rf", d]);
	}
});

function mkTmp(prefix = "moraga-link-test-"): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	tmps.push(d);
	return d;
}

function paths(): CachePaths {
	const root = mkTmp("moraga-link-cache-");
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
	depsRaw?: string;
}): string {
	const name = opts.name ?? "myapp";
	const fmtMap = (m?: Record<string, string>): string => {
		if (!m || Object.keys(m).length === 0) return "{}";
		const entries = Object.entries(m).map(
			([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`,
		);
		return `{\n${entries.join(",\n")}\n  }`;
	};
	const depsField = opts.depsRaw ?? fmtMap(opts.deps);
	return `{
  "name": ${JSON.stringify(name)},
  "version": "0.1.0",
  "espeto": ">= 0.1.0",
  "deps": ${depsField},
  "dev_deps": ${fmtMap(opts.devDeps)}
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

function setupRoot(manifestSrc: string): {
	rootDir: string;
	cachePaths: CachePaths;
} {
	const rootDir = mkTmp("moraga-link-root-");
	writeFileSync(join(rootDir, "moraga.esp"), manifestSrc);
	return { rootDir, cachePaths: paths() };
}

function setupLinkedPackage(opts: {
	name: string;
	deps?: Record<string, string>;
	version?: string;
}): string {
	const dir = mkTmp(`moraga-link-pkg-${opts.name}-`);
	writeFileSync(
		join(dir, "moraga.esp"),
		makeManifestSrc({
			name: opts.name,
			deps: opts.deps,
		}),
	);
	writeFileSync(
		join(dir, `${opts.name}.esp`),
		`def hello() do\n  "${opts.name} (linked)"\nend\n`,
	);
	return dir;
}

beforeEach(() => {
	shaCounter = 0;
});

describe("runLink — validation", () => {
	it("rejects invalid url", async () => {
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await expect(
			runLink(rootDir, "not-a-url", "../x", {
				paths: cachePaths,
				adapter: new FakeAdapter(),
			}),
		).rejects.toThrow(LinkError);
	});

	it("rejects empty path", async () => {
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await expect(
			runLink(rootDir, "github.com/foo/bar", "", {
				paths: cachePaths,
				adapter: new FakeAdapter(),
			}),
		).rejects.toThrow(/path must not be empty/);
	});

	it("rejects when no moraga.esp", async () => {
		const rootDir = mkTmp();
		await expect(
			runLink(rootDir, "github.com/foo/bar", "../x"),
		).rejects.toThrow(/no moraga\.esp/);
	});

	it("rejects when url is not in deps or dev_deps", async () => {
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		const linkedDir = setupLinkedPackage({ name: "bar" });
		await expect(
			runLink(rootDir, "github.com/foo/bar", linkedDir, {
				paths: cachePaths,
				adapter: new FakeAdapter(),
			}),
		).rejects.toThrow(/not in deps or dev_deps/);
	});

	it("rejects when path does not exist", async () => {
		const { rootDir, cachePaths } = setupRoot(
			makeManifestSrc({ deps: { "github.com/foo/bar": "1.0.0" } }),
		);
		await expect(
			runLink(rootDir, "github.com/foo/bar", "/no/such/path", {
				paths: cachePaths,
				adapter: new FakeAdapter(),
			}),
		).rejects.toThrow(/link path not found/);
	});

	it("rejects when path is not a package (no moraga.esp)", async () => {
		const { rootDir, cachePaths } = setupRoot(
			makeManifestSrc({ deps: { "github.com/foo/bar": "1.0.0" } }),
		);
		const emptyDir = mkTmp("moraga-link-empty-");
		await expect(
			runLink(rootDir, "github.com/foo/bar", emptyDir, {
				paths: cachePaths,
				adapter: new FakeAdapter(),
			}),
		).rejects.toThrow(/missing.*moraga\.esp/);
	});

	it("rejects when linked package's moraga.esp is malformed", async () => {
		const { rootDir, cachePaths } = setupRoot(
			makeManifestSrc({ deps: { "github.com/foo/bar": "1.0.0" } }),
		);
		const dir = mkTmp("moraga-link-bad-");
		writeFileSync(join(dir, "moraga.esp"), "this is not valid");
		await expect(
			runLink(rootDir, "github.com/foo/bar", dir, {
				paths: cachePaths,
				adapter: new FakeAdapter(),
			}),
		).rejects.toThrow(/linked package's moraga\.esp is invalid/);
	});
});

describe("runLink — happy paths", () => {
	it("creates moraga.local.esp and symlinks .espetos/<name> to linked path", async () => {
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
		expect(existsSync(join(rootDir, ".espetos", "bar"))).toBe(true);
		const cachedTarget = readlinkSync(join(rootDir, ".espetos", "bar"));
		expect(cachedTarget).toContain(cachePaths.root);

		const linkedDir = setupLinkedPackage({ name: "bar" });
		const r = await runLink(rootDir, "github.com/foo/bar", linkedDir, {
			paths: cachePaths,
			adapter,
		});
		expect(r.changed).toBe(true);

		const localSrc = readFileSync(
			join(rootDir, "moraga.local.esp"),
			"utf8",
		);
		const lp = parseLocal(localSrc, "moraga.local.esp");
		expect(lp.ok).toBe(true);
		if (lp.ok) {
			expect(lp.local.links.get("github.com/foo/bar")).toBe(linkedDir);
		}

		expect(lstatSync(join(rootDir, ".espetos", "bar")).isSymbolicLink()).toBe(
			true,
		);
		const linkedTarget = readlinkSync(join(rootDir, ".espetos", "bar"));
		expect(linkedTarget).toBe(linkedDir);
	});

	it("preserves existing manifest when relinking is a no-op (same path)", async () => {
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
		const linkedDir = setupLinkedPackage({ name: "bar" });
		await runLink(rootDir, "github.com/foo/bar", linkedDir, {
			paths: cachePaths,
			adapter,
		});

		const localBefore = readFileSync(
			join(rootDir, "moraga.local.esp"),
			"utf8",
		);
		const r = await runLink(rootDir, "github.com/foo/bar", linkedDir, {
			paths: cachePaths,
			adapter,
		});
		expect(r.changed).toBe(false);
		const localAfter = readFileSync(
			join(rootDir, "moraga.local.esp"),
			"utf8",
		);
		expect(localAfter).toBe(localBefore);
	});

	it("errors if url is already linked to a different path", async () => {
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
		const linkedDir1 = setupLinkedPackage({ name: "bar" });
		const linkedDir2 = setupLinkedPackage({ name: "bar" });
		await runLink(rootDir, "github.com/foo/bar", linkedDir1, {
			paths: cachePaths,
			adapter,
		});
		await expect(
			runLink(rootDir, "github.com/foo/bar", linkedDir2, {
				paths: cachePaths,
				adapter,
			}),
		).rejects.toThrow(/already linked to/);
	});

	it("works for url in dev_deps", async () => {
		const adapter = new FakeAdapter();
		addPackageToAdapter(adapter, "github.com/foo/test_only", "1.0.0", {
			name: "test_only",
		});
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[{ url: "github.com/foo/test_only", version: "1.0.0" }],
			{ dev: true, paths: cachePaths, adapter },
		);
		const linkedDir = setupLinkedPackage({ name: "test_only" });
		const r = await runLink(rootDir, "github.com/foo/test_only", linkedDir, {
			paths: cachePaths,
			adapter,
		});
		expect(r.changed).toBe(true);
		const target = readlinkSync(
			join(rootDir, ".espetos", "test_only"),
		);
		expect(target).toBe(linkedDir);
	});

	it("does not put linked package in moraga.lock", async () => {
		const adapter = new FakeAdapter();
		addPackageToAdapter(adapter, "github.com/foo/bar", "1.0.0", {
			name: "bar",
		});
		addPackageToAdapter(adapter, "github.com/foo/other", "2.0.0", {
			name: "other",
		});
		const { rootDir, cachePaths } = setupRoot(makeManifestSrc({}));
		await runAdd(
			rootDir,
			[
				{ url: "github.com/foo/bar", version: "1.0.0" },
				{ url: "github.com/foo/other", version: "2.0.0" },
			],
			{ paths: cachePaths, adapter },
		);
		const linkedDir = setupLinkedPackage({ name: "bar" });
		await runLink(rootDir, "github.com/foo/bar", linkedDir, {
			paths: cachePaths,
			adapter,
		});

		const lock = readFileSync(join(rootDir, "moraga.lock"), "utf8");
		expect(lock).not.toContain("github.com/foo/bar");
		expect(lock).toContain("github.com/foo/other");
	});

	it("supports relative paths (resolved from rootDir)", async () => {
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

		const siblingDir = join(rootDir, "..", "sibling-pkg");
		mkdirSync(siblingDir, { recursive: true });
		tmps.push(siblingDir);
		writeFileSync(
			join(siblingDir, "moraga.esp"),
			makeManifestSrc({ name: "bar" }),
		);
		writeFileSync(
			join(siblingDir, "bar.esp"),
			`def hello() do\n  "bar (linked relative)"\nend\n`,
		);

		const r = await runLink(rootDir, "github.com/foo/bar", "../sibling-pkg", {
			paths: cachePaths,
			adapter,
		});
		expect(r.changed).toBe(true);
		const localSrc = readFileSync(
			join(rootDir, "moraga.local.esp"),
			"utf8",
		);
		expect(localSrc).toContain("../sibling-pkg");
		expect(existsSync(join(rootDir, ".espetos", "bar"))).toBe(true);
	});
});

describe("runLink — rollback", () => {
	it("removes moraga.local.esp when it was created and install fails", async () => {
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

		const badDir = mkTmp("moraga-link-broken-");
		writeFileSync(
			join(badDir, "moraga.esp"),
			makeManifestSrc({
				name: "bar",
				depsRaw: `{"github.com/missing/pkg": "9.9.9"}`,
			}),
		);

		await expect(
			runLink(rootDir, "github.com/foo/bar", badDir, {
				paths: cachePaths,
				adapter,
			}),
		).rejects.toThrow();

		expect(existsSync(join(rootDir, "moraga.local.esp"))).toBe(false);
	});

	it("restores prior moraga.local.esp content when install fails", async () => {
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

		const linkedA = setupLinkedPackage({ name: "a" });
		await runLink(rootDir, "github.com/foo/a", linkedA, {
			paths: cachePaths,
			adapter,
		});
		const before = readFileSync(
			join(rootDir, "moraga.local.esp"),
			"utf8",
		);

		const badB = mkTmp("moraga-link-broken-b-");
		writeFileSync(
			join(badB, "moraga.esp"),
			makeManifestSrc({
				name: "b",
				depsRaw: `{"github.com/missing/pkg": "9.9.9"}`,
			}),
		);

		await expect(
			runLink(rootDir, "github.com/foo/b", badB, {
				paths: cachePaths,
				adapter,
			}),
		).rejects.toThrow();

		const after = readFileSync(
			join(rootDir, "moraga.local.esp"),
			"utf8",
		);
		expect(after).toBe(before);
	});
});

describe("runLink — preserves manifest unchanged", () => {
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
		const before = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		const linkedDir = setupLinkedPackage({ name: "bar" });
		await runLink(rootDir, "github.com/foo/bar", linkedDir, {
			paths: cachePaths,
			adapter,
		});
		const after = readFileSync(join(rootDir, "moraga.esp"), "utf8");
		expect(after).toBe(before);
		const m = parseManifest(after, "moraga.esp");
		expect(m.ok).toBe(true);
	});
});
