import { describe, expect, test } from "bun:test";
import { parseArgs } from "../cli/args.ts";

const DEFAULT_FLAGS = {
	untracked: false,
	watch: false,
	flatten: true,
	treeSide: "left" as const,
	diffStyle: "unified" as const,
	treeHidden: false,
	foldWithTree: false,
};

describe("parseArgs", () => {
	test("defaults: open true, no port, no help/version", () => {
		expect(parseArgs([])).toEqual({
			open: true,
			help: false,
			version: false,
			...DEFAULT_FLAGS,
		});
	});
	test("--port <n> sets a valid integer port", () => {
		expect(parseArgs(["--port", "51000"])).toEqual({
			port: 51000,
			open: true,
			help: false,
			version: false,
			...DEFAULT_FLAGS,
		});
	});
	test("--port 0 is valid (ask the OS for any free port)", () => {
		expect(parseArgs(["--port", "0"])).toEqual({
			port: 0,
			open: true,
			help: false,
			version: false,
			...DEFAULT_FLAGS,
		});
	});
	test("invalid --port value is ignored (port stays undefined)", () => {
		expect(parseArgs(["--port", "abc"])).toEqual({
			open: true,
			help: false,
			version: false,
			...DEFAULT_FLAGS,
		});
		expect(parseArgs(["--port", "-1"])).toEqual({
			open: true,
			help: false,
			version: false,
			...DEFAULT_FLAGS,
		});
		expect(parseArgs(["--port", "70000"])).toEqual({
			open: true,
			help: false,
			version: false,
			...DEFAULT_FLAGS,
		});
		expect(parseArgs(["--port"])).toEqual({
			open: true,
			help: false,
			version: false,
			...DEFAULT_FLAGS,
		});
	});
	test("--no-open disables opening", () => {
		expect(parseArgs(["--no-open"]).open).toBe(false);
	});
	test("--help / -h set help", () => {
		expect(parseArgs(["--help"]).help).toBe(true);
		expect(parseArgs(["-h"]).help).toBe(true);
	});
	test("--version / -v set version", () => {
		expect(parseArgs(["--version"]).version).toBe(true);
		expect(parseArgs(["-v"]).version).toBe(true);
	});
	test("flags combine", () => {
		expect(parseArgs(["--port", "8080", "--no-open"])).toEqual({
			port: 8080,
			open: false,
			help: false,
			version: false,
			...DEFAULT_FLAGS,
		});
	});
});

describe("launch view flags", () => {
	test("defaults: untracked/watch off, flatten on, tree left, style unified, tree not hidden, fold-with-tree off", () => {
		expect(parseArgs([])).toMatchObject({
			untracked: false,
			watch: false,
			flatten: true,
			treeSide: "left",
			diffStyle: "unified",
			treeHidden: false,
			foldWithTree: false,
		});
	});
	test("each flag flips its field", () => {
		expect(
			parseArgs([
				"--untracked",
				"--watch",
				"--no-flatten",
				"--tree-right",
				"--split",
				"--hide-tree",
				"--fold-with-tree",
			]),
		).toMatchObject({
			untracked: true,
			watch: true,
			flatten: false,
			treeSide: "right",
			diffStyle: "split",
			treeHidden: true,
			foldWithTree: true,
		});
	});
});
