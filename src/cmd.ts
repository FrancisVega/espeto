import type {
	ArgDecl,
	CliType,
	Cmd,
	Expr,
	FlagDecl,
} from "./ast";
import { findSimilar } from "./hints";
import type { Value } from "./values";

export class CliUsageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CliUsageError";
	}
}

export type ParseArgvResult =
	| { kind: "help" }
	| { kind: "values"; provided: Map<string, Value> };

function toKebab(name: string): string {
	return name.replace(/_/g, "-");
}

export function parseCmdArgv(cmd: Cmd, argv: string[]): ParseArgvResult {
	const args = cmd.decls.filter(
		(d): d is ArgDecl => d.kind === "arg_decl",
	);
	const flags = cmd.decls.filter(
		(d): d is FlagDecl => d.kind === "flag_decl",
	);

	const flagByLong = new Map<string, FlagDecl>();
	for (const f of flags) flagByLong.set(toKebab(f.name), f);
	const flagByShort = new Map<string, FlagDecl>();
	for (const f of flags) {
		if (f.attrs.short) flagByShort.set(f.attrs.short, f);
	}

	const provided = new Map<string, Value>();
	const positional: string[] = [];

	let i = 0;
	while (i < argv.length) {
		const tok = argv[i]!;
		if (tok === "--help" || tok === "-h") {
			return { kind: "help" };
		}
		if (tok.startsWith("--")) {
			const eq = tok.indexOf("=");
			const name = eq >= 0 ? tok.slice(2, eq) : tok.slice(2);
			const valuePart = eq >= 0 ? tok.slice(eq + 1) : null;
			const decl = flagByLong.get(name);
			if (!decl) {
				const hint = findSimilar(name, [...flagByLong.keys()]);
				const suffix = hint ? ` (did you mean '--${hint}'?)` : "";
				throw new CliUsageError(`unknown flag: --${name}${suffix}`);
			}
			if (provided.has(decl.name)) {
				throw new CliUsageError(`duplicate flag: --${name}`);
			}
			if (decl.type === "bool" && valuePart === null) {
				provided.set(decl.name, true);
				i++;
				continue;
			}
			let raw: string;
			if (valuePart !== null) {
				raw = valuePart;
				i++;
			} else {
				if (i + 1 >= argv.length) {
					throw new CliUsageError(`flag --${name} expects a value`);
				}
				raw = argv[i + 1]!;
				i += 2;
			}
			provided.set(decl.name, coerce(decl.type, raw, `--${name}`));
			continue;
		}
		if (tok.startsWith("-") && tok.length === 2 && tok !== "--") {
			const ch = tok.slice(1);
			const decl = flagByShort.get(ch);
			if (!decl) {
				throw new CliUsageError(`unknown flag: -${ch}`);
			}
			if (provided.has(decl.name)) {
				throw new CliUsageError(`duplicate flag: --${toKebab(decl.name)}`);
			}
			if (decl.type === "bool") {
				provided.set(decl.name, true);
				i++;
				continue;
			}
			if (i + 1 >= argv.length) {
				throw new CliUsageError(`flag -${ch} expects a value`);
			}
			provided.set(decl.name, coerce(decl.type, argv[i + 1]!, `-${ch}`));
			i += 2;
			continue;
		}
		positional.push(tok);
		i++;
	}

	if (positional.length > args.length) {
		throw new CliUsageError(
			`unexpected positional arg: ${JSON.stringify(positional[args.length])}`,
		);
	}

	for (let j = 0; j < args.length; j++) {
		if (j < positional.length) {
			const arg = args[j]!;
			provided.set(arg.name, coerce(arg.type, positional[j]!, `<${arg.name}>`));
		}
	}

	return { kind: "values", provided };
}

function coerce(type: CliType, raw: string, label: string): Value {
	switch (type) {
		case "str":
			return raw;
		case "int": {
			if (!/^-?\d+$/.test(raw)) {
				throw new CliUsageError(
					`${label} expects int, got ${JSON.stringify(raw)}`,
				);
			}
			return BigInt(raw);
		}
		case "float": {
			if (!/^-?\d+(\.\d+)?$/.test(raw)) {
				throw new CliUsageError(
					`${label} expects float, got ${JSON.stringify(raw)}`,
				);
			}
			return Number(raw);
		}
		case "bool": {
			if (raw === "true") return true;
			if (raw === "false") return false;
			throw new CliUsageError(
				`${label} expects bool (true/false), got ${JSON.stringify(raw)}`,
			);
		}
	}
}

export function formatHelp(cmd: Cmd): string {
	const lines: string[] = [];

	const versionText = pickMetaText(cmd, "meta_version");
	lines.push(versionText ? `${cmd.name} v${versionText}` : cmd.name);

	const descText = pickMetaText(cmd, "meta_desc");
	if (descText) {
		lines.push("");
		lines.push(descText);
	}

	lines.push("");

	const args = cmd.decls.filter(
		(d): d is ArgDecl => d.kind === "arg_decl",
	);
	const flags = cmd.decls.filter(
		(d): d is FlagDecl => d.kind === "flag_decl",
	);

	const usage: string[] = [`Usage: ${cmd.name}`];
	for (const a of args) {
		usage.push(a.default ? `[${a.name}]` : `<${a.name}>`);
	}
	if (flags.length > 0) usage.push("[options]");
	lines.push(usage.join(" "));

	if (args.length > 0) {
		lines.push("");
		lines.push("Arguments:");
		for (const a of args) {
			const left = `  <${a.name}>  (${a.type})`;
			const right = a.attrs.desc ?? "";
			lines.push(joinPadded(left, right));
		}
	}

	lines.push("");
	lines.push("Options:");
	for (const f of flags) {
		const aliases = `--${toKebab(f.name)}${f.attrs.short ? `, -${f.attrs.short}` : ""}`;
		const typeBit = f.type === "bool" ? "" : ` <${f.type}>`;
		const left = `  ${aliases}${typeBit}`;
		const parts: string[] = [`(${f.type})`];
		if (f.attrs.desc) parts.push(f.attrs.desc);
		if (f.default) parts.push(`default: ${defaultLabel(f.default)}`);
		lines.push(joinPadded(left, parts.join("; ")));
	}
	lines.push(joinPadded("  --help, -h", "show this help"));

	return `${lines.join("\n")}\n`;
}

function pickMetaText(
	cmd: Cmd,
	kind: "meta_desc" | "meta_version",
): string | null {
	for (const m of cmd.meta) {
		if (m.kind !== kind) continue;
		const v = m.value;
		if (
			v.kind === "string" &&
			v.parts.length === 1 &&
			typeof v.parts[0] === "string"
		) {
			return v.parts[0];
		}
	}
	return null;
}

function defaultLabel(expr: Expr): string {
	if (
		expr.kind === "string" &&
		expr.parts.length === 1 &&
		typeof expr.parts[0] === "string"
	) {
		return JSON.stringify(expr.parts[0]);
	}
	if (
		expr.kind === "int" ||
		expr.kind === "float" ||
		expr.kind === "bool"
	) {
		return String(expr.value);
	}
	if (expr.kind === "nil") return "nil";
	return "<expr>";
}

function joinPadded(left: string, right: string): string {
	if (!right) return left;
	const minWidth = 28;
	const pad = Math.max(1, minWidth - left.length);
	return `${left}${" ".repeat(pad)}${right}`;
}
