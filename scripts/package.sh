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
    printf '%s\n' 'Usage: sh scripts/package.sh [--os windows|linux] [--output NEW_DIRECTORY] [--allow-dirty] [--skip-install] [--skip-web-build]'
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
    command -v zip >/dev/null 2>&1 || fail 'Required command not found: zip'
    extension=zip
    for launcher in start.bat; do
        [ -f "$root/scripts/launch/$launcher" ] || fail "Missing launcher: $launcher"
    done
else
    command -v tar >/dev/null 2>&1 || fail 'Required command not found: tar'
    command -v gzip >/dev/null 2>&1 || fail 'Required command not found: gzip'
    extension=tar.gz
    [ -f "$root/scripts/launch/start.sh" ] || fail 'Missing launcher: start.sh'
fi
[ -f "$root/server/scripts/release.sh" ] || fail 'Initialize the server submodule first.'
[ -f "$root/web/package-lock.json" ] || fail 'Initialize the web submodule first.'
[ -f "$root/docs/packaging-start.md" ] || fail 'Missing startup documentation.'

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
    output="$root/deploy/musicfs-$target-amd64-$(date +%Y%m%d-%H%M%S)"
fi
while [ "$output" != / ] && [ "${output%/}" != "$output" ]; do output=${output%/}; done
[ ! -e "$output" ] && [ ! -L "$output" ] || fail 'Output directory must not exist.'
[ ! -e "$output.$extension" ] && [ ! -L "$output.$extension" ] || fail 'Archive path must not exist.'
[ ! -e "$output.$extension.sha256" ] && [ ! -L "$output.$extension.sha256" ] || fail 'Archive checksum path must not exist.'
mkdir -p -- "$(dirname -- "$output")"
output=$(CDPATH= cd -- "$(dirname -- "$output")" && printf '%s/%s\n' "$(pwd -P)" "$(basename -- "$output")")
archive="$output.$extension"

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
set -- --os "$target" --arch amd64 --output "$output" --web-root "$root/web/dist"
if [ "$allow_dirty" = true ]; then set -- "$@" --allow-dirty; fi
(unset GOOS GOARCH CGO_ENABLED; sh "$root/server/scripts/release.sh" "$@")
printf '%s\n' 'Package assembly has not completed.' > "$output/.incomplete"
if [ "$target" = windows ]; then
    cp "$root/scripts/launch/start.bat" "$output/"
else
    cp "$root/scripts/launch/start.sh" "$output/start.sh"
    chmod +x "$output/start.sh"
fi
cp "$root/docs/packaging-start.md" "$output/START.md"
printf '{\n  "webRevision": "%s",\n  "webDirty": %s,\n  "webRebuilt": %s\n}\n' \
    "$web_revision" "$web_dirty" "$web_rebuilt" > "$output/web-source.json"

# Node is already required for Web builds and provides portable SHA-256 hashing.
node - "$output" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.argv[2];
const lines = [];
function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const relative = prefix + entry.name;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(full, relative + '/');
        else if (relative !== 'SHA256SUMS' && relative !== '.incomplete') {
            if (!entry.isFile()) throw new Error('Unsupported package entry: ' + relative);
            const digest = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
            lines.push(digest + '  ' + relative);
        }
    }
}
visit(root);
fs.writeFileSync(path.join(root, 'SHA256SUMS'), lines.sort().join('\n') + '\n');
NODE
rm -- "$output/.incomplete"
printf '%s\n' 'Creating archive...'
if [ "$target" = windows ]; then
    (cd "$(dirname -- "$output")" && zip -qr "$archive" "$(basename -- "$output")")
else
    tar -czf "$archive" -C "$(dirname -- "$output")" "$(basename -- "$output")"
fi
node - "$archive" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
async function writeArchiveChecksum() {
    const archive = process.argv[2];
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
    const line = hash.digest('hex') + '  ' + path.basename(archive) + '\n';
    fs.writeFileSync(archive + '.sha256', line, { flag: 'wx' });
}
writeArchiveChecksum().catch(error => { console.error(error.message); process.exitCode = 1; });
NODE
printf 'Package directory: %s\nArchive: %s\nArchive checksum: %s.sha256\n' "$output" "$archive" "$archive"
