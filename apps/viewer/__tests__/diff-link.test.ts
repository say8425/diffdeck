import { describe, expect, test } from "bun:test";
import { buildDiffViewerUrl } from "../server/link.ts";

describe("buildDiffViewerUrl", () => {
	test("builds a 127.0.0.1 URL with encoded repo and token", () => {
		const url = buildDiffViewerUrl({
			port: 49573,
			repo: "/Users/me/my project",
			token: "abc123",
		});
		expect(url).toBe(
			"http://127.0.0.1:49573/?repo=%2FUsers%2Fme%2Fmy+project&token=abc123",
		);
	});

	test("appends mode when provided", () => {
		const url = buildDiffViewerUrl({
			port: 49573,
			repo: "/x",
			token: "abc",
			mode: "base",
		});
		expect(url).toContain("mode=base");
	});

	test("omits mode when not provided", () => {
		const url = buildDiffViewerUrl({ port: 49573, repo: "/x", token: "abc" });
		expect(url).not.toContain("mode=");
	});
});

describe("buildDiffViewerUrl view flags", () => {
	const base = { port: 49573, repo: "/r", token: "t" };
	test("no view flags → no view params", () => {
		const url = buildDiffViewerUrl(base);
		expect(url).not.toContain("untracked");
		expect(url).not.toContain("style");
		expect(url).not.toContain("tree");
		expect(url).not.toContain("flatten");
		expect(url).not.toContain("watch");
		expect(url).not.toContain("sidebar");
	});
	test("non-default values are appended", () => {
		const url = buildDiffViewerUrl({
			...base,
			untracked: true,
			watch: true,
			flatten: false,
			treeSide: "right",
			diffStyle: "split",
			treeHidden: true,
		});
		const q = new URL(url).searchParams;
		expect(q.get("untracked")).toBe("1");
		expect(q.get("watch")).toBe("1");
		expect(q.get("flatten")).toBe("0");
		expect(q.get("tree")).toBe("right");
		expect(q.get("style")).toBe("split");
		expect(q.get("sidebar")).toBe("0");
	});
	test("default values are NOT appended (flatten:true, treeSide:left, diffStyle:unified)", () => {
		const url = buildDiffViewerUrl({
			...base,
			untracked: false,
			watch: false,
			flatten: true,
			treeSide: "left",
			diffStyle: "unified",
			treeHidden: false,
		});
		expect(new URL(url).search).toBe(`?repo=%2Fr&token=t`);
	});
});
