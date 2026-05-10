import type { Expr, Module, StringExpr } from "../ast";
import { EspetoError, type Span } from "../errors";
import { lex } from "../lexer";
import { parse } from "../parser";
import { URL_PATTERN } from "./manifest";

export type LocalManifestError = { message: string; span: Span };

export type LocalManifest = {
	links: Map<string, string>;
};

export type LocalManifestResult =
	| { ok: true; local: LocalManifest }
	| { ok: false; errors: LocalManifestError[] };

const KNOWN_TOP_LEVEL = new Set(["links"]);

export function parseLocal(
	source: string,
	file: string,
): LocalManifestResult {
	let module: Module;
	try {
		const tokens = lex(source, file);
		module = parse(tokens, source);
	} catch (e) {
		if (e instanceof EspetoError) {
			return { ok: false, errors: [{ message: e.message, span: e.span }] };
		}
		throw e;
	}

	const errors: LocalManifestError[] = [];

	if (module.items.length === 0) {
		return {
			ok: false,
			errors: [
				{
					message:
						"moraga.local.esp must contain a single map literal; file is empty",
					span: { file, line: 1, col: 1, length: 1 },
				},
			],
		};
	}

	const first = module.items[0];
	if (!isExpr(first) || first.kind !== "map") {
		return {
			ok: false,
			errors: [
				{
					message: "moraga.local.esp must be a single map literal at top level",
					span: itemSpan(first, file),
				},
			],
		};
	}

	if (module.items.length > 1) {
		errors.push({
			message:
				"moraga.local.esp must contain only a single map literal; found additional items",
			span: itemSpan(module.items[1], file),
		});
	}

	const links = new Map<string, string>();

	for (const e of first.entries) {
		if (!KNOWN_TOP_LEVEL.has(e.key)) {
			errors.push({
				message: `unknown field "${e.key}" in moraga.local.esp`,
				span: e.keySpan,
			});
		}
	}

	const linksE = first.entries.find((e) => e.key === "links");
	if (linksE) {
		if (linksE.value.kind !== "map") {
			errors.push({
				message: `"links" must be a map, got ${linksE.value.kind}`,
				span: linksE.value.span,
			});
		} else {
			for (const entry of linksE.value.entries) {
				if (!URL_PATTERN.test(entry.key)) {
					errors.push({
						message: `link key "${entry.key}" must look like "<host>/<owner>/<repo>"`,
						span: entry.keySpan,
					});
					continue;
				}
				const r = expectPlainString(entry.value, `links["${entry.key}"]`);
				if (!r.ok) {
					errors.push(r.error);
					continue;
				}
				if (r.value === "") {
					errors.push({
						message: `link path for "${entry.key}" must not be empty`,
						span: r.span,
					});
					continue;
				}
				links.set(entry.key, r.value);
			}
		}
	}

	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, local: { links } };
}

type StringResult =
	| { ok: true; value: string; span: Span }
	| { ok: false; error: LocalManifestError };

function expectPlainString(expr: Expr, field: string): StringResult {
	if (expr.kind !== "string") {
		return {
			ok: false,
			error: {
				message: `"${field}" must be a string, got ${expr.kind}`,
				span: expr.span,
			},
		};
	}
	const s = expr as StringExpr;
	for (const part of s.parts) {
		if (typeof part !== "string") {
			return {
				ok: false,
				error: {
					message: `"${field}" must be a plain string (no interpolation)`,
					span: s.span,
				},
			};
		}
	}
	return { ok: true, value: s.parts.join(""), span: s.span };
}

function isExpr(item: unknown): item is Expr {
	if (!item || typeof item !== "object" || !("kind" in item)) return false;
	const kind = (item as { kind: string }).kind;
	return !["fn_def", "assign", "cmd", "program", "import", "test"].includes(
		kind,
	);
}

function itemSpan(item: unknown, file: string): Span {
	if (item && typeof item === "object" && "span" in item) {
		return (item as { span: Span }).span;
	}
	return { file, line: 1, col: 1, length: 1 };
}
