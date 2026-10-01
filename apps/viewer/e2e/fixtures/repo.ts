// Playwright가 Node로 돌리므로 Bun `$` 대신 spawnSync로 git을 부른다(proc.ts).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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

/**
 * 전부 opt-in이다 — 기본 픽스처를 전제로 쓴 스펙들이 바이트 단위로 같은
 * 리포를 보게 둔다.
 */
export interface FixtureRepoOptions {
	/**
	 * 통째로 고친 `src/bulk-N.ts`를 더한다. 기본 픽스처는 뷰포트보다 짧아
	 * 스크롤(가상화의 마운트·언마운트)이 일어나지 않는다.
	 */
	bulkFiles?: number;
	/** 이 줄 수의 `pnpm-lock.yaml`을 커밋하고 일부를 고친다(lockfile은 접혀서 뜬다). */
	lockfileLines?: number;
	/** 단일 자식 디렉토리 사슬(`src/mid/deep/nested.ts`) — 사이드바 flatten의 대상. */
	nestedChainFile?: boolean;
	/**
	 * `src/한글파일.ts` — 비ASCII 파일명이 diff를 그리는지 본다(git의 C-quoting,
	 * server/diff.ts의 `parseRawZ`).
	 */
	koreanFilename?: boolean;
	/** 이 줄 수의 `src/big.ts`를 커밋하고 통째로 고친다(변경량은 줄 수의 두 배). */
	bigFileLines?: number;
	/**
	 * 긴 `src/long.ts`에서 몇 줄만 고친다 — 자동 접힘이 파일 길이가 아니라
	 * 변경량으로 판정되는지 가른다.
	 */
	longFileSmallEdit?: boolean;
	/**
	 * 워킹트리를 고치지 않아 기동 시 diff가 비어 있다. untracked `data.txt`는
	 * 그대로 둔다(토글 뒤에 숨은 변경).
	 */
	clean?: boolean;
	/**
	 * `feature` 브랜치에 `src/hello.ts` 수정 하나를 커밋하고 그 브랜치에 남는다.
	 * `clean`과 함께면 "작업은 커밋됐고 워킹트리는 깨끗한" 모양이다.
	 */
	featureBranchCommit?: boolean;
	/**
	 * `src/ctx.ts`에서 context 행을 사이에 둔 두 줄을 지운다. old 쪽 범위가
	 * context 행을 가로질러, `data-alt-line`을 읽는 `lineFor`와 `row.side`
	 * 필터를 가른다.
	 */
	contextBetweenDeletions?: boolean;
	/** base 커밋에 이 브랜치들을 더 만든다(피커가 거를 목록). */
	branches?: string[];
}

// 다른 스펙이 찾는 단어(예: "hello")를 넣지 않는다 — opt-in이 그 스펙들의
// 매치 수를 바꾸지 않게.
const bulkFileLines = (marker: string, length = 200): string =>
	`${Array.from(
		{ length },
		(_, i) =>
			`export const ${marker}_${i} = ${i}; // ${marker} filler line ${i}`,
	).join("\n")}\n`;

// 옛·새 줄 수의 합이 LARGE_FILE_LINE_THRESHOLD를 넘어야 large-file-collapse ①이
// 파일 길이로 세는 회귀를 잡는다.
const LONG_FILE_LINES = 2000;
const LONG_FILE_EDITED_LINES = 3;

// pnpm-lock.yaml 흉내. mutate는 20줄마다 한 블록만 바꿔 변경량을 파일 길이보다
// 훨씬 작게 둔다 — large-file-collapse.e2e.ts의 이름 규칙 스펙이 여기에 기댄다.
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
	const bigFileLines = options.bigFileLines ?? 0;
	if (bigFileLines > 0) {
		writeFileSync(
			join(dir, "src", "big.ts"),
			bulkFileLines("base", bigFileLines),
		);
	}
	if (options.longFileSmallEdit) {
		writeFileSync(
			join(dir, "src", "long.ts"),
			bulkFileLines("base", LONG_FILE_LINES),
		);
	}
	if (options.nestedChainFile) {
		mkdirSync(join(dir, "src", "mid", "deep"), { recursive: true });
		writeFileSync(
			join(dir, "src", "mid", "deep", "nested.ts"),
			"export const nested = 1;\n",
		);
	}
	if (options.koreanFilename) {
		writeFileSync(
			join(dir, "src", "한글파일.ts"),
			"export const korean = 1; // base\n",
		);
	}
	if (options.contextBetweenDeletions) {
		writeFileSync(
			join(dir, "src", "ctx.ts"),
			"keep-a\ndrop-1\nkeep-b\nkeep-c\ndrop-2\nkeep-d\n",
		);
	}

	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "base"]);

	// init.defaultBranch가 머신마다 달라(main/master) 늘 main으로 고정한다 —
	// 안 하면 브랜치명을 보는 스펙이 일부 머신에서만 통과한다.
	git(dir, ["branch", "-M", "main"]);
	for (const branch of options.branches ?? []) {
		git(dir, ["branch", branch]);
	}
	if (options.featureBranchCommit) {
		git(dir, ["checkout", "-qb", "feature"]);
		writeFileSync(
			join(dir, "src", "hello.ts"),
			'export const hello = (): string => "hello, branch";\n',
		);
		git(dir, ["add", "src/hello.ts"]);
		git(dir, ["commit", "-qm", "feature work"]);
	}

	if (!options.clean) {
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
		if (bigFileLines > 0) {
			writeFileSync(
				join(dir, "src", "big.ts"),
				bulkFileLines("edited", bigFileLines),
			);
		}
		if (options.longFileSmallEdit) {
			const lines = bulkFileLines("base", LONG_FILE_LINES).split("\n");
			for (let i = 0; i < LONG_FILE_EDITED_LINES; i++) {
				lines[i] = lines[i]?.replaceAll("base", "edited") ?? "";
			}
			writeFileSync(join(dir, "src", "long.ts"), lines.join("\n"));
		}
		if (options.nestedChainFile) {
			writeFileSync(
				join(dir, "src", "mid", "deep", "nested.ts"),
				"export const nested = 2;\n",
			);
		}
		if (options.koreanFilename) {
			writeFileSync(
				join(dir, "src", "한글파일.ts"),
				"export const korean = 2; // edited\n",
			);
		}
		if (options.contextBetweenDeletions) {
			writeFileSync(
				join(dir, "src", "ctx.ts"),
				"keep-a\nkeep-b\nkeep-c\nkeep-d\n",
			);
		}
	}

	// Untracked file for `--untracked`.
	writeFileSync(join(dir, "data.txt"), "untracked scratch data\n");

	const cleanup = (): void => {
		rmSync(dir, { recursive: true, force: true });
	};

	return { dir, cleanup };
};
