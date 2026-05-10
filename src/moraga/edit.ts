import type { MapExpr, Module } from "../ast";
import { EspetoError } from "../errors";
import { lex } from "../lexer";
import { parse } from "../parser";
import { type DepSpec, parseManifest } from "./manifest";

export class EditError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EditError";
	}
}

export type AddDepOpts = {
	dev?: boolean;
	alias?: string;
};

export type AddDepResult = {
	source: string;
	changed: boolean;
};

const FILE = "<edit>";

export function addDepToManifest(
	source: string,
	url: string,
	version: string,
	opts: AddDepOpts = {},
): AddDepResult {
	const r = parseManifest(source, FILE);
	if (!r.ok) {
		const lines = r.errors.map((e) => `  - ${e.message}`).join("\n");
		throw new EditError(`manifest is invalid:\n${lines}`);
	}
	const manifest = r.manifest;

	const targetField = opts.dev ? "dev_deps" : "deps";
	const otherField = opts.dev ? "deps" : "dev_deps";
	const targetMap = opts.dev ? manifest.devDeps : manifest.deps;
	const otherMap = opts.dev ? manifest.deps : manifest.devDeps;

	if (otherMap.has(url)) {
		const flagHint = opts.dev
			? "re-run without --dev"
			: "re-run with --dev";
		throw new EditError(
			`${url} is already in "${otherField}". Remove it from "${otherField}" first, or ${flagHint} to add it to "${otherField}" instead.`,
		);
	}

	const existing = targetMap.get(url);
	if (existing) {
		const sameVersion = existing.version === version;
		const sameAlias = (existing.alias ?? undefined) === opts.alias;
		if (sameVersion && sameAlias) {
			return { source, changed: false };
		}
		if (!sameVersion) {
			throw new EditError(
				`${url} is already in "${targetField}" at ${existing.version}. To change its version, remove it first with 'espeto remove ${url}' and re-add with the new version.`,
			);
		}
		const aliasDesc = existing.alias ? `"${existing.alias}"` : "(none)";
		throw new EditError(
			`${url} is already in "${targetField}" with alias ${aliasDesc}. To change its alias, remove it first with 'espeto remove ${url}'.`,
		);
	}

	const targetMapExpr = locateTargetMap(source, targetField);
	const lbraceOffset = lineColToOffset(
		source,
		targetMapExpr.span.line,
		targetMapExpr.span.col,
	);
	if (source[lbraceOffset] !== "{") {
		throw new EditError(
			`internal: expected '{' at offset ${lbraceOffset}, got ${JSON.stringify(source[lbraceOffset])}`,
		);
	}
	const rbraceOffset = matchClosingBrace(source, lbraceOffset);

	const outerIndent = getLineIndent(source, lbraceOffset);
	const defaultEntryIndent = `${outerIndent}  `;
	const entryIndent = pickEntryIndent(
		source,
		targetMapExpr,
		defaultEntryIndent,
	);

	const newEntry = formatEntry(url, version, opts.alias, entryIndent);
	const inner = source.slice(lbraceOffset + 1, rbraceOffset);
	const innerHasContent = inner.trim() !== "";
	const isMultiline = inner.includes("\n");

	if (!innerHasContent) {
		const replacement = `{\n${defaultEntryIndent}${newEntry}\n${outerIndent}}`;
		return {
			source:
				source.slice(0, lbraceOffset) +
				replacement +
				source.slice(rbraceOffset + 1),
			changed: true,
		};
	}

	if (!isMultiline) {
		const reprinted = reprintEntries(targetMap, defaultEntryIndent);
		const allEntries = [...reprinted, newEntry];
		const replacement = `{\n${defaultEntryIndent}${allEntries.join(`,\n${defaultEntryIndent}`)}\n${outerIndent}}`;
		return {
			source:
				source.slice(0, lbraceOffset) +
				replacement +
				source.slice(rbraceOffset + 1),
			changed: true,
		};
	}

	let i = rbraceOffset - 1;
	while (i > lbraceOffset && /\s/.test(source[i]!)) i--;
	const lastNonWs = source[i]!;
	const insertAt = i + 1;
	const prefix = lastNonWs === "," ? "" : ",";
	return {
		source:
			source.slice(0, insertAt) +
			`${prefix}\n${entryIndent}${newEntry}` +
			source.slice(insertAt),
		changed: true,
	};
}

function locateTargetMap(source: string, field: string): MapExpr {
	let module: Module;
	try {
		const tokens = lex(source, FILE);
		module = parse(tokens, source);
	} catch (e) {
		if (e instanceof EspetoError) {
			throw new EditError(`failed to parse manifest: ${e.message}`);
		}
		throw e;
	}
	const top = module.items[0];
	if (!top || !isMap(top)) {
		throw new EditError("manifest must be a single map literal at top level");
	}
	const fieldEntry = top.entries.find((e) => e.key === field);
	if (!fieldEntry) {
		throw new EditError(`manifest is missing "${field}" field`);
	}
	if (fieldEntry.value.kind !== "map") {
		throw new EditError(`manifest field "${field}" is not a map`);
	}
	return fieldEntry.value;
}

function isMap(item: unknown): item is MapExpr {
	return (
		!!item &&
		typeof item === "object" &&
		"kind" in item &&
		(item as { kind: string }).kind === "map"
	);
}

function lineColToOffset(source: string, line: number, col: number): number {
	let offset = 0;
	let currentLine = 1;
	while (currentLine < line && offset < source.length) {
		if (source[offset] === "\n") currentLine++;
		offset++;
	}
	return offset + (col - 1);
}

function getLineIndent(source: string, offset: number): string {
	let lineStart = offset;
	while (lineStart > 0 && source[lineStart - 1] !== "\n") lineStart--;
	let i = lineStart;
	while (
		i < source.length &&
		(source[i] === " " || source[i] === "\t")
	)
		i++;
	return source.slice(lineStart, i);
}

function pickEntryIndent(
	source: string,
	mapExpr: MapExpr,
	fallback: string,
): string {
	if (mapExpr.entries.length === 0) return fallback;
	const firstKey = mapExpr.entries[0]!.keySpan;
	const keyOffset = lineColToOffset(source, firstKey.line, firstKey.col);
	const indent = getLineIndent(source, keyOffset);
	return indent === "" ? fallback : indent;
}

function matchClosingBrace(source: string, lbraceOffset: number): number {
	let depth = 1;
	let i = lbraceOffset + 1;
	while (i < source.length) {
		const c = source[i]!;
		if (c === '"') {
			i++;
			while (i < source.length && source[i] !== '"') {
				if (source[i] === "\\") i += 2;
				else i++;
			}
			i++;
			continue;
		}
		if (c === "#") {
			while (i < source.length && source[i] !== "\n") i++;
			continue;
		}
		if (c === "{") depth++;
		else if (c === "}") {
			depth--;
			if (depth === 0) return i;
		}
		i++;
	}
	throw new EditError(
		`unbalanced braces in manifest starting at offset ${lbraceOffset}`,
	);
}

function formatEntry(
	url: string,
	version: string,
	alias: string | undefined,
	indent: string,
): string {
	if (alias === undefined) {
		return `${jsonStr(url)}: ${jsonStr(version)}`;
	}
	const inner = `${indent}  `;
	return `${jsonStr(url)}: {\n${inner}"version": ${jsonStr(version)},\n${inner}"as": ${jsonStr(alias)}\n${indent}}`;
}

function reprintEntries(
	deps: Map<string, DepSpec>,
	indent: string,
): string[] {
	const out: string[] = [];
	for (const [url, spec] of deps) {
		out.push(formatEntry(url, spec.version, spec.alias, indent));
	}
	return out;
}

function jsonStr(s: string): string {
	return JSON.stringify(s);
}
