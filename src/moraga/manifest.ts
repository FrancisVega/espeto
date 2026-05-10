import type { Expr, MapEntry, MapExpr, Module, StringExpr } from "../ast";
import { EspetoError, type Span } from "../errors";
import { lex } from "../lexer";
import { parse } from "../parser";

export type ManifestError = { message: string; span: Span };

export type DepSpec = {
	version: string;
	versionSpan: Span;
	alias?: string;
	aliasSpan?: Span;
};

export type OverrideSpec = { version: string; versionSpan: Span };

export type Manifest = {
	name: string;
	nameSpan: Span;
	version: string;
	versionSpan: Span;
	espeto: string;
	espetoSpan: Span;
	deps: Map<string, DepSpec>;
	devDeps: Map<string, DepSpec>;
	overrides: Map<string, OverrideSpec>;
};

export type ManifestResult =
	| { ok: true; manifest: Manifest }
	| { ok: false; errors: ManifestError[] };

export const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
export const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
export const URL_PATTERN =
	/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+(?:\/[a-zA-Z0-9_.-]+){2,}$/;
const ESPETO_PART_PATTERN = /^(>=|<)\s*(\S+)$/;

const REQUIRED_TOP_LEVEL = ["name", "version", "espeto", "deps", "dev_deps"];
const KNOWN_TOP_LEVEL = new Set([
	"name",
	"version",
	"espeto",
	"deps",
	"dev_deps",
	"overrides",
]);
const KNOWN_EXTENDED_DEP_FIELDS = new Set(["version", "as"]);

export function parseManifest(source: string, file: string): ManifestResult {
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

	const errors: ManifestError[] = [];

	if (module.items.length === 0) {
		return {
			ok: false,
			errors: [
				{
					message: "moraga.esp must contain a single map literal; file is empty",
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
					message: `moraga.esp must be a single map literal at top level, found ${describeItem(first)}`,
					span: itemSpan(first, file),
				},
			],
		};
	}

	if (module.items.length > 1) {
		errors.push({
			message:
				"moraga.esp must contain only a single map literal; found additional items",
			span: itemSpan(module.items[1], file),
		});
	}

	const map = first;
	const lookup = new Map<string, MapEntry>();
	for (const e of map.entries) lookup.set(e.key, e);

	const missing = REQUIRED_TOP_LEVEL.filter((f) => !lookup.has(f));
	if (missing.length > 0) {
		const label = missing.length === 1 ? "field" : "fields";
		const list = missing.map((f) => `"${f}"`).join(", ");
		errors.push({
			message: `missing required ${label}: ${list}`,
			span: map.span,
		});
	}

	for (const e of map.entries) {
		if (!KNOWN_TOP_LEVEL.has(e.key)) {
			errors.push({
				message: `unknown field "${e.key}"`,
				span: e.keySpan,
			});
		}
	}

	let name = "";
	let nameSpan: Span = map.span;
	let version = "";
	let versionSpan: Span = map.span;
	let espeto = "";
	let espetoSpan: Span = map.span;
	const deps = new Map<string, DepSpec>();
	const devDeps = new Map<string, DepSpec>();
	const overrides = new Map<string, OverrideSpec>();

	const nameE = lookup.get("name");
	if (nameE) {
		const r = expectPlainString(nameE.value, "name");
		if (r.ok) {
			if (!NAME_PATTERN.test(r.value)) {
				errors.push({
					message: `"name" must match /[a-z][a-z0-9_]*/, got "${r.value}"`,
					span: r.span,
				});
			}
			name = r.value;
			nameSpan = r.span;
		} else {
			errors.push(r.error);
		}
	}

	const versionE = lookup.get("version");
	if (versionE) {
		const r = expectPlainString(versionE.value, "version");
		if (r.ok) {
			if (!SEMVER_PATTERN.test(r.value)) {
				errors.push({
					message: `"version" must be exact semver (X.Y.Z), got "${r.value}"`,
					span: r.span,
				});
			}
			version = r.value;
			versionSpan = r.span;
		} else {
			errors.push(r.error);
		}
	}

	const espetoE = lookup.get("espeto");
	if (espetoE) {
		const r = expectPlainString(espetoE.value, "espeto");
		if (r.ok) {
			const e = validateEspetoConstraint(r.value, r.span);
			if (e) errors.push(e);
			espeto = r.value;
			espetoSpan = r.span;
		} else {
			errors.push(r.error);
		}
	}

	const depsE = lookup.get("deps");
	if (depsE) parseDeps(depsE.value, deps, errors, "deps");

	const devDepsE = lookup.get("dev_deps");
	if (devDepsE) parseDeps(devDepsE.value, devDeps, errors, "dev_deps");

	const overridesE = lookup.get("overrides");
	if (overridesE) parseOverrides(overridesE.value, overrides, errors);

	if (errors.length > 0) {
		return { ok: false, errors };
	}

	return {
		ok: true,
		manifest: {
			name,
			nameSpan,
			version,
			versionSpan,
			espeto,
			espetoSpan,
			deps,
			devDeps,
			overrides,
		},
	};
}

function isExpr(item: unknown): item is Expr {
	if (!item || typeof item !== "object" || !("kind" in item)) return false;
	const kind = (item as { kind: string }).kind;
	return !["fn_def", "assign", "cmd", "program", "import", "test"].includes(
		kind,
	);
}

function describeItem(item: unknown): string {
	if (!item || typeof item !== "object" || !("kind" in item)) return "unknown";
	const kind = (item as { kind: string }).kind;
	switch (kind) {
		case "fn_def":
			return "function definition";
		case "assign":
			return "assignment";
		case "cmd":
			return "command declaration";
		case "program":
			return "program declaration";
		case "import":
			return "import";
		case "test":
			return "test block";
		default:
			return `${kind} expression`;
	}
}

function itemSpan(item: unknown, file: string): Span {
	if (item && typeof item === "object" && "span" in item) {
		return (item as { span: Span }).span;
	}
	return { file, line: 1, col: 1, length: 1 };
}

type StringResult =
	| { ok: true; value: string; span: Span }
	| { ok: false; error: ManifestError };

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

type MapResult =
	| { ok: true; map: MapExpr }
	| { ok: false; error: ManifestError };

function expectMap(expr: Expr, field: string): MapResult {
	if (expr.kind !== "map") {
		return {
			ok: false,
			error: {
				message: `"${field}" must be a map, got ${expr.kind}`,
				span: expr.span,
			},
		};
	}
	return { ok: true, map: expr };
}

function parseDeps(
	expr: Expr,
	out: Map<string, DepSpec>,
	errors: ManifestError[],
	field: string,
): void {
	const r = expectMap(expr, field);
	if (!r.ok) {
		errors.push(r.error);
		return;
	}
	for (const entry of r.map.entries) {
		if (!URL_PATTERN.test(entry.key)) {
			errors.push({
				message: `dep key "${entry.key}" must look like "<host>/<owner>/<repo>"`,
				span: entry.keySpan,
			});
		}
		const v = entry.value;
		if (v.kind === "string") {
			const sr = expectPlainString(v, `${field}["${entry.key}"]`);
			if (!sr.ok) {
				errors.push(sr.error);
				continue;
			}
			if (!SEMVER_PATTERN.test(sr.value)) {
				errors.push({
					message: `dep version must be exact semver (X.Y.Z), got "${sr.value}"`,
					span: sr.span,
				});
				continue;
			}
			out.set(entry.key, { version: sr.value, versionSpan: sr.span });
		} else if (v.kind === "map") {
			const ext = parseExtendedDep(v, errors, `${field}["${entry.key}"]`);
			if (ext) out.set(entry.key, ext);
		} else {
			errors.push({
				message: `dep value must be a string (compact) or map (extended), got ${v.kind}`,
				span: v.span,
			});
		}
	}
}

function parseExtendedDep(
	m: MapExpr,
	errors: ManifestError[],
	field: string,
): DepSpec | undefined {
	const lookup = new Map<string, MapEntry>();
	for (const e of m.entries) lookup.set(e.key, e);

	for (const e of m.entries) {
		if (!KNOWN_EXTENDED_DEP_FIELDS.has(e.key)) {
			errors.push({
				message: `unknown field "${e.key}" in extended dep ${field}`,
				span: e.keySpan,
			});
		}
	}

	const versionE = lookup.get("version");
	if (!versionE) {
		errors.push({
			message: `extended dep ${field} must have a "version" field`,
			span: m.span,
		});
		return undefined;
	}
	const vr = expectPlainString(versionE.value, `${field}.version`);
	if (!vr.ok) {
		errors.push(vr.error);
		return undefined;
	}
	if (!SEMVER_PATTERN.test(vr.value)) {
		errors.push({
			message: `dep version must be exact semver, got "${vr.value}"`,
			span: vr.span,
		});
	}

	let alias: string | undefined;
	let aliasSpan: Span | undefined;
	const asE = lookup.get("as");
	if (asE) {
		const ar = expectPlainString(asE.value, `${field}.as`);
		if (ar.ok) {
			if (!NAME_PATTERN.test(ar.value)) {
				errors.push({
					message: `"as" alias must match /[a-z][a-z0-9_]*/, got "${ar.value}"`,
					span: ar.span,
				});
			}
			alias = ar.value;
			aliasSpan = ar.span;
		} else {
			errors.push(ar.error);
		}
	}

	return { version: vr.value, versionSpan: vr.span, alias, aliasSpan };
}

function parseOverrides(
	expr: Expr,
	out: Map<string, OverrideSpec>,
	errors: ManifestError[],
): void {
	const r = expectMap(expr, "overrides");
	if (!r.ok) {
		errors.push(r.error);
		return;
	}
	for (const entry of r.map.entries) {
		if (!URL_PATTERN.test(entry.key)) {
			errors.push({
				message: `override key "${entry.key}" must look like "<host>/<owner>/<repo>"`,
				span: entry.keySpan,
			});
		}
		const sr = expectPlainString(entry.value, `overrides["${entry.key}"]`);
		if (!sr.ok) {
			errors.push(sr.error);
			continue;
		}
		if (!SEMVER_PATTERN.test(sr.value)) {
			errors.push({
				message: `override version must be exact semver, got "${sr.value}"`,
				span: sr.span,
			});
			continue;
		}
		out.set(entry.key, { version: sr.value, versionSpan: sr.span });
	}
}

function validateEspetoConstraint(
	s: string,
	span: Span,
): ManifestError | null {
	const parts = s
		.split(",")
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	if (parts.length === 0) {
		return { message: `"espeto" constraint must not be empty`, span };
	}
	for (const part of parts) {
		const m = part.match(ESPETO_PART_PATTERN);
		const ver = m?.[2];
		if (!m || !ver) {
			return {
				message: `"espeto" constraint "${part}" must use ">=" or "<" with a semver (e.g., ">= 0.1.0")`,
				span,
			};
		}
		if (!SEMVER_PATTERN.test(ver)) {
			return {
				message: `"espeto" constraint version "${ver}" is not valid semver`,
				span,
			};
		}
	}
	return null;
}
