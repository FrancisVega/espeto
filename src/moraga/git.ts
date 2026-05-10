import { spawn } from "node:child_process";

export type GitErrorKind = "not_repo" | "command_failed" | "git_not_found";

export class GitError extends Error {
	readonly kind: GitErrorKind;
	readonly stderr?: string;
	constructor(kind: GitErrorKind, message: string, stderr?: string) {
		super(message);
		this.name = "GitError";
		this.kind = kind;
		this.stderr = stderr;
	}
}

export interface GitAdapter {
	isGitRepo(rootDir: string): Promise<boolean>;
	statusPorcelain(rootDir: string): Promise<string[]>;
	currentBranch(rootDir: string): Promise<string | null>;
	defaultBranch(rootDir: string, remote: string): Promise<string | null>;
	isTracked(rootDir: string, file: string): Promise<boolean>;
	hasTag(rootDir: string, tag: string): Promise<boolean>;
	remoteHasTag(
		rootDir: string,
		remote: string,
		tag: string,
	): Promise<boolean>;
	createTag(rootDir: string, tag: string, message: string): Promise<void>;
	pushTag(rootDir: string, remote: string, tag: string): Promise<void>;
	removeTag(rootDir: string, tag: string): Promise<void>;
}

type RunResult = {
	code: number;
	stdout: string;
	stderr: string;
};

async function runGit(rootDir: string, args: string[]): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", args, {
			cwd: rootDir,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
		child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
		child.on("error", (e: NodeJS.ErrnoException) => {
			if (e.code === "ENOENT") {
				reject(
					new GitError(
						"git_not_found",
						"git command not found — is git installed and on PATH?",
					),
				);
			} else {
				reject(e);
			}
		});
		child.on("close", (code) => {
			resolve({
				code: code ?? 1,
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
			});
		});
	});
}

function expectSuccess(r: RunResult, what: string): void {
	if (r.code !== 0) {
		throw new GitError(
			"command_failed",
			`${what} failed (exit ${r.code})`,
			r.stderr.trim(),
		);
	}
}

class RealGitAdapter implements GitAdapter {
	async isGitRepo(rootDir: string): Promise<boolean> {
		const r = await runGit(rootDir, [
			"rev-parse",
			"--is-inside-work-tree",
		]);
		return r.code === 0 && r.stdout.trim() === "true";
	}

	async statusPorcelain(rootDir: string): Promise<string[]> {
		const r = await runGit(rootDir, ["status", "--porcelain"]);
		expectSuccess(r, "git status");
		return r.stdout.split("\n").filter((l) => l.length > 0);
	}

	async currentBranch(rootDir: string): Promise<string | null> {
		const r = await runGit(rootDir, [
			"symbolic-ref",
			"--quiet",
			"--short",
			"HEAD",
		]);
		if (r.code === 0) return r.stdout.trim();
		return null;
	}

	async defaultBranch(
		rootDir: string,
		remote: string,
	): Promise<string | null> {
		const r = await runGit(rootDir, [
			"symbolic-ref",
			"--quiet",
			`refs/remotes/${remote}/HEAD`,
		]);
		if (r.code !== 0) return null;
		const out = r.stdout.trim();
		const prefix = `refs/remotes/${remote}/`;
		if (!out.startsWith(prefix)) return null;
		return out.slice(prefix.length);
	}

	async isTracked(rootDir: string, file: string): Promise<boolean> {
		const r = await runGit(rootDir, [
			"ls-files",
			"--error-unmatch",
			"--",
			file,
		]);
		return r.code === 0;
	}

	async hasTag(rootDir: string, tag: string): Promise<boolean> {
		const r = await runGit(rootDir, [
			"rev-parse",
			"--verify",
			"--quiet",
			`refs/tags/${tag}`,
		]);
		return r.code === 0;
	}

	async remoteHasTag(
		rootDir: string,
		remote: string,
		tag: string,
	): Promise<boolean> {
		const r = await runGit(rootDir, [
			"ls-remote",
			"--tags",
			remote,
			`refs/tags/${tag}`,
		]);
		expectSuccess(r, "git ls-remote");
		return r.stdout.trim().length > 0;
	}

	async createTag(
		rootDir: string,
		tag: string,
		message: string,
	): Promise<void> {
		const r = await runGit(rootDir, ["tag", "-a", tag, "-m", message]);
		expectSuccess(r, "git tag");
	}

	async pushTag(
		rootDir: string,
		remote: string,
		tag: string,
	): Promise<void> {
		const r = await runGit(rootDir, [
			"push",
			remote,
			`refs/tags/${tag}`,
		]);
		expectSuccess(r, "git push");
	}

	async removeTag(rootDir: string, tag: string): Promise<void> {
		const r = await runGit(rootDir, ["tag", "-d", tag]);
		expectSuccess(r, "git tag -d");
	}
}

export function getGitAdapter(): GitAdapter {
	return new RealGitAdapter();
}
