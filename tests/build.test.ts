import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../src/build";

const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;
const describeIfBun = hasBun ? describe : describe.skip;

describeIfBun("espeto build", () => {
	let tempDir: string;

	beforeAll(() => {
		tempDir = mkdtempSync(join(tmpdir(), "espeto-build-test-"));
	});

	afterAll(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("builds and runs a single-file program", () => {
		const src = join(tempDir, "single.esp");
		const out = join(tempDir, "single");
		writeFileSync(
			src,
			'cmd hi do\n  arg name: str\n  "hi #{name}" |> print\nend\n',
		);
		build({ entryFile: src, outFile: out });
		const result = execFileSync(out, ["world"], { encoding: "utf-8" });
		expect(result).toBe("hi world\n");
	});

	it("builds and runs a multi-file program with imports", () => {
		const lib = join(tempDir, "lib.esp");
		const src = join(tempDir, "main.esp");
		const out = join(tempDir, "main");
		writeFileSync(lib, "def shout(s) = \"#{s}!\"\n");
		writeFileSync(
			src,
			'import "./lib" only [shout]\n\ncmd hi do\n  arg name: str\n  shout(name) |> print\nend\n',
		);
		build({ entryFile: src, outFile: out });
		const result = execFileSync(out, ["world"], { encoding: "utf-8" });
		expect(result).toBe("world!\n");
	});

	it("propagates flags to the compiled cmd", () => {
		const src = join(tempDir, "flags.esp");
		const out = join(tempDir, "flags");
		writeFileSync(
			src,
			'cmd hi do\n  arg name: str\n  flag loud: bool = false\n  "hi #{name}" |> when(loud, upcase) |> print\nend\n',
		);
		build({ entryFile: src, outFile: out });
		expect(execFileSync(out, ["world"], { encoding: "utf-8" })).toBe(
			"hi world\n",
		);
		expect(execFileSync(out, ["world", "--loud"], { encoding: "utf-8" })).toBe(
			"HI WORLD\n",
		);
	});
});
