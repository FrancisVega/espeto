import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitError, getGitAdapter } from "../src/moraga/git";

const tmps: string[] = [];

afterEach(() => {
	while (tmps.length > 0) {
		const d = tmps.pop();
		if (d) spawnSync("rm", ["-rf", d]);
	}
});

function mkTmp(prefix = "moraga-git-test-"): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	tmps.push(d);
	return d;
}

function git(cwd: string, ...args: string[]): void {
	const r = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (r.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed in ${cwd}: ${r.stderr || r.stdout}`,
		);
	}
}

function initRepo(): string {
	const d = mkTmp();
	git(d, "init", "-q", "-b", "main");
	git(d, "config", "user.email", "test@example.com");
	git(d, "config", "user.name", "Test");
	writeFileSync(join(d, "README"), "hi\n");
	git(d, "add", "README");
	git(d, "commit", "-q", "-m", "initial");
	return d;
}

function initBareRemote(workingRepo: string, name = "origin"): string {
	const bare = mkTmp("moraga-git-bare-");
	git(bare, "init", "-q", "--bare", "-b", "main");
	git(workingRepo, "remote", "add", name, bare);
	git(workingRepo, "push", "-q", name, "main");
	return bare;
}

describe("GitAdapter", () => {
	const adapter = getGitAdapter();

	it("isGitRepo returns false for non-git dir", async () => {
		const d = mkTmp();
		expect(await adapter.isGitRepo(d)).toBe(false);
	});

	it("isGitRepo returns true after git init", async () => {
		const d = initRepo();
		expect(await adapter.isGitRepo(d)).toBe(true);
	});

	it("statusPorcelain reports clean, untracked, and modified", async () => {
		const d = initRepo();
		expect(await adapter.statusPorcelain(d)).toEqual([]);

		writeFileSync(join(d, "scratch.txt"), "x");
		const untracked = await adapter.statusPorcelain(d);
		expect(untracked.some((l) => l.startsWith("??"))).toBe(true);

		writeFileSync(join(d, "README"), "modified\n");
		const modified = await adapter.statusPorcelain(d);
		expect(modified.some((l) => l.includes("README"))).toBe(true);
	});

	it("currentBranch returns branch name", async () => {
		const d = initRepo();
		expect(await adapter.currentBranch(d)).toBe("main");
	});

	it("currentBranch returns null on detached HEAD", async () => {
		const d = initRepo();
		const r = spawnSync("git", ["rev-parse", "HEAD"], {
			cwd: d,
			encoding: "utf8",
		});
		const sha = r.stdout.trim();
		git(d, "checkout", "-q", "--detach", sha);
		expect(await adapter.currentBranch(d)).toBeNull();
	});

	it("defaultBranch returns null when no symbolic-ref configured", async () => {
		const d = initRepo();
		initBareRemote(d);
		expect(await adapter.defaultBranch(d, "origin")).toBeNull();
	});

	it("defaultBranch returns the configured branch", async () => {
		const d = initRepo();
		initBareRemote(d);
		git(
			d,
			"symbolic-ref",
			"refs/remotes/origin/HEAD",
			"refs/remotes/origin/main",
		);
		expect(await adapter.defaultBranch(d, "origin")).toBe("main");
	});

	it("isTracked distinguishes tracked vs untracked", async () => {
		const d = initRepo();
		expect(await adapter.isTracked(d, "README")).toBe(true);
		writeFileSync(join(d, "scratch.txt"), "x");
		expect(await adapter.isTracked(d, "scratch.txt")).toBe(false);
		expect(await adapter.isTracked(d, "missing.txt")).toBe(false);
	});

	it("hasTag returns true after createTag and false after removeTag", async () => {
		const d = initRepo();
		expect(await adapter.hasTag(d, "v1.0.0")).toBe(false);
		await adapter.createTag(d, "v1.0.0", "test v1.0.0");
		expect(await adapter.hasTag(d, "v1.0.0")).toBe(true);
		await adapter.removeTag(d, "v1.0.0");
		expect(await adapter.hasTag(d, "v1.0.0")).toBe(false);
	});

	it("createTag throws GitError on duplicate", async () => {
		const d = initRepo();
		await adapter.createTag(d, "v1.0.0", "first");
		await expect(
			adapter.createTag(d, "v1.0.0", "second"),
		).rejects.toBeInstanceOf(GitError);
	});

	it("pushTag and remoteHasTag work end-to-end against a bare remote", async () => {
		const d = initRepo();
		initBareRemote(d);

		expect(await adapter.remoteHasTag(d, "origin", "v1.0.0")).toBe(false);
		await adapter.createTag(d, "v1.0.0", "test v1.0.0");
		await adapter.pushTag(d, "origin", "v1.0.0");
		expect(await adapter.remoteHasTag(d, "origin", "v1.0.0")).toBe(true);
	});

	it("pushTag fails when remote already has the tag", async () => {
		const d = initRepo();
		const bare = initBareRemote(d);

		const other = mkTmp("moraga-git-other-");
		git(other, "clone", "-q", bare, ".");
		git(other, "config", "user.email", "test@example.com");
		git(other, "config", "user.name", "Test");
		git(other, "tag", "-a", "v1.0.0", "-m", "from other");
		git(other, "push", "-q", "origin", "refs/tags/v1.0.0");

		await adapter.createTag(d, "v1.0.0", "from us");
		await expect(
			adapter.pushTag(d, "origin", "v1.0.0"),
		).rejects.toBeInstanceOf(GitError);
	});
});
