import type { Expr, ListExpr, MapEntry, MapExpr, Module, StringExpr } from "../ast";
import { EspetoError, type Span } from "../errors";
import { lex } from "../lexer";
import { parse } from "../parser";

export type LockError = { message: string; span: Span };

export type LockEntry = {
	url: string;
	urlSpan: Span;
	version: string;
	sha: string;
	checksum: string;
	deps: string[];
};

export type Lock = Map<string, LockEntry>;

export type LockResult =
	| { ok: true; lock: Lock }
	| { ok: false; errors: LockError[] };

const URL_PATTERN =
	/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+(?:\/[a-zA-Z0-9_.-]+){2,}$/;
const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const CHECKSUM_PATTERN = /^h1:[0-9a-f]{64}$/;

const REQUIRED_ENTRY_FIELDS = ["version", "sha", "checksum", "deps"];
const KNOWN_ENTRY_FIELDS = new Set(REQUIRED_ENTRY_FIELDS);

export function parseLock(source: string, file: string): LockResult {
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

	const errors: LockError[] = [];

	if (module.items.length === 0) {
		return {
			ok: false,
			errors: [
				{
					message: "moraga.lock must contain a single map literal; file is empty",
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
					message: "moraga.lock must be a single map literal at top level",
					span: itemSpan(first, file),
				},
			],
		};
	}

	if (module.items.length > 1) {
		errors.push({
			message:
				"moraga.lock must contain only a single map literal; found additional items",
			span: itemSpan(module.items[1], file),
		});
	}

	const lock: Lock = new Map();
	for (const entry of first.entries) {
		if (!URL_PATTERN.test(entry.key)) {
			errors.push({
				message: `lock key "${entry.key}" must look like "<host>/<owner>/<repo>"`,
				span: entry.keySpan,
			});
			continue;
		}
		const parsed = parseEntry(entry.key, entry.keySpan, entry.value, errors);
		if (parsed) lock.set(entry.key, parsed);
	}

	if (errors.length > 0) {
		return { ok: false, errors };
	}
	return { ok: true, lock };
}

function parseEntry(
	url: string,
	urlSpan: Span,
	value: Expr,
	errors: LockError[],
): LockEntry | undefined {
	if (value.kind !== "map") {
		errors.push({
			message: `lock entry "${url}" must be a map, got ${value.kind}`,
			span: value.span,
		});
		return undefined;
	}
	const lookup = new Map<string, MapEntry>();
	for (const e of value.entries) lookup.set(e.key, e);

	const missing = REQUIRED_ENTRY_FIELDS.filter((f) => !lookup.has(f));
	if (missing.length > 0) {
		const list = missing.map((f) => `"${f}"`).join(", ");
		errors.push({
			message: `lock entry "${url}" missing required fields: ${list}`,
			span: value.span,
		});
		return undefined;
	}

	for (const e of value.entries) {
		if (!KNOWN_ENTRY_FIELDS.has(e.key)) {
			errors.push({
				message: `unknown field "${e.key}" in lock entry "${url}"`,
				span: e.keySpan,
			});
		}
	}

	const versionR = expectPlainString(lookup.get("version")!.value, "version");
	const shaR = expectPlainString(lookup.get("sha")!.value, "sha");
	const checksumR = expectPlainString(lookup.get("checksum")!.value, "checksum");
	const depsE = lookup.get("deps")!;

	if (!versionR.ok) errors.push(versionR.error);
	else if (!SEMVER_PATTERN.test(versionR.value)) {
		errors.push({
			message: `lock entry "${url}".version must be exact semver, got "${versionR.value}"`,
			span: versionR.span,
		});
	}
	if (!shaR.ok) errors.push(shaR.error);
	else if (!SHA_PATTERN.test(shaR.value)) {
		errors.push({
			message: `lock entry "${url}".sha must be 40 hex chars, got "${shaR.value}"`,
			span: shaR.span,
		});
	}
	if (!checksumR.ok) errors.push(checksumR.error);
	else if (!CHECKSUM_PATTERN.test(checksumR.value)) {
		errors.push({
			message: `lock entry "${url}".checksum must match "h1:<64-hex>", got "${checksumR.value}"`,
			span: checksumR.span,
		});
	}

	const deps = parseDepsList(depsE.value, url, errors);

	if (!versionR.ok || !shaR.ok || !checksumR.ok) return undefined;

	return {
		url,
		urlSpan,
		version: versionR.value,
		sha: shaR.value,
		checksum: checksumR.value,
		deps,
	};
}

function parseDepsList(
	expr: Expr,
	url: string,
	errors: LockError[],
): string[] {
	if (expr.kind !== "list") {
		errors.push({
			message: `lock entry "${url}".deps must be a list, got ${expr.kind}`,
			span: expr.span,
		});
		return [];
	}
	const list = expr as ListExpr;
	const out: string[] = [];
	for (const item of list.items) {
		const r = expectPlainString(item, `${url}.deps[]`);
		if (!r.ok) {
			errors.push(r.error);
			continue;
		}
		if (!URL_PATTERN.test(r.value)) {
			errors.push({
				message: `lock entry "${url}".deps[] must be a package url, got "${r.value}"`,
				span: r.span,
			});
			continue;
		}
		out.push(r.value);
	}
	return out;
}

type StringResult =
	| { ok: true; value: string; span: Span }
	| { ok: false; error: LockError };

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

export function serializeLock(lock: Lock): string {
	const urls = [...lock.keys()].sort();
	if (urls.length === 0) return "{}\n";

	const lines: string[] = ["{"];
	urls.forEach((url, i) => {
		const entry = lock.get(url)!;
		const last = i === urls.length - 1;
		const deps = [...entry.deps].sort();
		lines.push(`  ${jsonStr(url)}: {`);
		lines.push(`    "version": ${jsonStr(entry.version)},`);
		lines.push(`    "sha": ${jsonStr(entry.sha)},`);
		lines.push(`    "checksum": ${jsonStr(entry.checksum)},`);
		if (deps.length === 0) {
			lines.push(`    "deps": []`);
		} else {
			lines.push(`    "deps": [`);
			deps.forEach((d, j) => {
				const trail = j === deps.length - 1 ? "" : ",";
				lines.push(`      ${jsonStr(d)}${trail}`);
			});
			lines.push(`    ]`);
		}
		lines.push(`  }${last ? "" : ","}`);
	});
	lines.push("}");
	return `${lines.join("\n")}\n`;
}

function jsonStr(s: string): string {
	return JSON.stringify(s);
}
