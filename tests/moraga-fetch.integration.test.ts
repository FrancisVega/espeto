import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensurePackageCached } from "../src/moraga/resolve";

const SKIP = process.env.ESPETO_OFFLINE === "1";

const tmps: string[] = [];
afterEach(() => {
	while (tmps.length > 0) {
		const d = tmps.pop();
		if (d) spawnSync("rm", ["-rf", d]);
	}
});

function mkTmp(): { root: string; tmpRoot: string } {
	const root = mkdtempSync(join(tmpdir(), "moraga-int-"));
	tmps.push(root);
	return { root, tmpRoot: join(root, ".tmp") };
}

describe.skipIf(SKIP)("ensurePackageCached — real GitHub", () => {
	it(
		"downloads sindresorhus/escape-string-regexp@5.0.0 and caches it",
		async () => {
			const paths = mkTmp();
			const result = await ensurePackageCached(
				"github.com/sindresorhus/escape-string-regexp",
				"5.0.0",
				{ paths, retries: 1 },
			);

			expect(result.host).toBe("github.com");
			expect(result.repoPath).toBe("sindresorhus/escape-string-regexp");
			expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
			expect(result.checksum).toMatch(/^h1:[0-9a-f]{64}$/);
			expect(result.cachePath).toBe(
				join(
					paths.root,
					"github.com",
					"sindresorhus",
					"escape-string-regexp",
					result.sha,
				),
			);
			expect(existsSync(join(result.cachePath, "package.json"))).toBe(true);
			expect(existsSync(join(result.cachePath, "index.js"))).toBe(true);
		},
		60_000,
	);

	it(
		"second call hits the cache and reproduces the same checksum",
		async () => {
			const paths = mkTmp();
			const a = await ensurePackageCached(
				"github.com/sindresorhus/escape-string-regexp",
				"5.0.0",
				{ paths, retries: 1 },
			);
			const b = await ensurePackageCached(
				"github.com/sindresorhus/escape-string-regexp",
				"5.0.0",
				{ paths, retries: 1 },
			);
			expect(b.sha).toBe(a.sha);
			expect(b.checksum).toBe(a.checksum);
			expect(b.cachePath).toBe(a.cachePath);
		},
		60_000,
	);
});
