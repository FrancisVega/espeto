import { describe, expect, it } from "vitest";
import { run } from "../src/run";

describe("stdlib/sh: sh", () => {
	it("captures stdout in the map", () => {
		const v = run(`sh("echo hola")`, "x.esp") as unknown as {
			entries: { stdout: string; stderr: string; exit_code: bigint; ok: boolean };
		};
		expect(v.entries.stdout).toBe("hola\n");
		expect(v.entries.stderr).toBe("");
		expect(v.entries.exit_code).toBe(0n);
		expect(v.entries.ok).toBe(true);
	});

	it("does not raise on non-zero exit", () => {
		const v = run(`sh("false")`, "x.esp") as unknown as {
			entries: { exit_code: bigint; ok: boolean };
		};
		expect(v.entries.exit_code).toBe(1n);
		expect(v.entries.ok).toBe(false);
	});

	it("captures stderr separately", () => {
		const v = run(
			`sh("printf 'oops' >&2; exit 2")`,
			"x.esp",
		) as unknown as {
			entries: { stdout: string; stderr: string; exit_code: bigint };
		};
		expect(v.entries.stdout).toBe("");
		expect(v.entries.stderr).toBe("oops");
		expect(v.entries.exit_code).toBe(2n);
	});

	it("supports shell features (pipes)", () => {
		const v = run(
			`sh("printf 'a\\nb\\nc' | wc -l")`,
			"x.esp",
		) as unknown as { entries: { stdout: string; ok: boolean } };
		expect(v.entries.ok).toBe(true);
		expect(v.entries.stdout.trim()).toBe("2");
	});

	it("rejects non-string argument", () => {
		expect(() => run(`sh(42)`, "x.esp")).toThrow(
			/sh: cmd must be str, got int/,
		);
	});

	it("is consumable via .field access", () => {
		const v = run(
			`r = sh("echo ok")\nif r.ok do r.stdout |> trim else "fail" end`,
			"x.esp",
		);
		expect(v).toBe("ok");
	});

	it("preserves trailing newline (raw, no implicit trim)", () => {
		const v = run(`sh("printf 'no-newline'")`, "x.esp") as unknown as {
			entries: { stdout: string };
		};
		expect(v.entries.stdout).toBe("no-newline");
	});
});

describe("stdlib/sh: sh!", () => {
	it("returns stdout as a string on success", () => {
		const v = run(`sh!("echo hola")`, "x.esp");
		expect(v).toBe("hola\n");
	});

	it("returns stdout raw without trim", () => {
		const v = run(`sh!("printf 'abc\\n\\n'")`, "x.esp");
		expect(v).toBe("abc\n\n");
	});

	it("trim is composable via pipe", () => {
		const v = run(`sh!("echo hola") |> trim`, "x.esp");
		expect(v).toBe("hola");
	});

	it("is pipe-friendly (cmd |> sh!)", () => {
		const v = run(`"echo hola" |> sh! |> trim`, "x.esp");
		expect(v).toBe("hola");
	});

	it("raises on non-zero exit with cmd + exit + stderr", () => {
		expect(() => run(`sh!("cat /no-such-file-9821xyz")`, "x.esp")).toThrow(
			/sh!: command failed \(exit 1\)/,
		);
	});

	it("includes stderr in raise message", () => {
		const v = run(
			`try sh!("cat /no-such-file-9821xyz") rescue err => err`,
			"x.esp",
		) as string;
		expect(v).toMatch(/cat /);
		expect(v).toMatch(/No such file/);
	});

	it("raises with empty stderr cleanly (no trailing whitespace)", () => {
		const v = run(`try sh!("false") rescue err => err`, "x.esp") as string;
		expect(v).toBe("sh!: command failed (exit 1):\n  false");
	});

	it("rejects non-string argument", () => {
		expect(() => run(`sh!(42)`, "x.esp")).toThrow(
			/sh!: cmd must be str, got int/,
		);
	});

	it("is recoverable via try/rescue", () => {
		const v = run(
			`try sh!("false") rescue _ => "fallback"`,
			"x.esp",
		);
		expect(v).toBe("fallback");
	});

	it("interpolation lets dynamic args flow", () => {
		const v = run(
			`name = "Mundo"\nsh!("echo Hola, #{name}!") |> trim`,
			"x.esp",
		);
		expect(v).toBe("Hola, Mundo!");
	});
});
