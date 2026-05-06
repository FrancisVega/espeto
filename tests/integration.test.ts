import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { run } from "../src/run";

const examplesDir = resolve(import.meta.dirname, "../examples");
const examples = readdirSync(examplesDir, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => d.name)
	.sort();

describe.each(examples)("examples/%s", (name) => {
	it("matches expected_stdout.txt", () => {
		const dir = resolve(examplesDir, name);
		const source = readFileSync(`${dir}/cmd.esp`, "utf-8");
		const expected = readFileSync(`${dir}/expected_stdout.txt`, "utf-8");
		const argsPath = `${dir}/args.txt`;
		const cmdArgv = existsSync(argsPath)
			? readFileSync(argsPath, "utf-8").trim().split(/\s+/).filter(Boolean)
			: null;

		const writes: string[] = [];
		const spy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk: unknown) => {
				writes.push(String(chunk));
				return true;
			});
		try {
			run(source, `examples/${name}/cmd.esp`, { cmdArgv });
		} finally {
			spy.mockRestore();
		}
		expect(writes.join("")).toBe(expected);
	});
});
