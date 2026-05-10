export type ParsedSemver = {
	major: number;
	minor: number;
	patch: number;
	pre?: string;
	build?: string;
};

const SEMVER_RE =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function parseSemver(s: string): ParsedSemver | null {
	const m = s.match(SEMVER_RE);
	if (!m) return null;
	return {
		major: Number.parseInt(m[1]!, 10),
		minor: Number.parseInt(m[2]!, 10),
		patch: Number.parseInt(m[3]!, 10),
		pre: m[4],
		build: m[5],
	};
}

export function isPreRelease(s: string): boolean {
	const p = parseSemver(s);
	return p !== null && p.pre !== undefined;
}

export function compareSemver(a: string, b: string): number {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	if (pa && pb) return compareParsed(pa, pb);
	const fa = looseTriple(a);
	const fb = looseTriple(b);
	for (let i = 0; i < 3; i++) {
		const av = fa[i] ?? 0;
		const bv = fb[i] ?? 0;
		if (av !== bv) return av < bv ? -1 : 1;
	}
	return 0;
}

function compareParsed(a: ParsedSemver, b: ParsedSemver): number {
	if (a.major !== b.major) return a.major < b.major ? -1 : 1;
	if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
	if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
	if (a.pre === undefined && b.pre === undefined) return 0;
	if (a.pre === undefined) return 1;
	if (b.pre === undefined) return -1;
	return comparePre(a.pre, b.pre);
}

function comparePre(a: string, b: string): number {
	const ap = a.split(".");
	const bp = b.split(".");
	const len = Math.max(ap.length, bp.length);
	for (let i = 0; i < len; i++) {
		const av = ap[i];
		const bv = bp[i];
		if (av === undefined) return -1;
		if (bv === undefined) return 1;
		const ai = /^\d+$/.test(av) ? Number.parseInt(av, 10) : null;
		const bi = /^\d+$/.test(bv) ? Number.parseInt(bv, 10) : null;
		if (ai !== null && bi !== null) {
			if (ai !== bi) return ai < bi ? -1 : 1;
		} else if (ai !== null) {
			return -1;
		} else if (bi !== null) {
			return 1;
		} else if (av !== bv) {
			return av < bv ? -1 : 1;
		}
	}
	return 0;
}

function looseTriple(s: string): number[] {
	return s
		.split("-")[0]!
		.split("+")[0]!
		.split(".")
		.map((x) => Number.parseInt(x, 10) || 0);
}
