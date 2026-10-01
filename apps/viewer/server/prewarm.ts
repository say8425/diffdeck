/** 기동 직후 자기 /api/diff를 불러 payload 캐시를 데운다. best-effort다. */

export const prewarmDiff = async (opts: {
	port: number;
	repo: string;
	token: string;
	untracked: boolean;
}): Promise<number> => {
	let warmed = 0;
	// 순차로 돈다 — 두 모드를 겹치면 git 프로세스 버스트가 배로 는다.
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
			// 본문을 소비해 커넥션을 정리한다.
			// oxlint-disable-next-line no-await-in-loop
			await res.arrayBuffer();
			if (res.ok) warmed++;
		} catch {
			// best-effort
		}
	}
	return warmed;
};
