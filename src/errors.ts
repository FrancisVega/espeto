export type Span = {
	file: string;
	line: number;
	col: number;
	length: number;
};

export type Frame = {
	name: string;
	callSpan: Span;
	callerSource: string;
};

export class EspetoError extends Error {
	readonly span: Span;
	readonly source: string;
	readonly frames: Frame[] = [];

	constructor(message: string, span: Span, source: string) {
		super(message);
		this.name = "EspetoError";
		this.span = span;
		this.source = source;
	}
}

const MAX_FRAMES = 3;

const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export type FormatOptions = { color?: boolean };

function renderSpan(span: Span, source: string, color: boolean): string {
	const lines = source.split("\n");
	const line = lines[span.line - 1] ?? "";
	const lineNumStr = String(span.line);
	const gutter = " ".repeat(lineNumStr.length);
	const lineRow = `${lineNumStr} | ${line}`;
	const caretCol = Math.max(span.col - 1, 0);
	const caretLength = Math.max(span.length, 1);
	const carets = "^".repeat(caretLength);
	const caretRow = `${gutter} | ${" ".repeat(caretCol)}${color ? `${RED}${BOLD}${carets}${RESET}` : carets}`;
	return `${lineRow}\n${caretRow}`;
}

export function formatError(
	err: EspetoError,
	opts: FormatOptions = {},
): string {
	const color = opts.color === true;
	const { span, source, message, frames } = err;
	const errorLabel = color ? `${RED}${BOLD}error${RESET}` : "error";
	const location = color
		? `${BOLD}${span.file}:${span.line}:${span.col}${RESET}`
		: `${span.file}:${span.line}:${span.col}`;
	const header = `${location}: ${errorLabel}: ${message}`;
	const out = [header, renderSpan(span, source, color)];

	const shown = frames.slice(0, MAX_FRAMES);
	for (const f of shown) {
		const loc = `${f.callSpan.file}:${f.callSpan.line}:${f.callSpan.col}`;
		const frameHeader = color
			? `  ${DIM}called from${RESET} ${loc} ${DIM}in${RESET} ${f.name}`
			: `  called from ${loc} in ${f.name}`;
		out.push(frameHeader);
		out.push(renderSpan(f.callSpan, f.callerSource, color));
	}
	if (frames.length > MAX_FRAMES) {
		const more = `  ... and ${frames.length - MAX_FRAMES} more frame(s)`;
		out.push(color ? `${DIM}${more}${RESET}` : more);
	}

	return out.join("\n");
}
