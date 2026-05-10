import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
	cacheDirFor,
	type CachePaths,
} from "../src/moraga/cache";
import {
	type FetchFn,
	getAdapter,
	MoragaFetchError,
} from "../src/moraga/fetch";
import {
	ensurePackageCached,
	parsePackageUrl,
} from "../src/moraga/resolve";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

const tmps: string[] = [];
afterEach(() => {
	while (tmps.length > 0) {
		const d = tmps.pop();
		if (d) spawnSync("rm", ["-rf", d]);
	}
});

function mkTmp(prefix = "moraga-fetch-test-"): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	tmps.push(d);
	return d;
}

function paths(): CachePaths {
	const root = mkTmp("moraga-fetch-cache-");
	return { root, tmpRoot: join(root, ".tmp") };
}

type StubResponse = Response | Error;
type StubResponder =
	| StubResponse
	| ((init: RequestInit | undefined) => StubResponse | Promise<StubResponse>);

function stubFetch(responses: StubResponder[]): {
	fn: FetchFn;
	calls: Array<{ url: string; headers: Record<string, string> }>;
} {
	const calls: Array<{ url: string; headers: Record<string, string> }> = [];
	let i = 0;
	const fn: FetchFn = async (input, init) => {
		const url = typeof input === "string" ? input : input.toString();
		const h: Record<string, string> = {};
		if (init?.headers) {
			const hh = new Headers(init.headers);
			hh.forEach((v, k) => {
				h[k] = v;
			});
		}
		calls.push({ url, headers: h });
		const responder = responses[i++];
		if (responder === undefined) {
			throw new Error(`unexpected fetch call ${calls.length}: ${url}`);
		}
		const r =
			typeof responder === "function" ? await responder(init) : responder;
		if (r instanceof Error) throw r;
		return r;
	};
	return { fn, calls };
}

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function errRes(
	status: number,
	body = "",
	headers: Record<string, string> = {},
): Response {
	return new Response(body, { status, headers });
}

function tarballRes(buf: Buffer): Response {
	return new Response(new Uint8Array(buf), { status: 200 });
}

function makeWrappedTarballBytes(
	wrapperDir: string,
	files: Record<string, string>,
): Buffer {
	const work = mkTmp("moraga-tar-src-");
	const inner = join(work, wrapperDir);
	for (const [rel, content] of Object.entries(files)) {
		const abs = join(inner, rel);
		spawnSync("mkdir", ["-p", join(abs, "..")]);
		writeFileSync(abs, content);
	}
	const tarballPath = join(mkTmp("moraga-tar-out-"), "out.tgz");
	const r = spawnSync("tar", ["-czf", tarballPath, "-C", work, wrapperDir]);
	if (r.status !== 0) {
		throw new Error(`failed to build tarball fixture: ${r.stderr.toString()}`);
	}
	return readFileSync(tarballPath);
}

describe("parsePackageUrl", () => {
	it("splits host + path", () => {
		expect(parsePackageUrl("github.com/foo/bar")).toEqual({
			host: "github.com",
			path: "foo/bar",
		});
	});

	it("supports nested paths", () => {
		expect(parsePackageUrl("gitlab.com/g/sub/repo")).toEqual({
			host: "gitlab.com",
			path: "g/sub/repo",
		});
	});

	it("rejects strings with no slash", () => {
		expect(() => parsePackageUrl("github.com")).toThrow(MoragaFetchError);
	});

	it("rejects empty host or path", () => {
		expect(() => parsePackageUrl("/foo/bar")).toThrow(MoragaFetchError);
		expect(() => parsePackageUrl("github.com/")).toThrow(MoragaFetchError);
	});
});

describe("getAdapter", () => {
	it("rejects non-github hosts in v0", () => {
		expect(() => getAdapter("gitlab.com")).toThrow(MoragaFetchError);
	});
});

describe("GitHubAdapter — auth & headers", () => {
	it("attaches Bearer token from env.GITHUB_TOKEN", async () => {
		const { fn, calls } = stubFetch([jsonRes({ sha: SHA_A })]);
		const adapter = getAdapter("github.com", {
			fetchImpl: fn,
			env: { GITHUB_TOKEN: "tok123" },
		});
		await adapter.resolveSha("foo/bar", "v1.0.0");
		expect(calls[0]?.headers.authorization).toBe("Bearer tok123");
	});

	it("omits authorization header when no token", async () => {
		const { fn, calls } = stubFetch([jsonRes({ sha: SHA_A })]);
		const adapter = getAdapter("github.com", { fetchImpl: fn, env: {} });
		await adapter.resolveSha("foo/bar", "v1.0.0");
		expect(calls[0]?.headers.authorization).toBeUndefined();
	});

	it("sends User-Agent and Accept headers", async () => {
		const { fn, calls } = stubFetch([jsonRes({ sha: SHA_A })]);
		const adapter = getAdapter("github.com", { fetchImpl: fn, env: {} });
		await adapter.resolveSha("foo/bar", "v1.0.0");
		expect(calls[0]?.headers["user-agent"]).toMatch(/^espeto-moraga\//);
		expect(calls[0]?.headers.accept).toBe("application/vnd.github+json");
	});
});

describe("GitHubAdapter.resolveSha", () => {
	it("returns sha on 200", async () => {
		const { fn } = stubFetch([jsonRes({ sha: SHA_A })]);
		const adapter = getAdapter("github.com", { fetchImpl: fn, env: {} });
		expect(await adapter.resolveSha("foo/bar", "v1.0.0")).toBe(SHA_A);
	});

	it("hits the commits endpoint", async () => {
		const { fn, calls } = stubFetch([jsonRes({ sha: SHA_A })]);
		const adapter = getAdapter("github.com", { fetchImpl: fn, env: {} });
		await adapter.resolveSha("foo/bar", "v1.0.0");
		expect(calls[0]?.url).toBe(
			"https://api.github.com/repos/foo/bar/commits/v1.0.0",
		);
	});

	it("throws on malformed sha", async () => {
		const { fn } = stubFetch([jsonRes({ sha: "not-hex" })]);
		const adapter = getAdapter("github.com", { fetchImpl: fn, env: {} });
		await expect(adapter.resolveSha("foo/bar", "v1.0.0")).rejects.toThrow(
			/no valid sha/,
		);
	});

	it("throws on path that's not <owner>/<repo>", async () => {
		const { fn } = stubFetch([]);
		const adapter = getAdapter("github.com", { fetchImpl: fn, env: {} });
		await expect(adapter.resolveSha("only-one", "v1.0.0")).rejects.toThrow(
			/'<owner>\/<repo>'/,
		);
	});
});

describe("GitHubAdapter — error mapping", () => {
	it("401 → auth_required", async () => {
		const { fn } = stubFetch([errRes(401)]);
		const adapter = getAdapter("github.com", {
			fetchImpl: fn,
			env: {},
			retries: 0,
		});
		await expect(adapter.resolveSha("foo/bar", "v1.0.0")).rejects.toMatchObject(
			{ code: "auth_required", status: 401 },
		);
	});

	it("403 with X-RateLimit-Remaining=0 → rate_limited", async () => {
		const { fn } = stubFetch([errRes(403, "", { "X-RateLimit-Remaining": "0" })]);
		const adapter = getAdapter("github.com", {
			fetchImpl: fn,
			env: {},
			retries: 0,
		});
		await expect(adapter.resolveSha("foo/bar", "v1.0.0")).rejects.toMatchObject(
			{ code: "rate_limited", status: 403 },
		);
	});

	it("403 without rate-limit header → forbidden", async () => {
		const { fn } = stubFetch([errRes(403, "no go")]);
		const adapter = getAdapter("github.com", {
			fetchImpl: fn,
			env: {},
			retries: 0,
		});
		await expect(adapter.resolveSha("foo/bar", "v1.0.0")).rejects.toMatchObject(
			{ code: "forbidden", status: 403 },
		);
	});

	it("404 → not_found", async () => {
		const { fn } = stubFetch([errRes(404)]);
		const adapter = getAdapter("github.com", {
			fetchImpl: fn,
			env: {},
			retries: 0,
		});
		await expect(adapter.resolveSha("foo/bar", "v1.0.0")).rejects.toMatchObject(
			{ code: "not_found", status: 404 },
		);
	});

	it("404 without token includes $GITHUB_TOKEN hint", async () => {
		const { fn } = stubFetch([errRes(404)]);
		const adapter = getAdapter("github.com", {
			fetchImpl: fn,
			env: {},
			retries: 0,
		});
		await expect(adapter.resolveSha("foo/bar", "v1.0.0")).rejects.toThrow(
			/set \$GITHUB_TOKEN if this is a private repo/,
		);
	});

	it("404 with token omits $GITHUB_TOKEN hint", async () => {
		const { fn } = stubFetch([errRes(404)]);
		const adapter = getAdapter("github.com", {
			fetchImpl: fn,
			env: { GITHUB_TOKEN: "tok" },
			retries: 0,
		});
		let caught: Error | undefined;
		try {
			await adapter.resolveSha("foo/bar", "v1.0.0");
		} catch (e) {
			caught = e as Error;
		}
		expect(caught).toBeDefined();
		expect((caught as MoragaFetchError).code).toBe("not_found");
		expect(caught?.message).not.toMatch(/GITHUB_TOKEN/);
	});
});

describe("GitHubAdapter — retries", () => {
	it("retries on 503 and succeeds", async () => {
		const { fn, calls } = stubFetch([
			errRes(503),
			jsonRes({ sha: SHA_A }),
		]);
		const adapter = getAdapter("github.com", {
			fetchImpl: fn,
			env: {},
			retries: 3,
			initialBackoffMs: 1,
		});
		expect(await adapter.resolveSha("foo/bar", "v1.0.0")).toBe(SHA_A);
		expect(calls.length).toBe(2);
	});

	it("retries on network error and succeeds", async () => {
		const { fn, calls } = stubFetch([
			() => new TypeError("ECONNRESET"),
			jsonRes({ sha: SHA_A }),
		]);
		const adapter = getAdapter("github.com", {
			fetchImpl: fn,
			env: {},
			retries: 3,
			initialBackoffMs: 1,
		});
		expect(await adapter.resolveSha("foo/bar", "v1.0.0")).toBe(SHA_A);
		expect(calls.length).toBe(2);
	});

	it("does NOT retry on 404", async () => {
		const { fn, calls } = stubFetch([errRes(404)]);
		const adapter = getAdapter("github.com", {
			fetchImpl: fn,
			env: {},
			retries: 3,
			initialBackoffMs: 1,
		});
		await expect(adapter.resolveSha("foo/bar", "v1.0.0")).rejects.toMatchObject(
			{ code: "not_found" },
		);
		expect(calls.length).toBe(1);
	});

	it("gives up after retries are exhausted", async () => {
		const { fn, calls } = stubFetch([errRes(503), errRes(503), errRes(503)]);
		const adapter = getAdapter("github.com", {
			fetchImpl: fn,
			env: {},
			retries: 2,
			initialBackoffMs: 1,
		});
		await expect(adapter.resolveSha("foo/bar", "v1.0.0")).rejects.toMatchObject(
			{ code: "http", status: 503 },
		);
		expect(calls.length).toBe(3);
	});
});

describe("ensurePackageCached", () => {
	it("falls back from v<v> to <v> when the prefixed tag is 404", async () => {
		const tarball = makeWrappedTarballBytes("foo-bar-deadbee", {
			"a.txt": "hi",
		});
		const { fn, calls } = stubFetch([
			errRes(404),
			jsonRes({ sha: SHA_A }),
			tarballRes(tarball),
		]);
		const p = paths();
		const result = await ensurePackageCached(
			"github.com/foo/bar",
			"1.0.0",
			{ fetchImpl: fn, env: {}, paths: p, retries: 0 },
		);
		expect(result.sha).toBe(SHA_A);
		expect(calls[0]?.url).toContain("/commits/v1.0.0");
		expect(calls[1]?.url).toContain("/commits/1.0.0");
		expect(calls[2]?.url).toContain(`/tarball/${SHA_A}`);
		expect(result.checksum).toMatch(/^h1:[0-9a-f]{64}$/);
	});

	it("returns cached entry without calling tarball endpoint", async () => {
		const p = paths();
		const dir = cacheDirFor(p, "github.com", "foo/bar", SHA_B);
		await mkdir(dir, { recursive: true });
		const fs = require("node:fs/promises");
		await fs.writeFile(join(dir, "x.txt"), "cached");

		const { fn, calls } = stubFetch([jsonRes({ sha: SHA_B })]);
		const result = await ensurePackageCached(
			"github.com/foo/bar",
			"2.0.0",
			{ fetchImpl: fn, env: {}, paths: p, retries: 0 },
		);
		expect(result.sha).toBe(SHA_B);
		expect(result.cachePath).toBe(dir);
		expect(calls.length).toBe(1);
	});

	it("throws on expectedChecksum mismatch", async () => {
		const tarball = makeWrappedTarballBytes("x-y-1234567", {
			"a.txt": "hi",
		});
		const { fn } = stubFetch([
			jsonRes({ sha: SHA_A }),
			tarballRes(tarball),
		]);
		const p = paths();
		await expect(
			ensurePackageCached("github.com/x/y", "1.0.0", {
				fetchImpl: fn,
				env: {},
				paths: p,
				retries: 0,
				expectedChecksum: "h1:0000",
			}),
		).rejects.toThrow(/checksum mismatch/);
	});

	it("uses the v-prefixed tag without fallback when it exists", async () => {
		const tarball = makeWrappedTarballBytes("foo-bar-7890abc", {
			"a.txt": "hi",
		});
		const { fn, calls } = stubFetch([
			jsonRes({ sha: SHA_A }),
			tarballRes(tarball),
		]);
		const p = paths();
		await ensurePackageCached("github.com/foo/bar", "1.0.0", {
			fetchImpl: fn,
			env: {},
			paths: p,
			retries: 0,
		});
		expect(calls.length).toBe(2);
		expect(calls[0]?.url).toContain("/commits/v1.0.0");
	});
});

describe("GitHubAdapter.listTags", () => {
	it("returns tag names from the tags endpoint", async () => {
		const { fn, calls } = stubFetch([
			jsonRes([
				{ name: "v1.0.0", commit: { sha: SHA_A } },
				{ name: "v1.1.0", commit: { sha: SHA_B } },
				{ name: "v2.0.0-beta.1", commit: { sha: SHA_A } },
			]),
		]);
		const adapter = getAdapter("github.com", { fetchImpl: fn, env: {} });
		const tags = await adapter.listTags("foo/bar");
		expect(tags).toEqual(["v1.0.0", "v1.1.0", "v2.0.0-beta.1"]);
		expect(calls[0]?.url).toBe(
			"https://api.github.com/repos/foo/bar/tags?per_page=100",
		);
	});

	it("returns an empty array when there are no tags", async () => {
		const { fn } = stubFetch([jsonRes([])]);
		const adapter = getAdapter("github.com", { fetchImpl: fn, env: {} });
		expect(await adapter.listTags("foo/bar")).toEqual([]);
	});

	it("throws when the response is not an array", async () => {
		const { fn } = stubFetch([jsonRes({ error: "boom" })]);
		const adapter = getAdapter("github.com", {
			fetchImpl: fn,
			env: {},
			retries: 0,
		});
		await expect(adapter.listTags("foo/bar")).rejects.toThrow(/did not return an array/);
	});

	it("maps 404 to not_found", async () => {
		const { fn } = stubFetch([errRes(404)]);
		const adapter = getAdapter("github.com", {
			fetchImpl: fn,
			env: {},
			retries: 0,
		});
		await expect(adapter.listTags("foo/bar")).rejects.toMatchObject({
			code: "not_found",
			status: 404,
		});
	});

	it("skips entries without a string name", async () => {
		const { fn } = stubFetch([
			jsonRes([
				{ name: "v1.0.0" },
				{ name: 42 },
				{ commit: { sha: SHA_A } },
				{ name: "v2.0.0" },
			]),
		]);
		const adapter = getAdapter("github.com", { fetchImpl: fn, env: {} });
		const tags = await adapter.listTags("foo/bar");
		expect(tags).toEqual(["v1.0.0", "v2.0.0"]);
	});
});

describe("GitHubAdapter.downloadTarball", () => {
	it("returns a Readable from the response body", async () => {
		const tarball = makeWrappedTarballBytes("a-b-cccdddd", {
			"a.txt": "hi",
		});
		const { fn } = stubFetch([tarballRes(tarball)]);
		const adapter = getAdapter("github.com", {
			fetchImpl: fn,
			env: {},
			retries: 0,
		});
		const stream = await adapter.downloadTarball("a/b", SHA_A);
		expect(stream).toBeInstanceOf(Readable);
		const chunks: Buffer[] = [];
		for await (const c of stream) chunks.push(c as Buffer);
		expect(Buffer.concat(chunks).length).toBe(tarball.length);
	});

	it("throws when response has no body", async () => {
		const { fn } = stubFetch([new Response(null, { status: 200 })]);
		const adapter = getAdapter("github.com", {
			fetchImpl: fn,
			env: {},
			retries: 0,
		});
		await expect(adapter.downloadTarball("a/b", SHA_A)).rejects.toThrow(
			/no body/,
		);
	});
});
