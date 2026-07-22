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

export interface FixtureRepoOptions {
	/**
	 * Extra `src/bulk-N.ts` files, each fully rewritten in the working tree, to
	 * make the rendered diff tall enough to actually scroll — which is what
	 * drives CodeView's virtualization to mount and unmount files. The default
	 * fixture renders shorter than the viewport (nothing scrolls), so a spec
	 * that needs scroll behaviour must opt in. Kept opt-in so every other spec
	 * sees the byte-identical repo it was written against.
	 */
	bulkFiles?: number;
	/**
	 * Opt-in: commit a `pnpm-lock.yaml` with this many lines and edit part of
	 * it in the working tree. The viewer auto-collapses lockfiles on first
	 * sight, so this exercises the "huge collapsed file mounts at the bottom"
	 * path (lockfile-freeze.e2e.ts) without inflating any other spec's repo.
	 */
	lockfileLines?: number;
}

// Wide enough that each line is one diff row; deliberately free of the words
// other specs search for (e.g. "hello"), so opting in can never shift their
// match counts.
const bulkFileLines = (marker: string): string =>
	`${Array.from(
		{ length: 200 },
		(_, i) =>
			`export const ${marker}_${i} = ${i}; // ${marker} filler line ${i}`,
	).join("\n")}\n`;

// pnpm-lock.yaml 흉내: 실제 lockfile처럼 패키지 블록이 반복되는 YAML.
// mutate 시 20줄마다 버전만 바꿔 수천 줄짜리 현실적인 diff를 만든다.
const lockfileContents = (lines: number, mutate: boolean): string => {
	const out: string[] = ["lockfileVersion: '9.0'", "packages:"];
	for (let i = 2; i < lines; i += 2) {
		const bumped = mutate && i % 20 === 0;
		out.push(`  /pkg-${i}@1.${bumped ? 1 : 0}.0:`);
		out.push(
			`    resolution: {integrity: sha512-pkg${i}${bumped ? "b" : "a"}}`,
		);
	}
	return `${out.join("\n")}\n`;
};

export const makeFixtureRepo = (
	options: FixtureRepoOptions = {},
): FixtureRepo => {
	const bulkFiles = options.bulkFiles ?? 0;
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
	for (let i = 0; i < bulkFiles; i++) {
		writeFileSync(join(dir, "src", `bulk-${i}.ts`), bulkFileLines("base"));
	}
	const lockfileLines = options.lockfileLines ?? 0;
	if (lockfileLines > 0) {
		writeFileSync(
			join(dir, "pnpm-lock.yaml"),
			lockfileContents(lockfileLines, false),
		);
	}

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

	for (let i = 0; i < bulkFiles; i++) {
		writeFileSync(join(dir, "src", `bulk-${i}.ts`), bulkFileLines("edited"));
	}
	if (lockfileLines > 0) {
		writeFileSync(
			join(dir, "pnpm-lock.yaml"),
			lockfileContents(lockfileLines, true),
		);
	}

	// Untracked file for `--untracked`.
	writeFileSync(join(dir, "data.txt"), "untracked scratch data\n");

	const cleanup = (): void => {
		rmSync(dir, { recursive: true, force: true });
	};

	return { dir, cleanup };
};
