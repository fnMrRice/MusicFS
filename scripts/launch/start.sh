#!/bin/sh
set -eu

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
cd -- "$(dirname -- "$0")"
[ ! -e ./.incomplete ] || fail 'This package is incomplete. Build a new package first.'
[ -f ./bin/musicfs ] || fail 'bin/musicfs is missing. Extract the entire package first.'
[ -f ./web/index.html ] || fail 'web/index.html is missing. Build a complete package first.'
chmod +x ./bin/musicfs*
if [ ! -e ./configs/server.yaml ]; then
    [ -f ./configs/server.example.yaml ] || fail 'configs/server.example.yaml is missing.'
    cp ./configs/server.example.yaml ./configs/server.yaml
    printf '%s\n' 'Created configs/server.yaml. Edit it to configure music paths and enable plugins.'
fi
[ -f ./configs/server.yaml ] || fail 'configs/server.yaml must be a regular file.'
mkdir -p ./music
if [ -z "${MUSICFS_ADMIN_TOKEN:-}" ]; then
    token_file=./configs/admin-token.txt
    if [ ! -e "$token_file" ]; then
        MUSICFS_ADMIN_TOKEN=$(./bin/musicfs token) || fail 'Failed to generate an administrator token.'
        [ -n "$MUSICFS_ADMIN_TOKEN" ] || fail 'Token generation returned an empty value.'
        token_temp=$(umask 077; mktemp ./configs/.admin-token.XXXXXX) || fail 'Cannot create a token file.'
        trap 'rm -f -- "$token_temp"' 0
        trap 'exit 1' 1 2 3 15
        printf '%s\n' "$MUSICFS_ADMIN_TOKEN" > "$token_temp" || fail 'Cannot save the administrator token.'
        if [ ! -e "$token_file" ]; then
            mv -- "$token_temp" "$token_file" || fail 'Cannot save the administrator token.'
        else
            rm -f -- "$token_temp"
        fi
        trap - 0 1 2 3 15
    fi
    [ -f "$token_file" ] || fail 'configs/admin-token.txt must be a regular file.'
    MUSICFS_ADMIN_TOKEN=$(cat "$token_file") || fail 'Cannot read configs/admin-token.txt.'
    [ -n "$MUSICFS_ADMIN_TOKEN" ] || fail 'configs/admin-token.txt is empty. Supply a valid administrator token.'
fi
export MUSICFS_ADMIN_TOKEN
printf 'Administrator token: %s\n' "$MUSICFS_ADMIN_TOKEN"
printf '%s\n' 'Default Web URL: http://127.0.0.1:8080 (use your configured address if changed).'
printf '%s\n' 'Keep this window open. Press Ctrl+C to stop MusicFS.'
exec ./bin/musicfs serve --config ./configs/server.yaml "$@"
