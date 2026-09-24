import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	gitBytes,
	gitCatFileBatch,
	gitCatFileSizes,
	parseCatFileBatch,
	parseCatFileSizes,
} from "../server/gitOutput.ts";

/**
 * `git cat-file --batch`로 blob 여럿을 한 프로세스에서 읽는다. 잡는 깨짐:
 * 헤더를 줄 단위로 잘라 내용 속 개행·NUL·헤더처럼 생긴 줄에서 어긋나는 파서,
 * 빈 blob이나 `missing` 레코드에서 한 칸 밀리는 파서, 없는 객체를 빈 바이트로
 * 돌려주는 구현(빈 결과를 성공으로 저장하게 만든다).
 *
 * 설치 없이 돌도록 픽스처는 `Bun.spawnSync`로 만든다 — CI의 `test-bun13` 잡이 이
 * 파일을 Bun 1.3.14로, `bun install` 없이 돌린다.
 *
 * 마지막 테스트는 Bun 1.3.x `$` never-settle의 회귀망이다. 배치가 파일별 버스트를
 * 한 번의 호출로 바꿨으므로 예전 회귀망(`diff-large-blob.test.ts`)은 이 호출이 `$`로
 * 돌아가도 잡지 못한다(1.3.12, 3/3 통과 — 실측). 그러나 배치 호출끼리는 실제로
 * 겹친다(선택이 다른 `/api/diff` 요청·prewarm·watch 폴이 각자 빌드한다). 그래서
 * 16개를 동시에 부른다 — `$`로 되돌리면 8-way×8라운드로는 8번 중 6번만 멈췄고,
 * 16-way×5라운드로는 8번 중 8번 멈췄다(대부분 첫 라운드, 1.3.12 실측).
 */

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]): Uint8Array => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.byteLength;
	}
	return out;
};
const dec = (b: Uint8Array | undefined): string | undefined =>
	b === undefined ? undefined : new TextDecoder().decode(b);

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const M = "d".repeat(40);

test("splits records by the declared size, not by lines", () => {
	// 내용에 개행, NUL, 그리고 다음 레코드 헤더처럼 생긴 줄이 들어 있다.
	const tricky = `line1\n\0${B} blob 3\nfake\n`;
	const out = concat(
		enc(`${A} blob ${enc(tricky).byteLength}\n`),
		enc(tricky),
		enc("\n"),
		enc(`${B} blob 0\n\n`),
		enc(`${M} missing\n`),
		enc(`${C} blob 2\nhi\n`),
	);
	const blobs = parseCatFileBatch(out);
	expect([...blobs.keys()]).toEqual([A, B, C]);
	expect(dec(blobs.get(A))).toBe(tricky);
	expect(blobs.get(B)?.byteLength).toBe(0);
	expect(dec(blobs.get(C))).toBe("hi");
	expect(blobs.has(M)).toBe(false);
});

test("skips objects that are not blobs", () => {
	const out = concat(enc(`${A} tree 3\nabc\n`), enc(`${C} blob 1\nx\n`));
	expect([...parseCatFileBatch(out).keys()]).toEqual([C]);
});

let repo: string;
const BIG = 12;
const bigContent = (i: number): string =>
	`big${i}\n${`${"y".repeat(99)}\n`.repeat(2000)}`; // 200KB — 64KB 파이프 버퍼의 세 배
const git = (args: string[]): string => {
	const r = Bun.spawnSync(["git", "-C", repo, ...args], { stderr: "pipe" });
	if (r.exitCode !== 0)
		throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
	return r.stdout.toString().trim();
};

beforeAll(() => {
	repo = mkdtempSync(join(tmpdir(), "cc-cat-file-"));
	git(["init", "-q", "-b", "main"]);
	git(["config", "user.email", "t@t.co"]);
	git(["config", "user.name", "test"]);
	writeFileSync(join(repo, "text.txt"), "안녕\nworld\n");
	writeFileSync(join(repo, "bin.dat"), new Uint8Array([0, 1, 2, 10, 255, 0]));
	writeFileSync(join(repo, "empty.txt"), "");
	writeFileSync(join(repo, "big.txt"), `${"z".repeat(99)}\n`.repeat(2000));
	for (let i = 0; i < BIG; i++)
		writeFileSync(join(repo, `big${i}.txt`), bigContent(i));
	git(["add", "-A"]);
	git(["commit", "-qm", "init"]);
});

afterAll(() => {
	rmSync(repo, { recursive: true, force: true });
});

test("reads every requested blob byte-for-byte like git show", async () => {
	const paths = ["text.txt", "bin.dat", "empty.txt", "big.txt"];
	const oids = paths.map((p) => git(["rev-parse", `HEAD:${p}`]));
	const blobs = await gitCatFileBatch(repo, oids);
	expect(blobs.size).toBe(4);
	for (const oid of oids) {
		expect(blobs.get(oid)).toEqual(await gitBytes(["-C", repo, "show", oid]));
	}
});

test("leaves a missing object out instead of returning empty bytes", async () => {
	const present = git(["rev-parse", "HEAD:text.txt"]);
	const absent = "0123456789abcdef0123456789abcdef01234567";
	const blobs = await gitCatFileBatch(repo, [absent, present]);
	expect(blobs.has(absent)).toBe(false);
	expect(dec(blobs.get(present))).toBe("안녕\nworld\n");
});

test("an empty request returns an empty map", async () => {
	expect((await gitCatFileBatch(repo, [])).size).toBe(0);
});

const settleWithin = async <T>(work: Promise<T>, ms: number): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`cat-file 배치가 ${ms}ms 안에 settle하지 않았다`)),
			ms,
		);
	});
	try {
		return await Promise.race([work, deadline]);
	} finally {
		clearTimeout(timer);
	}
};

const ROUNDS = 5;
const WAYS = 16;
const SETTLE_MS = 10_000;

test(
	"many concurrent batches with >64KB output all settle and read to the end",
	async () => {
		const oids = Array.from({ length: BIG }, (_, i) =>
			git(["rev-parse", `HEAD:big${i}.txt`]),
		);
		for (let round = 0; round < ROUNDS; round++) {
			const results = await settleWithin(
				Promise.all(
					Array.from({ length: WAYS }, () => gitCatFileBatch(repo, oids)),
				),
				SETTLE_MS,
			);
			for (const blobs of results) {
				for (const [i, oid] of oids.entries()) {
					expect(dec(blobs.get(oid))).toBe(bigContent(i));
				}
			}
		}
	},
	ROUNDS * SETTLE_MS + 5_000,
);

test("drops a record whose declared size runs past the end of the output", () => {
	const out = concat(enc(`${A} blob 2\nok\n`), enc(`${B} blob 99\ncut short`));
	const blobs = parseCatFileBatch(out);
	expect([...blobs.keys()]).toEqual([A]);
	expect(dec(blobs.get(A))).toBe("ok");
});

test("parseCatFileSizes reads sizes and leaves missing objects out", () => {
	const out = `${A} blob 12\n${M} missing\n${C} blob 0\n${B} tree 40\n`;
	expect(parseCatFileSizes(out)).toEqual(
		new Map([
			[A, 12],
			[C, 0],
		]),
	);
});

test("gitCatFileSizes reports real blob sizes", async () => {
	const oid = git(["rev-parse", "HEAD:text.txt"]);
	const absent = "0123456789abcdef0123456789abcdef01234567";
	const sizes = await gitCatFileSizes(repo, [oid, absent]);
	expect(sizes).toEqual(
		new Map([[oid, new TextEncoder().encode("안녕\nworld\n").byteLength]]),
	);
	expect((await gitCatFileSizes(repo, [])).size).toBe(0);
});
