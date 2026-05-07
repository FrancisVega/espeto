import {
	type Diagnostic,
	DiagnosticSeverity,
	type Range,
} from "vscode-languageserver/node.js";

import { EspetoError, type Span } from "../errors";

export function spanToRange(span: Span): Range {
	const startLine = Math.max(0, span.line - 1);
	const startChar = Math.max(0, span.col - 1);
	return {
		start: { line: startLine, character: startChar },
		end: { line: startLine, character: startChar + Math.max(span.length, 1) },
	};
}

export function buildDiagnostics(error: unknown): Diagnostic[] {
	if (!(error instanceof EspetoError)) return [];
	return [
		{
			severity: DiagnosticSeverity.Error,
			range: spanToRange(error.span),
			message: error.message,
			source: "espeto",
		},
	];
}
