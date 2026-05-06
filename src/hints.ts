function distance(a: string, b: string, maxAllowed: number): number {
	const m = a.length;
	const n = b.length;
	if (Math.abs(m - n) > maxAllowed) return maxAllowed + 1;
	if (m === 0) return n;
	if (n === 0) return m;

	let prev = new Array<number>(n + 1);
	let curr = new Array<number>(n + 1);
	for (let j = 0; j <= n; j++) prev[j] = j;

	for (let i = 1; i <= m; i++) {
		curr[0] = i;
		let rowMin = curr[0]!;
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(
				prev[j]! + 1,
				curr[j - 1]! + 1,
				prev[j - 1]! + cost,
			);
			if (curr[j]! < rowMin) rowMin = curr[j]!;
		}
		if (rowMin > maxAllowed) return maxAllowed + 1;
		[prev, curr] = [curr, prev];
	}
	return prev[n]!;
}

export function findSimilar(
	target: string,
	candidates: string[],
	maxDist?: number,
): string | null {
	const limit = maxDist ?? Math.max(2, Math.floor(target.length / 3));
	let best: string | null = null;
	let bestDist = limit + 1;
	for (const c of candidates) {
		if (c === target) continue;
		const d = distance(target, c, bestDist);
		if (d < bestDist) {
			bestDist = d;
			best = c;
		}
	}
	return best;
}
