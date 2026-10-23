import {
	MANIFEST_PATH,
	SNAPSHOT_DIR,
	type SnapshotManifest,
	snapshotKey,
} from "./snapshot.ts";

export interface Env {
	ASSETS: { fetch(request: Request): Promise<Response> };
}

const notInSnapshot = (): Response =>
	new Response("not in this preview snapshot", { status: 404 });

const loadManifest = async (
	env: Env,
	origin: string,
): Promise<SnapshotManifest> => {
	const res = await env.ASSETS.fetch(new Request(`${origin}${MANIFEST_PATH}`));
	if (!res.ok) throw new Error(`snapshot manifest: ${res.status}`);
	return (await res.json()) as SnapshotManifest;
};

const replay = async (
	request: Request,
	url: URL,
	env: Env,
): Promise<Response> => {
	// 피커로 다른 브랜치를 고르면 녹화하지 않은 diff다. 녹화본을 대신 주면
	// 고른 것과 다른 비교를 보여 준다. 서버의 unknown-head로 답해야 뷰어가
	// 상태 줄에 이유를 쓰고, 새로 열면 워킹트리(녹화본)로 돌아갈 길을 준다.
	const head = url.searchParams.get("head");
	if (head) {
		return new Response(`not in this preview snapshot: ${head}`, {
			status: 400,
			headers: { "x-diff-error": "unknown-head" },
		});
	}
	const key = snapshotKey(url);
	if (!key) return notInSnapshot();
	const manifest = await loadManifest(env, url.origin);
	const entry = manifest.entries[key];
	if (!entry) return notInSnapshot();
	const etag = entry.headers.etag;
	if (etag && request.headers.get("if-none-match") === etag) {
		const headers: Record<string, string> = { etag };
		if (entry.headers["x-diff-base"] !== undefined) {
			headers["x-diff-base"] = entry.headers["x-diff-base"];
		}
		return new Response(null, { status: 304, headers });
	}
	const headers = { ...entry.headers, "cache-control": "no-store" };
	if (entry.file === null) {
		return new Response(null, { status: entry.status, headers });
	}
	const body = await env.ASSETS.fetch(
		new Request(`${url.origin}/${SNAPSHOT_DIR}/${entry.file}`),
	);
	return new Response(body.body, { status: entry.status, headers });
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/api/")) return replay(request, url, env);
		// 맨 주소로 들어오면 녹화한 리포와 base를 실은 뷰어 URL로 보낸다. 뷰어는
		// `repo` 없이 뜨면 어느 리포도 고르지 못한다.
		if (url.pathname === "/" && !url.searchParams.has("repo")) {
			const manifest = await loadManifest(env, url.origin);
			const query = new URLSearchParams({
				repo: manifest.repo,
				token: "preview",
				base: manifest.base,
			});
			return Response.redirect(`${url.origin}/?${query.toString()}`, 302);
		}
		return env.ASSETS.fetch(request);
	},
};
