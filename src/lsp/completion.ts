import {
	type CompletionItem,
	CompletionItemKind,
	MarkupKind,
} from "vscode-languageserver/node.js";

import type { Cmd, FnDef, Item, Module } from "../ast";
import { MANIFEST } from "./generated";
import type { FnDoc } from "./manifest-types";

const KEYWORDS = [
	"def",
	"defp",
	"do",
	"end",
	"true",
	"false",
	"nil",
	"program",
	"cmd",
	"arg",
	"flag",
	"desc",
	"version",
	"import",
	"only",
	"as",
	"if",
	"else",
	"and",
	"or",
	"not",
	"fn",
	"try",
	"rescue",
	"test",
	"assert",
];

function builtinDetail(fn: FnDoc): string {
	const params = fn.params.map((p) => `${p.name}: ${p.type}`).join(", ");
	return `${fn.name}(${params}) -> ${fn.returns.type}`;
}

function builtinDocs(fn: FnDoc): string {
	const lines = [fn.summary];
	if (fn.examples.length > 0) {
		lines.push("", "```espeto");
		for (const ex of fn.examples) lines.push(ex);
		lines.push("```");
	}
	return lines.join("\n");
}

export function buildCompletions(
	module: Module | null,
	line: number,
): CompletionItem[] {
	const items: CompletionItem[] = [];

	for (const kw of KEYWORDS) {
		items.push({ label: kw, kind: CompletionItemKind.Keyword });
	}

	for (const fn of Object.values(MANIFEST.functions)) {
		items.push({
			label: fn.name,
			kind: CompletionItemKind.Function,
			detail: builtinDetail(fn),
			documentation: {
				kind: MarkupKind.Markdown,
				value: builtinDocs(fn),
			},
		});
	}

	if (module) addScopeCompletions(module, line, items);
	return items;
}

function addScopeCompletions(
	module: Module,
	line: number,
	items: CompletionItem[],
): void {
	for (const item of module.items) {
		if (item.kind === "fn_def") {
			items.push({
				label: item.name,
				kind: CompletionItemKind.Function,
				detail: `fn ${item.name}(${item.params.join(", ")})`,
			});
		} else if (item.kind === "assign") {
			items.push({
				label: item.name,
				kind: CompletionItemKind.Variable,
				detail: "let",
			});
		}
	}

	const itemsArr = module.items;
	for (let i = 0; i < itemsArr.length; i++) {
		const item = itemsArr[i]!;
		const next = itemsArr[i + 1];
		const upperBound = next?.span.line ?? Number.POSITIVE_INFINITY;
		if (item.span.line <= line && line < upperBound) {
			addBlockBindings(item, line, items);
		}
	}
}

function addBlockBindings(
	item: Item,
	line: number,
	items: CompletionItem[],
): void {
	switch (item.kind) {
		case "cmd":
			addCmdBindings(item, items);
			return;
		case "fn_def":
			addFnBindings(item, items);
			return;
		case "program": {
			for (const f of item.flags) {
				items.push({
					label: f.name,
					kind: CompletionItemKind.Property,
					detail: `flag ${f.name}: ${f.type}`,
				});
			}
			for (let i = 0; i < item.cmds.length; i++) {
				const cmd = item.cmds[i]!;
				const next = item.cmds[i + 1];
				const upper = next?.span.line ?? Number.POSITIVE_INFINITY;
				if (cmd.span.line <= line && line < upper) {
					addCmdBindings(cmd, items);
				}
			}
			return;
		}
		case "test": {
			for (const stmt of item.body) {
				if (stmt.kind === "assign") {
					items.push({
						label: stmt.name,
						kind: CompletionItemKind.Variable,
						detail: "let",
					});
				}
			}
			return;
		}
	}
}

function addCmdBindings(cmd: Cmd, items: CompletionItem[]): void {
	for (const decl of cmd.decls) {
		items.push({
			label: decl.name,
			kind:
				decl.kind === "arg_decl"
					? CompletionItemKind.Field
					: CompletionItemKind.Property,
			detail: `${decl.kind === "arg_decl" ? "arg" : "flag"} ${decl.name}: ${decl.type}`,
		});
	}
	for (const stmt of cmd.body) {
		if (stmt.kind === "assign") {
			items.push({
				label: stmt.name,
				kind: CompletionItemKind.Variable,
				detail: "let",
			});
		}
	}
}

function addFnBindings(fn: FnDef, items: CompletionItem[]): void {
	for (const p of fn.params) {
		items.push({
			label: p,
			kind: CompletionItemKind.Variable,
			detail: `param of ${fn.name}`,
		});
	}
	for (const stmt of fn.body) {
		if (stmt.kind === "assign") {
			items.push({
				label: stmt.name,
				kind: CompletionItemKind.Variable,
				detail: "let",
			});
		}
	}
}
