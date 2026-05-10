import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getGitAdapter } from "../src/moraga/git";
import { executePublish, validatePublish } from "../src/moraga/publish";

const tmps: string[] = [];

afterEach(() => {
	while (tmps.length > 0) {
		const d = tmps.pop();
		if (d) spawnSync("rm", ["-rf", d]);
	}
});

function mkTmp(prefix = "moraga-publish-int-"): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	tmps.push(d);
	return d;
}

function git(cwd: string, ...args: string[]): { stdout: string } {
	const r = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (r.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed in ${cwd}: ${r.stderr || r.stdout}`,
		);
	}
	return { stdout: r.stdout };
}

function setupRepoWithRemote(opts: { name?: string; version?: string } = {}): {
	rootDir: string;
	bareDir: string;
} {
	const rootDir = mkTmp();
	const bareDir = mkTmp("moraga-publish-int-bare-");

	git(bareDir, "init", "-q", "--bare");
	git(rootDir, "init", "-q", "-b", "main");
	git(rootDir, "config", "user.email", "test@example.com");
	git(rootDir, "config", "user.name", "Test");

	const name = opts.name ?? "ansi";
	const version = opts.version ?? "1.0.0";
	const manifest = `{
  "name": "${name}",
  "version": "${version}",
  "espeto": ">= 0.1.0",
  "deps": {},
  "dev_deps": {}
}
`;
	writeFileSync(join(rootDir, "moraga.esp"), manifest);
	writeFileSync(
		join(rootDir, `${name}.esp`),
		`def hello() do\n  "hi"\nend\n`,
	);
	git(rootDir, "add", ".");
	git(rootDir, "commit", "-q", "-m", "initial");
	git(rootDir, "remote", "add", "origin", bareDir);
	git(rootDir, "push", "-q", "origin", "main");
	git(
		rootDir,
		"symbolic-ref",
		"refs/remotes/origin/HEAD",
		"refs/remotes/origin/main",
	);

	return { rootDir, bareDir };
}

describe("publish — integration with real git", () => {
	it("happy path: tag is created locally and pushed to origin", async () => {
		const { rootDir, bareDir } = setupRepoWithRemote();

		const validation = await validatePublish(rootDir);
		expect(validation.tagName).toBe("v1.0.0");
		expect(validation.tagMessage).toBe("ansi v1.0.0");

		await executePublish(rootDir, validation);

		const adapter = getGitAdapter();
		expect(await adapter.hasTag(rootDir, "v1.0.0")).toBe(true);

		const lsRemote = git(
			bareDir,
			"for-each-ref",
			"--format=%(refname)",
			"refs/tags/",
		);
		expect(lsRemote.stdout.trim()).toBe("refs/tags/v1.0.0");
	});

	it("validatePublish alone (dry-run equivalent) does not create any tag", async () => {
		const { rootDir, bareDir } = setupRepoWithRemote();

		await validatePublish(rootDir);

		const adapter = getGitAdapter();
		expect(await adapter.hasTag(rootDir, "v1.0.0")).toBe(false);
		const lsRemote = git(
			bareDir,
			"for-each-ref",
			"--format=%(refname)",
			"refs/tags/",
		);
		expect(lsRemote.stdout.trim()).toBe("");
	});

	it("rejects when tag already exists on origin", async () => {
		const { rootDir, bareDir } = setupRepoWithRemote();

		const other = mkTmp("moraga-publish-int-other-");
		git(other, "clone", "-q", bareDir, ".");
		git(other, "config", "user.email", "test@example.com");
		git(other, "config", "user.name", "Test");
		git(other, "tag", "-a", "v1.0.0", "-m", "from elsewhere");
		git(other, "push", "-q", "origin", "refs/tags/v1.0.0");

		await expect(validatePublish(rootDir)).rejects.toMatchObject({
			kind: "tag_exists_remote",
		});

		const adapter = getGitAdapter();
		expect(await adapter.hasTag(rootDir, "v1.0.0")).toBe(false);
	});
});
