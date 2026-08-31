import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { $ } from "bun";
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
const showBytes = async (
	repo: string,
	rev: string,
	path: string,
): Promise<Uint8Array<ArrayBuffer>> => {
	const buf = await $`git -C ${repo} show ${`${rev}:${path}`} 2>/dev/null`
		.nothrow()
		.arrayBuffer();
	return new Uint8Array(buf);
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
	status: DiffFileStatus,
	name: string,
	oldName?: string,
	/** new 쪽 리비전. 없으면 워킹트리(디스크의 지금 파일)를 읽는다. */
	head?: string,
): Promise<DiffFile> => {
	const oldBytes =
		status === "added" || status === "untracked"
			? new Uint8Array()
			: await showBytes(repo, base, oldName ?? name);
	const newBytes =
		status === "deleted"
			? new Uint8Array()
			: head
				? await showBytes(repo, head, name)
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

// git의 기본값(core.quotePath=true)에서는 -z 없는 출력이 비-ASCII/특수문자
// 경로를 큰따옴표+8진 이스케이프로 인용해서 낸다. 그 인용 문자열을 그대로
// 경로로 쓰면 git show/readFileSync가 못 찾아 조용히 빈 내용이 된다. -z는
// NUL로 레코드를 구분하고 경로를 인용 없이 그대로 낸다(fingerprint.ts와 동일
// 전략). rename/copy(R/C, 유사도 점수 접미) 레코드만 경로 필드가 2개(old, new).
const parseNameStatusZ = (
	output: string,
): Array<{ status: DiffFileStatus; name: string; oldName?: string }> => {
	const tokens = output.split("\0").filter((t) => t !== "");
	const specs: Array<{
		status: DiffFileStatus;
		name: string;
		oldName?: string;
	}> = [];
	for (let i = 0; i < tokens.length;) {
		const code = tokens[i] ?? "";
		i++;
		if (/^[RC]/.test(code)) {
			// C(copy)는 이 호출이 -C/--find-copies 없이 도는 한(현재 미사용) git이
			// 내지 않아 실제로는 미도달 — 나중에 copy 감지를 켜면 이 분기가 살아난다.
			const oldName = tokens[i];
			const name = tokens[i + 1] ?? "";
			i += 2;
			specs.push({ status: "renamed", name, oldName });
		} else {
			const name = tokens[i] ?? "";
			i++;
			const status: DiffFileStatus = code.startsWith("A")
				? "added"
				: code.startsWith("D")
					? "deleted"
					: "modified";
			specs.push({ status, name });
		}
	}
	return specs;
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
): Promise<DiffFile[]> => {
	const base = await resolveDiffBaseRev(repo, opts);
	const files: DiffFile[] = [];
	if (base) {
		// head가 있으면 리비전 둘을 준다(rev→rev). 없으면 리비전 하나 —
		// 그때만 오른쪽이 워킹트리가 되어 미커밋 변경이 함께 실린다.
		const nameStatus = opts.head
			? await $`git -C ${repo} diff --name-status -z ${base} ${opts.head} 2>/dev/null`
					.nothrow()
					.text()
			: await $`git -C ${repo} diff --name-status -z ${base} 2>/dev/null`
					.nothrow()
					.text();
		// 파일별 git show/워킹트리 읽기는 서로 독립이라 병렬화하되, 대형 diff에서
		// git 서브프로세스가 무제한으로 뜨지 않도록 동시성을 제한한다 (순서 유지).
		const specs = parseNameStatusZ(nameStatus);
		files.push(
			...(await mapWithLimit(specs, BUILD_CONCURRENCY, (spec) =>
				buildFile(repo, base, spec.status, spec.name, spec.oldName, opts.head),
			)),
		);
	}
	// 커밋된 리비전에는 untracked가 없다 — 토글이 켜져 있어도 붙일 것이
	// 없으므로 건너뛴다(디스크를 훑어 봐야 그건 워킹트리의 사실이지 이 뷰의
	// 사실이 아니다).
	if (opts.untracked && !opts.head) {
		const listed =
			await $`git -C ${repo} ls-files --others --exclude-standard -z 2>/dev/null`
				.nothrow()
				.text();
		const paths = listed.split("\0").filter((s) => s !== "");
		files.push(
			...(await mapWithLimit(paths, BUILD_CONCURRENCY, (path) =>
				buildFile(repo, base, "untracked", path),
			)),
		);
	}
	return files;
};
