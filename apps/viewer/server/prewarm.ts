/**
 * 서버 기동 직후 자기 자신의 /api/diff를 미리 호출해 payload 캐시를 데운다.
 * 브라우저가 뜨는 동안 파이프라인이 선실행되므로 첫 화면 요청이 캐시 히트로
 * 떨어진다. best-effort — 실패해도 뷰어 동작에는 영향이 없다.
 */

export const prewarmDiff = async (opts: {
	port: number;
	repo: string;
	token: string;
	untracked: boolean;
}): Promise<number> => {
	let warmed = 0;
	// 순차 실행: 두 모드를 동시에 돌리면 파일당 git 서브프로세스 burst가
	// 두 배가 된다 — 기동 직후라 순차로도 충분히 이르다.
	for (const mode of ["working", "base"] as const) {
		const query = new URLSearchParams({
			repo: opts.repo,
			token: opts.token,
			untracked: opts.untracked ? "1" : "0",
			mode,
		});
		try {
			// oxlint-disable-next-line no-await-in-loop
			const res = await fetch(
				`http://127.0.0.1:${opts.port}/api/diff?${query.toString()}`,
			);
			// 본문을 소비해 커넥션을 정리한다 (payload 자체는 서버 캐시에 남는다).
			// oxlint-disable-next-line no-await-in-loop
			await res.arrayBuffer();
			if (res.ok) warmed++;
		} catch {
			// best-effort — 실패해도 뷰어는 정상 동작한다.
		}
	}
	return warmed;
};
