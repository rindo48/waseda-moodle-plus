#!/usr/bin/env bash
# Firefox 用に Mozilla の署名を受けた .xpi を作る（AMO に非公開 = unlisted で出す。ストアには載らない）。
#
# 使い方（Git Bash）:  bash scripts/sign-firefox.sh
#   - 先に manifest.json の version を上げておく（同じ version は 2 回署名できない）
#   - AMO の API キーを ~/.amo-keys に置いておく（このリポジトリには絶対に入れない）:
#       WEB_EXT_API_KEY=user:xxxxx:xxx
#       WEB_EXT_API_SECRET=xxxxxxxx
#   - できた .xpi は dist/ に出る（dist/ は git に入らない）
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
keys="${AMO_KEYS_FILE:-$HOME/.amo-keys}"
[ -f "$keys" ] || { echo "API キーのファイルがありません: $keys" >&2; exit 1; }
set -a; . <(tr -d '\r' < "$keys"); set +a

version="$(node -p "require('$root/manifest.json').version")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# コミット済みの中身だけを使う（_metadata/ など Chrome が作るものを入れないため）
git -C "$root" archive HEAD | tar -x -C "$work"
rm -rf "$work/scripts" "$work/README.md" "$work/.gitignore"

mkdir -p "$root/dist"
npx -y web-ext@8 sign --channel unlisted -s "$work" -a "$work/out" --approval-timeout 900000
cp "$work"/out/*.xpi "$root/dist/waseda-moodle-plus-$version.xpi"
echo "できました: dist/waseda-moodle-plus-$version.xpi"
