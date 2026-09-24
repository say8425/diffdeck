import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	gitBytes,
	gitCatFileBatch,
	parseCatFileBatch,
} from "../server/gitOutput.ts";

/**
 * `git cat-file --batch`로 blob 여럿을 한 프로세스에서 읽는다. 잡는 깨짐:
 * 헤더를 줄 단위로 잘라 내용 속 개행·NUL·헤더처럼 생긴 줄에서 어긋나는 파서,
 * 빈 blob이나 `missing` 레코드에서 한 칸 밀리는 파서, 없는 객체를 빈 바이트로
 * 돌려주는 구현(빈 결과를 성공으로 저장하게 만든다).
 *
 * 설치 없이 돌도록 픽스처는 `Bun.spawnSync`로 만든다(`test-bun13` 잡과 같은 조건).
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
