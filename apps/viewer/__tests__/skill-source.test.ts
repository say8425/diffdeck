import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, "skills", "diffdeck", "SKILL.md");
const distSkillPath = join(
	import.meta.dir,
	"..",
	"dist",
	"skills",
	"diffdeck",
	"SKILL.md",
);

describe("diffdeck skill source", () => {
	test("skills/diffdeck/SKILL.md exists with name: diffdeck frontmatter", () => {
		expect(existsSync(skillPath)).toBe(true);
		const text = readFileSync(skillPath, "utf8");
		expect(text.startsWith("---")).toBe(true);
		expect(/^name:\s*diffdeck\s*$/m.test(text)).toBe(true);
		expect(/^description:\s*\S/m.test(text)).toBe(true);
	});
});

describe("skill is bundled into dist", () => {
	beforeAll(async () => {
		const proc = Bun.spawn(
			["bun", "run", join(import.meta.dir, "..", "build.ts")],
			{ stdout: "pipe", stderr: "pipe" },
		);
		if ((await proc.exited) !== 0) throw new Error("build.ts failed");
	});
	afterAll(() => {});

	test("build copies SKILL.md to dist/skills/diffdeck/SKILL.md", () => {
		expect(existsSync(distSkillPath)).toBe(true);
		expect(readFileSync(distSkillPath, "utf8")).toContain("name: diffdeck");
	});
});
