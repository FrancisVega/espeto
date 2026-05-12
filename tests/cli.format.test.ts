import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BIN = join(__dirname, "..", "bin", "espeto");

function runEspeto(
	args: string[],
	opts: { input?: string } = {},
): { status: number; stdout: string; stderr: string } {
	const r = spawnSync(BIN, args, {
		encoding: "utf-8",
		input: opts.input,
	});
	return {
		status: r.status ?? -1,
		stdout: r.stdout ?? "",
		stderr: r.stderr ?? "",
	};
}

describe("espeto format CLI", () => {
	let tmp: string;

	beforeAll(() => {
		tmp = mkdtempSync(join(tmpdir(), "espeto-format-cli-"));
	});

	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("writes formatted output to file by default", () => {
		const f = join(tmp, "write.esp");
		writeFileSync(f, "x=1\n");
		const r = runEspeto(["format", f]);
		expect(r.status).toBe(0);
		expect(r.stdout).toBe("");
		expect(readFileSync(f, "utf-8")).toBe("x = 1\n");
	});

	it("is silent and idempotent when file is already formatted", () => {
		const f = join(tmp, "idem.esp");
		writeFileSync(f, "x = 1\n");
		const r = runEspeto(["format", f]);
		expect(r.status).toBe(0);
		expect(r.stdout).toBe("");
		expect(r.stderr).toBe("");
		expect(readFileSync(f, "utf-8")).toBe("x = 1\n");
	});

	it("--check exits 0 when files are already formatted", () => {
		const f = join(tmp, "check-ok.esp");
		writeFileSync(f, "x = 1\n");
		const r = runEspeto(["format", "--check", f]);
		expect(r.status).toBe(0);
		expect(r.stdout).toBe("");
	});

	it("--check exits 1 and lists files that need formatting", () => {
		const f = join(tmp, "check-fail.esp");
		writeFileSync(f, "x=1\n");
		const r = runEspeto(["format", "--check", f]);
		expect(r.status).toBe(1);
		expect(r.stdout).toBe(`${f}\n`);
		expect(readFileSync(f, "utf-8")).toBe("x=1\n");
	});

	it("--stdin reads stdin and writes formatted output to stdout", () => {
		const r = runEspeto(["format", "--stdin"], { input: "x=1\n" });
		expect(r.status).toBe(0);
		expect(r.stdout).toBe("x = 1\n");
	});

	it("--stdin-filepath is reflected in error output", () => {
		const r = runEspeto(
			["format", "--stdin", "--stdin-filepath", "buffer.esp"],
			{ input: "if c do\n" },
		);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("buffer.esp");
	});

	it("walks directories recursively for *.esp files", () => {
		const root = join(tmp, "walk");
		mkdirSync(join(root, "sub"), { recursive: true });
		writeFileSync(join(root, "a.esp"), "x=1\n");
		writeFileSync(join(root, "sub", "b.esp"), "y=2\n");
		writeFileSync(join(root, "ignore.txt"), "not espeto\n");
		const r = runEspeto(["format", root]);
		expect(r.status).toBe(0);
		expect(readFileSync(join(root, "a.esp"), "utf-8")).toBe("x = 1\n");
		expect(readFileSync(join(root, "sub", "b.esp"), "utf-8")).toBe("y = 2\n");
		expect(readFileSync(join(root, "ignore.txt"), "utf-8")).toBe(
			"not espeto\n",
		);
	});

	it("skips .espetos/, .git/, node_modules/ during walk", () => {
		const root = join(tmp, "skip");
		mkdirSync(join(root, ".espetos"), { recursive: true });
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(join(root, "node_modules"), { recursive: true });
		writeFileSync(join(root, "ok.esp"), "x=1\n");
		writeFileSync(join(root, ".espetos", "dep.esp"), "y=2\n");
		writeFileSync(join(root, ".git", "g.esp"), "y=2\n");
		writeFileSync(join(root, "node_modules", "n.esp"), "y=2\n");
		const r = runEspeto(["format", root]);
		expect(r.status).toBe(0);
		expect(readFileSync(join(root, "ok.esp"), "utf-8")).toBe("x = 1\n");
		expect(readFileSync(join(root, ".espetos", "dep.esp"), "utf-8")).toBe(
			"y=2\n",
		);
		expect(readFileSync(join(root, ".git", "g.esp"), "utf-8")).toBe("y=2\n");
		expect(
			readFileSync(join(root, "node_modules", "n.esp"), "utf-8"),
		).toBe("y=2\n");
	});

	it("exits 1 and reports parse error for a single broken file", () => {
		const f = join(tmp, "broken.esp");
		writeFileSync(f, "if c do\n");
		const r = runEspeto(["format", f]);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("error");
		expect(r.stderr).toContain(f);
		expect(readFileSync(f, "utf-8")).toBe("if c do\n");
	});

	it("skips broken files in a directory walk, formats the rest, exits 1", () => {
		const root = join(tmp, "mixed");
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "good.esp"), "x=1\n");
		writeFileSync(join(root, "broken.esp"), "if c do\n");
		const r = runEspeto(["format", root]);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("broken.esp");
		expect(readFileSync(join(root, "good.esp"), "utf-8")).toBe("x = 1\n");
		expect(readFileSync(join(root, "broken.esp"), "utf-8")).toBe("if c do\n");
	});

	it("exits 2 with no args and no --stdin", () => {
		const r = runEspeto(["format"]);
		expect(r.status).toBe(2);
		expect(r.stderr).toContain("specify file or directory");
	});

	it("exits 2 when the path does not exist", () => {
		const r = runEspeto(["format", join(tmp, "does-not-exist.esp")]);
		expect(r.status).toBe(2);
		expect(r.stderr).toContain("path not found");
	});

	it("exits 2 when --stdin and a positional path are combined", () => {
		const r = runEspeto(["format", "--stdin", "some/path.esp"]);
		expect(r.status).toBe(2);
		expect(r.stderr).toContain("mutually exclusive");
	});

	it("exits 2 when --stdin-filepath is used without --stdin", () => {
		const r = runEspeto([
			"format",
			"--stdin-filepath",
			"x.esp",
			join(tmp, "write.esp"),
		]);
		expect(r.status).toBe(2);
		expect(r.stderr).toContain("--stdin-filepath requires --stdin");
	});
});
