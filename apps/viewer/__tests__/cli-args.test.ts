import { describe, expect, test } from "bun:test";
import { parseArgs } from "../cli/args.ts";

describe("parseArgs", () => {
	test("defaults: open true, no port, no help/version", () => {
		expect(parseArgs([])).toEqual({ open: true, help: false, version: false });
	});
	test("--port <n> sets a valid integer port", () => {
		expect(parseArgs(["--port", "51000"])).toEqual({
			port: 51000,
			open: true,
			help: false,
			version: false,
		});
	});
	test("invalid --port value is ignored (port stays undefined)", () => {
		expect(parseArgs(["--port", "abc"])).toEqual({
			open: true,
			help: false,
			version: false,
		});
		expect(parseArgs(["--port", "70000"])).toEqual({
			open: true,
			help: false,
			version: false,
		});
		expect(parseArgs(["--port"])).toEqual({
			open: true,
			help: false,
			version: false,
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
		});
	});
});
