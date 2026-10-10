#!/bin/sh
set -eu

cd -- "$(dirname -- "$0")"
[ -f ./bin/musicfs ] || { printf '%s\n' 'Error: bin/musicfs is missing.' >&2; exit 1; }
chmod +x ./bin/musicfs*
if [ ! -e ./configs/server.yaml ]; then
    cp ./configs/server.example.yaml ./configs/server.yaml
fi
mkdir -p ./music
if [ -z "${MUSICFS_ADMIN_TOKEN:-}" ]; then
    MUSICFS_ADMIN_TOKEN=$(./bin/musicfs token)
    [ -n "$MUSICFS_ADMIN_TOKEN" ] || { printf '%s\n' 'Error: token generation returned an empty value.' >&2; exit 1; }
fi
export MUSICFS_ADMIN_TOKEN
printf 'Administrator token: %s\n' "$MUSICFS_ADMIN_TOKEN"
printf '%s\n' 'Default Web URL: http://127.0.0.1:8080 (use your configured address if changed).'
printf '%s\n' 'Keep this window open. Press Ctrl+C to stop MusicFS.'
exec ./bin/musicfs serve --config ./configs/server.yaml "$@"
