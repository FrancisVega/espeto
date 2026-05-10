import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { type HostAdapter, MoragaFetchError } from "../src/moraga/fetch";
import {
	formatJson,
	formatText,
	OutdatedError,
	runOutdated,
	totalOutdated,
} from "../src/moraga/outdated";

const tmps: string[] = [];

afterEach(() => {
	while (tmps.length > 0) {
		const d = tmps.pop();
		if (d) spawnSync("rm", ["-rf", d]);
	}
});

function mkTmp(prefix = "moraga-outdated-test-"): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	tmps.push(d);
	return d;
}

class FakeAdapter implements HostAdapter {
	readonly host = "github.com";
	readonly availableTags = new Map<string, string[]>();
	readonly errorOn = new Set<string>();

	async resolveSha(): Promise<string> {
		throw new MoragaFetchError("not_found", "unused");
	}

	async downloadTarball(): Promise<Readable> {
		throw new MoragaFetchError("not_found", "unused");
	}

	async listTags(repoPath: string): Promise<string[]> {
		if (this.errorOn.has(repoPath)) {
			throw new MoragaFetchError("network", "offline");
		}
		return this.availableTags.get(repoPath) ?? [];
	}
}

function setupRoot(opts: {
	deps?: Record<string, string>;
	devDeps?: Record<string, string>;
}): string {
	const fmtMap = (m?: Record<string, string>): string => {
		if (!m || Object.keys(m).length === 0) return "{}";
		const entries = Object.entries(m).map(
			([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`,
		);
		return `{\n${entries.join(",\n")}\n  }`;
	};
	const src = `{
  "name": "myapp",
  "version": "0.1.0",
  "espeto": ">= 0.1.0",
  "deps": ${fmtMap(opts.deps)},
  "dev_deps": ${fmtMap(opts.devDeps)}
}
`;
	const rootDir = mkTmp("moraga-outdated-root-");
	writeFileSync(join(rootDir, "moraga.esp"), src);
	return rootDir;
}

describe("runOutdated", () => {
	it("returns empty when manifest has no deps", async () => {
		const rootDir = setupRoot({});
		const adapter = new FakeAdapter();
		const r = await runOutdated(rootDir, { adapter });
		expect(r.deps).toEqual([]);
		expect(r.devDeps).toEqual([]);
	});

	it("returns empty when all deps at latest", async () => {
		const rootDir = setupRoot({
			deps: { "github.com/foo/bar": "1.2.0" },
		});
		const adapter = new FakeAdapter();
		adapter.availableTags.set("foo/bar", ["v1.0.0", "v1.1.0", "v1.2.0"]);
		const r = await runOutdated(rootDir, { adapter });
		expect(r.deps).toEqual([]);
	});

	it("lists outdated deps with gap classification", async () => {
		const rootDir = setupRoot({
			deps: {
				"github.com/foo/major": "1.0.0",
				"github.com/foo/minor": "1.0.0",
				"github.com/foo/patch": "1.0.0",
			},
		});
		const adapter = new FakeAdapter();
		adapter.availableTags.set("foo/major", ["v1.0.0", "v2.0.0"]);
		adapter.availableTags.set("foo/minor", ["v1.0.0", "v1.5.0"]);
		adapter.availableTags.set("foo/patch", ["v1.0.0", "v1.0.5"]);
		const r = await runOutdated(rootDir, { adapter });
		const byUrl = Object.fromEntries(r.deps.map((e) => [e.url, e]));
		expect(byUrl["github.com/foo/major"]?.gap).toBe("major");
		expect(byUrl["github.com/foo/minor"]?.gap).toBe("minor");
		expect(byUrl["github.com/foo/patch"]?.gap).toBe("patch");
	});

	it("separates deps and dev_deps", async () => {
		const rootDir = setupRoot({
			deps: { "github.com/foo/runtime": "1.0.0" },
			devDeps: { "github.com/foo/lint": "0.5.0" },
		});
		const adapter = new FakeAdapter();
		adapter.availableTags.set("foo/runtime", ["v1.0.0", "v1.1.0"]);
		adapter.availableTags.set("foo/lint", ["v0.5.0", "v1.0.0"]);
		const r = await runOutdated(rootDir, { adapter });
		expect(r.deps.map((e) => e.url)).toEqual(["github.com/foo/runtime"]);
		expect(r.devDeps.map((e) => e.url)).toEqual(["github.com/foo/lint"]);
		expect(r.devDeps[0]?.gap).toBe("major");
	});

	it("excludes pre-releases by default", async () => {
		const rootDir = setupRoot({
			deps: { "github.com/foo/bar": "1.0.0" },
		});
		const adapter = new FakeAdapter();
		adapter.availableTags.set("foo/bar", ["v1.0.0", "v2.0.0-beta.1"]);
		const r = await runOutdated(rootDir, { adapter });
		expect(r.deps).toEqual([]);
	});

	it("includes pre-releases with includePre", async () => {
		const rootDir = setupRoot({
			deps: { "github.com/foo/bar": "1.0.0" },
		});
		const adapter = new FakeAdapter();
		adapter.availableTags.set("foo/bar", ["v1.0.0", "v2.0.0-beta.1"]);
		const r = await runOutdated(rootDir, { adapter, includePre: true });
		expect(r.deps[0]?.latest).toBe("2.0.0-beta.1");
	});

	it("propagates network errors (offline = hard error)", async () => {
		const rootDir = setupRoot({
			deps: { "github.com/foo/bar": "1.0.0" },
		});
		const adapter = new FakeAdapter();
		adapter.errorOn.add("foo/bar");
		await expect(runOutdated(rootDir, { adapter })).rejects.toThrow();
	});

	it("rejects missing manifest", async () => {
		const rootDir = mkTmp();
		await expect(runOutdated(rootDir)).rejects.toThrow(OutdatedError);
	});
});

describe("formatText", () => {
	it("returns 'all packages at latest' when nothing outdated", () => {
		const out = formatText({ deps: [], devDeps: [] });
		expect(out).toBe("all packages at latest\n");
	});

	it("renders aligned columns with gap labels", () => {
		const out = formatText({
			deps: [
				{
					url: "github.com/foo/bar",
					current: "1.0.0",
					latest: "1.2.0",
					gap: "minor",
				},
			],
			devDeps: [],
		});
		expect(out).toContain("deps:");
		expect(out).toContain("github.com/foo/bar");
		expect(out).toContain("1.0.0");
		expect(out).toContain("→");
		expect(out).toContain("1.2.0");
		expect(out).toContain("(minor)");
	});

	it("includes both sections when both have entries", () => {
		const out = formatText({
			deps: [
				{
					url: "github.com/a/x",
					current: "1.0.0",
					latest: "1.1.0",
					gap: "minor",
				},
			],
			devDeps: [
				{
					url: "github.com/b/y",
					current: "0.5.0",
					latest: "1.0.0",
					gap: "major",
				},
			],
		});
		expect(out).toContain("deps:");
		expect(out).toContain("dev_deps:");
	});
});

describe("formatJson", () => {
	it("emits valid JSON", () => {
		const r = {
			deps: [
				{
					url: "github.com/foo/bar",
					current: "1.0.0",
					latest: "1.2.0",
					gap: "minor" as const,
				},
			],
			devDeps: [],
		};
		const out = formatJson(r);
		expect(JSON.parse(out)).toEqual(r);
	});
});

describe("totalOutdated", () => {
	it("counts entries in both sections", () => {
		expect(
			totalOutdated({
				deps: [
					{
						url: "github.com/a/x",
						current: "1.0.0",
						latest: "1.1.0",
						gap: "minor",
					},
				],
				devDeps: [
					{
						url: "github.com/b/y",
						current: "0.5.0",
						latest: "1.0.0",
						gap: "major",
					},
				],
			}),
		).toBe(2);
		expect(totalOutdated({ deps: [], devDeps: [] })).toBe(0);
	});
});
