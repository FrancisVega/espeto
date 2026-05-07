/**
 * Generate dist/stdlib.manifest.json + dist/stdlib.d.esp from JSDoc on
 * stdlib BuiltinFn exports. Consumed by the LSP server to power hover
 * and go-to-definition.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STDLIB_DIR = join(ROOT, "src/stdlib");
const OUT_DIR = join(ROOT, "dist");
const MANIFEST_PATH = join(OUT_DIR, "stdlib.manifest.json");
const STUB_PATH = join(OUT_DIR, "stdlib.d.esp");
const GENERATED_TS_PATH = join(ROOT, "src/lsp/generated.ts");

type Param = { name: string; type: string; doc: string };
type Returns = { type: string; doc: string };

type FnDoc = {
	name: string;
	module: string;
	summary: string;
	description: string;
	params: Param[];
	returns: Returns;
	examples: string[];
	definedAt: { file: string; line: number };
	stubLine: number;
};

type Manifest = {
	version: string;
	generatedAt: string;
	functions: Record<string, FnDoc>;
};

function readPackageVersion(): string {
	const pkg = JSON.parse(
		readFileSync(join(ROOT, "package.json"), "utf-8"),
	) as { version: string };
	return pkg.version;
}

function loadRegistry(): Map<string, string> {
	const indexPath = join(STDLIB_DIR, "index.ts");
	const src = readFileSync(indexPath, "utf-8");
	const sf = ts.createSourceFile(
		indexPath,
		src,
		ts.ScriptTarget.Latest,
		true,
	);
	const registry = new Map<string, string>();
	const visit = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			ts.isIdentifier(node.expression.expression) &&
			node.expression.expression.text === "env" &&
			node.expression.name.text === "define"
		) {
			const arg0 = node.arguments[0];
			const arg1 = node.arguments[1];
			if (
				arg0 &&
				ts.isStringLiteral(arg0) &&
				arg1 &&
				ts.isIdentifier(arg1)
			) {
				registry.set(arg1.text, arg0.text);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return registry;
}

type ImportInfo = { module: string; originalName: string };

function loadImports(): Map<string, ImportInfo> {
	const indexPath = join(STDLIB_DIR, "index.ts");
	const src = readFileSync(indexPath, "utf-8");
	const sf = ts.createSourceFile(
		indexPath,
		src,
		ts.ScriptTarget.Latest,
		true,
	);
	const importMap = new Map<string, ImportInfo>();
	for (const stmt of sf.statements) {
		if (!ts.isImportDeclaration(stmt)) continue;
		const spec = stmt.moduleSpecifier;
		if (!ts.isStringLiteral(spec)) continue;
		const modulePath = spec.text;
		if (!modulePath.startsWith("./")) continue;
		const moduleName = modulePath.slice(2);
		const clause = stmt.importClause;
		if (!clause?.namedBindings) continue;
		if (!ts.isNamedImports(clause.namedBindings)) continue;
		for (const elem of clause.namedBindings.elements) {
			const localName = elem.name.text;
			const originalName = elem.propertyName?.text ?? localName;
			importMap.set(localName, { module: moduleName, originalName });
		}
	}
	return importMap;
}

function jsdocCommentText(
	comment: string | ts.NodeArray<ts.JSDocComment> | undefined,
): string {
	if (!comment) return "";
	if (typeof comment === "string") return comment.trim();
	return comment
		.map((c) => (c.kind === ts.SyntaxKind.JSDocText ? c.text : ""))
		.join("")
		.trim();
}

function extractJSDoc(
	stmt: ts.VariableStatement,
): {
	summary: string;
	description: string;
	params: Param[];
	returns: Returns;
	examples: string[];
} | null {
	const jsdocs = ts.getJSDocCommentsAndTags(stmt) as readonly ts.JSDoc[];
	if (jsdocs.length === 0) return null;
	const jsdoc = jsdocs[0];
	if (!jsdoc) return null;

	const fullComment = jsdocCommentText(jsdoc.comment);
	const lines = fullComment.split(/\r?\n/);
	const summary = (lines[0] ?? "").trim();
	const description = lines.slice(1).join("\n").trim();

	const params: Param[] = [];
	let returns: Returns = { type: "any", doc: "" };
	const examples: string[] = [];

	for (const tag of jsdoc.tags ?? []) {
		if (ts.isJSDocParameterTag(tag)) {
			const name = ts.isIdentifier(tag.name) ? tag.name.text : "";
			const type = jsdocTypeText(tag.typeExpression);
			const doc = jsdocCommentText(tag.comment).replace(/^[-—\s]+/, "");
			params.push({ name, type, doc });
		} else if (ts.isJSDocReturnTag(tag)) {
			returns = {
				type: jsdocTypeText(tag.typeExpression),
				doc: jsdocCommentText(tag.comment),
			};
		} else if (tag.tagName.text === "example") {
			examples.push(jsdocCommentText(tag.comment));
		}
	}

	return { summary, description, params, returns, examples };
}

function jsdocTypeText(
	type: ts.JSDocTypeExpression | undefined,
): string {
	if (!type) return "any";
	const t = type.type;
	return t.getText().trim();
}

function staticEspetoName(decl: ts.VariableDeclaration): string | null {
	const init = decl.initializer;
	if (!init) return null;
	if (ts.isObjectLiteralExpression(init)) {
		for (const prop of init.properties) {
			if (
				ts.isPropertyAssignment(prop) &&
				ts.isIdentifier(prop.name) &&
				prop.name.text === "name" &&
				ts.isStringLiteral(prop.initializer)
			) {
				return prop.initializer.text;
			}
		}
		return null;
	}
	if (ts.isCallExpression(init)) {
		const arg0 = init.arguments[0];
		if (arg0 && ts.isStringLiteral(arg0)) return arg0.text;
		return null;
	}
	return null;
}

type ParsedExport = {
	jsName: string;
	espetoName: string;
	module: string;
	jsdoc: NonNullable<ReturnType<typeof extractJSDoc>>;
	definedAt: { file: string; line: number };
};

function parseModule(filePath: string): ParsedExport[] {
	const src = readFileSync(filePath, "utf-8");
	const sf = ts.createSourceFile(
		filePath,
		src,
		ts.ScriptTarget.Latest,
		true,
	);
	const moduleName = basename(filePath).replace(/\.ts$/, "");
	const out: ParsedExport[] = [];

	for (const stmt of sf.statements) {
		if (!ts.isVariableStatement(stmt)) continue;
		const isExported = stmt.modifiers?.some(
			(m) => m.kind === ts.SyntaxKind.ExportKeyword,
		);
		if (!isExported) continue;

		const jsdoc = extractJSDoc(stmt);
		if (!jsdoc) continue;

		for (const decl of stmt.declarationList.declarations) {
			if (!ts.isIdentifier(decl.name)) continue;
			const jsName = decl.name.text;
			const espetoName = staticEspetoName(decl);
			if (!espetoName) continue;

			const { line } = sf.getLineAndCharacterOfPosition(decl.name.getStart(sf));
			out.push({
				jsName,
				espetoName,
				module: moduleName,
				jsdoc,
				definedAt: {
					file: `src/stdlib/${basename(filePath)}`,
					line: line + 1,
				},
			});
		}
	}
	return out;
}

function renderSignature(fn: FnDoc): string {
	const paramText = fn.params.map((p) => `${p.name}: ${p.type}`).join(", ");
	return `${fn.name}(${paramText}) -> ${fn.returns.type}`;
}

function renderStub(functions: FnDoc[]): { content: string; lineMap: Map<string, number> } {
	const byModule = new Map<string, FnDoc[]>();
	for (const fn of functions) {
		const arr = byModule.get(fn.module) ?? [];
		arr.push(fn);
		byModule.set(fn.module, arr);
	}

	const lines: string[] = [];
	const lineMap = new Map<string, number>();
	const push = (s: string) => lines.push(s);

	push("# Espeto stdlib (auto-generated; do not edit)");
	push("# Target of go-to-definition for builtin functions.");
	push("# Hover over any builtin in your code to see its docs.");
	push("");

	const moduleOrder = [
		"strings",
		"numbers",
		"lists",
		"maps",
		"io",
		"json",
		"predicates",
		"pipe",
		"errors",
	];
	const seenModules = new Set<string>();
	const orderedModules: string[] = [];
	for (const m of moduleOrder) {
		if (byModule.has(m)) {
			orderedModules.push(m);
			seenModules.add(m);
		}
	}
	for (const m of byModule.keys()) {
		if (!seenModules.has(m)) orderedModules.push(m);
	}

	for (const moduleName of orderedModules) {
		const fns = byModule.get(moduleName) ?? [];
		fns.sort((a, b) => a.name.localeCompare(b.name));
		push(`# ─── ${moduleName} ${"─".repeat(60 - moduleName.length)}`);
		push("");
		for (const fn of fns) {
			lineMap.set(fn.name, lines.length + 1);
			push(`# ${renderSignature(fn)}`);
			push("#");
			for (const line of fn.summary.split(/\r?\n/)) {
				push(`# ${line}`);
			}
			if (fn.description) {
				push("#");
				for (const line of fn.description.split(/\r?\n/)) {
					push(`# ${line}`);
				}
			}
			if (fn.examples.length > 0) {
				push("#");
				push("# Example:");
				for (const ex of fn.examples) {
					for (const line of ex.split(/\r?\n/)) {
						push(`#   ${line}`);
					}
				}
			}
			push("");
		}
	}

	return { content: lines.join("\n"), lineMap };
}

function main(): void {
	const registry = loadRegistry();
	const imports = loadImports();
	const files = readdirSync(STDLIB_DIR)
		.filter((f) => f.endsWith(".ts") && f !== "index.ts")
		.map((f) => join(STDLIB_DIR, f));

	const allExports = new Map<string, ParsedExport>();
	for (const file of files) {
		for (const exp of parseModule(file)) {
			allExports.set(exp.jsName, exp);
		}
	}

	const functions: FnDoc[] = [];
	const missing: string[] = [];
	for (const [jsName, espetoName] of registry) {
		const importInfo = imports.get(jsName);
		const sourceName = importInfo?.originalName ?? jsName;
		const exp = allExports.get(sourceName);
		if (!exp) {
			missing.push(`${espetoName} (js: ${jsName})`);
			continue;
		}
		if (exp.espetoName !== espetoName) {
			console.warn(
				`warn: name mismatch for ${jsName}: index says "${espetoName}", source says "${exp.espetoName}"`,
			);
		}
		const moduleFromImports = importInfo?.module ?? exp.module;
		functions.push({
			name: espetoName,
			module: moduleFromImports,
			summary: exp.jsdoc.summary,
			description: exp.jsdoc.description,
			params: exp.jsdoc.params,
			returns: exp.jsdoc.returns,
			examples: exp.jsdoc.examples,
			definedAt: exp.definedAt,
			stubLine: 0,
		});
	}

	if (missing.length > 0) {
		console.error(
			`error: ${missing.length} registered builtins lack JSDoc:\n  ${missing.join("\n  ")}`,
		);
		process.exit(1);
	}

	const sorted = [...functions].sort((a, b) => a.name.localeCompare(b.name));
	const { content: stubContent, lineMap } = renderStub(sorted);

	for (const fn of functions) {
		fn.stubLine = lineMap.get(fn.name) ?? 0;
	}

	const fnRecord: Record<string, FnDoc> = {};
	for (const fn of [...functions].sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		fnRecord[fn.name] = fn;
	}

	const manifest: Manifest = {
		version: readPackageVersion(),
		generatedAt: new Date().toISOString(),
		functions: fnRecord,
	};

	mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
	writeFileSync(STUB_PATH, `${stubContent}\n`);

	const generatedTs = `// AUTO-GENERATED by scripts/build-manifest.ts. Do not edit.
import type { Manifest } from "./manifest-types";

export const MANIFEST: Manifest = ${JSON.stringify(manifest, null, 2)} as Manifest;

export const STUB_CONTENT: string = ${JSON.stringify(`${stubContent}\n`)};
`;
	writeFileSync(GENERATED_TS_PATH, generatedTs);

	console.log(
		`built ${MANIFEST_PATH} (${functions.length} functions)\nbuilt ${STUB_PATH}\nbuilt ${GENERATED_TS_PATH}`,
	);
}

main();
