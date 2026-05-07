import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

	it("builds and dispatches a program with multiple subcmds", () => {
		const src = join(tempDir, "todo.esp");
		const out = join(tempDir, "todo");
		writeFileSync(
			src,
			`program todo do
  desc "todo manager"
  version "0.1.0"
  flag loud: bool = false

  cmd add do
    arg item: str
    msg = "added: #{item}"
    msg |> when(loud, upcase) |> print
  end

  cmd remove do
    arg id: int
    "removed: #{id}" |> print
  end
end
`,
		);
		build({ entryFile: src, outFile: out });

		expect(execFileSync(out, ["add", "milk"], { encoding: "utf-8" })).toBe(
			"added: milk\n",
		);
		expect(execFileSync(out, ["remove", "3"], { encoding: "utf-8" })).toBe(
			"removed: 3\n",
		);
		expect(
			execFileSync(out, ["--loud", "add", "milk"], { encoding: "utf-8" }),
		).toBe("ADDED: MILK\n");
		expect(execFileSync(out, ["--version"], { encoding: "utf-8" })).toBe(
			"0.1.0\n",
		);

		const helpOut = execFileSync(out, ["--help"], { encoding: "utf-8" });
		expect(helpOut).toContain("Usage: todo <command>");
		expect(helpOut).toContain("add");
		expect(helpOut).toContain("remove");
	});

	it("preserves build-time __file__ and __dir__ in compiled binary", () => {
		const src = join(tempDir, "show.esp");
		const out = join(tempDir, "show");
		writeFileSync(
			src,
			`cmd run do
  print(__file__)
  print(__dir__)
end
`,
		);
		build({ entryFile: src, outFile: out });
		const result = execFileSync(out, [], { encoding: "utf-8" });
		expect(result).toBe(`${src}\n${tempDir}\n`);
	});

	it("__dir__ in imported module resolves to imported module's build-time dir", () => {
		const subDir = join(tempDir, "subdir");
		mkdirSync(subDir, { recursive: true });
		const lib = join(subDir, "lib.esp");
		const src = join(tempDir, "entry.esp");
		const out = join(tempDir, "entry");
		writeFileSync(lib, "def lib_dir() = __dir__\n");
		writeFileSync(
			src,
			`import "./subdir/lib" only [lib_dir]
cmd run do
  print(__dir__)
  print(lib_dir())
end
`,
		);
		build({ entryFile: src, outFile: out });
		const result = execFileSync(out, [], { encoding: "utf-8" });
		expect(result).toBe(`${tempDir}\n${subDir}\n`);
	});
});
