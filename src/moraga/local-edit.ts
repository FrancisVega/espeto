import type { MapEntry, MapExpr, Module } from "../ast";
import { EspetoError } from "../errors";
import { lex } from "../lexer";
import { parse } from "../parser";
import { parseLocal } from "./local";

export class LocalEditError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LocalEditError";
	}
}

export type AddLinkResult = {
	source: string;
	changed: boolean;
};

export type RemoveLinkResult = {
	source: string;
	changed: boolean;
	wasPresent: boolean;
};

const FILE = "<local-edit>";

const EMPTY_LOCAL = `{
  "links": {}
}
`;

export function emptyLocalManifest(): string {
	return EMPTY_LOCAL;
}

export function addLinkToLocal(
	source: string,
	url: string,
	path: string,
): AddLinkResult {
	const src = source === "" ? EMPTY_LOCAL : source;

	const r = parseLocal(src, FILE);
	if (!r.ok) {
		const lines = r.errors.map((e) => `  - ${e.message}`).join("\n");
		throw new LocalEditError(`moraga.local.esp is invalid:\n${lines}`);
	}

	const existing = r.local.links.get(url);
	if (existing !== undefined) {
		if (existing === path) {
			return { source: src, changed: false };
		}
		throw new LocalEditError(
			`${url} is already linked to "${existing}". Run 'espeto unlink ${url}' first to relink it to a different path.`,
		);
	}

	const linksMap = locateLinksMap(src);
	if (!linksMap) {
		return { source: addLinksField(src, url, path), changed: true };
	}

	const lbraceOffset = lineColToOffset(
		src,
		linksMap.span.line,
		linksMap.span.col,
	);
	if (src[lbraceOffset] !== "{") {
		throw new LocalEditError(
			`internal: expected '{' at offset ${lbraceOffset}`,
		);
	}
	const rbraceOffset = matchClosingBrace(src, lbraceOffset);

	const outerIndent = getLineIndent(src, lbraceOffset);
	const defaultEntryIndent = `${outerIndent}  `;
	const entryIndent = pickEntryIndent(src, linksMap, defaultEntryIndent);

	const newEntry = `${jsonStr(url)}: ${jsonStr(path)}`;
	const inner = src.slice(lbraceOffset + 1, rbraceOffset);
	const innerHasContent = inner.trim() !== "";
	const isMultiline = inner.includes("\n");

	if (!innerHasContent) {
		const replacement = `{\n${defaultEntryIndent}${newEntry}\n${outerIndent}}`;
		return {
			source:
				src.slice(0, lbraceOffset) +
				replacement +
				src.slice(rbraceOffset + 1),
			changed: true,
		};
	}

	if (!isMultiline) {
		const reprinted = reprintLinks(r.local.links, defaultEntryIndent);
		const allEntries = [...reprinted, newEntry];
		const replacement = `{\n${defaultEntryIndent}${allEntries.join(`,\n${defaultEntryIndent}`)}\n${outerIndent}}`;
		return {
			source:
				src.slice(0, lbraceOffset) +
				replacement +
				src.slice(rbraceOffset + 1),
			changed: true,
		};
	}

	let i = rbraceOffset - 1;
	while (i > lbraceOffset && /\s/.test(src[i]!)) i--;
	const lastNonWs = src[i]!;
	const insertAt = i + 1;
	const prefix = lastNonWs === "," ? "" : ",";
	return {
		source:
			src.slice(0, insertAt) +
			`${prefix}\n${entryIndent}${newEntry}` +
			src.slice(insertAt),
		changed: true,
	};
}

export function removeLinkFromLocal(
	source: string,
	url: string,
): RemoveLinkResult {
	if (source === "") {
		return { source, changed: false, wasPresent: false };
	}

	const r = parseLocal(source, FILE);
	if (!r.ok) {
		const lines = r.errors.map((e) => `  - ${e.message}`).join("\n");
		throw new LocalEditError(`moraga.local.esp is invalid:\n${lines}`);
	}

	if (!r.local.links.has(url)) {
		return { source, changed: false, wasPresent: false };
	}

	const linksMap = locateLinksMap(source);
	if (!linksMap) {
		throw new LocalEditError(
			`internal: link ${url} present in parsed manifest but no links map located`,
		);
	}

	const lbraceOffset = lineColToOffset(
		source,
		linksMap.span.line,
		linksMap.span.col,
	);
	if (source[lbraceOffset] !== "{") {
		throw new LocalEditError(
			`internal: expected '{' at offset ${lbraceOffset}`,
		);
	}
	const rbraceOffset = matchClosingBrace(source, lbraceOffset);

	const entries = linksMap.entries;
	const idx = entries.findIndex((e) => e.key === url);
	if (idx === -1) {
		throw new LocalEditError(
			`internal: url ${url} present in manifest but not in MapExpr`,
		);
	}
	const N = entries.length;

	if (N === 1) {
		return {
			source:
				source.slice(0, lbraceOffset) +
				"{}" +
				source.slice(rbraceOffset + 1),
			changed: true,
			wasPresent: true,
		};
	}

	const inner = source.slice(lbraceOffset + 1, rbraceOffset);
	const isMultiline = inner.includes("\n");
	if (!isMultiline) {
		const remaining = new Map<string, string>();
		for (const [k, v] of r.local.links) {
			if (k !== url) remaining.set(k, v);
		}
		const outerIndent = getLineIndent(source, lbraceOffset);
		const entryIndent = `${outerIndent}  `;
		const reprinted = reprintLinks(remaining, entryIndent);
		const replacement = `{\n${entryIndent}${reprinted.join(`,\n${entryIndent}`)}\n${outerIndent}}`;
		return {
			source:
				source.slice(0, lbraceOffset) +
				replacement +
				source.slice(rbraceOffset + 1),
			changed: true,
			wasPresent: true,
		};
	}

	const entry = entries[idx]!;
	const entryStart = lineColToOffset(
		source,
		entry.keySpan.line,
		entry.keySpan.col,
	);
	const entryEnd = computeEntryEnd(source, entry);
	const lineStart = scanLineStart(source, entryStart);

	if (idx < N - 1) {
		const next = entries[idx + 1]!;
		const nextStart = lineColToOffset(
			source,
			next.keySpan.line,
			next.keySpan.col,
		);
		const nextLineStart = scanLineStart(source, nextStart);
		return {
			source: source.slice(0, lineStart) + source.slice(nextLineStart),
			changed: true,
			wasPresent: true,
		};
	}

	let i = lineStart - 1;
	while (i >= 0 && /\s/.test(source[i]!)) i--;
	if (source[i] !== ",") {
		throw new LocalEditError(
			`internal: expected ',' before last entry, found ${JSON.stringify(source[i])}`,
		);
	}
	return {
		source: source.slice(0, i) + source.slice(entryEnd),
		changed: true,
		wasPresent: true,
	};
}

function addLinksField(source: string, url: string, path: string): string {
	const r = parseLocal(source, FILE);
	if (!r.ok) {
		const lines = r.errors.map((e) => `  - ${e.message}`).join("\n");
		throw new LocalEditError(`moraga.local.esp is invalid:\n${lines}`);
	}

	const top = locateTopMap(source);
	const lbraceOffset = lineColToOffset(source, top.span.line, top.span.col);
	if (source[lbraceOffset] !== "{") {
		throw new LocalEditError(
			`internal: expected '{' at top-level offset ${lbraceOffset}`,
		);
	}
	const rbraceOffset = matchClosingBrace(source, lbraceOffset);

	const outerIndent = getLineIndent(source, lbraceOffset);
	const fieldIndent = `${outerIndent}  `;
	const linkIndent = `${fieldIndent}  `;

	const linksField = `${jsonStr("links")}: {\n${linkIndent}${jsonStr(url)}: ${jsonStr(path)}\n${fieldIndent}}`;

	const inner = source.slice(lbraceOffset + 1, rbraceOffset);
	const innerHasContent = inner.trim() !== "";

	if (!innerHasContent) {
		const replacement = `{\n${fieldIndent}${linksField}\n${outerIndent}}`;
		return (
			source.slice(0, lbraceOffset) +
			replacement +
			source.slice(rbraceOffset + 1)
		);
	}

	let i = rbraceOffset - 1;
	while (i > lbraceOffset && /\s/.test(source[i]!)) i--;
	const lastNonWs = source[i]!;
	const insertAt = i + 1;
	const prefix = lastNonWs === "," ? "" : ",";
	return (
		source.slice(0, insertAt) +
		`${prefix}\n${fieldIndent}${linksField}` +
		source.slice(insertAt)
	);
}

function locateLinksMap(source: string): MapExpr | null {
	const top = locateTopMap(source);
	const linksE = top.entries.find((e) => e.key === "links");
	if (!linksE) return null;
	if (linksE.value.kind !== "map") {
		throw new LocalEditError(`"links" is not a map`);
	}
	return linksE.value;
}

function locateTopMap(source: string): MapExpr {
	let module: Module;
	try {
		const tokens = lex(source, FILE);
		module = parse(tokens, source);
	} catch (e) {
		if (e instanceof EspetoError) {
			throw new LocalEditError(`failed to parse moraga.local.esp: ${e.message}`);
		}
		throw e;
	}
	const top = module.items[0];
	if (!top || !isMap(top)) {
		throw new LocalEditError(
			"moraga.local.esp must be a single map literal at top level",
		);
	}
	return top;
}

function isMap(item: unknown): item is MapExpr {
	return (
		!!item &&
		typeof item === "object" &&
		"kind" in item &&
		(item as { kind: string }).kind === "map"
	);
}

function computeEntryEnd(source: string, entry: MapEntry): number {
	const v = entry.value;
	if (v.kind === "string") {
		return lineColToOffset(source, v.span.line, v.span.col) + v.span.length;
	}
	throw new LocalEditError(`internal: unexpected value kind ${v.kind}`);
}

function scanLineStart(source: string, offset: number): number {
	let i = offset;
	while (i > 0 && source[i - 1] !== "\n") i--;
	return i;
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
	while (i < source.length && (source[i] === " " || source[i] === "\t")) i++;
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
	throw new LocalEditError(
		`unbalanced braces starting at offset ${lbraceOffset}`,
	);
}

function reprintLinks(
	links: Map<string, string>,
	_indent: string,
): string[] {
	const out: string[] = [];
	for (const [url, path] of links) {
		out.push(`${jsonStr(url)}: ${jsonStr(path)}`);
	}
	return out;
}

function jsonStr(s: string): string {
	return JSON.stringify(s);
}
