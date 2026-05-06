import { readFileSync } from "node:fs";
import { basename, dirname, resolve as resolvePath } from "node:path";
import type { ImportItem, Program } from "./ast";
import { Env } from "./env";
import { EspetoError } from "./errors";
import { evaluate } from "./evaluator";
import { lex } from "./lexer";
import { parse } from "./parser";

export type ResolvedModule = { absPath: string; source: string };

export type Resolver = (
	importerAbsPath: string,
	importPath: string,
) => ResolvedModule;

export const defaultResolver: Resolver = (importerAbsPath, importPath) => {
	const absPath = resolvePath(dirname(importerAbsPath), `${importPath}.esp`);
	const source = readFileSync(absPath, "utf-8");
	return { absPath, source };
};

export type LoadedModule = {
	absPath: string;
	source: string;
	program: Program;
	env: Env;
	exportedNames: Set<string>;
	privateNames: Set<string>;
};

export class ModuleLoader {
	private cache = new Map<string, LoadedModule>();
	private loading: string[] = [];

	constructor(
		private readonly preludeEnv: Env,
		private readonly resolver: Resolver,
	) {}

	loadInto(
		program: Program,
		env: Env,
		importerAbsPath: string,
		importerSource: string,
	): void {
		const importedFromPath = new Map<string, string>();
		const importedBindings = new Map<string, string>();

		for (const item of program.items) {
			if (item.kind !== "import") continue;

			let resolved: ResolvedModule;
			try {
				resolved = this.resolver(importerAbsPath, item.path);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				throw new EspetoError(
					`cannot resolve import '${item.path}': ${msg}`,
					item.pathSpan,
					importerSource,
				);
			}

			if (importedFromPath.has(resolved.absPath)) {
				throw new EspetoError(
					`duplicate import '${item.path}'; merge into single 'only [...]'`,
					item.span,
					importerSource,
				);
			}
			importedFromPath.set(resolved.absPath, item.path);

			const module = this.load(resolved, item, importerSource);

			injectImport(env, module, item, importerSource, importedBindings);
		}
	}

	private load(
		resolved: ResolvedModule,
		importItem: ImportItem,
		importerSource: string,
	): LoadedModule {
		const cached = this.cache.get(resolved.absPath);
		if (cached) return cached;

		if (this.loading.includes(resolved.absPath)) {
			const chain = [...this.loading, resolved.absPath]
				.map((p) => basename(p))
				.join(" -> ");
			throw new EspetoError(
				`circular import: ${chain}`,
				importItem.pathSpan,
				importerSource,
			);
		}

		const tokens = lex(resolved.source, resolved.absPath);
		const program = parse(tokens, resolved.source);

		validateImportableModule(program, resolved.source);

		this.loading.push(resolved.absPath);
		try {
			const env = this.preludeEnv.extend();
			this.loadInto(program, env, resolved.absPath, resolved.source);
			evaluate(program, env, resolved.source, null);

			const exportedNames = new Set<string>();
			const privateNames = new Set<string>();
			for (const it of program.items) {
				if (it.kind === "fn_def") {
					(it.exported ? exportedNames : privateNames).add(it.name);
				}
			}

			const loaded: LoadedModule = {
				absPath: resolved.absPath,
				source: resolved.source,
				program,
				env,
				exportedNames,
				privateNames,
			};
			this.cache.set(resolved.absPath, loaded);
			return loaded;
		} finally {
			this.loading.pop();
		}
	}
}

function validateImportableModule(program: Program, source: string): void {
	for (const item of program.items) {
		if (item.kind === "import" || item.kind === "fn_def") continue;
		const what =
			item.kind === "cmd"
				? "cmd"
				: item.kind === "assign"
					? "top-level assignment"
					: "top-level expression";
		throw new EspetoError(
			`importable module cannot contain ${what} (only 'def', 'defp', 'import' allowed)`,
			item.span,
			source,
		);
	}
}

function injectImport(
	importerEnv: Env,
	module: LoadedModule,
	importItem: ImportItem,
	importerSource: string,
	importedBindings: Map<string, string>,
): void {
	const only = importItem.only;
	const pathLit = importItem.path;

	if (only === undefined) {
		for (const name of module.exportedNames) {
			const prev = importedBindings.get(name);
			if (prev !== undefined) {
				throw new EspetoError(
					`name '${name}' imported from both '${prev}' and '${pathLit}'; resolve with 'only [${name} as ...]'`,
					importItem.span,
					importerSource,
				);
			}
			const v = module.env.lookup(name);
			if (v !== undefined) importerEnv.define(name, v);
			importedBindings.set(name, pathLit);
		}
		return;
	}

	for (const sel of only) {
		const targetName = sel.name;
		const bindingName = sel.as ?? sel.name;

		if (!module.exportedNames.has(targetName)) {
			const isPrivate = module.privateNames.has(targetName);
			const msg = isPrivate
				? `'${targetName}' is not exported by '${pathLit}' (private)`
				: `name '${targetName}' not defined in '${pathLit}'`;
			throw new EspetoError(msg, sel.nameSpan, importerSource);
		}

		const prev = importedBindings.get(bindingName);
		if (prev !== undefined) {
			throw new EspetoError(
				`name '${bindingName}' imported from both '${prev}' and '${pathLit}'; resolve with 'only [${bindingName} as ...]'`,
				sel.asSpan ?? sel.nameSpan,
				importerSource,
			);
		}

		const v = module.env.lookup(targetName);
		if (v !== undefined) importerEnv.define(bindingName, v);
		importedBindings.set(bindingName, pathLit);
	}
}
