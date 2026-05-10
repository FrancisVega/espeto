import { existsSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CachePaths } from "./cache";
import { EditError, removeDepFromManifest } from "./edit";
import { type AdapterOptions, type HostAdapter } from "./fetch";
import { install, InstallError, type InstallResult } from "./install";
import { URL_PATTERN } from "./manifest";

export class RemoveError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RemoveError";
	}
}

export type RemoveOptions = {
	fetchOpts?: AdapterOptions;
	paths?: CachePaths;
	adapter?: HostAdapter;
};

export type RemoveResult = {
	removed: string[];
	skipped: string[];
	install: InstallResult | { installed: 0 };
};

export async function runRemove(
	rootDir: string,
	urls: string[],
	opts: RemoveOptions = {},
): Promise<RemoveResult> {
	if (urls.length === 0) {
		throw new RemoveError("no packages specified");
	}

	const manifestPath = join(rootDir, "moraga.esp");
	if (!existsSync(manifestPath)) {
		throw new RemoveError(`no moraga.esp found in ${rootDir}`);
	}

	const seen = new Set<string>();
	for (const url of urls) {
		if (!URL_PATTERN.test(url)) {
			throw new RemoveError(
				`invalid package url "${url}": expected "<host>/<owner>/<repo>"`,
			);
		}
		if (seen.has(url)) {
			throw new RemoveError(
				`${url} appears more than once in this command — list each package only once`,
			);
		}
		seen.add(url);
	}

	const original = await readFile(manifestPath, "utf8");
	let nextSrc = original;
	const removed: string[] = [];
	const skipped: string[] = [];

	for (const url of urls) {
		try {
			const r = removeDepFromManifest(nextSrc, url);
			if (r.changed) {
				removed.push(url);
				nextSrc = r.source;
			} else {
				skipped.push(url);
			}
		} catch (e) {
			if (e instanceof EditError) {
				throw new RemoveError(e.message);
			}
			throw e;
		}
	}

	if (removed.length === 0) {
		return { removed, skipped, install: { installed: 0 } };
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
		return { removed, skipped, install: installResult };
	} catch (e) {
		await writeFile(manifestPath, original, "utf8").catch(() => {});
		if (e instanceof InstallError) {
			throw new RemoveError(
				`install failed; rolled back moraga.esp.\n${e.message}`,
			);
		}
		throw e;
	}
}
