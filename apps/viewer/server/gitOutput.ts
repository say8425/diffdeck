/**
 * git을 `$`가 아니라 `Bun.spawn`으로 부르고 stdout을 끝까지 읽는다. 출력이
 * 64KB를 넘을 수 있는 서버의 git 호출은 전부 여기를 탄다 — 남은 `$`는
 * `rev-parse`·`merge-base`·`gh pr view`처럼 출력 크기가 리포 규모와 무관한
 * 호출뿐이고, 새 호출도 출력이 클 수 있으면 여기를 탄다.
 *
 * Bun 1.3.x의 `$`는 64KB를 넘는 stdout을 받는 호출에서 자식이 이미 끝났는데도
 * promise가 영영 settle하지 않을 수 있다 — 호출이 겹치면 거의 확정이고 완전
 * 순차여도 결국 걸린다(1.3.12·1.3.14 실측, macOS·Linux 모두; 업스트림은 1.4.0에서
 * 수정). 크기는 필요조건일 뿐이다 — 같은 크기라도 호출에 따라 안 멈추기도 한다
 * (`worktree list` 110KB는 한 번도 안 멈췄다). 예전 `getDiffFiles`의 8-way 파일별 `git show` 버스트가 그 모양이라(지금은 `cat-file --batch` 한 번이다 — 아래 `gitCatFileBatch`) 큰 blob이 섞인
 * diff가 통째로 45초 flight 타임아웃 → 503이 됐고, 같은 작업을 `Bun.spawn`으로는
 * 수천 번 돌려도 걸리지 않았다.
 *
 * 동작은 `$ … 2>/dev/null` + `.nothrow()`와 같다: 종료 코드를 보지 않고 stdout만
 * 읽고(없는 rev:path는 빈 출력), 스폰 자체가 실패하면(cwd 삭제) 둘 다 throw한다.
 * stdout을 먼저 비우고 `exited`를 기다린다 — 지금 Bun은 파이프를 선제
 * 버퍼링해 반대 순서도 교착하지 않지만(1.3.12, 50MB까지 실측) 그 구현 세부에
 * 기대지 않는다.
 * 인자는 셸을 거치지 않고 argv로 그대로 간다(옵션 꼴 참조를 막는 건 여전히
 * 호출자 몫이다 — `verifyBaseRef`). 회귀망: `git-output.test.ts`,
 * `diff-large-blob.test.ts`, `git-large-output.test.ts`(호출처별).
 */
export interface GitRunResult {
	stdout: Uint8Array<ArrayBuffer>;
	exitCode: number;
}

/**
 * `gitBytes`와 같되 종료 코드를 함께 준다. 결과를 저장하는 호출자(blob 캐시)가
 * 실패한 읽기를 굳히지 않으려면 빈 출력이 "빈 파일"인지 "실패"인지 갈라야 한다.
 */
export const gitRun = async (
	args: readonly string[],
): Promise<GitRunResult> => {
	const proc = Bun.spawn(["git", ...args], {
		stdout: "pipe",
		stderr: "ignore",
	});
	const buf = await new Response(proc.stdout).arrayBuffer();
	const exitCode = await proc.exited;
	return { stdout: new Uint8Array(buf), exitCode };
};

export const gitBytes = async (
	args: readonly string[],
): Promise<Uint8Array<ArrayBuffer>> => (await gitRun(args)).stdout;

export const gitText = async (args: readonly string[]): Promise<string> =>
	new TextDecoder().decode(await gitBytes(args));

/**
 * `git cat-file --batch` 출력을 OID → 바이트로 푼다. 레코드는
 * `<oid> <type> <size>\n<내용>\n`이고 없는 객체는 `<oid> missing\n`이다.
 * **내용은 헤더의 크기로 자른다** — 줄 단위로 자르면 내용 속 개행·NUL, 심지어
 * 다음 헤더처럼 생긴 줄에서 어긋난다. blob만 담고, `missing`처럼 크기가 없는
 * 레코드는 건너뛴다(없는 객체를 빈 바이트로 담으면 호출자가 그것을 성공으로
 * 저장하게 된다 — blob 캐시의 "실패는 저장하지 않는다" 계약).
 */
export const parseCatFileBatch = (
	out: Uint8Array,
): Map<string, Uint8Array<ArrayBuffer>> => {
	const blobs = new Map<string, Uint8Array<ArrayBuffer>>();
	const decoder = new TextDecoder();
	let pos = 0;
	while (pos < out.byteLength) {
		const eol = out.indexOf(10, pos);
		if (eol < 0) break;
		const [oid = "", type = "", sizeText] = decoder
			.decode(out.subarray(pos, eol))
			.split(" ");
		pos = eol + 1;
		if (sizeText === undefined) continue;
		const size = Number(sizeText);
		if (!Number.isInteger(size) || pos + size > out.byteLength) break;
		// 복사한다 — 큰 출력 버퍼 하나를 캐시 항목들이 붙잡고 있지 않게.
		if (type === "blob") blobs.set(oid, out.slice(pos, pos + size));
		pos += size + 1;
	}
	return blobs;
};

/**
 * blob 여럿을 `git cat-file --batch` **한 프로세스**로 읽는다. 파일마다
 * `git show`를 띄우면 프로세스 생성이 첫 로드를 지배했다(raycast-extensions
 * 150파일: `git show` 8-way 387ms → 이 배치 37ms, 실측). 없는 객체는 결과에서
 * 빠지고, 호출자가 파일별 `git show`로 떨어져 지금과 같은 방식으로 실패한다.
 *
 * stdout 읽기를 먼저 걸고 stdin을 쓴다 — 지금 Bun은 파이프를 선제 버퍼링해
 * 반대 순서도 교착하지 않지만(1.3.12, OID 20,000개·출력 41MB까지 실측) 그
 * 구현 세부에 기대지 않는다. OID는 argv가 아니라 stdin으로 가므로
 * 옵션으로 해석될 수 없다. `$`가 아니라 `Bun.spawn`이다(위 `gitBytes`와 같은 이유).
 */
export const gitCatFileBatch = async (
	repo: string,
	oids: readonly string[],
): Promise<Map<string, Uint8Array<ArrayBuffer>>> => {
	if (oids.length === 0) return new Map();
	const proc = Bun.spawn(["git", "-C", repo, "cat-file", "--batch"], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "ignore",
	});
	const out = new Response(proc.stdout).arrayBuffer();
	await proc.stdin.write(`${oids.join("\n")}\n`);
	await proc.stdin.end();
	const buf = await out;
	await proc.exited;
	return parseCatFileBatch(new Uint8Array(buf));
};
