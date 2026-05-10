import { describe, expect, it } from "vitest";
import { compareSemver, isPreRelease, parseSemver } from "../src/moraga/semver";

describe("parseSemver", () => {
	it("parses plain versions", () => {
		expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
	});

	it("parses versions with pre-release", () => {
		expect(parseSemver("1.0.0-beta.1")).toEqual({
			major: 1,
			minor: 0,
			patch: 0,
			pre: "beta.1",
		});
	});

	it("parses versions with build metadata", () => {
		expect(parseSemver("1.0.0+abc")).toEqual({
			major: 1,
			minor: 0,
			patch: 0,
			build: "abc",
		});
	});

	it("returns null for non-semver", () => {
		expect(parseSemver("v1.0.0")).toBeNull();
		expect(parseSemver("not-a-version")).toBeNull();
		expect(parseSemver("1.0")).toBeNull();
	});
});

describe("isPreRelease", () => {
	it("returns true for pre-release versions", () => {
		expect(isPreRelease("1.0.0-beta")).toBe(true);
		expect(isPreRelease("1.0.0-rc.1")).toBe(true);
		expect(isPreRelease("0.1.0-alpha.0")).toBe(true);
	});

	it("returns false for stable versions", () => {
		expect(isPreRelease("1.0.0")).toBe(false);
		expect(isPreRelease("1.0.0+build")).toBe(false);
	});

	it("returns false for invalid versions", () => {
		expect(isPreRelease("not-a-version")).toBe(false);
	});
});

describe("compareSemver", () => {
	it("compares major/minor/patch", () => {
		expect(compareSemver("1.0.0", "2.0.0")).toBeLessThan(0);
		expect(compareSemver("2.0.0", "1.0.0")).toBeGreaterThan(0);
		expect(compareSemver("1.2.0", "1.10.0")).toBeLessThan(0);
		expect(compareSemver("1.0.5", "1.0.10")).toBeLessThan(0);
		expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
	});

	it("ranks pre-release lower than stable of same triple", () => {
		expect(compareSemver("1.0.0-beta", "1.0.0")).toBeLessThan(0);
		expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
	});

	it("compares pre-release identifiers per spec", () => {
		expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
		expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.2")).toBeLessThan(0);
		expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
		expect(compareSemver("1.0.0-rc.1", "1.0.0-rc.10")).toBeLessThan(0);
	});

	it("ignores build metadata in comparison", () => {
		expect(compareSemver("1.0.0+a", "1.0.0+b")).toBe(0);
	});
});
