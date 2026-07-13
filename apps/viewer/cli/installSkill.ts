import { cpSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

export interface InstallSkillOptions {
	codex: boolean;
	project: boolean;
}

export const parseInstallArgs = (argv: string[]): InstallSkillOptions => ({
	codex: argv.includes("--codex"),
	project: argv.includes("--project"),
});

// Target directories the skill is written into. Claude Code reads
// <base>/.claude/skills/<name>/; Codex reads <base>/.agents/skills/<name>/.
// base = cwd for --project (repo-local), else HOME (user-global).
export const resolveSkillTargets = (
	opts: InstallSkillOptions,
	env: Env = process.env,
	cwd: string = process.cwd(),
): string[] => {
	const base = opts.project ? cwd : env.HOME || homedir();
	const targets = [join(base, ".claude", "skills", "diffdeck")];
	if (opts.codex) targets.push(join(base, ".agents", "skills", "diffdeck"));
	return targets;
};

export const installSkillTo = (sourceFile: string, targets: string[]): void => {
	for (const dir of targets) {
		mkdirSync(dir, { recursive: true });
		cpSync(sourceFile, join(dir, "SKILL.md"));
	}
};
