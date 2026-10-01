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
	// 내용에 개행, NUL, 다음 레코드 헤더처럼 생긴 줄을 넣어 줄 단위 파서를 가른다.
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
	`big${i}\n${`${"y".repeat(99)}\n`.repeat(2000)}`; // 64KB 파이프 버퍼를 넘어야 한다
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

// Bun 1.3.x `$` never-settle의 회귀망이다(testing.md). 배치 호출은 실제로 겹치므로(다른 선택의 요청·prewarm·watch 폴)
// 동시에 부르고, WAYS를 줄이면 판별력이 떨어진다.
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
