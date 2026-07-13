// Deterministic fixture repo for e2e specs: a committed base commit, then
// working-tree edits so the diff viewer has something to render on first
// load. Mirrors the mkdtempSync + git-seed pattern from
// apps/viewer/__tests__/cli-smoke.test.ts (which uses Bun's `$` shell — not
// available under Playwright's Node runtime, see fixtures/proc.ts's header),
// extended with the shapes Tasks 7-8 need: two text diffs (for tree nav), a
// binary image diff (Old/New card), and an untracked file (`--untracked`).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Two distinct 1x1 PNGs (red, then blue) so assets/logo.png has a real binary
// diff: committed as red, overwritten in the working tree as blue.
const RED_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const BLUE_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC";

const git = (dir: string, args: string[]): void => {
	const result = spawnSync("git", ["-C", dir, ...args], { stdio: "pipe" });
	if (result.status !== 0) {
		const stderr = result.stderr?.toString() ?? "";
		throw new Error(
			`git ${args.join(" ")} failed (exit ${result.status}): ${stderr}`,
		);
	}
};

export interface FixtureRepo {
	dir: string;
	cleanup: () => void;
}

export const makeFixtureRepo = (): FixtureRepo => {
	const dir = mkdtempSync(join(tmpdir(), "dd-e2e-repo-"));

	git(dir, ["init", "-q"]);
	git(dir, ["config", "user.email", "t@t.co"]);
	git(dir, ["config", "user.name", "test"]);

	mkdirSync(join(dir, "src"), { recursive: true });
	mkdirSync(join(dir, "assets"), { recursive: true });

	// Committed base.
	writeFileSync(
		join(dir, "src", "hello.ts"),
		'export const hello = (): string => "hello";\n',
	);
	writeFileSync(
		join(dir, "README.md"),
		"# diffdeck e2e fixture\n\nBase line.\n",
	);
	writeFileSync(
		join(dir, "assets", "logo.png"),
		Buffer.from(RED_PNG_BASE64, "base64"),
	);

	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "base"]);

	// Working-tree changes: two text diffs, one binary image diff.
	writeFileSync(
		join(dir, "src", "hello.ts"),
		'export const hello = (): string => "hello, world";\n',
	);
	writeFileSync(
		join(dir, "README.md"),
		"# diffdeck e2e fixture\n\nBase line.\n\nWorking-tree edit.\n",
	);
	writeFileSync(
		join(dir, "assets", "logo.png"),
		Buffer.from(BLUE_PNG_BASE64, "base64"),
	);

	// Untracked file for `--untracked`.
	writeFileSync(join(dir, "data.txt"), "untracked scratch data\n");

	const cleanup = (): void => {
		rmSync(dir, { recursive: true, force: true });
	};

	return { dir, cleanup };
};
