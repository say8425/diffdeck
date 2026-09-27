import "./happydom.ts";
import { describe, expect, mock, test } from "bun:test";
import {
	buildLoadErrorModel,
	type LoadFailure,
	loadErrorKey,
	renderLoadError,
} from "../browser/loadError.ts";

const ctx = { repo: "/Users/me", head: "feat/x", base: "develop" };
const http = (
	status: number,
	marker: string | null = null,
	body = "",
): LoadFailure => ({ kind: "http", status, marker, body });

describe("buildLoadErrorModel", () => {
	test("network failure says the server is unreachable and offers a retry", () => {
		const m = buildLoadErrorModel({ kind: "network" }, ctx);
		expect(m.headline).toBe("Can't reach the diffdeck server");
		expect(m.action?.kind).toBe("retry");
		expect(m.status).toBe("Failed to load diff: server unreachable");
	});

	test("busy after retries offers another retry", () => {
		const m = buildLoadErrorModel({ kind: "busy" }, ctx);
		expect(m.headline).toBe("The server is taking too long");
		expect(m.action?.kind).toBe("retry");
	});

	test("not-a-repo names the path and gives no button", () => {
		const m = buildLoadErrorModel(http(400, "not-a-repo"), ctx);
		expect(m.headline).toBe("Not a git repository");
		expect(m.context).toBe("/Users/me");
		expect(m.action).toBeNull();
		expect(m.note).toContain("git repository");
	});

	test.each([
		["no-repo", "No repository in this link"],
		["repo-missing", "That folder doesn't exist"],
		["no-worktree", "This repository has no working tree"],
		["git-unavailable", "Couldn't run git"],
	])("%s has its own headline", (marker, headline) => {
		const m = buildLoadErrorModel(http(400, marker), ctx);
		expect(m.headline).toBe(headline);
		expect(m.status).toMatch(/^Failed to load diff: /);
	});

	test("repo-missing names the path", () => {
		expect(buildLoadErrorModel(http(400, "repo-missing"), ctx).context).toBe(
			"/Users/me",
		);
	});

	test("unknown-head names the ref and leads back to the working tree", () => {
		const m = buildLoadErrorModel(http(400, "unknown-head"), ctx);
		expect(m.headline).toBe("That branch is gone");
		expect(m.context).toBe("No ref named feat/x in this repo");
		expect(m.action).toEqual({
			kind: "view-working-tree",
			label: "View the working tree instead",
		});
	});

	test("unknown-head tolerates a missing head", () => {
		const m = buildLoadErrorModel(http(400, "unknown-head"), {
			...ctx,
			head: null,
		});
		expect(m.context).toBe("No ref named  in this repo");
	});

	test("unknown-base names the base and offers to drop it from the link", () => {
		const m = buildLoadErrorModel(http(400, "unknown-base"), ctx);
		expect(m.headline).toBe("That base is gone");
		expect(m.context).toContain("develop");
		// "default"라고 약속하지 않는다 — 저장된 프리퍼런스가 이길 수 있다.
		expect(m.action).toEqual({
			kind: "drop-base",
			label: "Remove develop from this link",
		});
	});

	test("unsafe-repo says git refuses it rather than that it is not a repo", () => {
		const m = buildLoadErrorModel(http(400, "unsafe-repo"), ctx);
		expect(m.headline).toBe("git refuses to open this repository");
		expect(m.context).toBe("/Users/me");
		expect(m.note).toContain("safe.directory");
	});

	test("403 says the token was rejected", () => {
		const m = buildLoadErrorModel(http(403, null, "forbidden"), ctx);
		expect(m.headline).toBe("This link's access token was rejected");
		expect(m.action).toBeNull();
	});

	test("an unknown marker falls through to the status", () => {
		const m = buildLoadErrorModel(http(400, "something-new", "odd"), ctx);
		expect(m.headline).toBe("Failed to load diff");
		expect(m.context).toBe("The server answered 400: odd");
	});

	test("an unmarked failure carries the server's words, trimmed and capped", () => {
		const m = buildLoadErrorModel(
			http(500, null, `  ${"x".repeat(500)}\n`),
			ctx,
		);
		expect(m.context).toBe(`The server answered 500: ${"x".repeat(200)}`);
		expect(m.action?.kind).toBe("retry");
		expect(m.status).toBe("Failed to load diff: HTTP 500");
	});

	test("an empty body says only the status", () => {
		const m = buildLoadErrorModel(http(502), ctx);
		expect(m.context).toBe("The server answered 502");
	});
});

describe("loadErrorKey", () => {
	test("differs when the context differs, even under the same headline", () => {
		const a = buildLoadErrorModel(http(400, "not-a-repo"), ctx);
		const b = buildLoadErrorModel(http(400, "not-a-repo"), {
			...ctx,
			repo: "/elsewhere",
		});
		expect(loadErrorKey(a)).not.toBe(loadErrorKey(b));
		expect(loadErrorKey(a)).toBe(
			loadErrorKey(buildLoadErrorModel(http(400, "not-a-repo"), ctx)),
		);
	});
});

describe("renderLoadError", () => {
	test("renders the empty-card vocabulary with headline, context, action and note", () => {
		const onAction = mock(() => {});
		const model = buildLoadErrorModel({ kind: "network" }, ctx);
		const el = renderLoadError(document, model, onAction);
		expect(el.id).toBe("empty");
		expect(el.className).toBe("empty-card");
		expect(el.getAttribute("data-load-error")).toBe(loadErrorKey(model));
		expect(el.getAttribute("role")).toBe("alert");
		expect(el.querySelector(".empty-headline")?.textContent).toBe(
			model.headline,
		);
		expect(el.querySelector(".empty-context")?.textContent).toBe(model.context);
		expect(el.querySelector(".empty-quiet")?.textContent).toBe(model.note);
		const button = el.querySelector<HTMLButtonElement>(".empty-action");
		expect(button?.textContent).toBe("Try again");
		button?.click();
		expect(onAction).toHaveBeenCalledWith("retry");
	});

	test("omits the button and note when the model has none", () => {
		const el = renderLoadError(
			document,
			buildLoadErrorModel(http(400, "unknown-head"), ctx),
			() => {},
		);
		expect(el.querySelector(".empty-quiet")).toBeNull();
		const bare = renderLoadError(
			document,
			buildLoadErrorModel(http(403), ctx),
			() => {},
		);
		expect(bare.querySelector(".empty-action")).toBeNull();
	});
});
