/**
 * cwd가 삭제된 프로세스는 자식 프로세스를 하나도 띄울 수 없다(OS 제약이라 `Bun.spawn`도
 * ENOENT). 그러면 모든 라우트가 repo와 무관하게 `git-unavailable`이 된다.
 */

/** 루트는 unlink할 수 없다. */
export const SAFE_CWD = "/";

export interface CwdDeps {
	cwd: () => string;
	exists: (path: string) => boolean;
}

/**
 * `existsSync(".")`·`statSync(".")`로는 못 잡는다 — 열린 cwd 디스크립터가 inode를 살려
 * 둬 항상 true다. `process.cwd()`가 주는 경로 문자열만이 사라진 사실을 드러낸다.
 */
export const isCwdAlive = (deps: CwdDeps): boolean => {
	try {
		return deps.exists(deps.cwd());
	} catch {
		// 런타임에 따라(Node) 삭제된 cwd에서 process.cwd()가 throw한다 — 그 자체가 죽었다는
		// 증거다. 삼키지 않으면 핸들러 진입부가 터져 모든 라우트가 500이 된다.
		return false;
	}
};
