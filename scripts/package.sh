#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
target=linux
output=
allow_dirty=false
skip_web=false
skip_install=false

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
usage() {
    printf '%s\n' 'Usage: sh scripts/package.sh [--os windows|linux] [--output DIRECTORY] [--allow-dirty] [--skip-install] [--skip-web-build]'
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --os|--output)
            [ "$#" -ge 2 ] && [ -n "$2" ] || fail "$1 requires a value."
            if [ "$1" = --os ]; then target=$2; else output=$2; fi
            shift 2 ;;
        --allow-dirty) allow_dirty=true; shift ;;
        --skip-install) skip_install=true; shift ;;
        --skip-web-build) skip_web=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; fail "Unknown argument: $1" ;;
    esac
done
case "$target" in windows|linux) ;; *) fail 'Target OS must be windows or linux.' ;; esac

for command_name in go node git; do
    command -v "$command_name" >/dev/null 2>&1 || fail "Required command not found: $command_name"
done
if [ "$skip_web" = false ]; then
    command -v npm >/dev/null 2>&1 || fail 'Required command not found: npm'
fi
if [ "$target" = windows ]; then
    [ -f "$root/scripts/launch/start.bat" ] || fail 'Missing launcher: start.bat'
else
    [ -f "$root/scripts/launch/start.sh" ] || fail 'Missing launcher: start.sh'
fi
[ -f "$root/server/scripts/release.sh" ] || fail 'Initialize the server submodule first.'
[ -f "$root/web/package-lock.json" ] || fail 'Initialize the web submodule first.'
[ -f "$root/docs/packaging-start.md" ] || fail 'Missing startup documentation.'
helper="$root/scripts/package-files.mjs"
[ -f "$helper" ] || fail 'Missing package file helper.'

web_revision=$(git -C "$root/web" rev-parse HEAD)
web_status=$(git -C "$root/web" status --porcelain)
web_dirty=false
web_rebuilt=true
[ -z "$web_status" ] || web_dirty=true
[ "$skip_web" = false ] || web_rebuilt=false
if [ "$allow_dirty" = false ]; then
    for repository in server web; do
        status=$(git -C "$root/$repository" status --porcelain)
        [ -z "$status" ] || fail "$repository working tree is dirty; commit changes or use --allow-dirty for validation."
    done
fi

if [ -z "$output" ]; then
    output="$root/deploy/musicfs-$target-amd64"
fi
while [ "$output" != / ] && [ "${output%/}" != "$output" ]; do output=${output%/}; done
mkdir -p -- "$(dirname -- "$output")"
output=$(CDPATH= cd -- "$(dirname -- "$output")" && printf '%s/%s\n' "$(pwd -P)" "$(basename -- "$output")")
node "$helper" check "$output"
build_id=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')
stage="$(dirname -- "$output")/.$(basename -- "$output").build-$build_id"

if [ "$skip_web" = false ]; then
    printf '%s\n' 'Installing Web dependencies and building Web assets...'
    (
        cd "$root/web"
        if [ "$skip_install" = true ]; then
            [ -d node_modules ] || fail 'Web dependencies are missing; run again without --skip-install.'
        else
            npm ci --no-audit --no-fund
        fi
        npm run build
    )
fi
[ -f "$root/web/dist/index.html" ] || fail 'Web build requires web/dist/index.html.'

printf 'Building MusicFS for %s amd64...\n' "$target"
set -- --os "$target" --arch amd64 --output "$stage" --web-root "$root/web/dist"
if [ "$allow_dirty" = true ]; then set -- "$@" --allow-dirty; fi
(unset GOOS GOARCH CGO_ENABLED; sh "$root/server/scripts/release.sh" "$@")
node "$helper" assemble "$stage" "$root" "$target" "$web_revision" "$web_dirty" "$web_rebuilt"
printf 'Updating build directory: %s\n' "$output"
node "$helper" publish "$stage" "$output"
printf 'Build directory: %s\n' "$output"
