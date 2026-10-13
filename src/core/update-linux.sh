#!/bin/sh
source=$1; target=$2; previous=$3; parent=$4; expected=$5; result=$6
attempt=0
while kill -0 "$parent" 2>/dev/null; do
  attempt=$((attempt+1)); [ "$attempt" -lt 120 ] || exit 1; sleep .5
done
[ "$(sha256sum "$source" | cut -d ' ' -f 1)" = "$expected" ] || exit 1
mv -- "$target" "$previous" || exit 1
if mv -- "$source" "$target"; then
  printf '{"state":"installed"}\n' > "$result"
  env -u APPIMAGE -u APPDIR "$target" >/dev/null 2>&1 &
  rm -- "$previous"
else
  mv -- "$previous" "$target"
  printf '{"state":"error","message":"Не удалось заменить AppImage"}\n' > "$result"
  env -u APPIMAGE -u APPDIR "$target" >/dev/null 2>&1 &
fi
