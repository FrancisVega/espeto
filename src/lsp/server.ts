import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type CompletionItem,
	type CompletionParams,
	createConnection,
	type Definition,
	type DefinitionParams,
	type DocumentSymbol,
	type DocumentSymbolParams,
	type FoldingRange,
	type FoldingRangeParams,
	type Hover,
	type HoverParams,
	type InitializeResult,
	type Location,
	ProposedFeatures,
	type ReferenceParams,
	type RenameParams,
	type SemanticTokens,
	type SemanticTokensParams,
	type SignatureHelp,
	type SignatureHelpParams,
	type TextEdit,
	TextDocuments,
	TextDocumentSyncKind,
	type WorkspaceEdit,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { Span } from "../errors";
import { EspetoError } from "../errors";
import { lex } from "../lexer";
import { parse } from "../parser";
import {
	findIdentAt,
	findReferences,
	findResolvableAt,
	type Resolution,
	resolveIdent,
} from "./analyze";
import { buildCompletions } from "./completion";
import { buildDiagnostics, spanToRange } from "./diagnostics";
import {
	buildSemanticTokens,
	SEMANTIC_TOKEN_MODIFIERS,
	SEMANTIC_TOKEN_TYPES,
} from "./semantic";
import {
	findCallContext,
	lookupSignature,
} from "./signature";
import { buildDocumentSymbols, buildFoldingRanges } from "./symbols";
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

export function renderResolutionHover(res: Resolution): string {
	switch (res.kind) {
		case "builtin": {
			const fn = MANIFEST.functions[res.name];
			if (!fn) return `\`${res.name}\` (builtin)`;
			return renderBuiltinHover(fn);
		}
		case "source_binding": {
			const doc =
				res.name === "__file__"
					? "Absolute path of the current source file. Per-module binding; resolves to the file where the code text is defined (definition-site, closure-captured)."
					: "Absolute directory of the current source file. Per-module binding; resolves to the directory where the code text is defined (definition-site, closure-captured).";
			return [
				"```espeto",
				`${res.name}: str`,
				"```",
				"",
				doc,
				"",
				"*magic identifier; not bound in REPL*",
			].join("\n");
		}
		case "fn": {
			const params = res.node.params.join(", ");
			const exported = res.node.exported ? "export " : "";
			const lines = [
				"```espeto",
				`${exported}fn ${res.node.name}(${params})`,
				"```",
			];
			if (res.node.doc) {
				lines.push("", res.node.doc);
			}
			lines.push("", res.node.exported ? "*local function*" : "*private function*");
			return lines.join("\n");
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
		case "source_binding":
			return null;
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
			completionProvider: { triggerCharacters: [] },
			referencesProvider: true,
			renameProvider: true,
			documentSymbolProvider: true,
			foldingRangeProvider: true,
			signatureHelpProvider: { triggerCharacters: ["(", ","] },
			semanticTokensProvider: {
				legend: {
					tokenTypes: [...SEMANTIC_TOKEN_TYPES],
					tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
				},
				full: true,
				range: false,
			},
		},
		serverInfo: { name: "espeto-lsp", version: MANIFEST.version },
	}),
);

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

function publishDiagnostics(doc: TextDocument): void {
	const parsed = getParsed(doc);
	connection.sendDiagnostics({
		uri: doc.uri,
		diagnostics: buildDiagnostics(parsed.ok ? null : parsed.error),
	});
}

documents.onDidChangeContent((e) => {
	publishDiagnostics(e.document);
});

documents.onDidClose((e) => {
	parseCache.delete(e.document.uri);
	connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
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

connection.onCompletion(
	(params: CompletionParams): CompletionItem[] => {
		const doc = documents.get(params.textDocument.uri);
		if (!doc) return [];
		const parsed = getParsed(doc);
		const module = parsed.ok ? parsed.module : null;
		return buildCompletions(module, params.position.line + 1);
	},
);

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

connection.onReferences((params: ReferenceParams): Location[] | null => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) return null;
	const parsed = getParsed(doc);
	if (!parsed.ok) return null;
	const found = findResolvableAt(
		parsed.module,
		params.position.line + 1,
		params.position.character + 1,
		BUILTIN_NAMES,
	);
	if (!found) return null;
	const spans = findReferences(parsed.module, found.resolution, BUILTIN_NAMES);
	const docPath = uriToPath(doc.uri);
	const seen = new Set<string>();
	const out: Location[] = [];
	for (const s of spans) {
		const key = `${s.file}:${s.line}:${s.col}:${s.length}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({
			uri:
				s.file === docPath ? doc.uri : pathToFileURL(s.file).toString(),
			range: spanToRange(s),
		});
	}
	return out;
});

connection.onRenameRequest(
	(params: RenameParams): WorkspaceEdit | null => {
		if (!IDENT_RE.test(params.newName)) return null;
		const doc = documents.get(params.textDocument.uri);
		if (!doc) return null;
		const parsed = getParsed(doc);
		if (!parsed.ok) return null;
		const found = findResolvableAt(
			parsed.module,
			params.position.line + 1,
			params.position.character + 1,
			BUILTIN_NAMES,
		);
		if (!found) return null;
		if (
			found.resolution.kind === "builtin" ||
			found.resolution.kind === "source_binding"
		) {
			return null;
		}
		if (params.newName === found.name) return null;
		const spans = findReferences(parsed.module, found.resolution, BUILTIN_NAMES);
		if (spans.length === 0) return null;
		const docPath = uriToPath(doc.uri);
		const seen = new Set<string>();
		const editsByUri = new Map<string, TextEdit[]>();
		for (const s of spans) {
			const key = `${s.file}:${s.line}:${s.col}:${s.length}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const uri =
				s.file === docPath ? doc.uri : pathToFileURL(s.file).toString();
			const list = editsByUri.get(uri) ?? [];
			list.push({ range: spanToRange(s), newText: params.newName });
			editsByUri.set(uri, list);
		}
		const changes: WorkspaceEdit["changes"] = {};
		for (const [uri, list] of editsByUri) {
			list.sort((a, b) =>
				a.range.start.line === b.range.start.line
					? a.range.start.character - b.range.start.character
					: a.range.start.line - b.range.start.line,
			);
			changes[uri] = list;
		}
		return { changes };
	},
);

connection.onDocumentSymbol(
	(params: DocumentSymbolParams): DocumentSymbol[] | null => {
		const doc = documents.get(params.textDocument.uri);
		if (!doc) return null;
		const parsed = getParsed(doc);
		if (!parsed.ok) return null;
		return buildDocumentSymbols(parsed.module);
	},
);

connection.onFoldingRanges(
	(params: FoldingRangeParams): FoldingRange[] | null => {
		const doc = documents.get(params.textDocument.uri);
		if (!doc) return null;
		const parsed = getParsed(doc);
		if (!parsed.ok) return null;
		return buildFoldingRanges(parsed.module);
	},
);

connection.onSignatureHelp(
	(params: SignatureHelpParams): SignatureHelp | null => {
		const doc = documents.get(params.textDocument.uri);
		if (!doc) return null;
		const offset = doc.offsetAt(params.position);
		const ctx = findCallContext(doc.getText(), offset);
		if (!ctx) return null;
		const parsed = getParsed(doc);
		const userFns =
			parsed.ok
				? parsed.module.items.flatMap((it) =>
						it.kind === "fn_def" ? [it] : [],
					)
				: [];
		return lookupSignature(ctx, userFns);
	},
);

connection.languages.semanticTokens.on(
	(params: SemanticTokensParams): SemanticTokens => {
		const doc = documents.get(params.textDocument.uri);
		if (!doc) return { data: [] };
		const parsed = getParsed(doc);
		if (!parsed.ok) return { data: [] };
		return buildSemanticTokens(parsed.module, BUILTIN_NAMES);
	},
);

documents.listen(connection);
connection.listen();
