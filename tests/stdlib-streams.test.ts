import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { run } from "../src/run";

let tmpDir: string;

beforeAll(() => {
	tmpDir = mkdtempSync(path.join(tmpdir(), "espeto-stream-"));
});

afterAll(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function fixture(name: string, content: string): string {
	const p = path.join(tmpDir, name);
	writeFileSync(p, content, "utf-8");
	return p;
}

function captureStdout(fn: () => void): string {
	const writes: string[] = [];
	const spy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk: unknown) => {
			writes.push(String(chunk));
			return true;
		});
	try {
		fn();
	} finally {
		spy.mockRestore();
	}
	return writes.join("");
}

describe("stdlib/streams: read_lines", () => {
	it("reads file lines and collects to list", () => {
		const p = fixture("a.txt", "alpha\nbeta\ngamma\n");
		expect(run(`read_lines("${p}") |> collect`, "x.esp")).toEqual([
			"alpha",
			"beta",
			"gamma",
		]);
	});

	it("handles file without trailing newline", () => {
		const p = fixture("b.txt", "x\ny");
		expect(run(`read_lines("${p}") |> collect`, "x.esp")).toEqual(["x", "y"]);
	});

	it("empty file returns empty stream", () => {
		const p = fixture("empty.txt", "");
		expect(run(`read_lines("${p}") |> collect`, "x.esp")).toEqual([]);
	});

	it("missing file raises upfront", () => {
		expect(() =>
			run(`read_lines("/does/not/exist") |> count`, "x.esp"),
		).toThrow(/file not found/);
	});

	it("returns a stream value", () => {
		const p = fixture("isstr.txt", "x\n");
		expect(run(`is_stream?(read_lines("${p}"))`, "x.esp")).toBe(true);
	});
});

describe("stdlib/streams: stdin_lines", () => {
	it("returns a stream value", () => {
		expect(run(`is_stream?(stdin_lines())`, "x.esp")).toBe(true);
	});
});

describe("stdlib/streams: sh_lines", () => {
	it("streams stdout lines", () => {
		expect(run(`sh_lines("seq 1 3") |> collect`, "x.esp")).toEqual([
			"1",
			"2",
			"3",
		]);
	});

	it("count consumes fully", () => {
		expect(run(`sh_lines("seq 1 50") |> count`, "x.esp")).toBe(50n);
	});

	it("take terminates early without OOM", () => {
		expect(
			run(`sh_lines("seq 1 1000000") |> take(5) |> collect`, "x.esp"),
		).toEqual(["1", "2", "3", "4", "5"]);
	});

	it("returns a stream value", () => {
		expect(run(`is_stream?(sh_lines("echo hi"))`, "x.esp")).toBe(true);
	});
});

describe("stdlib/streams: collect", () => {
	it("materializes stream to list", () => {
		const p = fixture("col.txt", "x\ny\n");
		expect(run(`read_lines("${p}") |> collect`, "x.esp")).toEqual(["x", "y"]);
	});

	it("rejects non-stream", () => {
		expect(() => run(`collect([1, 2])`, "x.esp")).toThrow(
			/collect: arg must be stream, got list/,
		);
	});
});

describe("stdlib/streams: count", () => {
	it("counts items", () => {
		const p = fixture("cnt.txt", "1\n2\n3\n4\n");
		expect(run(`read_lines("${p}") |> count`, "x.esp")).toBe(4n);
	});

	it("empty stream count is 0", () => {
		const p = fixture("cnt0.txt", "");
		expect(run(`read_lines("${p}") |> count`, "x.esp")).toBe(0n);
	});

	it("rejects non-stream", () => {
		expect(() => run(`count([1, 2])`, "x.esp")).toThrow(
			/count: arg must be stream, got list/,
		);
	});
});

describe("stdlib/streams: lazy ops", () => {
	it("map transforms each line", () => {
		const p = fixture("mp.txt", "abc\ndef\n");
		expect(
			run(`read_lines("${p}") |> map(upcase) |> collect`, "x.esp"),
		).toEqual(["ABC", "DEF"]);
	});

	it("filter keeps matching", () => {
		const p = fixture("flt.txt", "1\n2\n3\n4\n");
		expect(
			run(
				`read_lines("${p}") |> filter(fn s => s == "2" or s == "4") |> collect`,
				"x.esp",
			),
		).toEqual(["2", "4"]);
	});

	it("take limits items", () => {
		const p = fixture("tk.txt", "a\nb\nc\nd\ne\n");
		expect(
			run(`read_lines("${p}") |> take(3) |> collect`, "x.esp"),
		).toEqual(["a", "b", "c"]);
	});

	it("drop skips items", () => {
		const p = fixture("dp.txt", "a\nb\nc\nd\n");
		expect(
			run(`read_lines("${p}") |> drop(2) |> collect`, "x.esp"),
		).toEqual(["c", "d"]);
	});

	it("take_while halts on first false", () => {
		const p = fixture("tw.txt", "a\nbb\nccc\nx\n");
		expect(
			run(
				`read_lines("${p}") |> take_while(fn s => length(s) < 3) |> collect`,
				"x.esp",
			),
		).toEqual(["a", "bb"]);
	});

	it("drop_while skips while true", () => {
		const p = fixture("dw.txt", "a\nbb\nccc\nx\n");
		expect(
			run(
				`read_lines("${p}") |> drop_while(fn s => length(s) < 3) |> collect`,
				"x.esp",
			),
		).toEqual(["ccc", "x"]);
	});

	it("ops chain lazily", () => {
		const p = fixture("chain.txt", "1\n2\n3\n4\n5\n");
		expect(
			run(
				`read_lines("${p}") |> map(to_int) |> filter(fn n => n > 1) |> take(2) |> collect`,
				"x.esp",
			),
		).toEqual([2n, 3n]);
	});
});

describe("stdlib/streams: sinks", () => {
	it("each calls fn for each item", () => {
		const p = fixture("ea.txt", "a\nb\nc\n");
		const out = captureStdout(() =>
			run(`read_lines("${p}") |> each(print)`, "x.esp"),
		);
		expect(out).toBe("a\nb\nc\n");
	});

	it("each returns nil", () => {
		const p = fixture("eanil.txt", "x\n");
		expect(run(`read_lines("${p}") |> each(fn s => s)`, "x.esp")).toBe(null);
	});

	it("reduce folds with init", () => {
		const p = fixture("rd.txt", "1\n2\n3\n");
		expect(
			run(
				`read_lines("${p}") |> map(to_int) |> reduce(0, fn(acc, n) => acc + n)`,
				"x.esp",
			),
		).toBe(6n);
	});

	it("find returns first match", () => {
		const p = fixture("fnd.txt", "a\nbb\nccc\n");
		expect(
			run(
				`read_lines("${p}") |> find(fn s => length(s) >= 2)`,
				"x.esp",
			),
		).toBe("bb");
	});

	it("find returns nil when no match", () => {
		const p = fixture("fnone.txt", "a\nb\n");
		expect(
			run(
				`read_lines("${p}") |> find(fn s => length(s) > 100)`,
				"x.esp",
			),
		).toBe(null);
	});
});

describe("stdlib/streams: polymorphism", () => {
	it("map on list returns list", () => {
		expect(run(`map([1, 2], fn n => n * 2)`, "x.esp")).toEqual([2n, 4n]);
	});

	it("map on stream returns stream", () => {
		const p = fixture("pm.txt", "x\ny\n");
		expect(
			run(`is_stream?(map(read_lines("${p}"), upcase))`, "x.esp"),
		).toBe(true);
	});

	it("filter on stream returns stream", () => {
		const p = fixture("pf.txt", "a\nb\n");
		expect(
			run(
				`is_stream?(filter(read_lines("${p}"), fn s => true))`,
				"x.esp",
			),
		).toBe(true);
	});

	it("each on list returns nil", () => {
		const out = captureStdout(() =>
			run(`each([1, 2], fn n => "n=#{n}" |> print)`, "x.esp"),
		);
		expect(out).toBe("n=1\nn=2\n");
	});

	it("take_while on list", () => {
		expect(
			run(`take_while([1, 2, 3, 1], fn n => n < 3)`, "x.esp"),
		).toEqual([1n, 2n]);
	});

	it("drop_while on list", () => {
		expect(
			run(`drop_while([1, 2, 3, 1], fn n => n < 3)`, "x.esp"),
		).toEqual([3n, 1n]);
	});

	it("take_while empty list", () => {
		expect(run(`take_while([], fn n => true)`, "x.esp")).toEqual([]);
	});

	it("drop_while never-false leaves all", () => {
		expect(
			run(`drop_while([1, 2, 3], fn n => false)`, "x.esp"),
		).toEqual([1n, 2n, 3n]);
	});

	it("take_while predicate must return bool", () => {
		expect(() =>
			run(`take_while([1], fn n => n)`, "x.esp"),
		).toThrow(/take_while: predicate must return bool/);
	});
});

describe("stdlib/streams: list-only fns reject streams pedagogically", () => {
	it("length rejects stream", () => {
		const p = fixture("ls.txt", "a\n");
		expect(() => run(`length(read_lines("${p}"))`, "x.esp")).toThrow(
			/length: stream not supported.*count.*collect/,
		);
	});

	it("head rejects stream", () => {
		const p = fixture("hs.txt", "a\n");
		expect(() => run(`head(read_lines("${p}"))`, "x.esp")).toThrow(
			/head: stream not supported/,
		);
	});

	it("tail rejects stream", () => {
		const p = fixture("ts.txt", "a\n");
		expect(() => run(`tail(read_lines("${p}"))`, "x.esp")).toThrow(
			/tail: stream not supported/,
		);
	});

	it("sort rejects stream", () => {
		const p = fixture("ss.txt", "a\n");
		expect(() => run(`sort(read_lines("${p}"))`, "x.esp")).toThrow(
			/sort: stream not supported/,
		);
	});

	it("sort_by rejects stream", () => {
		const p = fixture("sbs.txt", "a\n");
		expect(() =>
			run(`sort_by(read_lines("${p}"), fn s => s)`, "x.esp"),
		).toThrow(/sort_by: stream not supported/);
	});

	it("reverse rejects stream", () => {
		const p = fixture("rvs.txt", "a\n");
		expect(() => run(`reverse(read_lines("${p}"))`, "x.esp")).toThrow(
			/reverse: stream not supported/,
		);
	});

	it("unique rejects stream", () => {
		const p = fixture("uns.txt", "a\n");
		expect(() => run(`unique(read_lines("${p}"))`, "x.esp")).toThrow(
			/unique: stream not supported/,
		);
	});

	it("concat rejects stream", () => {
		const p = fixture("cns.txt", "a\n");
		expect(() =>
			run(`concat(read_lines("${p}"), [1])`, "x.esp"),
		).toThrow(/concat: stream not supported/);
	});

	it("zip rejects stream", () => {
		const p = fixture("zps.txt", "a\n");
		expect(() => run(`zip(read_lines("${p}"), [1])`, "x.esp")).toThrow(
			/zip: stream not supported/,
		);
	});
});

describe("stdlib/streams: single-pass strict", () => {
	it("re-iterating raises", () => {
		const p = fixture("sp1.txt", "x\ny\n");
		expect(() =>
			run(
				`s = read_lines("${p}")
a = s |> count
b = s |> count`,
				"x.esp",
			),
		).toThrow(/stream already consumed/);
	});

	it("once consumed by op, can't reuse source", () => {
		const p = fixture("sp2.txt", "a\nb\n");
		expect(() =>
			run(
				`s = read_lines("${p}")
a = s |> filter(fn x => true)
b = s |> count`,
				"x.esp",
			),
		).toThrow(/stream already consumed/);
	});

	it("two ops on same source raise", () => {
		const p = fixture("sp3.txt", "a\n");
		expect(() =>
			run(
				`s = read_lines("${p}")
a = s |> map(upcase)
b = s |> filter(fn x => true)`,
				"x.esp",
			),
		).toThrow(/stream already consumed/);
	});
});

describe("stdlib/streams: edge cases", () => {
	it("empty stream collect", () => {
		const p = fixture("ec.txt", "");
		expect(run(`read_lines("${p}") |> collect`, "x.esp")).toEqual([]);
	});

	it("empty stream after filter", () => {
		const p = fixture("ec2.txt", "");
		expect(
			run(
				`read_lines("${p}") |> filter(fn s => true) |> collect`,
				"x.esp",
			),
		).toEqual([]);
	});

	it("stream of 1 item", () => {
		const p = fixture("one.txt", "only\n");
		expect(run(`read_lines("${p}") |> collect`, "x.esp")).toEqual(["only"]);
	});

	it("raise mid-pipeline propagates", () => {
		const p = fixture("err.txt", "1\n2\nbad\n4\n");
		expect(() =>
			run(`read_lines("${p}") |> map(to_int) |> count`, "x.esp"),
		).toThrow(/cannot parse/);
	});

	it("take(0) returns empty", () => {
		const p = fixture("t0.txt", "a\nb\n");
		expect(
			run(`read_lines("${p}") |> take(0) |> collect`, "x.esp"),
		).toEqual([]);
	});

	it("take more than available returns all", () => {
		const p = fixture("tmore.txt", "a\nb\n");
		expect(
			run(`read_lines("${p}") |> take(100) |> collect`, "x.esp"),
		).toEqual(["a", "b"]);
	});

	it("drop more than available returns empty", () => {
		const p = fixture("dmore.txt", "a\nb\n");
		expect(
			run(`read_lines("${p}") |> drop(100) |> collect`, "x.esp"),
		).toEqual([]);
	});

	it("take negative n raises", () => {
		const p = fixture("tneg.txt", "a\n");
		expect(() =>
			run(`read_lines("${p}") |> take(-1) |> collect`, "x.esp"),
		).toThrow(/take: n must be non-negative/);
	});
});

describe("stdlib/streams: serialization guards", () => {
	it("to_str raises on stream", () => {
		const p = fixture("ts1.txt", "a\n");
		expect(() => run(`to_str(read_lines("${p}"))`, "x.esp")).toThrow(
			/streams cannot be stringified/,
		);
	});

	it("to_json raises on stream", () => {
		const p = fixture("tj1.txt", "a\n");
		expect(() => run(`to_json(read_lines("${p}"))`, "x.esp")).toThrow(
			/streams cannot be serialized/,
		);
	});

	it("interpolation raises on stream", () => {
		const p = fixture("ti1.txt", "a\n");
		expect(() =>
			run(
				`s = read_lines("${p}")
"got: #{s}"`,
				"x.esp",
			),
		).toThrow(/streams cannot be stringified/);
	});

	it("== raises on stream", () => {
		const p = fixture("teq.txt", "a\n");
		expect(() =>
			run(`read_lines("${p}") == [1]`, "x.esp"),
		).toThrow(/streams are not comparable/);
	});
});

describe("stdlib/streams: predicate", () => {
	it("is_stream? true for stream", () => {
		const p = fixture("isps.txt", "a\n");
		expect(
			run(`is_stream?(read_lines("${p}"))`, "x.esp"),
		).toBe(true);
	});

	it("is_stream? false for list", () => {
		expect(run(`is_stream?([1, 2])`, "x.esp")).toBe(false);
	});

	it("is_stream? false for str", () => {
		expect(run(`is_stream?("hi")`, "x.esp")).toBe(false);
	});

	it("is_stream? false for nil", () => {
		expect(run(`is_stream?(nil)`, "x.esp")).toBe(false);
	});
});
