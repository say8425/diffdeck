import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { $ } from "bun";
import type { BlobCache } from "./blobCache.ts";
import {
	gitBytes,
	gitCatFileBatch,
	gitCatFileSizes,
	gitRun,
	gitText,
} from "./gitOutput.ts";
import { mapWithLimit } from "./mapLimit.ts";

// buildFile 동시 실행 상한 — 배치에 담지 않은 blob은 파일마다 git 프로세스를 띄운다.
const BUILD_CONCURRENCY = 8;

const refExists = async (repo: string, ref: string): Promise<boolean> => {
	const r = await $`git -C ${repo} rev-parse --verify --quiet ${ref}`
		.nothrow()
		.quiet();
	return r.exitCode === 0;
};

/**
 * 사용자가 고른 ref(base·head)를 검증하고 표시명을 만든다. 보안 경계다: `$`도
 * `Bun.spawn`도 git의 옵션 파싱을 막지 않아, `-`로 시작하는 ref가 `git diff`에 닿으면
 * `--output=<path>`로 아무 파일이나 쓸 수 있다. `rev-parse --verify`의 거부에만
 * 기대지 않고 여기서 먼저 끊는다. 커밋이 아닌 리비전(`HEAD:a.txt`)도 통과하지만
 * merge-base가 실패해 빈 diff가 될 뿐이다.
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
	/** old/new 바이트 해시. 클라이언트 파싱 캐시의 키이자 ETag의 재료다. */
	contentVersion: string;
	/** 바이너리 전용 해시. 내용이 JSON에 안 실리므로 변경 감지와 blob URL 캐시버스터에 쓴다. */
	blobVersion?: string;
}

// `/api/blob`(이미지)의 읽기. Uint8Array<ArrayBuffer>로 명시한다 — Response body는
// SharedArrayBuffer 기반 뷰를 받지 않는다.
const showBytes = (
	repo: string,
	rev: string,
	path: string,
): Promise<Uint8Array<ArrayBuffer>> =>
	gitBytes(["-C", repo, "show", `${rev}:${path}`]);

type Prefetched = ReadonlyMap<string, Uint8Array<ArrayBuffer>>;

// OID가 있으면 이름이 아니라 OID로 읽는다 — 이름(`HEAD:<path>`)으로 읽으면 목록과 읽기
// 사이에 ref가 움직일 때 새 내용이 옛 OID 아래 저장돼 세션 내내 남는다. 종료 코드가
// 0일 때만 저장한다 — 잠깐 실패한 빈 읽기가 눌러앉지 않게. OID는 `oidOrNull`이
// 16진수만 통과시켜 옵션 꼴이 될 수 없다.
const readBlob = async (
	repo: string,
	rev: string,
	path: string,
	oid: string | null,
	blobs?: BlobCache,
	/** 이번 빌드의 배치 선읽기. 캐시에는 실제로 쓸 때 넣는다. */
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
	/** new 쪽 리비전. 없으면 워킹트리를 읽는다. */
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
	// 워킹트리 new 쪽은 캐시하지 않는다 — 디스크가 진실이다.
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

// 서브모듈(gitlink)의 OID는 blob이 아니라 커밋이라 캐시 키로 쓰지 않는다(이름으로 읽는다).
const GITLINK_MODE = "160000";

// `git diff --raw -z --no-abbrev`의 레코드: `:<oldmode> <newmode> <oldoid> <newoid>
// <status>\0<path>\0`이고 R/C만 경로가 둘이다. `-z`가 없으면 비ASCII 경로가 인용돼
// 읽기가 조용히 빈다. `--no-abbrev`가 없으면 약어 OID가 캐시 키가 된다(`--full-index`는
// 여기서 효과가 없다). 없는 쪽 OID는 전부 0이라 null로 둔다.
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
			// C는 사용자가 `diff.renames=copies`를 켜 두면 나온다 — rename처럼 두 경로를 읽는다.
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

// 조건은 `buildFile`과 같아야 한다(old는 추가가 아니면, new는 head 모드에서 삭제가
// 아니면). 캐시 확인은 `has`다 — `get`은 hit/miss 통계와 LRU 순서를 흔든다.
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

// 배치는 프로세스 생성 비용만 아끼므로 작은 blob에서만 이득이다. 큰 blob을 담으면 diff의
// 모든 blob이 한 버퍼에 올라 메모리 상한이 사라진다. 나머지(크기를 모르는 것 포함)는
// 파일별 읽기로 간다.
export const PREFETCH_LIMITS = {
	maxBlob: 1024 * 1024,
	maxTotal: 32 * 1024 * 1024,
} as const;

export const pickForBatch = (
	oids: readonly string[],
	sizes: ReadonlyMap<string, number>,
	limits: { maxBlob: number; maxTotal: number } = PREFETCH_LIMITS,
): string[] => {
	const picked: string[] = [];
	let total = 0;
	for (const oid of oids) {
		const size = sizes.get(oid);
		if (size === undefined || size > limits.maxBlob) continue;
		if (total + size > limits.maxTotal) continue;
		total += size;
		picked.push(oid);
	}
	return picked;
};

export const resolveDiffBaseRev = async (
	repo: string,
	opts: { mode?: "working" | "base"; ref?: string; head?: string },
): Promise<string> => {
	// 갈림점은 head 기준이다 — `merge-base(ref, HEAD)`면 남의 브랜치를 보면서 지금
	// 워크트리의 HEAD를 기준 삼게 된다.
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
 * 이미지 diff용 바이트. side=new는 head(없으면 워킹트리), side=old는 base 리비전.
 * repo 밖 경로나 없는 쪽은 null이다.
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
	blobs?: BlobCache,
): Promise<DiffFile[]> => {
	const base = await resolveDiffBaseRev(repo, opts);
	const files: DiffFile[] = [];
	if (base) {
		// 끝의 `--`가 계약이다 — ref 이름이 트래킹된 경로(`docs`·`src`)와 같으면 git이
		// `ambiguous argument`로 실패하는데, gitText는 종료 코드를 보지 않아 에러 없는
		// "변경 없음" 화면이 된다. `$`가 아니라 gitText인 것은 출력이 64KB를 넘을 수 있어서다.
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
		const specs = parseRawZ(raw);
		const wanted = blobsToRead(specs, opts.head, blobs);
		const prefetched = await gitCatFileBatch(
			repo,
			pickForBatch(wanted, await gitCatFileSizes(repo, wanted)),
		);
		files.push(
			...(await mapWithLimit(specs, BUILD_CONCURRENCY, (spec) =>
				buildFile(repo, base, spec, opts.head, blobs, prefetched),
			)),
		);
	}
	// 커밋된 리비전에는 untracked가 없다 — 토글이 켜져 있어도 붙이지 않는다.
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
