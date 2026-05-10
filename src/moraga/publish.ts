import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EspetoError } from "../errors";
import { lex } from "../lexer";
import { parse } from "../parser";
import { type GitAdapter, GitError, getGitAdapter } from "./git";
import { parseLocal } from "./local";
import { parseManifest } from "./manifest";

export type PublishErrorKind =
	| "invalid_manifest"
	| "missing_entrypoint"
	| "invalid_entrypoint"
	| "local_links_present"
	| "invalid_local_manifest"
	| "not_git_repo"
	| "local_file_tracked"
	| "working_tree_dirty"
	| "detached_head"
	| "wrong_branch"
	| "no_default_branch"
	| "tag_exists_local"
	| "tag_exists_remote";

export class PublishError extends Error {
	readonly kind: PublishErrorKind;
	constructor(kind: PublishErrorKind, message: string) {
		super(message);
		this.name = "PublishError";
		this.kind = kind;
	}
}

export type PublishOptions = {
	allowDirty?: boolean;
	git?: GitAdapter;
};

export type Validation = {
	name: string;
	version: string;
	tagName: string;
	tagMessage: string;
	branch: string;
	dirtyAllowed: boolean;
};

const REMOTE = "origin";

export async function validatePublish(
	rootDir: string,
	opts: PublishOptions = {},
): Promise<Validation> {
	const git = opts.git ?? getGitAdapter();

	const manifestPath = join(rootDir, "moraga.esp");
	let manifestSource: string;
	try {
		manifestSource = await readFile(manifestPath, "utf8");
	} catch {
		throw new PublishError(
			"invalid_manifest",
			`moraga.esp not found at ${rootDir}`,
		);
	}
	const parsed = parseManifest(manifestSource, "moraga.esp");
	if (!parsed.ok) {
		const first = parsed.errors[0]!;
		throw new PublishError(
			"invalid_manifest",
			`moraga.esp: ${first.message}`,
		);
	}
	const { name, version } = parsed.manifest;

	const entrypointPath = join(rootDir, `${name}.esp`);
	if (!existsSync(entrypointPath)) {
		throw new PublishError(
			"missing_entrypoint",
			`entrypoint ${name}.esp not found at ${rootDir}`,
		);
	}
	const entrypointSource = await readFile(entrypointPath, "utf8");
	try {
		const tokens = lex(entrypointSource, `${name}.esp`);
		parse(tokens, entrypointSource);
	} catch (e) {
		if (e instanceof EspetoError) {
			throw new PublishError(
				"invalid_entrypoint",
				`${name}.esp: ${e.message}`,
			);
		}
		throw e;
	}

	const localPath = join(rootDir, "moraga.local.esp");
	if (existsSync(localPath)) {
		const localSource = await readFile(localPath, "utf8");
		const localResult = parseLocal(localSource, "moraga.local.esp");
		if (!localResult.ok) {
			throw new PublishError(
				"invalid_local_manifest",
				`moraga.local.esp: ${localResult.errors[0]!.message}`,
			);
		}
		if (localResult.local.links.size > 0) {
			throw new PublishError(
				"local_links_present",
				`moraga.local.esp has ${localResult.local.links.size} active link(s) — unlink before publishing (links are local state and would not resolve for consumers)`,
			);
		}
	}

	if (!(await git.isGitRepo(rootDir))) {
		throw new PublishError(
			"not_git_repo",
			`${rootDir} is not a git repository`,
		);
	}

	if (await git.isTracked(rootDir, "moraga.local.esp")) {
		throw new PublishError(
			"local_file_tracked",
			"moraga.local.esp is tracked by git — add it to .gitignore and remove from the index before publishing",
		);
	}

	const status = await git.statusPorcelain(rootDir);
	const dirtyAllowed = status.length > 0 && opts.allowDirty === true;
	if (status.length > 0 && !opts.allowDirty) {
		const preview = status
			.slice(0, 5)
			.map((l) => `  ${l}`)
			.join("\n");
		const more = status.length > 5 ? `\n  ... and ${status.length - 5} more` : "";
		throw new PublishError(
			"working_tree_dirty",
			`working tree has ${status.length} uncommitted change(s):\n${preview}${more}\n\ncommit, stash, or use --allow-dirty`,
		);
	}

	const currentBranch = await git.currentBranch(rootDir);
	if (currentBranch === null) {
		throw new PublishError(
			"detached_head",
			"HEAD is detached — checkout a branch before publishing",
		);
	}

	const defaultBranch = await git.defaultBranch(rootDir, REMOTE);
	if (defaultBranch === null) {
		throw new PublishError(
			"no_default_branch",
			`could not determine default branch of ${REMOTE} — run: git remote set-head ${REMOTE} --auto`,
		);
	}
	if (currentBranch !== defaultBranch) {
		throw new PublishError(
			"wrong_branch",
			`current branch is "${currentBranch}" but ${REMOTE}'s default branch is "${defaultBranch}" — checkout ${defaultBranch} before publishing`,
		);
	}

	const tagName = `v${version}`;
	if (await git.hasTag(rootDir, tagName)) {
		throw new PublishError(
			"tag_exists_local",
			`tag ${tagName} already exists locally — bump the version in moraga.esp, or run: git tag -d ${tagName}`,
		);
	}
	if (await git.remoteHasTag(rootDir, REMOTE, tagName)) {
		throw new PublishError(
			"tag_exists_remote",
			`tag ${tagName} already exists on ${REMOTE} — bump the version in moraga.esp, or fetch it with: git fetch ${REMOTE} refs/tags/${tagName}`,
		);
	}

	return {
		name,
		version,
		tagName,
		tagMessage: `${name} ${tagName}`,
		branch: currentBranch,
		dirtyAllowed,
	};
}

export async function executePublish(
	rootDir: string,
	validation: Validation,
	opts: PublishOptions = {},
): Promise<void> {
	const git = opts.git ?? getGitAdapter();
	await git.createTag(rootDir, validation.tagName, validation.tagMessage);
	try {
		await git.pushTag(rootDir, REMOTE, validation.tagName);
	} catch (e) {
		try {
			await git.removeTag(rootDir, validation.tagName);
		} catch {
			// rollback failed; original error is what matters
		}
		throw e;
	}
}

export { GitError };
