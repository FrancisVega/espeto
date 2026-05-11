import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { VERSION } from "../version";
import { NAME_PATTERN } from "./manifest";

export class InitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InitError";
	}
}

export type InitOptions = {
	name?: string;
	version?: string;
	force?: boolean;
};

export type InitResult = {
	name: string;
	files: string[];
};

function sanitizeName(raw: string): string {
	return raw
		.toLowerCase()
		.replace(/[-\s]+/g, "_")
		.replace(/[^a-z0-9_]/g, "");
}

export async function runInit(
	rootDir: string,
	opts: InitOptions = {},
): Promise<InitResult> {
	const name = opts.name ?? sanitizeName(basename(rootDir));
	if (!NAME_PATTERN.test(name)) {
		throw new InitError(
			`invalid package name "${name}": must match [a-z][a-z0-9_]* (start with a letter, snake_case). Use --name to override.`,
		);
	}
	const version = opts.version ?? "0.1.0";
	const force = opts.force ?? false;

	const manifestPath = join(rootDir, "moraga.esp");
	const sourcePath = join(rootDir, "main.esp");
	const testPath = join(rootDir, "main_test.esp");

	if (!force) {
		for (const p of [manifestPath, sourcePath, testPath]) {
			if (existsSync(p)) {
				throw new InitError(
					`${p} already exists. Use --force to overwrite.`,
				);
			}
		}
	}

	const manifest = `{
  "name": "${name}",
  "version": "${version}",
  "espeto": ">= ${VERSION}",
  "deps": {},
  "dev_deps": {}
}
`;

	const source = `## ${name} package

def hello(who) do
  "hello, #{who}"
end
`;

	const test = `import "./main" only [hello]

test "hello returns a greeting" do
  assert hello("world") == "hello, world"
end
`;

	await writeFile(manifestPath, manifest, "utf8");
	await writeFile(sourcePath, source, "utf8");
	await writeFile(testPath, test, "utf8");

	return {
		name,
		files: [manifestPath, sourcePath, testPath],
	};
}
