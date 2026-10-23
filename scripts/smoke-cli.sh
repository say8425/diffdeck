#!/usr/bin/env bash
# 빌드된 dist/cli.js를 PATH의 bun으로 띄워 첫 화면 API가 답하는지 본다. CI는 지원 하한
# Bun으로 이것을 돈다(ci-release.md).
set -euo pipefail

cli="$(cd "$(dirname "$0")/.." && pwd)/apps/viewer/dist/cli.js"
[ -f "$cli" ] || { echo "missing $cli (run: cd apps/viewer && bun run build)" >&2; exit 1; }

work="$(mktemp -d)"
pid=""
trap '[ -n "$pid" ] && kill "$pid" 2>/dev/null; rm -rf "$work"' EXIT

# 원격을 두지 않는다. 원격이 있으면 base 해석이 `gh pr view`로 GitHub를 찾는다(e2e.md).
repo="$work/repo"
git init -q "$repo"
printf 'one\n' >"$repo/a.txt"
git -C "$repo" add a.txt
git -C "$repo" -c user.email=smoke@example.com -c user.name=smoke commit -q -m init
printf 'two\n' >"$repo/a.txt"

echo "bun $(bun --version)"
bun "$cli" --version

(cd "$repo" && XDG_CACHE_HOME="$work/cache" exec bun "$cli" --no-open --port 0) \
	>"$work/out" 2>"$work/err" &
pid=$!

url=""
for _ in $(seq 1 100); do
	url="$(grep -oE 'http://127\.0\.0\.1:[0-9]+/\?[^[:space:]]+' "$work/out" | head -n 1 || true)"
	[ -n "$url" ] && break
	kill -0 "$pid" 2>/dev/null || break
	sleep 0.2
done
if [ -z "$url" ]; then
	echo "CLI did not print a viewer URL" >&2
	cat "$work/out" "$work/err" >&2
	exit 1
fi

origin="${url%%/\?*}"
query="${url#*\?}"
curl -fsS -o /dev/null "$origin/api/ping?$query"
curl -fsS -o /dev/null "$origin/api/summary?$query"
curl -fsS "$origin/api/diff?$query" | grep -q '"a.txt"'
curl -fsS -o /dev/null "$url"
curl -fsS -o /dev/null "$origin/main.js"
curl -fsS -o /dev/null "$origin/worker.js"
echo "smoke ok"
