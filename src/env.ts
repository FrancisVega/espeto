import type { Value } from "./values";

export class Env {
	private bindings = new Map<string, Value>();

	constructor(private parent: Env | null = null) {}

	lookup(name: string): Value | undefined {
		const v = this.bindings.get(name);
		if (v !== undefined) return v;
		return this.parent?.lookup(name);
	}

	define(name: string, value: Value): void {
		this.bindings.set(name, value);
	}

	extend(): Env {
		return new Env(this);
	}

	allNames(): string[] {
		const out = new Set<string>();
		// biome-ignore lint/suspicious/noExplicitAny: traversal
		let cur: Env | null = this;
		while (cur !== null) {
			for (const k of cur.bindings.keys()) out.add(k);
			cur = cur.parent;
		}
		return [...out];
	}
}
