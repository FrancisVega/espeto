import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync,
	readdirSync,
	mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CachePaths } from "../src/moraga/cache";
import { type HostAdapter, MoragaFetchError } from "../src/moraga/fetch";
import { install, InstallError } from "../src/moraga/install";
import { parseLock } from "../src/moraga/lock";

const tmps: string[] = [];

afterEach(() => {
	while (tmps.length > 0) {
		const d = tmps.pop();
		if (d) spawnSync("rm", ["-rf", d]);
	}
});

function mkTmp(prefix = "moraga-install-test-"): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	tmps.push(d);
	return d;
}

function paths(): CachePaths {
	const root = mkTmp("moraga-install-cache-");
	return { root, tmpRoot: join(root, ".tmp") };
}

class FakeAdapter implements HostAdapter {
	readonly host = "github.com";
	readonly tags = new Map<string, string>();
	readonly tarballs = new Map<string, Buffer>();
	resolveCalls: Array<{ repoPath: string; ref: string }> = [];
	downloadCalls: Array<{ repoPath: string; sha: string }> = [];

	async resolveSha(repoPath: string, ref: string): Promise<string> {
		this.resolveCalls.push({ repoPath, ref });
		const key = `${repoPath}|${ref}`;
		const sha = this.tags.get(key);
		if (!sha) {
			throw new MoragaFetchError("not_found", `no such tag ${key}`);
		}
		return sha;
	}

	async downloadTarball(repoPath: string, sha: string): Promise<Readable> {
		this.downloadCalls.push({ repoPath, sha });
		const buf = this.tarballs.get(sha);
		if (!buf) {
			throw new MoragaFetchError("not_found", `no such sha ${sha}`);
		}
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

function makeManifest(opts: {
	name: string;
	version?: string;
	espeto?: string;
	deps?: Record<string, string | { version: string; as?: string }>;
	devDeps?: Record<string, string | { version: string; as?: string }>;
	overrides?: Record<string, string>;
}): string {
	const v = opts.version ?? "1.0.0";
	const e = opts.espeto ?? ">= 0.1.0";
	const fmtDep = (d: string | { version: string; as?: string }): string => {
		if (typeof d === "string") return JSON.stringify(d);
		if (d.as) return `{"version": ${JSON.stringify(d.version)}, "as": ${JSON.stringify(d.as)}}`;
		return `{"version": ${JSON.stringify(d.version)}}`;
	};
	const fmtMap = (m?: Record<string, string | { version: string; as?: string }>): string => {
		if (!m || Object.keys(m).length === 0) return "{}";
		const entries = Object.entries(m).map(
			([k, v]) => `${JSON.stringify(k)}: ${fmtDep(v)}`,
		);
		return `{\n    ${entries.join(",\n    ")}\n  }`;
	};
	const fmtOverrides = (m?: Record<string, string>): string => {
		if (!m || Object.keys(m).length === 0) return "";
		const entries = Object.entries(m).map(
			([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`,
		);
		return `,\n  "overrides": {\n${entries.join(",\n")}\n  }`;
	};
	return `{
  "name": ${JSON.stringify(opts.name)},
  "version": ${JSON.stringify(v)},
  "espeto": ${JSON.stringify(e)},
  "deps": ${fmtMap(opts.deps)},
  "dev_deps": ${fmtMap(opts.devDeps)}${fmtOverrides(opts.overrides)}
}`;
}

function addPackage(
	adapter: FakeAdapter,
	url: string,
	version: string,
	manifest: { name: string; deps?: Record<string, string | { version: string; as?: string }>; espeto?: string },
	extraFiles: Record<string, string> = {},
): string {
	const sha = nextSha();
	const repoPath = url.replace(/^github\.com\//, "");
	const wrapperDir = `${repoPath.replace(/\//g, "-")}-${version}`;
	const moragaSrc = makeManifest({
		name: manifest.name,
		version,
		espeto: manifest.espeto,
		deps: manifest.deps,
	});
	const entrypoint = `def hello() do\n  "${manifest.name}"\nend\n`;
	const files: Record<string, string> = {
		"moraga.esp": moragaSrc,
		[`${manifest.name}.esp`]: entrypoint,
		...extraFiles,
	};
	const tarball = makeTarball(wrapperDir, files);
	adapter.tags.set(`${repoPath}|v${version}`, sha);
	adapter.tarballs.set(sha, tarball);
	return sha;
}

function makeTarball(wrapperDir: string, files: Record<string, string>): Buffer {
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
		throw new Error(`failed to build tarball fixture: ${r.stderr.toString()}`);
	}
	return readFileSync(tarballPath);
}

function setupRoot(
	manifestSrc: string,
	lockSrc?: string,
): { rootDir: string; cachePaths: CachePaths } {
	const rootDir = mkTmp("moraga-install-root-");
	writeFileSync(join(rootDir, "moraga.esp"), manifestSrc);
	if (lockSrc !== undefined) {
		writeFileSync(join(rootDir, "moraga.lock"), lockSrc);
	}
	return { rootDir, cachePaths: paths() };
}

beforeEach(() => {
	shaCounter = 0;
});

describe("install — happy paths", () => {
	it("installs nothing when deps is empty", async () => {
		const { rootDir, cachePaths } = setupRoot(makeManifest({ name: "myapp" }));
		const adapter = new FakeAdapter();
		const r = await install(rootDir, { paths: cachePaths, adapter });
		expect(r.installed).toBe(0);
		expect(adapter.downloadCalls.length).toBe(0);
		expect(existsSync(join(rootDir, ".espetos"))).toBe(true);
		expect(readdirSync(join(rootDir, ".espetos"))).toEqual([]);
		expect(existsSync(join(rootDir, "moraga.lock"))).toBe(true);
	});

	it("installs a single direct dep into .espetos/", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/ansi", "1.0.0", { name: "ansi" });
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: { "github.com/foo/ansi": "1.0.0" },
			}),
		);
		const r = await install(rootDir, { paths: cachePaths, adapter });
		expect(r.installed).toBe(1);
		const linkPath = join(rootDir, ".espetos", "ansi");
		expect(existsSync(linkPath)).toBe(true);
		expect(existsSync(join(linkPath, "ansi.esp"))).toBe(true);
		expect(existsSync(join(linkPath, "moraga.esp"))).toBe(true);
	});

	it("installs transitive deps via BFS", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/ansi", "1.0.0", {
			name: "ansi",
			deps: { "github.com/foo/json": "2.0.0" },
		});
		addPackage(adapter, "github.com/foo/json", "2.0.0", { name: "json" });
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: { "github.com/foo/ansi": "1.0.0" },
			}),
		);
		const r = await install(rootDir, { paths: cachePaths, adapter });
		expect(r.installed).toBe(2);
		expect(existsSync(join(rootDir, ".espetos", "ansi"))).toBe(true);
		expect(existsSync(join(rootDir, ".espetos", "json"))).toBe(true);
	});

	it("writes a deterministic, alphabetical lock file", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/zebra", "1.0.0", { name: "zebra" });
		addPackage(adapter, "github.com/foo/ansi", "1.0.0", { name: "ansi" });
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: {
					"github.com/foo/zebra": "1.0.0",
					"github.com/foo/ansi": "1.0.0",
				},
			}),
		);
		await install(rootDir, { paths: cachePaths, adapter });
		const lockSrc = readFileSync(join(rootDir, "moraga.lock"), "utf8");
		const ansiIdx = lockSrc.indexOf('"github.com/foo/ansi"');
		const zebraIdx = lockSrc.indexOf('"github.com/foo/zebra"');
		expect(ansiIdx).toBeGreaterThan(0);
		expect(zebraIdx).toBeGreaterThan(ansiIdx);
	});

	it("installs root dev_deps but not transitive dev_deps", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/ansi", "1.0.0", {
			name: "ansi",
			deps: { "github.com/foo/json": "2.0.0" },
		});
		addPackage(adapter, "github.com/foo/json", "2.0.0", { name: "json" });
		addPackage(adapter, "github.com/foo/test_only", "1.0.0", {
			name: "test_only",
		});
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: { "github.com/foo/ansi": "1.0.0" },
				devDeps: { "github.com/foo/test_only": "1.0.0" },
			}),
		);
		const r = await install(rootDir, { paths: cachePaths, adapter });
		expect(r.installed).toBe(3);
		expect(existsSync(join(rootDir, ".espetos", "test_only"))).toBe(true);
	});
});

describe("install — lock states", () => {
	it("(b) reuses lock SHA when manifest matches — no resolveSha calls", async () => {
		const adapter = new FakeAdapter();
		const sha = addPackage(adapter, "github.com/foo/ansi", "1.0.0", {
			name: "ansi",
		});
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: { "github.com/foo/ansi": "1.0.0" },
			}),
		);
		await install(rootDir, { paths: cachePaths, adapter });

		const before = adapter.resolveCalls.length;
		const adapter2 = new FakeAdapter();
		// Re-prime tarballs only (no tags), so resolveSha would FAIL if called
		adapter2.tarballs.set(sha, adapter.tarballs.get(sha)!);
		await install(rootDir, { paths: cachePaths, adapter: adapter2 });
		expect(adapter2.resolveCalls.length).toBe(0);
		expect(before).toBeGreaterThan(0);
	});

	it("(c) adds new dep to existing lock without re-resolving old ones", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/ansi", "1.0.0", { name: "ansi" });
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: { "github.com/foo/ansi": "1.0.0" },
			}),
		);
		await install(rootDir, { paths: cachePaths, adapter });
		const calls1 = adapter.resolveCalls.length;

		// Add a new dep to manifest
		addPackage(adapter, "github.com/foo/json", "2.0.0", { name: "json" });
		writeFileSync(
			join(rootDir, "moraga.esp"),
			makeManifest({
				name: "myapp",
				deps: {
					"github.com/foo/ansi": "1.0.0",
					"github.com/foo/json": "2.0.0",
				},
			}),
		);
		await install(rootDir, { paths: cachePaths, adapter });
		const newCalls = adapter.resolveCalls.slice(calls1);
		// Only the new dep should have been resolved
		expect(newCalls.length).toBe(1);
		expect(newCalls[0]!.repoPath).toBe("foo/json");
	});

	it("(d) prunes lock entries when dep removed from manifest", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/ansi", "1.0.0", { name: "ansi" });
		addPackage(adapter, "github.com/foo/json", "2.0.0", { name: "json" });
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: {
					"github.com/foo/ansi": "1.0.0",
					"github.com/foo/json": "2.0.0",
				},
			}),
		);
		await install(rootDir, { paths: cachePaths, adapter });
		expect(existsSync(join(rootDir, ".espetos", "json"))).toBe(true);

		writeFileSync(
			join(rootDir, "moraga.esp"),
			makeManifest({
				name: "myapp",
				deps: { "github.com/foo/ansi": "1.0.0" },
			}),
		);
		await install(rootDir, { paths: cachePaths, adapter });
		const lockSrc = readFileSync(join(rootDir, "moraga.lock"), "utf8");
		expect(lockSrc).not.toContain("github.com/foo/json");
		expect(existsSync(join(rootDir, ".espetos", "json"))).toBe(false);
	});

	it("(f) errors on checksum mismatch (corrupted lock)", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/ansi", "1.0.0", { name: "ansi" });
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: { "github.com/foo/ansi": "1.0.0" },
			}),
		);
		await install(rootDir, { paths: cachePaths, adapter });

		// Corrupt the lock's checksum
		const lockSrc = readFileSync(join(rootDir, "moraga.lock"), "utf8");
		const corrupted = lockSrc.replace(
			/"checksum": "h1:[0-9a-f]+"/,
			'"checksum": "h1:' + "f".repeat(64) + '"',
		);
		writeFileSync(join(rootDir, "moraga.lock"), corrupted);

		// Wipe disk cache so it has to redownload (otherwise the cache hit recomputes from disk)
		spawnSync("rm", ["-rf", cachePaths.root]);

		await expect(
			install(rootDir, { paths: cachePaths, adapter }),
		).rejects.toThrow(/checksum mismatch/);
	});
});

describe("install — conflicts and overrides", () => {
	it("errors on transitive version conflict", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/a", "1.0.0", {
			name: "a",
			deps: { "github.com/foo/json": "1.0.0" },
		});
		addPackage(adapter, "github.com/foo/b", "1.0.0", {
			name: "b",
			deps: { "github.com/foo/json": "2.0.0" },
		});
		addPackage(adapter, "github.com/foo/json", "1.0.0", { name: "json" });
		addPackage(adapter, "github.com/foo/json", "2.0.0", { name: "json" });
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: {
					"github.com/foo/a": "1.0.0",
					"github.com/foo/b": "1.0.0",
				},
			}),
		);
		await expect(
			install(rootDir, { paths: cachePaths, adapter }),
		).rejects.toThrow(/version conflict for github\.com\/foo\/json/);
	});

	it("override pisa antes de detectar conflicto", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/a", "1.0.0", {
			name: "a",
			deps: { "github.com/foo/json": "1.0.0" },
		});
		addPackage(adapter, "github.com/foo/b", "1.0.0", {
			name: "b",
			deps: { "github.com/foo/json": "2.0.0" },
		});
		addPackage(adapter, "github.com/foo/json", "3.0.0", { name: "json" });
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: {
					"github.com/foo/a": "1.0.0",
					"github.com/foo/b": "1.0.0",
				},
				overrides: { "github.com/foo/json": "3.0.0" },
			}),
		);
		const r = await install(rootDir, { paths: cachePaths, adapter });
		expect(r.installed).toBe(3);
		const lockSrc = readFileSync(join(rootDir, "moraga.lock"), "utf8");
		expect(lockSrc).toContain('"version": "3.0.0"');
	});
});

describe("install — aliasing", () => {
	it("creates alias dir with renamed entrypoint and symlinks", async () => {
		const adapter = new FakeAdapter();
		addPackage(
			adapter,
			"github.com/foo/json",
			"1.0.0",
			{ name: "json" },
			{ "lib/util.esp": "def util_fn() do\n  1\nend\n" },
		);
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: {
					"github.com/foo/json": { version: "1.0.0", as: "my_json" },
				},
			}),
		);
		await install(rootDir, { paths: cachePaths, adapter });
		const aliasDir = join(rootDir, ".espetos", "my_json");
		expect(existsSync(aliasDir)).toBe(true);
		expect(statSync(aliasDir).isDirectory()).toBe(true);
		// Entrypoint renamed to alias
		expect(existsSync(join(aliasDir, "my_json.esp"))).toBe(true);
		// Original entrypoint name does NOT exist as alias-claim
		expect(existsSync(join(aliasDir, "json.esp"))).toBe(false);
		// Other files preserved
		expect(existsSync(join(aliasDir, "moraga.esp"))).toBe(true);
		// Subdirs symlinked
		expect(existsSync(join(aliasDir, "lib", "util.esp"))).toBe(true);
		// Canonical .espetos/json/ NOT created (alias claims only alias)
		expect(existsSync(join(rootDir, ".espetos", "json"))).toBe(false);
	});

	it("rejects `as:` in transitive deps strictly", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/a", "1.0.0", {
			name: "a",
			deps: {
				"github.com/foo/json": { version: "1.0.0", as: "renamed_json" },
			},
		});
		addPackage(adapter, "github.com/foo/json", "1.0.0", { name: "json" });
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: { "github.com/foo/a": "1.0.0" },
			}),
		);
		await expect(
			install(rootDir, { paths: cachePaths, adapter }),
		).rejects.toThrow(/declares alias.*Aliases are only allowed in the root/);
	});

	it("errors when transitive needs canonical of a root-aliased package", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/a", "1.0.0", {
			name: "a",
			deps: { "github.com/foo/json": "1.0.0" },
		});
		addPackage(adapter, "github.com/foo/json", "1.0.0", { name: "json" });
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: {
					"github.com/foo/a": "1.0.0",
					"github.com/foo/json": { version: "1.0.0", as: "my_json" },
				},
			}),
		);
		await expect(
			install(rootDir, { paths: cachePaths, adapter }),
		).rejects.toThrow(/aliased.*Remove the alias/);
	});

	it("errors on canonical-name collision between unaliased deps", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/json", "1.0.0", { name: "json" });
		addPackage(adapter, "github.com/bar/json", "1.0.0", { name: "json" });
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: {
					"github.com/foo/json": "1.0.0",
					"github.com/bar/json": "1.0.0",
				},
			}),
		);
		await expect(
			install(rootDir, { paths: cachePaths, adapter }),
		).rejects.toThrow(/name collision in \.espetos\/: "json"/);
	});
});

describe("install — espeto compiler constraint", () => {
	it("errors when package requires newer espeto", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/ansi", "1.0.0", {
			name: "ansi",
			espeto: ">= 99.0.0",
		});
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: { "github.com/foo/ansi": "1.0.0" },
			}),
		);
		await expect(
			install(rootDir, { paths: cachePaths, adapter }),
		).rejects.toThrow(/requires espeto >= 99\.0\.0/);
	});

	it("errors on root manifest with too-old constraint", async () => {
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({ name: "myapp", espeto: ">= 99.0.0" }),
		);
		await expect(
			install(rootDir, { paths: cachePaths, adapter: new FakeAdapter() }),
		).rejects.toThrow(/moraga\.esp requires espeto >= 99\.0\.0/);
	});
});

describe("install — cleanup and error surfaces", () => {
	it("wipes stale .espetos/ on rebuild", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/ansi", "1.0.0", { name: "ansi" });
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: { "github.com/foo/ansi": "1.0.0" },
			}),
		);
		mkdirSync(join(rootDir, ".espetos"), { recursive: true });
		mkdirSync(join(rootDir, ".espetos", "stale"), { recursive: true });
		writeFileSync(join(rootDir, ".espetos", "stale", "stale.esp"), "");
		await install(rootDir, { paths: cachePaths, adapter });
		expect(existsSync(join(rootDir, ".espetos", "stale"))).toBe(false);
		expect(existsSync(join(rootDir, ".espetos", "ansi"))).toBe(true);
	});

	it("errors when a downloaded package has no moraga.esp", async () => {
		const adapter = new FakeAdapter();
		const repoPath = "foo/broken";
		const sha = nextSha();
		const tarball = makeTarball("broken-1.0.0", {
			"broken.esp": "def hi() do\n  1\nend\n",
		});
		adapter.tags.set(`${repoPath}|v1.0.0`, sha);
		adapter.tarballs.set(sha, tarball);
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: { "github.com/foo/broken": "1.0.0" },
			}),
		);
		await expect(
			install(rootDir, { paths: cachePaths, adapter }),
		).rejects.toThrow(/missing moraga\.esp/);
	});

	it("errors when moraga.esp is invalid", async () => {
		const { rootDir, cachePaths } = setupRoot("not a manifest");
		await expect(
			install(rootDir, { paths: cachePaths, adapter: new FakeAdapter() }),
		).rejects.toThrow(InstallError);
	});

	it("errors when no moraga.esp exists", async () => {
		const rootDir = mkTmp("moraga-no-manifest-");
		await expect(
			install(rootDir, { paths: paths(), adapter: new FakeAdapter() }),
		).rejects.toThrow(/no moraga\.esp found/);
	});
});

describe("install — lock parsing round-trip", () => {
	it("written lock parses back into same set of urls", async () => {
		const adapter = new FakeAdapter();
		addPackage(adapter, "github.com/foo/ansi", "1.0.0", {
			name: "ansi",
			deps: { "github.com/foo/json": "2.0.0" },
		});
		addPackage(adapter, "github.com/foo/json", "2.0.0", { name: "json" });
		const { rootDir, cachePaths } = setupRoot(
			makeManifest({
				name: "myapp",
				deps: { "github.com/foo/ansi": "1.0.0" },
			}),
		);
		await install(rootDir, { paths: cachePaths, adapter });
		const lockSrc = readFileSync(join(rootDir, "moraga.lock"), "utf8");
		const r = parseLock(lockSrc, "moraga.lock");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect([...r.lock.keys()].sort()).toEqual([
				"github.com/foo/ansi",
				"github.com/foo/json",
			]);
			expect(r.lock.get("github.com/foo/ansi")!.deps).toEqual([
				"github.com/foo/json",
			]);
		}
	});
});
