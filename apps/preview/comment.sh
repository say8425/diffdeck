#!/usr/bin/env bash
# PR의 프리뷰 댓글을 하나로 유지한다. 숨은 표식으로 찾는다 — `gh pr comment
# --edit-last`는 같은 봇이 남긴 다른 댓글을 덮어쓴다.
# 사용법: comment.sh <PR 번호> <본문>. ONLY_EXISTING=1이면 댓글이 없을 때 새로 달지 않는다.
set -euo pipefail
pr="$1"
body="$2"
marker='<!-- diffdeck-preview -->'
id="$(gh api "repos/$GITHUB_REPOSITORY/issues/$pr/comments" --paginate \
	--jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | contains(\"$marker\"))) | .id" | sed -n 1p)"
full="$marker
$body"
if [ -n "$id" ]; then
	gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -f body="$full" >/dev/null
elif [ "${ONLY_EXISTING:-}" != "1" ]; then
	gh pr comment "$pr" --body "$full"
fi
