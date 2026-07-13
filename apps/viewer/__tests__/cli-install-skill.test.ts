import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	installSkillTo,
	parseInstallArgs,
	resolveSkillTargets,
} from "../cli/installSkill.ts";

describe("parseInstallArgs", () => {
	test("defaults: no codex, no project", () => {
		expect(parseInstallArgs([])).toEqual({ codex: false, project: false });
	});
	test("--codex and --project flags", () => {
		expect(parseInstallArgs(["--codex", "--project"])).toEqual({
			codex: true,
			project: true,
		});
	});
});

describe("resolveSkillTargets", () => {
	const env = { HOME: "/home/x" };
	test("default → Claude Code user skills dir", () => {
		expect(
			resolveSkillTargets({ codex: false, project: false }, env, "/cwd"),
		).toEqual(["/home/x/.claude/skills/diffdeck"]);
	});
	test("--codex appends Codex user skills dir", () => {
		expect(
			resolveSkillTargets({ codex: true, project: false }, env, "/cwd"),
		).toEqual([
			"/home/x/.claude/skills/diffdeck",
			"/home/x/.agents/skills/diffdeck",
		]);
	});
	test("--project uses cwd as base", () => {
		expect(
			resolveSkillTargets({ codex: true, project: true }, env, "/cwd"),
		).toEqual(["/cwd/.claude/skills/diffdeck", "/cwd/.agents/skills/diffdeck"]);
	});
});

describe("installSkillTo", () => {
	let tmp: string;
	beforeAll(() => {
		tmp = mkdtempSync(join(tmpdir(), "dd-install-"));
	});
	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});
	test("copies SKILL.md into each target dir (creating dirs)", () => {
		const src = join(tmp, "src-SKILL.md");
		Bun.write(src, "---\nname: diffdeck\n---\nbody");
		const a = join(tmp, "a", "diffdeck");
		const b = join(tmp, "b", "diffdeck");
		installSkillTo(src, [a, b]);
		expect(existsSync(join(a, "SKILL.md"))).toBe(true);
		expect(readFileSync(join(b, "SKILL.md"), "utf8")).toContain(
			"name: diffdeck",
		);
	});
});

describe("packaged cli.js install-skill", () => {
	let home: string;
	beforeAll(async () => {
		const build = Bun.spawn(
			["bun", "run", join(import.meta.dir, "..", "build.ts")],
			{ stdout: "pipe", stderr: "pipe" },
		);
		if ((await build.exited) !== 0) throw new Error("build.ts failed");
		home = mkdtempSync(join(tmpdir(), "dd-skill-home-"));
	});
	afterAll(() => {
		rmSync(home, { recursive: true, force: true });
	});
	test("writes the bundled SKILL.md into <HOME>/.claude/skills/diffdeck", async () => {
		const cli = join(import.meta.dir, "..", "dist", "cli.js");
		const proc = Bun.spawn(["bun", cli, "install-skill"], {
			env: { ...process.env, HOME: home },
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await proc.exited).toBe(0);
		const installed = join(home, ".claude", "skills", "diffdeck", "SKILL.md");
		expect(existsSync(installed)).toBe(true);
		expect(readFileSync(installed, "utf8")).toContain("name: diffdeck");
	});
});
