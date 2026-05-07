import {
	type FSWatcher,
	readFileSync,
	statSync,
	watch as fsWatch,
} from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { stderr } from "node:process";
import { defaultResolver, type Resolver } from "./imports";
import { runMain } from "./run";
import { discoverTestFiles, runTestsMain } from "./test";

const DEBOUNCE_MS = 100;
const STARTUP_GUARD_MS = 200;
const PREFIX = "▸";

export type WatchOptions = {
	cmdArgv?: string[] | null;
};

export type SettleInfo = {
	code: number;
	files: Set<string>;
	durationMs: number;
};

export type WatchEvents = {
	onSettled?: (info: SettleInfo) => void;
};

export type StartWatcherOptions = WatchOptions &
	WatchEvents & {
		debounceMs?: number;
		/**
		 * Ignore events for this many ms after a watcher attaches. Filters
		 * macOS FSEvents in-flight events from writes that happened just
		 * before attach. Default 200ms.
		 */
		startupGuardMs?: number;
		log?: boolean;
	};

export type WatcherHandle = {
	close: () => void;
};

export function diffSets<T>(
	prev: Set<T>,
	next: Set<T>,
): { toClose: Set<T>; toOpen: Set<T> } {
	const toClose = new Set<T>();
	const toOpen = new Set<T>();
	for (const x of prev) if (!next.has(x)) toClose.add(x);
	for (const x of next) if (!prev.has(x)) toOpen.add(x);
	return { toClose, toOpen };
}

export function debounce(fn: () => void, ms: number): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return () => {
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			fn();
		}, ms);
	};
}

export function startWatcher(
	entryFile: string,
	opts: StartWatcherOptions = {},
): WatcherHandle {
	const entryAbs = resolvePath(entryFile);
	const debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
	const startupGuardMs = opts.startupGuardMs ?? STARTUP_GUARD_MS;
	const log = opts.log ?? true;
	let resolvedFiles = new Set<string>([entryAbs]);
	const dirWatchers = new Map<string, FSWatcher>();
	let acceptEventsAt = 0;
	let closed = false;

	const recordingResolver: Resolver = (importerAbsPath, importPath) => {
		const m = defaultResolver(importerAbsPath, importPath);
		resolvedFiles.add(m.absPath);
		return m;
	};

	const syncWatchers = () => {
		if (closed) return;
		const dirs = new Set<string>();
		for (const f of resolvedFiles) dirs.add(dirname(f));
		const prevDirs = new Set(dirWatchers.keys());
		const { toClose, toOpen } = diffSets(prevDirs, dirs);
		for (const d of toClose) {
			dirWatchers.get(d)?.close();
			dirWatchers.delete(d);
		}
		for (const d of toOpen) {
			try {
				const w = fsWatch(d, (_eventType, filename) => {
					if (closed || filename === null) return;
					if (Date.now() < acceptEventsAt) return;
					if (!filename.endsWith(".esp")) return;
					const abs = resolvePath(d, filename);
					if (!resolvedFiles.has(abs)) return;
					triggerRerun();
				});
				dirWatchers.set(d, w);
			} catch (e) {
				if (log) {
					stderr.write(
						`${PREFIX} failed to watch ${d}: ${e instanceof Error ? e.message : String(e)}\n`,
					);
				}
			}
		}
		if (toOpen.size > 0) {
			acceptEventsAt = Date.now() + startupGuardMs;
		}
	};

	const runOnce = () => {
		if (closed) return;
		resolvedFiles = new Set<string>([entryAbs]);
		const t0 = Date.now();
		let source: string | null = null;
		try {
			source = readFileSync(entryAbs, "utf-8");
		} catch (e) {
			stderr.write(
				`error: ${e instanceof Error ? e.message : String(e)}\n`,
			);
		}
		const code =
			source === null
				? 1
				: runMain(source, entryAbs, {
						cmdArgv: opts.cmdArgv ?? null,
						resolver: recordingResolver,
					});
		const durationMs = Date.now() - t0;
		if (log) {
			const n = resolvedFiles.size;
			const noun = n === 1 ? "file" : "files";
			const status =
				code === 0
					? `ran in ${durationMs}ms`
					: `failed (${durationMs}ms)`;
			stderr.write(`${PREFIX} ${status} — watching ${n} ${noun}\n`);
		}
		syncWatchers();
		opts.onSettled?.({
			code,
			files: new Set(resolvedFiles),
			durationMs,
		});
	};

	const triggerRerun = debounce(runOnce, debounceMs);

	runOnce();

	return {
		close: () => {
			closed = true;
			for (const w of dirWatchers.values()) w.close();
			dirWatchers.clear();
		},
	};
}

export function watchAndRun(
	entryFile: string,
	opts: WatchOptions = {},
): Promise<number> {
	startWatcher(entryFile, opts);
	return new Promise<number>(() => {});
}

export function startTestWatcher(root: string): Promise<number> {
	const rootAbs = resolvePath(root);
	let watchedFiles = new Set<string>();
	const dirWatchers = new Map<string, FSWatcher>();
	let acceptEventsAt = 0;
	let closed = false;

	const recordingResolver: Resolver = (importer, importPath) => {
		const m = defaultResolver(importer, importPath);
		watchedFiles.add(m.absPath);
		return m;
	};

	const collectWatchDirs = (): Set<string> => {
		const dirs = new Set<string>();
		try {
			const info = statSync(rootAbs);
			if (info.isDirectory()) dirs.add(rootAbs);
			else dirs.add(dirname(rootAbs));
		} catch {
			// ignore — root might temporarily not exist
		}
		for (const f of watchedFiles) dirs.add(dirname(f));
		return dirs;
	};

	const syncWatchers = (): void => {
		if (closed) return;
		const dirs = collectWatchDirs();
		const prev = new Set(dirWatchers.keys());
		const { toClose, toOpen } = diffSets(prev, dirs);
		for (const d of toClose) {
			dirWatchers.get(d)?.close();
			dirWatchers.delete(d);
		}
		for (const d of toOpen) {
			try {
				const w = fsWatch(d, (_event, filename) => {
					if (closed || filename === null) return;
					if (Date.now() < acceptEventsAt) return;
					if (!filename.endsWith(".esp")) return;
					triggerRerun();
				});
				dirWatchers.set(d, w);
			} catch (e) {
				stderr.write(
					`${PREFIX} failed to watch ${d}: ${e instanceof Error ? e.message : String(e)}\n`,
				);
			}
		}
		if (toOpen.size > 0) {
			acceptEventsAt = Date.now() + STARTUP_GUARD_MS;
		}
	};

	const runOnce = (): void => {
		if (closed) return;
		watchedFiles = new Set<string>();
		try {
			for (const f of discoverTestFiles(root)) watchedFiles.add(f);
		} catch (e) {
			stderr.write(
				`error: ${e instanceof Error ? e.message : String(e)}\n`,
			);
		}
		const t0 = Date.now();
		runTestsMain(root, { resolver: recordingResolver });
		const ms = Date.now() - t0;
		const n = watchedFiles.size;
		const noun = n === 1 ? "file" : "files";
		stderr.write(`${PREFIX} ran in ${ms}ms — watching ${n} ${noun}\n`);
		syncWatchers();
	};

	const triggerRerun = debounce(runOnce, DEBOUNCE_MS);

	runOnce();

	return new Promise<number>(() => {});
}
