import { existsSync } from "node:fs";
import {
	mkdir,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { platform } from "node:process";
import { VERSION } from "../version";
import { type CachePaths, defaultCachePaths } from "./cache";
import {
	type AdapterOptions,
	type HostAdapter,
} from "./fetch";
import {
	type Lock,
	type LockEntry,
	parseLock,
	serializeLock,
} from "./lock";
import {
	type DepSpec,
	type Manifest,
	type OverrideSpec,
	parseManifest,
} from "./manifest";
import { ensurePackageCached } from "./resolve";

const MAX_CONCURRENCY = 8;

export class InstallError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InstallError";
	}
}

export type InstallOptions = {
	fetchOpts?: AdapterOptions;
	paths?: CachePaths;
	adapter?: HostAdapter;
};

export type InstallResult = {
	installed: number;
};

type ResolvedEntry = {
	url: string;
	version: string;
	sha: string;
	checksum: string;
	cachePath: string;
	manifest: Manifest;
	alias?: string;
	depUrls: string[];
};

type QueueItem = {
	url: string;
	version: string;
	alias?: string;
	chain: string[];
};

export async function install(
	rootDir: string,
	opts: InstallOptions = {},
): Promise<InstallResult> {
	if (platform === "win32") {
		throw new InstallError(
			"espeto install is not supported on Windows in v0 (symlink/tar limitations)",
		);
	}

	const manifestPath = join(rootDir, "moraga.esp");
	const lockPath = join(rootDir, "moraga.lock");
	const espetosDir = join(rootDir, ".espetos");

	if (!existsSync(manifestPath)) {
		throw new InstallError(`no moraga.esp found in ${rootDir}`);
	}

	const manifestSrc = await readFile(manifestPath, "utf8");
	const r = parseManifest(manifestSrc, manifestPath);
	if (!r.ok) {
		const lines = r.errors.map((e) => `  - ${e.message}`).join("\n");
		throw new InstallError(`moraga.esp has errors:\n${lines}`);
	}
	const rootManifest = r.manifest;

	const rc = checkEspetoConstraint(rootManifest.espeto, VERSION);
	if (!rc.ok) {
		throw new InstallError(
			`moraga.esp requires espeto ${rootManifest.espeto}, but compiler is ${VERSION}`,
		);
	}

	let prevLock: Lock = new Map();
	if (existsSync(lockPath)) {
		const lockSrc = await readFile(lockPath, "utf8");
		const lr = parseLock(lockSrc, lockPath);
		if (!lr.ok) {
			const lines = lr.errors.map((e) => `  - ${e.message}`).join("\n");
			throw new InstallError(`moraga.lock has errors:\n${lines}`);
		}
		prevLock = lr.lock;
	}

	const paths = opts.paths ?? defaultCachePaths();

	const resolved = await resolveGraph(rootManifest, prevLock, paths, opts);
	validateAliasesAndCollisions(resolved);

	const newLock = buildLock(resolved);
	await writeFile(lockPath, serializeLock(newLock), "utf8");

	await rm(espetosDir, { recursive: true, force: true });
	await mkdir(espetosDir, { recursive: true });
	for (const entry of resolved.values()) {
		if (entry.alias) {
			await populateAliasedDir(
				entry.cachePath,
				join(espetosDir, entry.alias),
				entry.manifest.name,
				entry.alias,
			);
		} else {
			await symlink(
				entry.cachePath,
				join(espetosDir, entry.manifest.name),
				"dir",
			);
		}
	}

	return { installed: resolved.size };
}

async function resolveGraph(
	rootManifest: Manifest,
	prevLock: Lock,
	paths: CachePaths,
	opts: InstallOptions,
): Promise<Map<string, ResolvedEntry>> {
	const resolved = new Map<string, ResolvedEntry>();
	const requested = new Map<string, { version: string; chain: string[] }>();

	const initial: QueueItem[] = [];
	for (const [url, spec] of applyOverrides(rootManifest.deps, rootManifest.overrides)) {
		initial.push({ url, version: spec.version, alias: spec.alias, chain: ["root"] });
	}
	for (const [url, spec] of applyOverrides(rootManifest.devDeps, rootManifest.overrides)) {
		initial.push({ url, version: spec.version, alias: spec.alias, chain: ["root"] });
	}

	let queue = initial;
	while (queue.length > 0) {
		const toProcess = dedupeAndCheckConflicts(queue, requested);
		const collected: QueueItem[] = [];

		await processWithConcurrency(toProcess, MAX_CONCURRENCY, async (item) => {
			const lockHit = prevLock.get(item.url);
			const useLock = lockHit && lockHit.version === item.version;
			const result = await ensurePackageCached(item.url, item.version, {
				...opts.fetchOpts,
				paths,
				adapter: opts.adapter,
				knownSha: useLock ? lockHit.sha : undefined,
				expectedChecksum: useLock ? lockHit.checksum : undefined,
			});

			const pkgManifestPath = join(result.cachePath, "moraga.esp");
			if (!existsSync(pkgManifestPath)) {
				throw new InstallError(
					`package ${item.url}@${item.version} is missing moraga.esp (sha=${result.sha})`,
				);
			}
			const pkgSrc = await readFile(pkgManifestPath, "utf8");
			const pmr = parseManifest(pkgSrc, pkgManifestPath);
			if (!pmr.ok) {
				const lines = pmr.errors.map((e) => `  - ${e.message}`).join("\n");
				throw new InstallError(
					`package ${item.url}@${item.version} has invalid moraga.esp:\n${lines}`,
				);
			}
			const pkgManifest = pmr.manifest;

			rejectAliasInDeps(item.url, item.version, pkgManifest.deps, "deps");
			rejectAliasInDeps(item.url, item.version, pkgManifest.devDeps, "dev_deps");

			const c = checkEspetoConstraint(pkgManifest.espeto, VERSION);
			if (!c.ok) {
				throw new InstallError(
					`package ${item.url}@${item.version} requires espeto ${pkgManifest.espeto}, but compiler is ${VERSION}`,
				);
			}

			resolved.set(item.url, {
				url: item.url,
				version: item.version,
				sha: result.sha,
				checksum: result.checksum,
				cachePath: result.cachePath,
				manifest: pkgManifest,
				alias: item.alias,
				depUrls: [...pkgManifest.deps.keys()],
			});

			const childChain = [...item.chain, `${item.url}@${item.version}`];
			for (const [depUrl, depSpec] of applyOverrides(
				pkgManifest.deps,
				rootManifest.overrides,
			)) {
				collected.push({
					url: depUrl,
					version: depSpec.version,
					chain: childChain,
				});
			}
		});

		queue = collected;
	}

	return resolved;
}

function dedupeAndCheckConflicts(
	batch: QueueItem[],
	requested: Map<string, { version: string; chain: string[] }>,
): QueueItem[] {
	const out: QueueItem[] = [];
	for (const item of batch) {
		const prev = requested.get(item.url);
		if (prev) {
			if (prev.version !== item.version) {
				throw new InstallError(formatConflictError(item.url, prev, item));
			}
			continue;
		}
		const dup = out.find((x) => x.url === item.url);
		if (dup) {
			if (dup.version !== item.version) {
				throw new InstallError(
					formatConflictError(
						item.url,
						{ version: dup.version, chain: dup.chain },
						item,
					),
				);
			}
			continue;
		}
		requested.set(item.url, { version: item.version, chain: item.chain });
		out.push(item);
	}
	return out;
}

function rejectAliasInDeps(
	url: string,
	version: string,
	deps: Map<string, DepSpec>,
	field: string,
): void {
	for (const [depUrl, spec] of deps) {
		if (spec.alias) {
			throw new InstallError(
				`package ${url}@${version} declares alias ("as": "${spec.alias}") on ${field}["${depUrl}"]. Aliases are only allowed in the root manifest's deps.`,
			);
		}
	}
}

function applyOverrides(
	deps: Map<string, DepSpec>,
	overrides: Map<string, OverrideSpec>,
): Map<string, DepSpec> {
	const out = new Map<string, DepSpec>();
	for (const [url, spec] of deps) {
		const ov = overrides.get(url);
		if (ov) {
			out.set(url, {
				version: ov.version,
				versionSpan: ov.versionSpan,
				alias: spec.alias,
				aliasSpan: spec.aliasSpan,
			});
		} else {
			out.set(url, spec);
		}
	}
	return out;
}

function validateAliasesAndCollisions(
	resolved: Map<string, ResolvedEntry>,
): void {
	const claims = new Map<string, string>();
	for (const [url, entry] of resolved) {
		const claimName = entry.alias ?? entry.manifest.name;
		const prev = claims.get(claimName);
		if (prev && prev !== url) {
			throw new InstallError(
				`name collision in .espetos/: "${claimName}" claimed by both ${prev} and ${url}. Add an alias in moraga.esp deps to one of them.`,
			);
		}
		claims.set(claimName, url);
	}

	for (const [parentUrl, entry] of resolved) {
		for (const depUrl of entry.depUrls) {
			const dep = resolved.get(depUrl);
			if (!dep || !dep.alias) continue;
			throw new InstallError(
				`${parentUrl}@${entry.version} depends on ${depUrl} as "${dep.manifest.name}" (canonical), but moraga.esp aliased ${depUrl} as "${dep.alias}". Remove the alias to expose the canonical name.`,
			);
		}
	}
}

function buildLock(resolved: Map<string, ResolvedEntry>): Lock {
	const lock: Lock = new Map();
	const fakeSpan = { file: "moraga.lock", line: 1, col: 1, length: 1 };
	for (const [url, entry] of resolved) {
		const lockEntry: LockEntry = {
			url,
			urlSpan: fakeSpan,
			version: entry.version,
			sha: entry.sha,
			checksum: entry.checksum,
			deps: [...entry.depUrls],
		};
		lock.set(url, lockEntry);
	}
	return lock;
}

async function populateAliasedDir(
	cachePath: string,
	aliasDir: string,
	canonicalName: string,
	aliasName: string,
): Promise<void> {
	await mkdir(aliasDir, { recursive: true });
	const entries = await readdir(cachePath, { withFileTypes: true });
	for (const e of entries) {
		const target = join(cachePath, e.name);
		let dest = join(aliasDir, e.name);
		if (e.isFile() && e.name === `${canonicalName}.esp`) {
			dest = join(aliasDir, `${aliasName}.esp`);
		}
		await symlink(target, dest, e.isDirectory() ? "dir" : "file");
	}
}

function formatConflictError(
	url: string,
	prev: { version: string; chain: string[] },
	curr: QueueItem,
): string {
	const prevPath = [...prev.chain, `${url}@${prev.version}`].join(" → ");
	const currPath = [...curr.chain, `${url}@${curr.version}`].join(" → ");
	return (
		`version conflict for ${url}\n` +
		`  - ${prevPath}\n` +
		`  - ${currPath}\n` +
		`resolve by adding to "overrides" in moraga.esp:\n` +
		`  "${url}": "<chosen-version>"`
	);
}

export function checkEspetoConstraint(
	constraint: string,
	current: string,
): { ok: true } | { ok: false; reason: string } {
	const parts = constraint
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean);
	for (const part of parts) {
		const m = part.match(/^(>=|<)\s*(\S+)$/);
		if (!m) return { ok: false, reason: `bad constraint part "${part}"` };
		const op = m[1]!;
		const ver = m[2]!;
		const cmp = compareSemver(current, ver);
		if (op === ">=" && cmp < 0) {
			return { ok: false, reason: `${current} < ${ver}` };
		}
		if (op === "<" && cmp >= 0) {
			return { ok: false, reason: `${current} >= ${ver}` };
		}
	}
	return { ok: true };
}

function compareSemver(a: string, b: string): number {
	const pa = parseTriple(a);
	const pb = parseTriple(b);
	for (let i = 0; i < 3; i++) {
		const av = pa[i] ?? 0;
		const bv = pb[i] ?? 0;
		if (av !== bv) return av < bv ? -1 : 1;
	}
	return 0;
}

function parseTriple(s: string): number[] {
	return s
		.split("-")[0]!
		.split("+")[0]!
		.split(".")
		.map((x) => Number.parseInt(x, 10) || 0);
}

async function processWithConcurrency<T>(
	items: T[],
	n: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let i = 0;
	const runners: Promise<void>[] = [];
	const count = Math.min(n, items.length);
	for (let k = 0; k < count; k++) {
		runners.push(
			(async () => {
				while (true) {
					const idx = i++;
					if (idx >= items.length) return;
					await worker(items[idx]!);
				}
			})(),
		);
	}
	await Promise.all(runners);
}
