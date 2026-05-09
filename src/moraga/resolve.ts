import {
	type CachePaths,
	cacheDirFor,
	computeMerkleHash,
	defaultCachePaths,
	extractTarballToCache,
	isCached,
} from "./cache";
import {
	type AdapterOptions,
	type HostAdapter,
	MoragaFetchError,
	getAdapter,
} from "./fetch";

export type EnsureCachedOptions = AdapterOptions & {
	paths?: CachePaths;
	adapter?: HostAdapter;
	expectedChecksum?: string;
};

export type EnsureCachedResult = {
	host: string;
	repoPath: string;
	sha: string;
	cachePath: string;
	checksum: string;
};

export function parsePackageUrl(url: string): {
	host: string;
	path: string;
} {
	const i = url.indexOf("/");
	if (i < 0) {
		throw new MoragaFetchError(
			"http",
			`invalid package url '${url}': expected '<host>/<path>'`,
		);
	}
	const host = url.slice(0, i);
	const path = url.slice(i + 1);
	if (!host || !path) {
		throw new MoragaFetchError(
			"http",
			`invalid package url '${url}': empty host or path`,
		);
	}
	return { host, path };
}

export async function ensurePackageCached(
	url: string,
	version: string,
	opts: EnsureCachedOptions = {},
): Promise<EnsureCachedResult> {
	const { host, path } = parsePackageUrl(url);
	const adapter = opts.adapter ?? getAdapter(host, opts);
	const paths = opts.paths ?? defaultCachePaths();

	const sha = await resolveTag(adapter, path, version);
	const finalPath = cacheDirFor(paths, host, path, sha);

	let checksum: string;
	if (await isCached(paths, host, path, sha)) {
		checksum = await computeMerkleHash(finalPath);
	} else {
		const stream = await adapter.downloadTarball(path, sha);
		const result = await extractTarballToCache(paths, host, path, sha, stream);
		checksum = result.checksum;
	}

	if (
		opts.expectedChecksum !== undefined &&
		opts.expectedChecksum !== checksum
	) {
		throw new MoragaFetchError(
			"http",
			`checksum mismatch for ${url}@${version} (sha=${sha}): expected ${opts.expectedChecksum}, got ${checksum}`,
		);
	}

	return {
		host,
		repoPath: path,
		sha,
		cachePath: finalPath,
		checksum,
	};
}

async function resolveTag(
	adapter: HostAdapter,
	repoPath: string,
	version: string,
): Promise<string> {
	try {
		return await adapter.resolveSha(repoPath, `v${version}`);
	} catch (e) {
		if (e instanceof MoragaFetchError && e.code === "not_found") {
			return await adapter.resolveSha(repoPath, version);
		}
		throw e;
	}
}
