import { existsSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CachePaths } from "./cache";
import { EditError, setDepVersion } from "./edit";
import {
	type AdapterOptions,
	type HostAdapter,
	getAdapter,
} from "./fetch";
import { install, InstallError, type InstallResult } from "./install";
import { parseManifest, URL_PATTERN } from "./manifest";
import { parsePackageUrl } from "./resolve";
import { compareSemver, parseSemver } from "./semver";

export class UpdateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UpdateError";
	}
}

export type UpdateOptions = {
	fetchOpts?: AdapterOptions;
	paths?: CachePaths;
	adapter?: HostAdapter;
	includePre?: boolean;
};

export type UpdateChange = {
	url: string;
	from: string;
	to: string;
	foundIn: "deps" | "dev_deps";
};

export type UpdateResult = {
	changes: UpdateChange[];
	upToDate: string[];
	install: InstallResult | { installed: 0 };
};

export async function runUpdate(
	rootDir: string,
	urls: string[] | undefined,
	opts: UpdateOptions = {},
): Promise<UpdateResult> {
	const manifestPath = join(rootDir, "moraga.esp");
	if (!existsSync(manifestPath)) {
		throw new UpdateError(`no moraga.esp found in ${rootDir}`);
	}

	const original = await readFile(manifestPath, "utf8");
	const r = parseManifest(original, manifestPath);
	if (!r.ok) {
		const lines = r.errors.map((e) => `  - ${e.message}`).join("\n");
		throw new UpdateError(`moraga.esp has errors:\n${lines}`);
	}
	const manifest = r.manifest;

	let targets: string[];
	if (urls === undefined || urls.length === 0) {
		targets = [...manifest.deps.keys(), ...manifest.devDeps.keys()];
	} else {
		const seen = new Set<string>();
		for (const url of urls) {
			if (!URL_PATTERN.test(url)) {
				throw new UpdateError(
					`invalid package url "${url}": expected "<host>/<owner>/<repo>"`,
				);
			}
			if (seen.has(url)) {
				throw new UpdateError(
					`${url} appears more than once in this command — list each package only once`,
				);
			}
			seen.add(url);
			if (!manifest.deps.has(url) && !manifest.devDeps.has(url)) {
				throw new UpdateError(`${url} is not in deps or dev_deps`);
			}
		}
		targets = urls;
	}

	if (targets.length === 0) {
		return { changes: [], upToDate: [], install: { installed: 0 } };
	}

	const includePre = opts.includePre ?? false;
	const changes: UpdateChange[] = [];
	const upToDate: string[] = [];
	let nextSrc = original;

	for (const url of targets) {
		const inDeps = manifest.deps.get(url);
		const inDev = manifest.devDeps.get(url);
		const spec = inDeps ?? inDev;
		if (!spec) continue;
		const foundIn: "deps" | "dev_deps" = inDeps ? "deps" : "dev_deps";

		const latest = await fetchLatest(url, includePre, opts);
		if (latest === null) {
			throw new UpdateError(
				`no usable semver tags found for ${url}${includePre ? "" : " (use --pre to include pre-releases)"}`,
			);
		}

		const cmp = compareSemver(latest, spec.version);
		if (cmp <= 0) {
			upToDate.push(url);
			continue;
		}

		try {
			const r = setDepVersion(nextSrc, url, latest);
			if (r.changed) {
				nextSrc = r.source;
				changes.push({
					url,
					from: spec.version,
					to: latest,
					foundIn,
				});
			}
		} catch (e) {
			if (e instanceof EditError) {
				throw new UpdateError(e.message);
			}
			throw e;
		}
	}

	if (changes.length === 0) {
		return { changes: [], upToDate, install: { installed: 0 } };
	}

	const tmpPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(tmpPath, nextSrc, "utf8");
	try {
		await rename(tmpPath, manifestPath);
	} catch (e) {
		await unlink(tmpPath).catch(() => {});
		throw e;
	}

	try {
		const installResult = await install(rootDir, {
			fetchOpts: opts.fetchOpts,
			paths: opts.paths,
			adapter: opts.adapter,
		});
		return { changes, upToDate, install: installResult };
	} catch (e) {
		await writeFile(manifestPath, original, "utf8").catch(() => {});
		if (e instanceof InstallError) {
			throw new UpdateError(
				`install failed; rolled back moraga.esp.\n${e.message}`,
			);
		}
		throw e;
	}
}

async function fetchLatest(
	url: string,
	includePre: boolean,
	opts: UpdateOptions,
): Promise<string | null> {
	const { host, path } = parsePackageUrl(url);
	const adapter = opts.adapter ?? getAdapter(host, opts.fetchOpts ?? {});
	const tags = await adapter.listTags(path);
	return pickLatest(tags, includePre);
}

export function pickLatest(
	tags: string[],
	includePre: boolean,
): string | null {
	let bestStr: string | null = null;
	for (const tag of tags) {
		const ver = tag.startsWith("v") ? tag.slice(1) : tag;
		const p = parseSemver(ver);
		if (!p) continue;
		if (!includePre && p.pre !== undefined) continue;
		if (bestStr === null || compareSemver(ver, bestStr) > 0) {
			bestStr = ver;
		}
	}
	return bestStr;
}
