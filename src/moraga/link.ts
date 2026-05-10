import { existsSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath, join } from "node:path";
import type { CachePaths } from "./cache";
import type { AdapterOptions, HostAdapter } from "./fetch";
import { install, InstallError, type InstallResult } from "./install";
import { LocalEditError, addLinkToLocal } from "./local-edit";
import { parseManifest, URL_PATTERN } from "./manifest";

export class LinkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LinkError";
	}
}

export type LinkOptions = {
	fetchOpts?: AdapterOptions;
	paths?: CachePaths;
	adapter?: HostAdapter;
};

export type LinkResult = {
	url: string;
	path: string;
	changed: boolean;
	install: InstallResult | { installed: 0 };
};

export async function runLink(
	rootDir: string,
	url: string,
	path: string,
	opts: LinkOptions = {},
): Promise<LinkResult> {
	if (!URL_PATTERN.test(url)) {
		throw new LinkError(
			`invalid package url "${url}": expected "<host>/<owner>/<repo>"`,
		);
	}
	if (path === "") {
		throw new LinkError(`link path must not be empty`);
	}

	const manifestPath = join(rootDir, "moraga.esp");
	if (!existsSync(manifestPath)) {
		throw new LinkError(`no moraga.esp found in ${rootDir}`);
	}

	const manifestSrc = await readFile(manifestPath, "utf8");
	const mr = parseManifest(manifestSrc, manifestPath);
	if (!mr.ok) {
		const lines = mr.errors.map((e) => `  - ${e.message}`).join("\n");
		throw new LinkError(`moraga.esp has errors:\n${lines}`);
	}
	const inDeps = mr.manifest.deps.has(url);
	const inDevDeps = mr.manifest.devDeps.has(url);
	if (!inDeps && !inDevDeps) {
		throw new LinkError(
			`${url} is not in deps or dev_deps. Add it first with 'espeto add ${url}@<version>'.`,
		);
	}

	const absLinkPath = isAbsolute(path) ? path : resolvePath(rootDir, path);
	if (!existsSync(absLinkPath)) {
		throw new LinkError(`link path not found: ${absLinkPath}`);
	}
	const linkedManifestPath = join(absLinkPath, "moraga.esp");
	if (!existsSync(linkedManifestPath)) {
		throw new LinkError(
			`link path is not a package: missing ${linkedManifestPath}`,
		);
	}
	const linkedSrc = await readFile(linkedManifestPath, "utf8");
	const lmr = parseManifest(linkedSrc, linkedManifestPath);
	if (!lmr.ok) {
		const lines = lmr.errors.map((e) => `  - ${e.message}`).join("\n");
		throw new LinkError(
			`linked package's moraga.esp is invalid:\n${lines}`,
		);
	}

	const localPath = join(rootDir, "moraga.local.esp");
	const original = existsSync(localPath)
		? await readFile(localPath, "utf8")
		: null;

	let nextSrc: string;
	let changed: boolean;
	try {
		const r = addLinkToLocal(original ?? "", url, path);
		nextSrc = r.source;
		changed = r.changed;
	} catch (e) {
		if (e instanceof LocalEditError) throw new LinkError(e.message);
		throw e;
	}

	if (!changed) {
		return { url, path, changed: false, install: { installed: 0 } };
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
		return { url, path, changed: true, install: installResult };
	} catch (e) {
		if (original === null) {
			await unlink(localPath).catch(() => {});
		} else {
			await writeFile(localPath, original, "utf8").catch(() => {});
		}
		if (e instanceof InstallError) {
			throw new LinkError(
				`install failed; rolled back moraga.local.esp.\n${e.message}`,
			);
		}
		throw e;
	}
}
