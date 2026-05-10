import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAdapter } from "../src/moraga/fetch";
import { runOutdated } from "../src/moraga/outdated";

const SKIP = process.env.ESPETO_OFFLINE === "1";

const tmps: string[] = [];
afterEach(() => {
	while (tmps.length > 0) {
		const d = tmps.pop();
		if (d) spawnSync("rm", ["-rf", d]);
	}
});

function mkTmp(prefix: string): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	tmps.push(d);
	return d;
}

describe.skipIf(SKIP)("outdated — real GitHub", () => {
	it(
		"detects an outdated dep against real tags on escape-string-regexp",
		async () => {
			const rootDir = mkTmp("moraga-outdated-int-");
			writeFileSync(
				join(rootDir, "moraga.esp"),
				`{
  "name": "tmpapp",
  "version": "0.1.0",
  "espeto": ">= 0.1.0",
  "deps": {
    "github.com/sindresorhus/escape-string-regexp": "1.0.0"
  },
  "dev_deps": {}
}
`,
			);

			const r = await runOutdated(rootDir, {
				fetchOpts: { retries: 1 },
			});
			expect(r.deps.length).toBe(1);
			const entry = r.deps[0]!;
			expect(entry.url).toBe(
				"github.com/sindresorhus/escape-string-regexp",
			);
			expect(entry.current).toBe("1.0.0");
			expect(entry.latest).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
			expect(entry.gap).toBe("major");
		},
		60_000,
	);

	it(
		"listTags returns real semver tags from sindresorhus/escape-string-regexp",
		async () => {
			const adapter = getAdapter("github.com", { retries: 1 });
			const tags = await adapter.listTags("sindresorhus/escape-string-regexp");
			expect(tags.length).toBeGreaterThan(3);
			expect(tags.some((t) => /^v?[0-9]+\.[0-9]+\.[0-9]+$/.test(t))).toBe(true);
		},
		60_000,
	);
});
