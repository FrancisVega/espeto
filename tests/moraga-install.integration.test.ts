import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { install } from "../src/moraga/install";

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

describe.skipIf(SKIP)("install — real GitHub", () => {
	it(
		"errors with 'missing moraga.esp' when target repo isn't an Espeto package",
		async () => {
			const rootDir = mkTmp("moraga-int-root-");
			const cacheRoot = mkTmp("moraga-int-cache-");
			writeFileSync(
				join(rootDir, "moraga.esp"),
				`{
  "name": "tmpapp",
  "version": "0.1.0",
  "espeto": ">= 0.1.0",
  "deps": {
    "github.com/sindresorhus/escape-string-regexp": "5.0.0"
  },
  "dev_deps": {}
}`,
			);
			await expect(
				install(rootDir, {
					paths: { root: cacheRoot, tmpRoot: join(cacheRoot, ".tmp") },
					fetchOpts: { retries: 1 },
				}),
			).rejects.toThrow(/missing moraga\.esp/);
		},
		60_000,
	);
});
