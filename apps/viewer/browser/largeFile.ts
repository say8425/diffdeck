import type { Hunk } from "@diffdeck/diffs";

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

// 한 파일에서 실제로 변경된(`+`/`-` 프리픽스가 붙은) 줄 수.
//
// `FileDiffMetadata`에도 동명의 `additionLines`/`deletionLines`가 있지만 그건
// **string[]**이고, 뷰어처럼 파일 전량으로 파싱한 diff(`isPartial === false`)에서는
// 각각 새/옛 파일의 전체 내용이다 — 세면 "변경량"이 아니라 "파일 길이 × 2"가 된다.
// 실제 변경 줄 수는 hunk 쪽 동명 **숫자** 필드에만 있고, 파일 헤더에 뜨는
// `+N -M` 배지도 같은 값을 센다(`createFileHeaderElement`).
export const countChangedLines = (
	hunks: readonly Pick<Hunk, "additionLines" | "deletionLines">[],
): number =>
	hunks.reduce((sum, h) => sum + h.additionLines + h.deletionLines, 0);
