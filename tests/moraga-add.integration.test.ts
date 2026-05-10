import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAdd } from "../src/moraga/add";

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

describe.skipIf(SKIP)("add — real GitHub", () => {
	it(
		"rolls back manifest when target repo isn't an Espeto package (no moraga.esp)",
		async () => {
			const rootDir = mkTmp("moraga-add-int-root-");
			const cacheRoot = mkTmp("moraga-add-int-cache-");
			const original = `{
  "name": "tmpapp",
  "version": "0.1.0",
  "espeto": ">= 0.1.0",
  "deps": {},
  "dev_deps": {}
}
`;
			writeFileSync(join(rootDir, "moraga.esp"), original);

			await expect(
				runAdd(
					rootDir,
					[
						{
							url: "github.com/sindresorhus/escape-string-regexp",
							version: "5.0.0",
						},
					],
					{
						paths: { root: cacheRoot, tmpRoot: join(cacheRoot, ".tmp") },
						fetchOpts: { retries: 1 },
					},
				),
			).rejects.toThrow(/install failed/);

			const after = readFileSync(join(rootDir, "moraga.esp"), "utf8");
			expect(after).toBe(original);
		},
		60_000,
	);
});
