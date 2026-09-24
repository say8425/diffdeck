import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { $ } from "bun";
import type { BlobCache } from "./blobCache.ts";
import { gitBytes, gitCatFileBatch, gitRun, gitText } from "./gitOutput.ts";
import { mapWithLimit } from "./mapLimit.ts";

// buildFile 병렬 실행 상한 — 파일당 git 서브프로세스가 뜨므로 무제한이면
// 대형 diff + watch 폴링에서 프로세스가 폭증한다.
const BUILD_CONCURRENCY = 8;

export const isGitRepo = async (repo: string): Promise<boolean> => {
	try {
		const out =
			await $`git -C ${repo} rev-parse --is-inside-work-tree 2>/dev/null`.text();
		return out.trim() === "true";
	} catch {
		return false;
	}
};

const refExists = async (repo: string, ref: string): Promise<boolean> => {
	const r = await $`git -C ${repo} rev-parse --verify --quiet ${ref}`
		.nothrow()
		.quiet();
	return r.exitCode === 0;
};

/**
 * 호출자가 고른 base 참조를 검증하고 표시명을 만든다.
 *
 * **보안 경계다.** Bun의 `$`는 셸을 이스케이프하지 git의 옵션 파싱을 막아주지
 * 않는다 — 첫 글자가 `-`인 참조가 `git diff`에 도달하면 `--output=<path>`로
 * 데몬이 쓸 수 있는 아무 경로나 만들거나 비울 수 있다. `refExists`가 쓰는
 * `rev-parse --verify --quiet`는 옵션 꼴 문자열을 거부하지만, 그 방어에만
 * 기대지 않고 여기서 먼저 끊는다.
 *
 * 알려진 한계: `rev-parse --verify`는 커밋이 아닌 리비전(`HEAD:a.txt` 같은
 * blob)도 통과시킨다. 그런 값은 `merge-base`가 실패해 빈 diff가 되는데,
 * 보안 문제는 아니지만 조용한 빈 화면이라 목록 밖 값은 애초에 고를 수 없게
 * 하는 것이 옳다(피커는 /api/refs가 준 목록에서만 고른다).
 */
export const verifyBaseRef = async (
	repo: string,
	ref: string,
): Promise<{ base: string; ref: string } | null> => {
	if (ref === "" || ref.startsWith("-")) return null;
	if (!(await refExists(repo, ref))) return null;
	return {
		base: ref.startsWith("origin/") ? ref.slice("origin/".length) : ref,
		ref,
	};
};

export const prBaseName = async (repo: string): Promise<string | null> => {
	try {
		const out = await $`gh pr view --json baseRefName -q .baseRefName`
			.cwd(repo)
			.nothrow()
			.quiet()
			.text();
		return out.trim() || null;
	} catch {
		return null;
	}
};

export const defaultBranchName = async (
	repo: string,
): Promise<string | null> => {
	const r =
		await $`git -C ${repo} rev-parse --abbrev-ref origin/HEAD 2>/dev/null`
			.nothrow()
			.quiet();
	// When origin/HEAD is unset, git echoes the arg back and exits non-zero.
	if (r.exitCode !== 0) return null;
	const t = r.text().trim();
	if (!t.startsWith("origin/")) return null;
	const name = t.slice("origin/".length);
	return name && name !== "HEAD" ? name : null;
};

/**
 * Resolve the branch to diff against: PR target, else the default branch,
 * else main/master. Returns the base display name and a usable git ref
 * (`origin/<base>` preferred, else local `<base>`), or nulls when unresolved.
 */
export const resolveBaseRef = async (
	repo: string,
): Promise<{ base: string | null; ref: string | null }> => {
	const named = (await prBaseName(repo)) ?? (await defaultBranchName(repo));
	const candidates = named
		? [`origin/${named}`, named]
		: ["origin/main", "origin/master", "main", "master"];
	for (const ref of candidates) {
		// 우선순위 순서대로 첫 매치에서 멈춰야 하므로 의도적으로 순차 실행.
		// oxlint-disable-next-line no-await-in-loop
		if (await refExists(repo, ref)) {
			const base = ref.startsWith("origin/")
				? ref.slice("origin/".length)
				: ref;
			return { base, ref };
		}
	}
	return { base: named, ref: null };
};

export type DiffFileStatus =
	| "added"
	| "deleted"
	| "modified"
	| "renamed"
	| "untracked";

export interface DiffFile {
	name: string;
	oldName?: string;
	status: DiffFileStatus;
	binary: boolean;
	oldContents: string;
	newContents: string;
	/**
	 * old/new 바이트 해시 쌍. 클라이언트 파싱 캐시의 키이자 서버 ETag의 재료 —
	 * 값이 같으면 내용이 같다고 보고 재파싱/재전송을 건너뛴다.
	 */
	contentVersion: string;
	/**
	 * 바이너리 파일 전용 바이트 해시. 내용이 JSON에 실리지 않는 바이너리도
	 * watch 폴링의 직렬화 비교로 변경이 감지되게 하고, blob URL 캐시버스터로
	 * 쓰인다. 텍스트 파일에는 없다.
	 */
	blobVersion?: string;
}

// Uint8Array<ArrayBuffer>로 명시: fetch Response body(BodyInit)는
// SharedArrayBuffer 기반 뷰를 받지 않으므로 넓은 ArrayBufferLike면 안 된다.
//
// `/api/blob`(이미지)의 읽기다. `getDiffFiles`는 blob을 `cat-file --batch` 한 번으로
// 미리 읽고(`gitCatFileBatch`), 배치가 못 읽은 것만 `readBlob`이 파일별로 읽는다.
// 셋 다 `$`가 아니라 `Bun.spawn`이다(근거와 동작 계약은 gitOutput.ts).
const showBytes = (
	repo: string,
	rev: string,
	path: string,
): Promise<Uint8Array<ArrayBuffer>> =>
	gitBytes(["-C", repo, "show", `${rev}:${path}`]);

// blob 하나를 읽는다: 캐시 → 이번 빌드가 `cat-file --batch`로 미리 읽은 것 → 파일별
// `git show <oid>`(`gitRun`) 순이다. 마지막은 배치가 못 읽은 OID에서만 온다.
//
// **OID가 있으면 이름이 아니라 OID로 읽는다 — 이게 캐시 계약의 절반이다.** 키는
// 목록(`git diff --raw`)이 준 OID인데 값을 `git show HEAD:<path>`처럼 이름으로 읽으면,
// 목록과 읽기 사이에 ref가 움직일 때(watch 중의 커밋·체크아웃·리베이스, head로 보는
// 브랜치의 전진) 새 커밋의 내용이 옛 OID 아래 저장되고 세션 내내 남는다 — 캐시 전엔
// 다음 폴에 저절로 회복되던 경합이 영구 오염이 된다(리뷰에서 결정론적으로 재현).
// OID로 읽으면 목록이 본 바로 그 내용을 읽는다. 출력은 `git show <rev>:<path>`와
// 바이트 단위로 같다(textconv·`eol`·필터가 걸린 경로에서도 md5 동일 — 실측). OID는
// `oidOrNull`이 16진수만 통과시키므로 옵션 꼴이 git에 닿을 수 없다.
//
// **종료 코드가 0일 때만 저장한다** — 잠깐 못 읽은 결과(빈 바이트, 예: 부분
// 클론의 지연 페치 실패)를 저장하면 그 빈 내용이 영구히 눌러앉는다(캐시 전엔 그
// 빌드에만 비고 다음 재빌드에서 회복됐다).
type Prefetched = ReadonlyMap<string, Uint8Array<ArrayBuffer>>;

const readBlob = async (
	repo: string,
	rev: string,
	path: string,
	oid: string | null,
	blobs?: BlobCache,
	/** 이번 빌드가 `cat-file --batch`로 미리 읽어 둔 blob. 쓰는 순간 캐시에 넣는다. */
	prefetched?: Prefetched,
): Promise<Uint8Array<ArrayBuffer>> => {
	if (oid && blobs) {
		const hit = blobs.get(oid);
		if (hit !== undefined) return hit;
	}
	const pre = oid ? prefetched?.get(oid) : undefined;
	if (pre !== undefined) {
		if (oid && blobs) blobs.set(oid, pre);
		return pre;
	}
	// 배치가 못 읽은 OID(예: 부분 클론에서 아직 없는 객체)만 여기로 온다 — 그때도
	// 이름이 아니라 OID로 읽는다(위 주석의 경합).
	const { stdout, exitCode } = await gitRun([
		"-C",
		repo,
		"show",
		oid ?? `${rev}:${path}`,
	]);
	if (oid && blobs && exitCode === 0) blobs.set(oid, stdout);
	return stdout;
};

const readWorkingBytes = (
	repo: string,
	path: string,
): Uint8Array<ArrayBuffer> => {
	try {
		return new Uint8Array(readFileSync(join(repo, path)));
	} catch {
		return new Uint8Array();
	}
};

const buildFile = async (
	repo: string,
	base: string,
	spec: FileSpec,
	/** new 쪽 리비전. 없으면 워킹트리(디스크의 지금 파일)를 읽는다. */
	head?: string,
	blobs?: BlobCache,
	prefetched?: Prefetched,
): Promise<DiffFile> => {
	const { status, name, oldName } = spec;
	// old 쪽을 읽을지는 상태가 정한다 — OID는 캐시 키로만 쓴다.
	const oldBytes =
		status === "added" || status === "untracked"
			? new Uint8Array()
			: await readBlob(
					repo,
					base,
					oldName ?? name,
					spec.oldOid,
					blobs,
					prefetched,
				);
	// 워킹트리 new 쪽은 캐시하지 않는다 — 디스크가 진실이고, 전부 새로 읽어도
	// 176파일에 4.3ms다(실측).
	const newBytes =
		status === "deleted"
			? new Uint8Array()
			: head
				? await readBlob(repo, head, name, spec.newOid, blobs, prefetched)
				: readWorkingBytes(repo, name);
	const binary = oldBytes.includes(0) || newBytes.includes(0);
	const decoder = new TextDecoder();
	const contentVersion = `${Bun.hash(oldBytes).toString(36)}.${Bun.hash(newBytes).toString(36)}`;
	return {
		name,
		...(oldName ? { oldName } : {}),
		status,
		binary,
		oldContents: binary ? "" : decoder.decode(oldBytes),
		newContents: binary ? "" : decoder.decode(newBytes),
		contentVersion,
		...(binary ? { blobVersion: contentVersion } : {}),
	};
};

export interface FileSpec {
	status: DiffFileStatus;
	name: string;
	oldName?: string;
	/** 0이 아닌 전체 blob OID. 없으면 null — 캐시를 거치지 않는다. */
	oldOid: string | null;
	newOid: string | null;
}

const oidOrNull = (s: string): string | null =>
	/^[0-9a-f]+$/.test(s) && !/^0+$/.test(s) ? s : null;

// 서브모듈(gitlink)의 OID는 blob이 아니라 서브모듈 쪽 커밋이다 — `git show <커밋>`의
// 출력은 git 설정(로그 형식)에 따라 달라지고 대개 로컬에 그 객체가 없다. 키로 쓰지
// 않고 지금처럼 이름으로 읽는다.
const GITLINK_MODE = "160000";

// `git diff --raw -z --no-abbrev`의 레코드: `:<oldmode> <newmode> <oldoid>
// <newoid> <status>\0<path>\0`. rename/copy(R/C, 유사도 점수 접미)만 경로가
// 둘(`<old>\0<new>\0`)이다.
//
// **`-z`가 계약이다.** git의 기본값(core.quotePath=true)에서는 -z 없는 출력이
// 비-ASCII/특수문자 경로를 큰따옴표+8진 이스케이프로 인용해서 낸다. 그 인용
// 문자열을 그대로 경로로 쓰면 git show/readFileSync가 못 찾아 조용히 빈 내용이
// 된다. -z는 NUL로 레코드를 구분하고 경로를 인용 없이 그대로 낸다
// (fingerprint.ts와 동일 전략).
//
// **`--no-abbrev`도 계약이다.** `--full-index`는 패치의 index 줄에만 작용해 여기선
// 7자 약어가 나온다(실측) — 약어를 blob 캐시 키로 쓰면 큰 리포에서 충돌한다.
// 없는 쪽 OID(추가된 파일의 old, 삭제된 파일의 new, 워킹트리에서 stat이 바뀐
// 파일의 new)는 전부 0이라 null로 둔다. 상태 매핑은 예전 `--name-status` 파서와
// 같다.
export const parseRawZ = (output: string): FileSpec[] => {
	const tokens = output.split("\0");
	const specs: FileSpec[] = [];
	for (let i = 0; i < tokens.length;) {
		const meta = tokens[i] ?? "";
		i++;
		if (!meta.startsWith(":")) continue;
		const [oldMode, newMode, oldRaw = "", newRaw = "", code = ""] = meta
			.slice(1)
			.split(" ");
		const oldOid = oldMode === GITLINK_MODE ? null : oidOrNull(oldRaw);
		const newOid = newMode === GITLINK_MODE ? null : oidOrNull(newRaw);
		if (/^[RC]/.test(code)) {
			// C(copy)는 기본 설정에선 안 나오지만 사용자가 `diff.renames=copies`를
			// 켜 두면 -C 없이도 나온다 — rename처럼 두 경로를 읽는다.
			const oldName = tokens[i] ?? "";
			const name = tokens[i + 1] ?? "";
			i += 2;
			specs.push({ status: "renamed", name, oldName, oldOid, newOid });
		} else {
			const name = tokens[i] ?? "";
			i++;
			const status: DiffFileStatus = code.startsWith("A")
				? "added"
				: code.startsWith("D")
					? "deleted"
					: "modified";
			specs.push({ status, name, oldOid, newOid });
		}
	}
	return specs;
};

// `buildFile`이 git에서 읽을 blob 중 캐시에 없는 것 — 그 조건은 `buildFile`과
// 같아야 한다: old 쪽은 추가된 파일이 아니면, new 쪽은 head 모드에서 삭제된 파일이
// 아니면 읽는다(워킹트리 new 쪽은 디스크에서 읽으므로 빠진다). 캐시 확인은
// `has`로 한다 — `get`으로 보면 hit/miss 통계와 LRU 순서가 흔들린다.
const blobsToRead = (
	specs: readonly FileSpec[],
	head: string | undefined,
	blobs?: BlobCache,
): string[] => {
	const wanted = new Set<string>();
	const want = (oid: string | null): void => {
		if (oid && !blobs?.has(oid)) wanted.add(oid);
	};
	for (const spec of specs) {
		if (spec.status !== "added") want(spec.oldOid);
		if (head && spec.status !== "deleted") want(spec.newOid);
	}
	return [...wanted];
};

export const resolveDiffBaseRev = async (
	repo: string,
	opts: { mode?: "working" | "base"; ref?: string; head?: string },
): Promise<string> => {
	// 갈림점은 **head 기준**으로 잡는다. `merge-base(ref, HEAD)`로 두면 브랜치를
	// head로 볼 때 지금 워크트리의 HEAD와 갈림점을 재게 되는데, 그 둘은 아무
	// 관계도 없다 — 남의 브랜치를 보면서 내 위치를 기준 삼는 셈이다.
	const headRev = opts.head ?? "HEAD";
	if (opts.mode !== "base" || !opts.ref)
		return headRev === "HEAD" ? "HEAD" : headRev;
	return (
		await $`git -C ${repo} merge-base ${opts.ref} ${headRev} 2>/dev/null`
			.nothrow()
			.text()
	).trim();
};

/**
 * 이미지 diff용 원본 바이트 조회. side=new는 워킹트리, side=old는 base
 * 리비전(HEAD 또는 merge-base)의 파일 내용. repo 밖을 가리키는 경로나
 * 존재하지 않는 쪽은 null.
 */
export const getFileBytes = async (
	repo: string,
	path: string,
	side: "old" | "new",
	opts: { mode?: "working" | "base"; ref?: string; head?: string } = {},
): Promise<Uint8Array<ArrayBuffer> | null> => {
	const root = resolve(repo);
	const target = resolve(root, path);
	// 빈 경로 차단: side=old에서 `git show <rev>:`가 트리 목록을 돌려주는 것 방지.
	if (
		!path ||
		isAbsolute(path) ||
		(target !== root && !target.startsWith(`${root}/`))
	) {
		return null;
	}
	if (side === "new") {
		// 텍스트 diff와 같은 축을 봐야 한다 — 예전에 라우트마다 기준이 갈려
		// 이미지 카드가 텍스트와 다른 비교를 보여준 적이 있다.
		const bytes = opts.head
			? await showBytes(repo, opts.head, path)
			: readWorkingBytes(repo, path);
		return bytes.length > 0 ? bytes : null;
	}
	const base = await resolveDiffBaseRev(repo, opts);
	if (!base) return null;
	const bytes = await showBytes(repo, base, path);
	return bytes.length > 0 ? bytes : null;
};

export const getDiffFiles = async (
	repo: string,
	opts: {
		untracked?: boolean;
		mode?: "working" | "base";
		ref?: string;
		/** new 쪽 리비전. 없으면 워킹트리를 본다. */
		head?: string;
	} = {},
	/** 변경 폴에서 바뀌지 않은 blob의 `git show`를 건너뛴다. 없으면 지금과 같다. */
	blobs?: BlobCache,
): Promise<DiffFile[]> => {
	const base = await resolveDiffBaseRev(repo, opts);
	const files: DiffFile[] = [];
	if (base) {
		// head가 있으면 리비전 둘을 준다(rev→rev). 없으면 리비전 하나 —
		// 그때만 오른쪽이 워킹트리가 되어 미커밋 변경이 함께 실린다.
		//
		// **끝의 `--`가 계약이다.** 참조 이름이 트래킹된 경로와 같으면(흔하다:
		// `docs`·`src`·`test`) git이 rev인지 path인지 못 정해 `ambiguous
		// argument`로 죽는데, `2>/dev/null` + `.nothrow()`가 그 실패를 빈
		// 문자열로 삼켜 **에러 없는 "변경 없음" 화면**이 된다(실측). 피커가
		// `%(refname:short)`를 그대로 넘기므로 사용자는 목록에서 고르기만
		// 해도 이 상태에 들어간다. head 축이 사용자 ref 이름을 `git diff`의
		// 위치 인자로 처음 통과시키면서 열린 노출이다 — 예전엔 언제나
		// `HEAD` 아니면 merge-base OID였다. `merge-base`·`rev-list`·
		// `rev-parse`·`show <rev>:<path>`는 rev만 받아 영향이 없다(실측).
		//
		// `$`가 아니라 `gitText`다 — 큰 diff에서 출력이 64KB를 넘는다.
		const raw = await gitText([
			"-C",
			repo,
			"diff",
			"--raw",
			"-z",
			"--no-abbrev",
			base,
			...(opts.head ? [opts.head] : []),
			"--",
		]);
		// 파일별 git show/워킹트리 읽기는 서로 독립이라 병렬화하되, 대형 diff에서
		// git 서브프로세스가 무제한으로 뜨지 않도록 동시성을 제한한다 (순서 유지).
		const specs = parseRawZ(raw);
		const prefetched = await gitCatFileBatch(
			repo,
			blobsToRead(specs, opts.head, blobs),
		);
		files.push(
			...(await mapWithLimit(specs, BUILD_CONCURRENCY, (spec) =>
				buildFile(repo, base, spec, opts.head, blobs, prefetched),
			)),
		);
	}
	// 커밋된 리비전에는 untracked가 없다 — 토글이 켜져 있어도 붙일 것이
	// 없으므로 건너뛴다(디스크를 훑어 봐야 그건 워킹트리의 사실이지 이 뷰의
	// 사실이 아니다).
	if (opts.untracked && !opts.head) {
		const listed = await gitText([
			"-C",
			repo,
			"ls-files",
			"--others",
			"--exclude-standard",
			"-z",
		]);
		const paths = listed.split("\0").filter((s) => s !== "");
		files.push(
			...(await mapWithLimit(paths, BUILD_CONCURRENCY, (path) =>
				buildFile(repo, base, {
					status: "untracked",
					name: path,
					oldOid: null,
					newOid: null,
				}),
			)),
		);
	}
	return files;
};
