// 검증·수동 실행용 최소 dev 엔트리. 정식 CLI(데몬·토큰·URL·spawn)는 Plan 5.
// 실행 전 `bun run apps/viewer/build.ts`로 dist를 만들어 둘 것.
import { resolveDiffPort } from "./server/config.ts";
import { startDiffServer } from "./server/server.ts";

const handle = startDiffServer({
	port: resolveDiffPort(),
	viewerDir: `${import.meta.dir}/dist`,
});
console.log(
	`diffdeck viewer: http://127.0.0.1:${handle.server.port}  (token ${handle.token})`,
);
