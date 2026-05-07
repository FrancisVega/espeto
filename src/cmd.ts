import type {
	ArgDecl,
	CliType,
	Cmd,
	Expr,
	FlagDecl,
	MetaStmt,
	ProgramDecl,
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

export type ProgramArgvSplit = {
	progArgv: string[];
	subcmd: string | null;
	cmdArgv: string[];
};

export type ParseProgramFlagsResult =
	| { kind: "help" }
	| { kind: "version" }
	| { kind: "values"; provided: Map<string, Value> };

function toKebab(name: string): string {
	return name.replace(/_/g, "-");
}

export function splitProgramArgv(
	argv: string[],
	programFlags: FlagDecl[],
): ProgramArgvSplit {
	const flagByLong = new Map<string, FlagDecl>();
	const flagByShort = new Map<string, FlagDecl>();
	for (const f of programFlags) {
		flagByLong.set(toKebab(f.name), f);
		if (f.attrs.short) flagByShort.set(f.attrs.short, f);
	}

	const progArgv: string[] = [];
	let i = 0;
	while (i < argv.length) {
		const tok = argv[i]!;
		if (tok === "--") {
			i++;
			continue;
		}
		if (tok.startsWith("--")) {
			const eq = tok.indexOf("=");
			if (eq >= 0) {
				progArgv.push(tok);
				i++;
				continue;
			}
			const name = tok.slice(2);
			const decl = flagByLong.get(name);
			if (decl && decl.type !== "bool") {
				progArgv.push(tok);
				if (i + 1 < argv.length) {
					progArgv.push(argv[i + 1]!);
					i += 2;
				} else {
					i++;
				}
				continue;
			}
			progArgv.push(tok);
			i++;
			continue;
		}
		if (tok.startsWith("-") && tok.length === 2) {
			const ch = tok.slice(1);
			if (ch >= "0" && ch <= "9") {
				break;
			}
			const decl = flagByShort.get(ch);
			if (decl && decl.type !== "bool") {
				progArgv.push(tok);
				if (i + 1 < argv.length) {
					progArgv.push(argv[i + 1]!);
					i += 2;
				} else {
					i++;
				}
				continue;
			}
			progArgv.push(tok);
			i++;
			continue;
		}
		break;
	}

	if (i >= argv.length) {
		return { progArgv, subcmd: null, cmdArgv: [] };
	}
	const subcmd = argv[i]!;
	const cmdArgv = argv.slice(i + 1);
	return { progArgv, subcmd, cmdArgv };
}

export function parseProgramFlags(
	prog: ProgramDecl,
	argv: string[],
): ParseProgramFlagsResult {
	const flags = prog.flags;
	const flagByLong = new Map<string, FlagDecl>();
	const flagByShort = new Map<string, FlagDecl>();
	for (const f of flags) {
		flagByLong.set(toKebab(f.name), f);
		if (f.attrs.short) flagByShort.set(f.attrs.short, f);
	}

	const hasVersion =
		prog.meta.find((m) => m.kind === "meta_version") !== undefined;

	const provided = new Map<string, Value>();
	let i = 0;
	while (i < argv.length) {
		const tok = argv[i]!;
		if (tok === "--help" || tok === "-h") {
			return { kind: "help" };
		}
		if (tok === "--version") {
			if (!hasVersion) {
				throw new CliUsageError("unknown flag: --version");
			}
			return { kind: "version" };
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
		if (tok.startsWith("-") && tok.length === 2) {
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
		throw new CliUsageError(
			`unexpected positional '${tok}' before subcommand (program-level flags must come before the subcommand name)`,
		);
	}

	return { kind: "values", provided };
}

export function pickMeta(
	meta: MetaStmt[],
	kind: "meta_desc" | "meta_version",
): string | null {
	for (const m of meta) {
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

export function parseCmdArgv(
	cmd: Cmd,
	argv: string[],
	parent?: ProgramDecl,
): ParseArgvResult {
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

	const parentFlagsByLong = new Map<string, FlagDecl>();
	const parentFlagsByShort = new Map<string, FlagDecl>();
	if (parent) {
		for (const f of parent.flags) {
			parentFlagsByLong.set(toKebab(f.name), f);
			if (f.attrs.short) parentFlagsByShort.set(f.attrs.short, f);
		}
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
				if (parent && parentFlagsByLong.has(name)) {
					throw new CliUsageError(
						`unknown flag '--${name}' for command '${cmd.name}'\n\n  '--${name}' is a flag of program '${parent.name}' — write it before the subcommand:\n      ${parent.name} --${name} ${cmd.name} ...`,
					);
				}
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
			if (ch >= "0" && ch <= "9") {
				positional.push(tok);
				i++;
				continue;
			}
			const decl = flagByShort.get(ch);
			if (!decl) {
				if (parent && parentFlagsByShort.has(ch)) {
					const longName = toKebab(parentFlagsByShort.get(ch)!.name);
					throw new CliUsageError(
						`unknown flag '-${ch}' for command '${cmd.name}'\n\n  '-${ch}' is a flag of program '${parent.name}' — write it before the subcommand:\n      ${parent.name} -${ch} ${cmd.name} ...    (or --${longName})`,
					);
				}
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

export function formatUsageLine(cmd: Cmd, parent?: ProgramDecl): string {
	const cmdName = parent ? `${parent.name} ${cmd.name}` : cmd.name;
	const args = cmd.decls.filter(
		(d): d is ArgDecl => d.kind === "arg_decl",
	);
	const flags = cmd.decls.filter(
		(d): d is FlagDecl => d.kind === "flag_decl",
	);
	const inheritedCount = parent ? parent.flags.length : 0;
	const parts: string[] = [`usage: ${cmdName}`];
	for (const a of args) {
		parts.push(a.default ? `[${a.name}]` : `<${a.name}>`);
	}
	if (flags.length > 0 || inheritedCount > 0) parts.push("[options]");
	return parts.join(" ");
}

export function formatHelp(cmd: Cmd, parent?: ProgramDecl): string {
	const lines: string[] = [];

	const cmdName = parent ? `${parent.name} ${cmd.name}` : cmd.name;
	const versionText = pickMetaText(cmd, "meta_version");
	lines.push(versionText ? `${cmdName} v${versionText}` : cmdName);

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

	const inherited = parent ? parent.flags : [];
	const usage: string[] = [`Usage: ${cmdName}`];
	for (const a of args) {
		usage.push(a.default ? `[${a.name}]` : `<${a.name}>`);
	}
	if (flags.length > 0 || inherited.length > 0) usage.push("[options]");
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
		lines.push(formatFlagLine(f));
	}
	for (const f of inherited) {
		lines.push(formatFlagLine(f, parent ? parent.name : undefined));
	}
	lines.push(joinPadded("  --help, -h", "show this help"));

	return `${lines.join("\n")}\n`;
}

function formatFlagLine(f: FlagDecl, inheritedFrom?: string): string {
	const aliases = `--${toKebab(f.name)}${f.attrs.short ? `, -${f.attrs.short}` : ""}`;
	const typeBit = f.type === "bool" ? "" : ` <${f.type}>`;
	const left = `  ${aliases}${typeBit}`;
	const parts: string[] = [];
	if (inheritedFrom) parts.push(`(inherited from ${inheritedFrom})`);
	parts.push(`(${f.type})`);
	if (f.attrs.desc) parts.push(f.attrs.desc);
	if (f.default) parts.push(`default: ${defaultLabel(f.default)}`);
	return joinPadded(left, parts.join("; "));
}

function pickMetaText(
	cmd: Cmd,
	kind: "meta_desc" | "meta_version",
): string | null {
	return pickMeta(cmd.meta, kind);
}

export function formatProgramHelp(prog: ProgramDecl): string {
	const lines: string[] = [];

	const versionText = pickMeta(prog.meta, "meta_version");
	lines.push(versionText ? `${prog.name} v${versionText}` : prog.name);

	const descText = pickMeta(prog.meta, "meta_desc");
	if (descText) {
		lines.push("");
		lines.push(descText);
	}

	lines.push("");
	lines.push(`Usage: ${prog.name} <command> [options]`);

	lines.push("");
	lines.push("Commands:");
	for (const c of prog.cmds) {
		const desc = pickMetaText(c, "meta_desc");
		const left = `  ${c.name}`;
		lines.push(joinPadded(left, desc ?? ""));
	}

	if (prog.flags.length > 0) {
		lines.push("");
		lines.push("Options:");
		for (const f of prog.flags) {
			const aliases = `--${toKebab(f.name)}${f.attrs.short ? `, -${f.attrs.short}` : ""}`;
			const typeBit = f.type === "bool" ? "" : ` <${f.type}>`;
			const left = `  ${aliases}${typeBit}`;
			const parts: string[] = [`(${f.type})`];
			if (f.attrs.desc) parts.push(f.attrs.desc);
			if (f.default) parts.push(`default: ${defaultLabel(f.default)}`);
			lines.push(joinPadded(left, parts.join("; ")));
		}
	} else {
		lines.push("");
		lines.push("Options:");
	}
	lines.push(joinPadded("  --help, -h", "show this help"));
	if (versionText) {
		lines.push(joinPadded("  --version", "show version"));
	}

	lines.push("");
	lines.push(`Run '${prog.name} <command> --help' for command-specific help.`);

	return `${lines.join("\n")}\n`;
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
