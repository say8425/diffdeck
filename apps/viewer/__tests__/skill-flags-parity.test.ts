import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HELP } from "../cli.ts";

const skillPath = join(
	import.meta.dir,
	"..",
	"..",
	"..",
	"skills",
	"diffdeck",
	"SKILL.md",
);

const metaFlags = new Set(["--help", "--version"]);

const extractOptionsFlags = (help: string): string[] => {
	const optionsBlock = help.split("Options:")[1].split(/\n\s*\n/)[0];
	const tokens = optionsBlock.match(/--[a-z][a-z-]*/g) ?? [];
	return [...new Set(tokens)].filter((flag) => !metaFlags.has(flag));
};

describe("SKILL.md Options parity with cli.ts HELP", () => {
	const flags = extractOptionsFlags(HELP);

	test("HELP's Options block has flags to check", () => {
		expect(flags.length).toBeGreaterThan(0);
	});

	test("HELP's Options block excludes meta-flags --help/--version", () => {
		expect(flags).not.toContain("--help");
		expect(flags).not.toContain("--version");
	});

	const skillContent = readFileSync(skillPath, "utf8");

	for (const flag of extractOptionsFlags(HELP)) {
		test(`SKILL.md documents ${flag}`, () => {
			expect(skillContent).toContain(`\`${flag}`);
		});
	}
});
