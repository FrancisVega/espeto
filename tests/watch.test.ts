import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	debounce,
	diffSets,
	type SettleInfo,
	startWatcher,
} from "../src/watch";

describe("diffSets", () => {
	it("reports adds and removes", () => {
		const a = new Set(["a", "b", "c"]);
		const b = new Set(["b", "c", "d"]);
		const { toClose, toOpen } = diffSets(a, b);
		expect([...toClose]).toEqual(["a"]);
		expect([...toOpen]).toEqual(["d"]);
	});

	it("is empty when sets are equal", () => {
		const a = new Set([1, 2, 3]);
		const b = new Set([1, 2, 3]);
		const { toClose, toOpen } = diffSets(a, b);
		expect(toClose.size).toBe(0);
		expect(toOpen.size).toBe(0);
	});

	it("handles disjoint sets", () => {
		const a = new Set([1, 2]);
		const b = new Set([3, 4]);
		const { toClose, toOpen } = diffSets(a, b);
		expect([...toClose].sort()).toEqual([1, 2]);
		expect([...toOpen].sort()).toEqual([3, 4]);
	});
});

describe("debounce", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("fires once after delay when called rapidly", () => {
		const fn = vi.fn();
		const d = debounce(fn, 100);
		d();
		d();
		d();
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(99);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(2);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("resets the timer on each call", () => {
		const fn = vi.fn();
		const d = debounce(fn, 100);
		d();
		vi.advanceTimersByTime(80);
		d();
		vi.advanceTimersByTime(80);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(30);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("can fire multiple times across separate bursts", () => {
		const fn = vi.fn();
		const d = debounce(fn, 50);
		d();
		vi.advanceTimersByTime(60);
		expect(fn).toHaveBeenCalledTimes(1);
		d();
		vi.advanceTimersByTime(60);
		expect(fn).toHaveBeenCalledTimes(2);
	});
});

describe("startWatcher", () => {
	let dir: string;
	let stdoutSpy: ReturnType<typeof vi.spyOn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "espeto-watch-test-"));
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
	});

	const waitFor = (pred: () => boolean, timeoutMs = 3000) =>
		new Promise<void>((resolve, reject) => {
			const start = Date.now();
			const tick = () => {
				if (pred()) return resolve();
				if (Date.now() - start > timeoutMs)
					return reject(new Error("waitFor timed out"));
				setTimeout(tick, 10);
			};
			tick();
		});

	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	const TEST_GUARD = 50;
	const PAST_GUARD = 80;

	it("re-runs when the entry file changes", async () => {
		const entry = join(dir, "entry.esp");
		writeFileSync(entry, '"first" |> print\n');
		const events: SettleInfo[] = [];
		const handle = startWatcher(entry, {
			onSettled: (e) => events.push(e),
			debounceMs: 20,
			startupGuardMs: TEST_GUARD,
			log: false,
		});
		try {
			await waitFor(() => events.length >= 1);
			expect(events[0]?.code).toBe(0);
			expect(events[0]?.files.size).toBe(1);
			await sleep(PAST_GUARD);
			writeFileSync(entry, '"second" |> print\n');
			await waitFor(() => events.length >= 2);
			expect(events[1]?.code).toBe(0);
		} finally {
			handle.close();
		}
	});

	it("re-runs when an imported file changes", async () => {
		const entry = join(dir, "entry.esp");
		const lib = join(dir, "lib.esp");
		writeFileSync(lib, 'def hello(name) = "hi #{name}"\n');
		writeFileSync(
			entry,
			'import "./lib" only [hello]\nhello("world") |> print\n',
		);
		const events: SettleInfo[] = [];
		const handle = startWatcher(entry, {
			onSettled: (e) => events.push(e),
			debounceMs: 20,
			startupGuardMs: TEST_GUARD,
			log: false,
		});
		try {
			await waitFor(() => events.length >= 1);
			expect(events[0]?.code).toBe(0);
			expect(events[0]?.files.size).toBe(2);
			await sleep(PAST_GUARD);
			writeFileSync(lib, 'def hello(name) = "yo #{name}"\n');
			await waitFor(() => events.length >= 2);
			expect(events[1]?.code).toBe(0);
			expect(events[1]?.files.size).toBe(2);
		} finally {
			handle.close();
		}
	});

	it("survives a parse error and re-runs after a fix", async () => {
		const entry = join(dir, "entry.esp");
		writeFileSync(entry, '"ok" |> print\n');
		const events: SettleInfo[] = [];
		const handle = startWatcher(entry, {
			onSettled: (e) => events.push(e),
			debounceMs: 20,
			startupGuardMs: TEST_GUARD,
			log: false,
		});
		try {
			await waitFor(() => events.length >= 1);
			expect(events[0]?.code).toBe(0);
			await sleep(PAST_GUARD);
			writeFileSync(entry, "this is not valid espeto !!!\n");
			await waitFor(() => events.length >= 2);
			expect(events[1]?.code).toBe(1);
			await sleep(PAST_GUARD);
			writeFileSync(entry, '"recovered" |> print\n');
			await waitFor(() => events.length >= 3);
			expect(events[2]?.code).toBe(0);
		} finally {
			handle.close();
		}
	});
});
