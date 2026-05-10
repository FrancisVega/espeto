import { existsSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CachePaths } from "./cache";
import { addDepToManifest, EditError } from "./edit";
import {
	type AdapterOptions,
	type HostAdapter,
	MoragaFetchError,
	getAdapter,
} from "./fetch";
import { install, InstallError, type InstallResult } from "./install";
import {
	NAME_PATTERN,
	SEMVER_PATTERN,
	URL_PATTERN,
} from "./manifest";
import { parsePackageUrl } from "./resolve";

export class AddError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AddError";
	}
}

export type AddSpec = {
	url: string;
	version: string;
	alias?: string;
};

export type AddOptions = {
	dev?: boolean;
	fetchOpts?: AdapterOptions;
	paths?: CachePaths;
	adapter?: HostAdapter;
};

export type AddResult = {
	added: string[];
	skipped: string[];
	install: InstallResult;
};

export async function runAdd(
	rootDir: string,
	specs: AddSpec[],
	opts: AddOptions = {},
): Promise<AddResult> {
	if (specs.length === 0) {
		throw new AddError("no packages specified");
	}

	const manifestPath = join(rootDir, "moraga.esp");
	if (!existsSync(manifestPath)) {
		throw new AddError(`no moraga.esp found in ${rootDir}`);
	}

	const seen = new Set<string>();
	for (const spec of specs) {
		validateSpec(spec);
		if (seen.has(spec.url)) {
			throw new AddError(
				`${spec.url} appears more than once in this command — list each package only once`,
			);
		}
		seen.add(spec.url);
	}

	const original = await readFile(manifestPath, "utf8");
	let nextSrc = original;
	const added: string[] = [];
	const skipped: string[] = [];

	for (const spec of specs) {
		try {
			const r = addDepToManifest(nextSrc, spec.url, spec.version, {
				dev: opts.dev,
				alias: spec.alias,
			});
			if (r.changed) {
				added.push(spec.url);
				nextSrc = r.source;
			} else {
				skipped.push(spec.url);
			}
		} catch (e) {
			if (e instanceof EditError) {
				throw new AddError(e.message);
			}
			throw e;
		}
	}

	if (added.length === 0) {
		return { added, skipped, install: { installed: 0 } };
	}

	for (const spec of specs) {
		if (skipped.includes(spec.url)) continue;
		await preflightResolve(spec, opts);
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
		return { added, skipped, install: installResult };
	} catch (e) {
		await writeFile(manifestPath, original, "utf8").catch(() => {});
		if (e instanceof InstallError) {
			throw new AddError(
				`install failed; rolled back moraga.esp.\n${e.message}`,
			);
		}
		throw e;
	}
}

function validateSpec(spec: AddSpec): void {
	if (!URL_PATTERN.test(spec.url)) {
		throw new AddError(
			`invalid package url "${spec.url}": expected "<host>/<owner>/<repo>"`,
		);
	}
	if (!SEMVER_PATTERN.test(spec.version)) {
		throw new AddError(
			`invalid version "${spec.version}" for ${spec.url}: must be exact semver (X.Y.Z)`,
		);
	}
	if (spec.alias !== undefined && !NAME_PATTERN.test(spec.alias)) {
		throw new AddError(
			`invalid alias "${spec.alias}": must match /[a-z][a-z0-9_]*/`,
		);
	}
}

async function preflightResolve(
	spec: AddSpec,
	opts: AddOptions,
): Promise<void> {
	const { host, path } = parsePackageUrl(spec.url);
	const adapter = opts.adapter ?? getAdapter(host, opts.fetchOpts ?? {});
	try {
		try {
			await adapter.resolveSha(path, `v${spec.version}`);
		} catch (e) {
			if (e instanceof MoragaFetchError && e.code === "not_found") {
				await adapter.resolveSha(path, spec.version);
			} else {
				throw e;
			}
		}
	} catch (e) {
		if (e instanceof MoragaFetchError) {
			throw new AddError(
				`cannot resolve ${spec.url}@${spec.version}: ${e.message}`,
			);
		}
		throw e;
	}
}
