import { describe, expect, it, vi } from "vitest";
import { run } from "../src/run";

function captureStdout(fn: () => void): string {
	const writes: string[] = [];
	const spy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk: unknown) => {
			writes.push(String(chunk));
			return true;
		});
	try {
		fn();
	} finally {
		spy.mockRestore();
	}
	return writes.join("");
}

describe("source bindings: __file__ / __dir__", () => {
	it("__file__ at top-level resolves to entryAbsPath", () => {
		const result = run("__file__", "main.esp", {
			entryAbsPath: "/abs/main.esp",
		});
		expect(result).toBe("/abs/main.esp");
	});

	it("__dir__ at top-level resolves to dirname(entryAbsPath)", () => {
		const result = run("__dir__", "main.esp", {
			entryAbsPath: "/abs/proj/main.esp",
		});
		expect(result).toBe("/abs/proj");
	});

	it("__file__ accessible inside def body", () => {
		const out = captureStdout(() =>
			run(
				`def show() do
  print(__file__)
end
show()`,
				"main.esp",
				{ entryAbsPath: "/abs/main.esp" },
			),
		);
		expect(out).toBe("/abs/main.esp\n");
	});

	it("__dir__ accessible inside cmd body", () => {
		const out = captureStdout(() =>
			run(
				`cmd run do
  print(__dir__)
end`,
				"main.esp",
				{ entryAbsPath: "/abs/proj/main.esp", cmdArgv: [] },
			),
		);
		expect(out).toBe("/abs/proj\n");
	});

	it("lambda captures __dir__ via closure", () => {
		const out = captureStdout(() =>
			run(
				`f = fn() => __dir__
print(f())`,
				"main.esp",
				{ entryAbsPath: "/x/y/main.esp" },
			),
		);
		expect(out).toBe("/x/y\n");
	});

	it("interpolates correctly inside string templates", () => {
		const out = captureStdout(() =>
			run(`print("#{__dir__}/users.json")`, "main.esp", {
				entryAbsPath: "/data/main.esp",
			}),
		);
		expect(out).toBe("/data/users.json\n");
	});

	it("user can shadow __file__ at top-level (consistency with regular bindings)", () => {
		const out = captureStdout(() =>
			run(
				`__file__ = "shadowed"
print(__file__)`,
				"main.esp",
				{ entryAbsPath: "/abs/main.esp" },
			),
		);
		expect(out).toBe("shadowed\n");
	});
});
