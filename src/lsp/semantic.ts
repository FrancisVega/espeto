import {
	type SemanticTokens,
	SemanticTokensBuilder,
} from "vscode-languageserver/node.js";

import type { Module } from "../ast";
import { type Resolution, walkIdents } from "./analyze";

export const SEMANTIC_TOKEN_TYPES = [
	"function",
	"parameter",
	"variable",
] as const;

export const SEMANTIC_TOKEN_MODIFIERS = ["defaultLibrary"] as const;

const TYPE_FUNCTION = 0;
const TYPE_PARAMETER = 1;
const TYPE_VARIABLE = 2;

const MOD_DEFAULT_LIBRARY = 1 << 0;

function tokenForResolution(
	res: Resolution,
): { type: number; modifiers: number } | null {
	switch (res.kind) {
		case "builtin":
			return { type: TYPE_FUNCTION, modifiers: MOD_DEFAULT_LIBRARY };
		case "source_binding":
			return { type: TYPE_VARIABLE, modifiers: MOD_DEFAULT_LIBRARY };
		case "fn":
			return { type: TYPE_FUNCTION, modifiers: 0 };
		case "arg":
		case "flag":
		case "fn_param":
		case "lambda_param":
			return { type: TYPE_PARAMETER, modifiers: 0 };
		case "let":
		case "rescue_err":
			return { type: TYPE_VARIABLE, modifiers: 0 };
	}
}

export function buildSemanticTokens(
	module: Module,
	builtinNames: Set<string>,
): SemanticTokens {
	const collected: {
		line: number;
		char: number;
		len: number;
		type: number;
		mod: number;
	}[] = [];
	walkIdents(module, builtinNames, (ident, res) => {
		if (!res) return true;
		const t = tokenForResolution(res);
		if (!t) return true;
		collected.push({
			line: ident.span.line - 1,
			char: ident.span.col - 1,
			len: ident.span.length,
			type: t.type,
			mod: t.modifiers,
		});
		return true;
	});
	collected.sort((a, b) => a.line - b.line || a.char - b.char);
	const builder = new SemanticTokensBuilder();
	for (const t of collected) {
		builder.push(t.line, t.char, t.len, t.type, t.mod);
	}
	return builder.build();
}
