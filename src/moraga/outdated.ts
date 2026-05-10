import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type AdapterOptions,
	type HostAdapter,
	getAdapter,
} from "./fetch";
import { parseManifest } from "./manifest";
import { parsePackageUrl } from "./resolve";
import { compareSemver, parseSemver } from "./semver";
import { pickLatest } from "./update";

export class OutdatedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OutdatedError";
	}
}

export type Gap = "major" | "minor" | "patch" | "pre";

export type OutdatedEntry = {
	url: string;
	current: string;
	latest: string;
	gap: Gap;
};

export type OutdatedOptions = {
	fetchOpts?: AdapterOptions;
	adapter?: HostAdapter;
	includePre?: boolean;
};

export type OutdatedResult = {
	deps: OutdatedEntry[];
	devDeps: OutdatedEntry[];
};

export async function runOutdated(
	rootDir: string,
	opts: OutdatedOptions = {},
): Promise<OutdatedResult> {
	const manifestPath = join(rootDir, "moraga.esp");
	if (!existsSync(manifestPath)) {
		throw new OutdatedError(`no moraga.esp found in ${rootDir}`);
	}

	const src = await readFile(manifestPath, "utf8");
	const r = parseManifest(src, manifestPath);
	if (!r.ok) {
		const lines = r.errors.map((e) => `  - ${e.message}`).join("\n");
		throw new OutdatedError(`moraga.esp has errors:\n${lines}`);
	}
	const manifest = r.manifest;
	const includePre = opts.includePre ?? false;

	const deps = await checkAll(manifest.deps, includePre, opts);
	const devDeps = await checkAll(manifest.devDeps, includePre, opts);
	return { deps, devDeps };
}

async function checkAll(
	map: Map<string, { version: string }>,
	includePre: boolean,
	opts: OutdatedOptions,
): Promise<OutdatedEntry[]> {
	const out: OutdatedEntry[] = [];
	for (const [url, spec] of map) {
		const latest = await fetchLatest(url, includePre, opts);
		if (latest === null) continue;
		if (compareSemver(latest, spec.version) <= 0) continue;
		out.push({
			url,
			current: spec.version,
			latest,
			gap: classifyGap(spec.version, latest),
		});
	}
	return out;
}

async function fetchLatest(
	url: string,
	includePre: boolean,
	opts: OutdatedOptions,
): Promise<string | null> {
	const { host, path } = parsePackageUrl(url);
	const adapter = opts.adapter ?? getAdapter(host, opts.fetchOpts ?? {});
	const tags = await adapter.listTags(path);
	return pickLatest(tags, includePre);
}

function classifyGap(current: string, latest: string): Gap {
	const a = parseSemver(current);
	const b = parseSemver(latest);
	if (!a || !b) return "pre";
	if (b.major !== a.major) return "major";
	if (b.minor !== a.minor) return "minor";
	if (b.patch !== a.patch) return "patch";
	return "pre";
}

export function formatText(result: OutdatedResult): string {
	const total = result.deps.length + result.devDeps.length;
	if (total === 0) return "all packages at latest\n";

	const lines: string[] = [];
	const sections: Array<{ title: string; entries: OutdatedEntry[] }> = [
		{ title: "deps", entries: result.deps },
		{ title: "dev_deps", entries: result.devDeps },
	];
	const allEntries = [...result.deps, ...result.devDeps];
	const widestUrl = Math.max(...allEntries.map((e) => e.url.length));
	const widestCurrent = Math.max(...allEntries.map((e) => e.current.length));
	const widestLatest = Math.max(...allEntries.map((e) => e.latest.length));

	for (const s of sections) {
		if (s.entries.length === 0) continue;
		lines.push(`${s.title}:`);
		for (const e of s.entries) {
			const padUrl = " ".repeat(widestUrl - e.url.length);
			const padCur = " ".repeat(widestCurrent - e.current.length);
			const padLat = " ".repeat(widestLatest - e.latest.length);
			lines.push(
				`  ${e.url}${padUrl}  ${e.current}${padCur}  →  ${e.latest}${padLat}   (${e.gap})`,
			);
		}
	}
	return `${lines.join("\n")}\n`;
}

export function formatJson(result: OutdatedResult): string {
	return `${JSON.stringify(result, null, 2)}\n`;
}

export function totalOutdated(result: OutdatedResult): number {
	return result.deps.length + result.devDeps.length;
}
