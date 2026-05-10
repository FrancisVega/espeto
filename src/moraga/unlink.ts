import { existsSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CachePaths } from "./cache";
import type { AdapterOptions, HostAdapter } from "./fetch";
import { install, InstallError, type InstallResult } from "./install";
import { LocalEditError, removeLinkFromLocal } from "./local-edit";
import { URL_PATTERN } from "./manifest";

export class UnlinkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnlinkError";
	}
}

export type UnlinkOptions = {
	fetchOpts?: AdapterOptions;
	paths?: CachePaths;
	adapter?: HostAdapter;
};

export type UnlinkResult = {
	unlinked: string[];
	skipped: string[];
	install: InstallResult | { installed: 0 };
};

export async function runUnlink(
	rootDir: string,
	urls: string[],
	opts: UnlinkOptions = {},
): Promise<UnlinkResult> {
	if (urls.length === 0) {
		throw new UnlinkError("no packages specified");
	}

	const seen = new Set<string>();
	for (const url of urls) {
		if (!URL_PATTERN.test(url)) {
			throw new UnlinkError(
				`invalid package url "${url}": expected "<host>/<owner>/<repo>"`,
			);
		}
		if (seen.has(url)) {
			throw new UnlinkError(
				`${url} appears more than once in this command — list each package only once`,
			);
		}
		seen.add(url);
	}

	const manifestPath = join(rootDir, "moraga.esp");
	if (!existsSync(manifestPath)) {
		throw new UnlinkError(`no moraga.esp found in ${rootDir}`);
	}

	const localPath = join(rootDir, "moraga.local.esp");
	const original = existsSync(localPath)
		? await readFile(localPath, "utf8")
		: null;

	const unlinked: string[] = [];
	const skipped: string[] = [];
	let nextSrc = original ?? "";

	for (const url of urls) {
		try {
			const r = removeLinkFromLocal(nextSrc, url);
			if (r.changed) {
				unlinked.push(url);
				nextSrc = r.source;
			} else {
				skipped.push(url);
			}
		} catch (e) {
			if (e instanceof LocalEditError) throw new UnlinkError(e.message);
			throw e;
		}
	}

	if (unlinked.length === 0) {
		return { unlinked, skipped, install: { installed: 0 } };
	}

	const tmpPath = `${localPath}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(tmpPath, nextSrc, "utf8");
	try {
		await rename(tmpPath, localPath);
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
		return { unlinked, skipped, install: installResult };
	} catch (e) {
		if (original === null) {
			await unlink(localPath).catch(() => {});
		} else {
			await writeFile(localPath, original, "utf8").catch(() => {});
		}
		if (e instanceof InstallError) {
			throw new UnlinkError(
				`install failed; rolled back moraga.local.esp.\n${e.message}`,
			);
		}
		throw e;
	}
}
