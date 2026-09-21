import { expect, test } from "bun:test";
import { parseRawZ } from "../server/diff.ts";

const Z40 = "0".repeat(40);

// git 2.55, `git diff --raw -z --no-abbrev HEAD --` 실측 출력(NUL을 \0로).
const SHA1_RAW = [
	`:000000 100644 ${Z40} da0f8ed91a8f2f0f067b3bdf26265d5ca48cf82c A`,
	"a.txt",
	`:100644 000000 6f1852975b9306ae5d8dfdf0d4cb1f5cb36ac229 ${Z40} D`,
	"d.txt",
	`:100644 100644 63a911f26fe84ea7fd8a863a636cfac908895ec9 ${Z40} M`,
	"m.txt",
	":100644 100644 a38f4b510f1ec5b3e15c7fdc3d5096573687dfb2 a38f4b510f1ec5b3e15c7fdc3d5096573687dfb2 R100",
	"r.txt",
	"r2.txt",
	`:100644 120000 795ea43143ebd1173b2ff6d1f24e7705306545dd ${Z40} T`,
	"t.txt",
	"",
].join("\0");

test("parses added, deleted, modified, renamed and type-changed records", () => {
	expect(parseRawZ(SHA1_RAW)).toEqual([
		{
			status: "added",
			name: "a.txt",
			oldOid: null,
			newOid: "da0f8ed91a8f2f0f067b3bdf26265d5ca48cf82c",
		},
		{
			status: "deleted",
			name: "d.txt",
			oldOid: "6f1852975b9306ae5d8dfdf0d4cb1f5cb36ac229",
			newOid: null,
		},
		{
			status: "modified",
			name: "m.txt",
			oldOid: "63a911f26fe84ea7fd8a863a636cfac908895ec9",
			newOid: null,
		},
		{
			status: "renamed",
			name: "r2.txt",
			oldName: "r.txt",
			oldOid: "a38f4b510f1ec5b3e15c7fdc3d5096573687dfb2",
			newOid: "a38f4b510f1ec5b3e15c7fdc3d5096573687dfb2",
		},
		{
			status: "modified",
			name: "t.txt",
			oldOid: "795ea43143ebd1173b2ff6d1f24e7705306545dd",
			newOid: null,
		},
	]);
});

test("keeps 64-character SHA-256 object ids whole", () => {
	const oid =
		"14f5162e2fe3d240d0d37aaab0f90e4af9a7cfa79639f3bab005b5bfb4174d9f";
	const raw = `:100644 100644 ${oid} ${"0".repeat(64)} M\0f\0`;
	expect(parseRawZ(raw)).toEqual([
		{ status: "modified", name: "f", oldOid: oid, newOid: null },
	]);
});

test("an unmerged record has no object ids and still maps to modified", () => {
	// `getDiffFiles`는 늘 base rev를 넘겨 충돌 중인 파일도 M으로 받지만(실측),
	// U가 오더라도 필드를 밀리지 않고 캐시 키 없이 넘긴다.
	const raw = `:000000 000000 ${Z40} ${Z40} U\0u.txt\0:100644 100644 ${"1".repeat(40)} ${Z40} M\0next.txt\0`;
	expect(parseRawZ(raw)).toEqual([
		{ status: "modified", name: "u.txt", oldOid: null, newOid: null },
		{
			status: "modified",
			name: "next.txt",
			oldOid: "1".repeat(40),
			newOid: null,
		},
	]);
});

test("returns nothing for empty output", () => {
	expect(parseRawZ("")).toEqual([]);
});
