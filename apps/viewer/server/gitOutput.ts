/**
 * 출력이 리포 크기를 따라 커질 수 있는 git 호출은 `$`가 아니라 여기(`Bun.spawn`)를
 * 탄다 — Bun 1.3.x의 `$`는 64KB가 넘는 stdout에서 영영 settle하지 않을 수 있다
 * (server.md). 종료 코드는 보지 않는다(실패는 빈 출력, 스폰 실패만 throw).
 * stdout을 다 읽은 뒤 `exited`를 기다린다(파이프 교착). 옵션 꼴 ref는 호출자가
 * 막는다(`verifyBaseRef`).
 */
export interface GitRunResult {
	stdout: Uint8Array<ArrayBuffer>;
	exitCode: number;
}

/** `gitBytes`와 같되 종료 코드도 준다 — 저장하는 호출자(blob 캐시)가 빈 파일과 실패를 가른다. */
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
 * `git cat-file --batch` 출력(`<oid> <type> <size>\n<내용>\n`, 없으면 `<oid> missing\n`)을
 * 푼다. 내용은 헤더의 크기로 자른다 — 줄 단위면 내용 속 개행·NUL에서 어긋난다. `missing`은
 * 담지 않는다 — 빈 바이트로 담으면 호출자가 실패를 성공으로 저장한다.
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

/** `git cat-file --batch-check` 출력 → OID별 크기(blob만). */
export const parseCatFileSizes = (out: string): Map<string, number> => {
	const sizes = new Map<string, number>();
	for (const line of out.split("\n")) {
		const [oid = "", type = "", sizeText] = line.split(" ");
		const size = Number(sizeText);
		if (type === "blob" && Number.isInteger(size)) sizes.set(oid, size);
	}
	return sizes;
};

// stdout 읽기를 먼저 걸고 stdin을 쓴다(파이프 교착 방지). OID는 stdin으로 가므로
// 옵션으로 해석되지 않는다.
const catFile = async (
	repo: string,
	mode: "--batch" | "--batch-check",
	oids: readonly string[],
): Promise<Uint8Array> => {
	const proc = Bun.spawn(["git", "-C", repo, "cat-file", mode], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "ignore",
	});
	const out = new Response(proc.stdout).arrayBuffer();
	await proc.stdin.write(`${oids.join("\n")}\n`);
	await proc.stdin.end();
	const buf = await out;
	await proc.exited;
	return new Uint8Array(buf);
};

export const gitCatFileSizes = async (
	repo: string,
	oids: readonly string[],
): Promise<Map<string, number>> =>
	oids.length === 0
		? new Map()
		: parseCatFileSizes(
				new TextDecoder().decode(await catFile(repo, "--batch-check", oids)),
			);

/**
 * blob 여럿을 `git cat-file --batch` 한 프로세스로 읽는다. 작은 blob에만 쓴다 — 출력
 * 전체가 한 버퍼에 오른다(무엇을 담을지는 `pickForBatch`가 정한다). 없는 객체는 빠진다.
 */
export const gitCatFileBatch = async (
	repo: string,
	oids: readonly string[],
): Promise<Map<string, Uint8Array<ArrayBuffer>>> => {
	if (oids.length === 0) return new Map();
	return parseCatFileBatch(await catFile(repo, "--batch", oids));
};
