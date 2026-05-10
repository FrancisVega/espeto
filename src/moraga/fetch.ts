import { Readable } from "node:stream";

export type FetchErrorCode =
	| "not_found"
	| "auth_required"
	| "rate_limited"
	| "forbidden"
	| "http"
	| "network";

export class MoragaFetchError extends Error {
	readonly code: FetchErrorCode;
	readonly status?: number;
	constructor(code: FetchErrorCode, message: string, status?: number) {
		super(message);
		this.name = "MoragaFetchError";
		this.code = code;
		this.status = status;
	}
}

export type FetchFn = (
	input: string | URL,
	init?: RequestInit,
) => Promise<Response>;

export type AdapterOptions = {
	fetchImpl?: FetchFn;
	env?: NodeJS.ProcessEnv;
	userAgent?: string;
	retries?: number;
	initialBackoffMs?: number;
	totalTimeoutMs?: number;
};

export interface HostAdapter {
	readonly host: string;
	resolveSha(repoPath: string, ref: string): Promise<string>;
	downloadTarball(repoPath: string, sha: string): Promise<Readable>;
	listTags(repoPath: string): Promise<string[]>;
}

export function getAdapter(host: string, opts: AdapterOptions = {}): HostAdapter {
	if (host === "github.com") return new GitHubAdapter(opts);
	throw new MoragaFetchError(
		"http",
		`unsupported host '${host}' — only github.com is supported in v0`,
	);
}

const DEFAULT_USER_AGENT = "espeto-moraga/0.1";
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 250;
const DEFAULT_TOTAL_TIMEOUT_MS = 5 * 60 * 1000;

class GitHubAdapter implements HostAdapter {
	readonly host = "github.com";
	private readonly fetchImpl: FetchFn;
	private readonly env: NodeJS.ProcessEnv;
	private readonly userAgent: string;
	private readonly retries: number;
	private readonly initialBackoffMs: number;
	private readonly totalTimeoutMs: number;

	constructor(opts: AdapterOptions) {
		this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchFn);
		this.env = opts.env ?? process.env;
		this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
		this.retries = opts.retries ?? DEFAULT_RETRIES;
		this.initialBackoffMs = opts.initialBackoffMs ?? DEFAULT_BACKOFF_MS;
		this.totalTimeoutMs = opts.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
	}

	async resolveSha(repoPath: string, ref: string): Promise<string> {
		const [owner, repo] = splitGitHubPath(repoPath);
		const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`;
		const res = await this.request(url, {
			headers: { Accept: "application/vnd.github+json" },
		});
		const body = (await res.json()) as { sha?: unknown };
		if (typeof body.sha !== "string" || !/^[0-9a-f]{40}$/.test(body.sha)) {
			throw new MoragaFetchError(
				"http",
				`commits API for ${owner}/${repo}@${ref} returned no valid sha`,
			);
		}
		return body.sha;
	}

	async downloadTarball(repoPath: string, sha: string): Promise<Readable> {
		const [owner, repo] = splitGitHubPath(repoPath);
		const url = `https://api.github.com/repos/${owner}/${repo}/tarball/${sha}`;
		const res = await this.request(url, {
			headers: { Accept: "application/vnd.github+json" },
		});
		if (!res.body) {
			throw new MoragaFetchError(
				"http",
				`tarball response for ${owner}/${repo}@${sha} has no body`,
			);
		}
		return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
	}

	async listTags(repoPath: string): Promise<string[]> {
		const [owner, repo] = splitGitHubPath(repoPath);
		const url = `https://api.github.com/repos/${owner}/${repo}/tags?per_page=100`;
		const res = await this.request(url, {
			headers: { Accept: "application/vnd.github+json" },
		});
		const body = (await res.json()) as unknown;
		if (!Array.isArray(body)) {
			throw new MoragaFetchError(
				"http",
				`tags API for ${owner}/${repo} did not return an array`,
			);
		}
		const out: string[] = [];
		for (const item of body) {
			if (item && typeof item === "object" && "name" in item) {
				const name = (item as { name: unknown }).name;
				if (typeof name === "string") out.push(name);
			}
		}
		return out;
	}

	private async request(url: string, init: RequestInit): Promise<Response> {
		const headers = new Headers(init.headers ?? {});
		headers.set("User-Agent", this.userAgent);
		const token = this.env.GITHUB_TOKEN;
		if (token) headers.set("Authorization", `Bearer ${token}`);

		let lastErr: unknown;
		for (let attempt = 0; attempt <= this.retries; attempt++) {
			const controller = new AbortController();
			const timeout = setTimeout(
				() => controller.abort(),
				this.totalTimeoutMs,
			);
			try {
				const res = await this.fetchImpl(url, {
					...init,
					headers,
					signal: controller.signal,
				});
				if (res.ok) return res;
				const err = await mapHttpError(res, url);
				if (!isRetryable(err) || attempt === this.retries) throw err;
				lastErr = err;
			} catch (e) {
				if (e instanceof MoragaFetchError) {
					if (!isRetryable(e) || attempt === this.retries) throw e;
					lastErr = e;
				} else {
					const netErr = new MoragaFetchError(
						"network",
						`network error fetching ${url}: ${e instanceof Error ? e.message : String(e)}`,
					);
					if (attempt === this.retries) throw netErr;
					lastErr = netErr;
				}
			} finally {
				clearTimeout(timeout);
			}
			await sleep(this.initialBackoffMs * 2 ** attempt);
		}
		throw lastErr ?? new MoragaFetchError("network", "unknown fetch failure");
	}
}

function splitGitHubPath(repoPath: string): [string, string] {
	const parts = repoPath.split("/");
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		throw new MoragaFetchError(
			"http",
			`github.com path must be '<owner>/<repo>', got '${repoPath}'`,
		);
	}
	return [parts[0], parts[1]];
}

async function mapHttpError(
	res: Response,
	url: string,
): Promise<MoragaFetchError> {
	const status = res.status;
	const remaining = res.headers.get("X-RateLimit-Remaining");
	if (status === 401) {
		return new MoragaFetchError(
			"auth_required",
			`401 unauthorized for ${url} — set $GITHUB_TOKEN`,
			status,
		);
	}
	if (status === 403 && remaining === "0") {
		return new MoragaFetchError(
			"rate_limited",
			`rate limit hit for ${url} — set $GITHUB_TOKEN to raise quota (60→5000/h)`,
			status,
		);
	}
	if (status === 403) {
		const body = await safeText(res, 500);
		return new MoragaFetchError(
			"forbidden",
			`403 forbidden for ${url}${body ? `: ${body}` : ""}`,
			status,
		);
	}
	if (status === 404) {
		return new MoragaFetchError(
			"not_found",
			`404 not found: ${url}`,
			status,
		);
	}
	const body = await safeText(res, 500);
	return new MoragaFetchError(
		"http",
		`HTTP ${status} for ${url}${body ? `: ${body}` : ""}`,
		status,
	);
}

async function safeText(res: Response, max: number): Promise<string> {
	try {
		const text = await res.text();
		return text.length > max ? `${text.slice(0, max)}…` : text;
	} catch {
		return "";
	}
}

function isRetryable(err: MoragaFetchError): boolean {
	if (err.code === "network") return true;
	if (err.code === "http" && err.status !== undefined && err.status >= 500) {
		return true;
	}
	return false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((res) => setTimeout(res, ms));
}
