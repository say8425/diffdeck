import type { Hunk } from "@diffdeck/diffs";

// 자동 접힘의 문턱 — 한 파일에서 **변경된** 줄 수(`+`와 `-`의 합)와 비교한다.
// `countChangedLines` 도입 전에는 같은 값이 "파일 길이 × 2"와 비교돼 사실상
// 750줄짜리 파일을 걸렀다. 의미가 바뀌었지만 값은 의도적으로 유지했다 —
// 이제 대략 "750줄 파일을 통째로 다시 쓴 정도"가 접힘 기준이라 자동 접힘이
// 훨씬 드물어지는데, 그게 이 수정이 노린 바다. 값을 1,600 이상으로 올리면
// `large-file-collapse.e2e.ts` ②(800줄 전량 재작성 = 1,600줄 변경)가 먼저
// 빨간불이 된다 — 우연이 아니라 의도된 트립와이어다.
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
// `-M +N` 배지도 같은 값을 센다(`createFileHeaderElement` — 삭제 span을 먼저
// push하므로 화면 순서가 `-M +N`이지 `+N -M`이 아니다).
export const countChangedLines = (
	hunks: readonly Pick<Hunk, "additionLines" | "deletionLines">[],
): number =>
	hunks.reduce((sum, h) => sum + h.additionLines + h.deletionLines, 0);
