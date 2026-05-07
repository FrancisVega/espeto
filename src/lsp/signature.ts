import {
	MarkupKind,
	type ParameterInformation,
	type SignatureHelp,
	type SignatureInformation,
} from "vscode-languageserver/node.js";

import type { FnDef } from "../ast";
import { MANIFEST } from "./generated";
import type { FnDoc } from "./manifest-types";

export type CallContext = { name: string; activeParam: number };

/**
 * Walks `text` up to `offset` tracking opening parens and commas to determine
 * the enclosing call. Skips over `#` line comments and `"..."` string literals
 * (with `\"` escape). Returns null if the cursor is not inside a call.
 *
 * Limitation: does not enter `#{...}` interpolations. If the cursor is inside
 * an interpolation, we return null rather than offering misleading help.
 */
export function findCallContext(
	text: string,
	offset: number,
): CallContext | null {
	type Frame = { name: string; argIndex: number };
	const stack: Frame[] = [];

	const isIdentStart = (c: string) =>
		(c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
	const isIdentCont = (c: string) =>
		isIdentStart(c) || (c >= "0" && c <= "9");

	let i = 0;
	const n = Math.min(offset, text.length);
	while (i < n) {
		const ch = text[i]!;
		if (ch === "#") {
			while (i < n && text[i] !== "\n") i++;
			continue;
		}
		if (ch === '"') {
			i++;
			while (i < n && text[i] !== '"') {
				if (text[i] === "\\" && i + 1 < n) {
					i += 2;
					continue;
				}
				i++;
			}
			if (i < n) i++;
			continue;
		}
		if (ch === "(") {
			let j = i - 1;
			while (j >= 0 && (text[j] === " " || text[j] === "\t")) j--;
			let endJ = j;
			while (j >= 0 && isIdentCont(text[j]!)) j--;
			const startJ = j + 1;
			if (
				startJ <= endJ &&
				isIdentStart(text[startJ]!) &&
				!isKeywordCallable(text.slice(startJ, endJ + 1))
			) {
				stack.push({ name: text.slice(startJ, endJ + 1), argIndex: 0 });
			} else {
				stack.push({ name: "", argIndex: 0 });
			}
			i++;
			continue;
		}
		if (ch === ")") {
			stack.pop();
			i++;
			continue;
		}
		if (ch === "," && stack.length > 0) {
			stack[stack.length - 1]!.argIndex++;
			i++;
			continue;
		}
		i++;
	}
	if (stack.length === 0) return null;
	const top = stack[stack.length - 1]!;
	if (top.name === "") return null;
	return { name: top.name, activeParam: top.argIndex };
}

const KW_BLOCK = new Set([
	"if",
	"and",
	"or",
	"not",
	"do",
	"end",
	"true",
	"false",
	"nil",
	"fn",
	"try",
	"rescue",
	"assert",
]);

function isKeywordCallable(name: string): boolean {
	return KW_BLOCK.has(name);
}

function clampActive(idx: number, paramCount: number): number {
	if (paramCount === 0) return 0;
	return Math.min(idx, paramCount - 1);
}

export function buildBuiltinSignatureHelp(
	fn: FnDoc,
	activeParam: number,
): SignatureHelp {
	const paramLabels = fn.params.map((p) => `${p.name}: ${p.type}`);
	const sigLabel = `${fn.name}(${paramLabels.join(", ")}) -> ${fn.returns.type}`;
	const parameters: ParameterInformation[] = fn.params.map((p, i) => ({
		label: paramLabels[i]!,
		documentation: p.doc,
	}));
	const sig: SignatureInformation = {
		label: sigLabel,
		documentation: { kind: MarkupKind.Markdown, value: fn.summary },
		parameters,
	};
	return {
		signatures: [sig],
		activeSignature: 0,
		activeParameter: clampActive(activeParam, fn.params.length),
	};
}

export function buildUserFnSignatureHelp(
	fn: FnDef,
	activeParam: number,
): SignatureHelp {
	const sigLabel = `fn ${fn.name}(${fn.params.join(", ")})`;
	const parameters: ParameterInformation[] = fn.params.map((p) => ({
		label: p,
	}));
	const sig: SignatureInformation = {
		label: sigLabel,
		parameters,
	};
	return {
		signatures: [sig],
		activeSignature: 0,
		activeParameter: clampActive(activeParam, fn.params.length),
	};
}

export function lookupSignature(
	ctx: CallContext,
	userFns: FnDef[],
): SignatureHelp | null {
	const builtin = MANIFEST.functions[ctx.name];
	if (builtin) return buildBuiltinSignatureHelp(builtin, ctx.activeParam);
	const userFn = userFns.find((f) => f.name === ctx.name);
	if (userFn) return buildUserFnSignatureHelp(userFn, ctx.activeParam);
	return null;
}
