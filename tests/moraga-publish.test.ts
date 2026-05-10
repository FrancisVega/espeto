import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type GitAdapter, GitError } from "../src/moraga/git";
import {
	executePublish,
	PublishError,
	validatePublish,
} from "../src/moraga/publish";

const tmps: string[] = [];

afterEach(() => {
	while (tmps.length > 0) {
		const d = tmps.pop();
		if (d) spawnSync("rm", ["-rf", d]);
	}
});

function mkTmp(prefix = "moraga-publish-test-"): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	tmps.push(d);
	return d;
}

function manifestSrc(opts: { name?: string; version?: string } = {}): string {
	const name = opts.name ?? "ansi";
	const version = opts.version ?? "1.0.0";
	return `{
  "name": "${name}",
  "version": "${version}",
  "espeto": ">= 0.1.0",
  "deps": {},
  "dev_deps": {}
}
`;
}

function setupRepo(opts: {
	name?: string;
	version?: string;
	withEntrypoint?: boolean;
	entrypointSource?: string;
	manifestSource?: string;
	localSource?: string;
} = {}): string {
	const d = mkTmp();
	const name = opts.name ?? "ansi";
	const manifest =
		opts.manifestSource ?? manifestSrc({ name, version: opts.version });
	writeFileSync(join(d, "moraga.esp"), manifest);
	if (opts.withEntrypoint !== false) {
		writeFileSync(
			join(d, `${name}.esp`),
			opts.entrypointSource ?? `def hello() do\n  "hi"\nend\n`,
		);
	}
	if (opts.localSource !== undefined) {
		writeFileSync(join(d, "moraga.local.esp"), opts.localSource);
	}
	return d;
}

class FakeGit implements GitAdapter {
	isRepo = true;
	status: string[] = [];
	branch: string | null = "main";
	defaultBranchName: string | null = "main";
	tracked = new Set<string>();
	localTags = new Set<string>();
	remoteTags = new Set<string>();
	pushShouldFail = false;
	removeShouldFail = false;

	createCalls: Array<{ tag: string; message: string }> = [];
	pushCalls: Array<{ remote: string; tag: string }> = [];
	removeCalls: string[] = [];

	async isGitRepo(): Promise<boolean> {
		return this.isRepo;
	}
	async statusPorcelain(): Promise<string[]> {
		return this.status.slice();
	}
	async currentBranch(): Promise<string | null> {
		return this.branch;
	}
	async defaultBranch(): Promise<string | null> {
		return this.defaultBranchName;
	}
	async isTracked(_root: string, file: string): Promise<boolean> {
		return this.tracked.has(file);
	}
	async hasTag(_root: string, tag: string): Promise<boolean> {
		return this.localTags.has(tag);
	}
	async remoteHasTag(
		_root: string,
		_remote: string,
		tag: string,
	): Promise<boolean> {
		return this.remoteTags.has(tag);
	}
	async createTag(
		_root: string,
		tag: string,
		message: string,
	): Promise<void> {
		this.createCalls.push({ tag, message });
		this.localTags.add(tag);
	}
	async pushTag(_root: string, remote: string, tag: string): Promise<void> {
		this.pushCalls.push({ remote, tag });
		if (this.pushShouldFail) {
			throw new GitError("command_failed", "push failed", "stderr");
		}
		this.remoteTags.add(tag);
	}
	async removeTag(_root: string, tag: string): Promise<void> {
		this.removeCalls.push(tag);
		if (this.removeShouldFail) {
			throw new GitError("command_failed", "remove failed");
		}
		this.localTags.delete(tag);
	}
}

describe("validatePublish", () => {
	it("returns Validation on the happy path", async () => {
		const d = setupRepo();
		const git = new FakeGit();
		const v = await validatePublish(d, { git });
		expect(v).toMatchObject({
			name: "ansi",
			version: "1.0.0",
			tagName: "v1.0.0",
			tagMessage: "ansi v1.0.0",
			branch: "main",
			dirtyAllowed: false,
		});
	});

	it("errors when moraga.esp is missing", async () => {
		const d = mkTmp();
		const git = new FakeGit();
		await expect(validatePublish(d, { git })).rejects.toMatchObject({
			kind: "invalid_manifest",
		});
	});

	it("errors when manifest is malformed", async () => {
		const d = mkTmp();
		writeFileSync(join(d, "moraga.esp"), "{ not a valid manifest");
		const git = new FakeGit();
		await expect(validatePublish(d, { git })).rejects.toMatchObject({
			kind: "invalid_manifest",
		});
	});

	it("errors when entrypoint is missing", async () => {
		const d = setupRepo({ withEntrypoint: false });
		const git = new FakeGit();
		await expect(validatePublish(d, { git })).rejects.toMatchObject({
			kind: "missing_entrypoint",
		});
	});

	it("errors when entrypoint has syntax errors", async () => {
		const d = setupRepo({ entrypointSource: "def hello(," });
		const git = new FakeGit();
		await expect(validatePublish(d, { git })).rejects.toMatchObject({
			kind: "invalid_entrypoint",
		});
	});

	it("errors when moraga.local.esp has links", async () => {
		const d = setupRepo({
			localSource: `{ "links": { "github.com/foo/bar": "../bar" } }\n`,
		});
		const git = new FakeGit();
		await expect(validatePublish(d, { git })).rejects.toMatchObject({
			kind: "local_links_present",
		});
	});

	it("errors when moraga.local.esp is malformed", async () => {
		const d = setupRepo({ localSource: "{ \"links\": [\n" });
		const git = new FakeGit();
		await expect(validatePublish(d, { git })).rejects.toMatchObject({
			kind: "invalid_local_manifest",
		});
	});

	it("accepts moraga.local.esp with empty links", async () => {
		const d = setupRepo({ localSource: `{ "links": {} }\n` });
		const git = new FakeGit();
		const v = await validatePublish(d, { git });
		expect(v.name).toBe("ansi");
	});

	it("errors when not a git repo", async () => {
		const d = setupRepo();
		const git = new FakeGit();
		git.isRepo = false;
		await expect(validatePublish(d, { git })).rejects.toMatchObject({
			kind: "not_git_repo",
		});
	});

	it("errors when moraga.local.esp is tracked by git", async () => {
		const d = setupRepo();
		const git = new FakeGit();
		git.tracked.add("moraga.local.esp");
		await expect(validatePublish(d, { git })).rejects.toMatchObject({
			kind: "local_file_tracked",
		});
	});

	it("errors when working tree is dirty", async () => {
		const d = setupRepo();
		const git = new FakeGit();
		git.status = [" M src/foo.esp", "?? scratch.esp"];
		await expect(validatePublish(d, { git })).rejects.toMatchObject({
			kind: "working_tree_dirty",
		});
	});

	it("allows dirty with --allow-dirty and reports dirtyAllowed=true", async () => {
		const d = setupRepo();
		const git = new FakeGit();
		git.status = [" M src/foo.esp"];
		const v = await validatePublish(d, { git, allowDirty: true });
		expect(v.dirtyAllowed).toBe(true);
	});

	it("reports dirtyAllowed=false when allowDirty is set but tree is clean", async () => {
		const d = setupRepo();
		const git = new FakeGit();
		const v = await validatePublish(d, { git, allowDirty: true });
		expect(v.dirtyAllowed).toBe(false);
	});

	it("errors when HEAD is detached", async () => {
		const d = setupRepo();
		const git = new FakeGit();
		git.branch = null;
		await expect(validatePublish(d, { git })).rejects.toMatchObject({
			kind: "detached_head",
		});
	});

	it("errors when default branch cannot be determined", async () => {
		const d = setupRepo();
		const git = new FakeGit();
		git.defaultBranchName = null;
		await expect(validatePublish(d, { git })).rejects.toMatchObject({
			kind: "no_default_branch",
		});
	});

	it("errors when current branch is not the default", async () => {
		const d = setupRepo();
		const git = new FakeGit();
		git.branch = "feature/xyz";
		git.defaultBranchName = "main";
		await expect(validatePublish(d, { git })).rejects.toMatchObject({
			kind: "wrong_branch",
		});
	});

	it("errors when tag exists locally", async () => {
		const d = setupRepo();
		const git = new FakeGit();
		git.localTags.add("v1.0.0");
		await expect(validatePublish(d, { git })).rejects.toMatchObject({
			kind: "tag_exists_local",
		});
	});

	it("errors when tag exists on remote", async () => {
		const d = setupRepo();
		const git = new FakeGit();
		git.remoteTags.add("v1.0.0");
		await expect(validatePublish(d, { git })).rejects.toMatchObject({
			kind: "tag_exists_remote",
		});
	});
});

describe("executePublish", () => {
	it("creates the tag and pushes to origin", async () => {
		const git = new FakeGit();
		const validation = {
			name: "ansi",
			version: "1.0.0",
			tagName: "v1.0.0",
			tagMessage: "ansi v1.0.0",
			branch: "main",
			dirtyAllowed: false,
		};
		await executePublish("/some/dir", validation, { git });
		expect(git.createCalls).toEqual([
			{ tag: "v1.0.0", message: "ansi v1.0.0" },
		]);
		expect(git.pushCalls).toEqual([{ remote: "origin", tag: "v1.0.0" }]);
		expect(git.removeCalls).toEqual([]);
	});

	it("removes the local tag and rethrows when push fails", async () => {
		const git = new FakeGit();
		git.pushShouldFail = true;
		const validation = {
			name: "ansi",
			version: "1.0.0",
			tagName: "v1.0.0",
			tagMessage: "ansi v1.0.0",
			branch: "main",
			dirtyAllowed: false,
		};
		await expect(
			executePublish("/some/dir", validation, { git }),
		).rejects.toBeInstanceOf(GitError);
		expect(git.removeCalls).toEqual(["v1.0.0"]);
		expect(git.localTags.has("v1.0.0")).toBe(false);
	});

	it("rethrows the push error even if cleanup also fails", async () => {
		const git = new FakeGit();
		git.pushShouldFail = true;
		git.removeShouldFail = true;
		const validation = {
			name: "ansi",
			version: "1.0.0",
			tagName: "v1.0.0",
			tagMessage: "ansi v1.0.0",
			branch: "main",
			dirtyAllowed: false,
		};
		await expect(
			executePublish("/some/dir", validation, { git }),
		).rejects.toMatchObject({ message: "push failed" });
		expect(git.removeCalls).toEqual(["v1.0.0"]);
	});
});

describe("PublishError export", () => {
	it("is an Error subclass with a kind field", () => {
		const e = new PublishError("not_git_repo", "test");
		expect(e).toBeInstanceOf(Error);
		expect(e.kind).toBe("not_git_repo");
		expect(e.name).toBe("PublishError");
	});
});
