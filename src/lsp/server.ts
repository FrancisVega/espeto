import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	createConnection,
	type Definition,
	type DefinitionParams,
	type Hover,
	type HoverParams,
	type InitializeResult,
	type Location,
	ProposedFeatures,
	type Range,
	TextDocuments,
	TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { Span } from "../errors";
import { EspetoError } from "../errors";
import { lex } from "../lexer";
import { parse } from "../parser";
import { findIdentAt, type Resolution, resolveIdent } from "./analyze";
import { MANIFEST, STUB_CONTENT } from "./generated";
import type { FnDoc } from "./manifest-types";

const BUILTIN_NAMES = new Set<string>(Object.keys(MANIFEST.functions));

const STUB_DIR = join(tmpdir(), "espeto-lsp");
const STUB_PATH = join(STUB_DIR, "stdlib.d.esp");
let stubInstalled = false;
function ensureStubFile(): string {
	if (!stubInstalled) {
		mkdirSync(STUB_DIR, { recursive: true });
		writeFileSync(STUB_PATH, STUB_CONTENT);
		stubInstalled = true;
	}
	return STUB_PATH;
}

function spanToRange(span: Span): Range {
	const startLine = Math.max(0, span.line - 1);
	const startChar = Math.max(0, span.col - 1);
	return {
		start: { line: startLine, character: startChar },
		end: { line: startLine, character: startChar + Math.max(span.length, 1) },
	};
}

function renderBuiltinHover(fn: FnDoc): string {
	const params = fn.params.map((p) => `${p.name}: ${p.type}`).join(", ");
	const sig = `${fn.name}(${params}) -> ${fn.returns.type}`;
	const lines: string[] = [];
	lines.push("```espeto");
	lines.push(sig);
	lines.push("```");
	lines.push("");
	lines.push(fn.summary);
	if (fn.description) {
		lines.push("");
		lines.push(fn.description);
	}
	if (fn.params.length > 0) {
		lines.push("");
		for (const p of fn.params) {
			lines.push(`- \`${p.name}\` (\`${p.type}\`) — ${p.doc}`);
		}
	}
	if (fn.returns.doc) {
		lines.push("");
		lines.push(`**Returns** \`${fn.returns.type}\`: ${fn.returns.doc}`);
	}
	if (fn.examples.length > 0) {
		lines.push("");
		lines.push("**Example**");
		lines.push("```espeto");
		for (const ex of fn.examples) lines.push(ex);
		lines.push("```");
	}
	lines.push("");
	lines.push(`*from \`stdlib/${fn.module}\`*`);
	return lines.join("\n");
}

function renderResolutionHover(res: Resolution): string {
	switch (res.kind) {
		case "builtin": {
			const fn = MANIFEST.functions[res.name];
			if (!fn) return `\`${res.name}\` (builtin)`;
			return renderBuiltinHover(fn);
		}
		case "fn": {
			const params = res.node.params.join(", ");
			const exported = res.node.exported ? "export " : "";
			return [
				"```espeto",
				`${exported}fn ${res.node.name}(${params})`,
				"```",
				"",
				"*local function*",
			].join("\n");
		}
		case "arg":
			return [
				"```espeto",
				`arg ${res.node.name}: ${res.node.type}${res.node.default ? " = …" : ""}`,
				"```",
				"",
				`*positional arg of \`cmd\`*${res.node.attrs.desc ? `\n\n${res.node.attrs.desc}` : ""}`,
			].join("\n");
		case "flag": {
			const short = res.node.attrs.short ? ` (-${res.node.attrs.short})` : "";
			return [
				"```espeto",
				`flag ${res.node.name}: ${res.node.type}${res.node.default ? " = …" : ""}`,
				"```",
				"",
				`*flag of \`cmd\`${short}*${res.node.attrs.desc ? `\n\n${res.node.attrs.desc}` : ""}`,
			].join("\n");
		}
		case "let":
			return [
				"```espeto",
				`${res.name} = …`,
				"```",
				"",
				"*local binding*",
			].join("\n");
		case "fn_param":
			return [
				"```espeto",
				`${res.name}`,
				"```",
				"",
				`*parameter of \`fn ${res.fn.name}\`*`,
			].join("\n");
		case "lambda_param":
			return [
				"```espeto",
				`${res.name}`,
				"```",
				"",
				"*lambda parameter*",
			].join("\n");
		case "rescue_err":
			return [
				"```espeto",
				`${res.name}`,
				"```",
				"",
				"*rescue error binding (str)*",
			].join("\n");
	}
}

function resolutionLocation(res: Resolution): Location | null {
	switch (res.kind) {
		case "builtin": {
			const fn = MANIFEST.functions[res.name];
			if (!fn) return null;
			const stubPath = ensureStubFile();
			const line = Math.max(0, fn.stubLine - 1);
			return {
				uri: pathToFileURL(stubPath).toString(),
				range: {
					start: { line, character: 0 },
					end: { line, character: 0 },
				},
			};
		}
		case "fn":
			return spanLocation(res.node.span);
		case "arg":
		case "flag":
			return spanLocation(res.node.span);
		case "let":
			return spanLocation(res.nameSpan);
		case "fn_param":
		case "lambda_param":
		case "rescue_err":
			return spanLocation(res.span);
	}
}

function spanLocation(span: Span): Location {
	return {
		uri: pathToFileURL(span.file).toString(),
		range: spanToRange(span),
	};
}

const connection = createConnection(
	ProposedFeatures.all,
	process.stdin,
	process.stdout,
);
const documents = new TextDocuments(TextDocument);

connection.onInitialize(
	(): InitializeResult => ({
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,
			hoverProvider: true,
			definitionProvider: true,
		},
		serverInfo: { name: "espeto-lsp", version: MANIFEST.version },
	}),
);

type Parsed = ReturnType<typeof safeParse>;
const parseCache = new Map<string, { version: number; result: Parsed }>();

function safeParse(source: string, filePath: string) {
	try {
		const tokens = lex(source, filePath);
		const module = parse(tokens, source);
		return { ok: true as const, module };
	} catch (e) {
		if (e instanceof EspetoError) return { ok: false as const, error: e };
		return {
			ok: false as const,
			error: new Error(e instanceof Error ? e.message : String(e)),
		};
	}
}

function getParsed(doc: TextDocument): Parsed {
	const cached = parseCache.get(doc.uri);
	if (cached && cached.version === doc.version) return cached.result;
	const filePath = uriToPath(doc.uri);
	const result = safeParse(doc.getText(), filePath);
	parseCache.set(doc.uri, { version: doc.version, result });
	return result;
}

function uriToPath(uri: string): string {
	if (uri.startsWith("file://")) {
		try {
			return new URL(uri).pathname;
		} catch {
			return uri;
		}
	}
	return uri;
}

documents.onDidClose((e) => {
	parseCache.delete(e.document.uri);
});

connection.onHover((params: HoverParams): Hover | null => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) return null;
	const parsed = getParsed(doc);
	if (!parsed.ok) return null;
	const line = params.position.line + 1;
	const col = params.position.character + 1;
	const ident = findIdentAt(parsed.module, line, col);
	if (!ident) return null;
	const resolution = resolveIdent(parsed.module, ident, BUILTIN_NAMES);
	if (!resolution) return null;
	return {
		contents: { kind: "markdown", value: renderResolutionHover(resolution) },
		range: spanToRange(ident.span),
	};
});

connection.onDefinition(
	(params: DefinitionParams): Definition | null => {
		const doc = documents.get(params.textDocument.uri);
		if (!doc) return null;
		const parsed = getParsed(doc);
		if (!parsed.ok) return null;
		const line = params.position.line + 1;
		const col = params.position.character + 1;
		const ident = findIdentAt(parsed.module, line, col);
		if (!ident) return null;
		const resolution = resolveIdent(parsed.module, ident, BUILTIN_NAMES);
		if (!resolution) return null;
		return resolutionLocation(resolution);
	},
);

documents.listen(connection);
connection.listen();
