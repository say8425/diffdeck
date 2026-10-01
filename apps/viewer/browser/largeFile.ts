import type { Hunk } from "@diffdeck/diffs";

// 한 파일의 변경 줄 수(`+`와 `-`의 합)와 비교한다. large-file-collapse.e2e.ts의
// 두 픽스처가 이 값에 맞춰져 있다 — 전량 재작성은 이 값을 넘고, 긴 파일은 옛·새
// 줄 수의 합이 이 값을 넘어야 판별한다. 값을 올리면 둘 다 다시 맞춘다.
export const LARGE_FILE_LINE_THRESHOLD = 1500;

export const LOCKFILE_NAMES: ReadonlySet<string> = new Set([
	"pnpm-lock.yaml",
	"package-lock.json",
	"npm-shrinkwrap.json",
	"yarn.lock",
	"bun.lock",
	"bun.lockb",
	"Cargo.lock",
	"composer.lock",
	"Gemfile.lock",
	"poetry.lock",
	"go.sum",
	"flake.lock",
	"Podfile.lock",
]);

const basename = (path: string): string => {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
};

export const isLargeFile = (name: string, changedLines: number): boolean =>
	LOCKFILE_NAMES.has(basename(name)) ||
	changedLines > LARGE_FILE_LINE_THRESHOLD;

// hunk의 숫자 필드를 센다(헤더의 `-M +N` 배지와 같은 값). `FileDiffMetadata`의
// 같은 이름 필드는 파일 전체 내용(string[])이다(viewer.md).
export const countChangedLines = (
	hunks: readonly Pick<Hunk, "additionLines" | "deletionLines">[],
): number =>
	hunks.reduce((sum, h) => sum + h.additionLines + h.deletionLines, 0);
