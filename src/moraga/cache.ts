import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type CachePaths = {
	root: string;
	tmpRoot: string;
};

export function defaultCachePaths(): CachePaths {
	const root = join(homedir(), ".espeto", "cache");
	return { root, tmpRoot: join(root, ".tmp") };
}

export function cacheDirFor(
	paths: CachePaths,
	host: string,
	repoPath: string,
	sha: string,
): string {
	return join(paths.root, host, ...repoPath.split("/"), sha);
}

export async function isCached(
	paths: CachePaths,
	host: string,
	repoPath: string,
	sha: string,
): Promise<boolean> {
	try {
		const s = await stat(cacheDirFor(paths, host, repoPath, sha));
		return s.isDirectory();
	} catch {
		return false;
	}
}

export type ExtractResult = {
	cachePath: string;
	checksum: string;
};

export async function extractTarballToCache(
	paths: CachePaths,
	host: string,
	repoPath: string,
	sha: string,
	tarballStream: Readable,
): Promise<ExtractResult> {
	await mkdir(paths.tmpRoot, { recursive: true });
	const tmpDir = join(paths.tmpRoot, `${sha}-${process.pid}-${Date.now()}`);
	await mkdir(tmpDir, { recursive: true });

	try {
		await extractTarGz(tarballStream, tmpDir);
		const checksum = await computeMerkleHash(tmpDir);
		const finalPath = cacheDirFor(paths, host, repoPath, sha);
		await mkdir(dirname(finalPath), { recursive: true });
		try {
			await rename(tmpDir, finalPath);
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === "ENOTEMPTY") {
				await rm(tmpDir, { recursive: true, force: true });
			} else {
				throw e;
			}
		}
		return { cachePath: finalPath, checksum };
	} catch (e) {
		await rm(tmpDir, { recursive: true, force: true });
		throw e;
	}
}

async function extractTarGz(input: Readable, destDir: string): Promise<void> {
	const child = spawn(
		"tar",
		["-xzf", "-", "-C", destDir, "--strip-components=1"],
		{ stdio: ["pipe", "ignore", "pipe"] },
	);

	const stderrChunks: Buffer[] = [];
	child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));

	const exit = new Promise<void>((res, rej) => {
		child.on("error", rej);
		child.on("close", (code) => {
			if (code === 0) {
				res();
			} else {
				const msg = Buffer.concat(stderrChunks).toString("utf8").trim();
				rej(
					new Error(
						`tar extraction failed (code ${code})${msg ? `: ${msg}` : ""}`,
					),
				);
			}
		});
	});

	await pipeline(input, child.stdin);
	await exit;
}

export async function computeMerkleHash(dirAbsPath: string): Promise<string> {
	const root = resolve(dirAbsPath);
	const files: string[] = [];
	await collectFiles(root, root, files);
	files.sort();

	const hash = createHash("sha256");
	for (const rel of files) {
		const abs = join(root, rel);
		const content = await readFile(abs);
		const fileHash = createHash("sha256").update(content).digest("hex");
		const normalised = rel.split(sep).join("/");
		hash.update(`${normalised}\0${fileHash}\0`);
	}
	return `h1:${hash.digest("hex")}`;
}

async function collectFiles(
	root: string,
	dir: string,
	out: string[],
): Promise<void> {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const e of entries) {
		const abs = join(dir, e.name);
		if (e.isDirectory()) {
			await collectFiles(root, abs, out);
		} else if (e.isFile()) {
			out.push(relative(root, abs));
		}
	}
}
