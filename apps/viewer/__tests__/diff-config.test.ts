import { describe, expect, test } from "bun:test";
import {
	DEFAULT_DIFF_PORT,
	getCacheDir,
	isDiffViewerDisabled,
	resolveDiffPort,
} from "../server/config.ts";

describe("resolveDiffPort", () => {
	test("defaults when unset", () => {
		expect(resolveDiffPort({})).toBe(DEFAULT_DIFF_PORT);
	});
	test("uses valid override", () => {
		expect(resolveDiffPort({ DIFFDECK_PORT: "51000" })).toBe(51000);
	});
	test("falls back on invalid override", () => {
		expect(resolveDiffPort({ DIFFDECK_PORT: "abc" })).toBe(DEFAULT_DIFF_PORT);
		expect(resolveDiffPort({ DIFFDECK_PORT: "70000" })).toBe(DEFAULT_DIFF_PORT);
		expect(resolveDiffPort({ DIFFDECK_PORT: "0" })).toBe(DEFAULT_DIFF_PORT);
	});
});

describe("isDiffViewerDisabled", () => {
	test("true only when exactly '1'", () => {
		expect(isDiffViewerDisabled({ DIFFDECK_DISABLE: "1" })).toBe(true);
		expect(isDiffViewerDisabled({ DIFFDECK_DISABLE: "0" })).toBe(false);
		expect(isDiffViewerDisabled({})).toBe(false);
	});
});

describe("getCacheDir", () => {
	test("respects XDG_CACHE_HOME", () => {
		expect(getCacheDir({ XDG_CACHE_HOME: "/tmp/xdg" })).toBe(
			"/tmp/xdg/diffdeck",
		);
	});
	test("falls back to ~/.cache", () => {
		const dir = getCacheDir({ HOME: "/home/x" });
		expect(dir.endsWith("/diffdeck")).toBe(true);
	});
});
