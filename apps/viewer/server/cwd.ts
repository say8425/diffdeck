/**
 * 프로세스 cwd가 삭제됐을 때 diffdeck 전체가 죽는 것을 막기 위한 판정 로직.
 *
 * cwd가 unlink된 프로세스는 자식 프로세스를 하나도 생성할 수 없다 — 자식이
 * 상속할 cwd를 커널이 해석하지 못하기 때문이고, 이는 OS 제약이라 셸을 안
 * 거치는 Bun.spawn도 ENOENT로 죽는다(실측). git 호출이 전부 실패하므로
 * /api/diff가 repo와 무관하게 400 "not a git repository"를 낸다.
 */

/** 재오염이 불가능한 유일한 경로 — 루트는 unlink할 수 없다. */
export const SAFE_CWD = "/";

/**
 * cwd 생존 판정에 필요한 syscall 의존. server.ts의 `createHandler` cfg·
 * `startDiffServer` opts와 이 파일의 `isCwdAlive` 파라미터, 총 세 곳에서
 * 같은 모양을 반복해 여기서 한 번만 선언하고 재사용한다.
 */
export interface CwdDeps {
	cwd: () => string;
	exists: (path: string) => boolean;
}

/**
 * cwd가 아직 살아 있는지 판정한다.
 *
 * `existsSync(".")`·`statSync(".")`로는 못 잡는다: 디렉토리가 unlink돼도
 * 프로세스가 쥔 cwd 파일 디스크립터가 inode를 살려두므로 둘 다 true를
 * 반환한다(실측). `process.cwd()`가 주는 스테일 **경로 문자열**만이
 * 네임스페이스에서 사라진 사실을 드러낸다.
 *
 * syscall을 직접 부르지 않고 주입받는 이유는 이 판정을 hermetic하게
 * 단위 테스트하기 위해서다.
 */
export const isCwdAlive = (deps: CwdDeps): boolean => {
	try {
		return deps.exists(deps.cwd());
	} catch {
		// 런타임에 따라 삭제된 cwd에서 process.cwd()가 throw한다 — 동일
		// darwin에서 Node는 uv_cwd ENOENT를 던지고 Bun은 캐시된 스테일
		// 문자열을 돌려준다(실측). throw했다는 사실 자체가 "cwd가 죽었다"는
		// 증거이므로 false가 정답이다. 여기서 삼키지 않으면 핸들러 진입부가
		// 그대로 터져 Bun.serve에 error 핸들러가 없는 지금 모든 라우트가
		// 500이 된다 — 고치려는 버그보다 나쁘다.
		return false;
	}
};
