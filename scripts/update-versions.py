"""按各实现仓库的发布批次更新开发版本。"""

import argparse
from enum import IntEnum
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]
# 切换计算方式前已推送的快照。起始版本及 Android 构建号从对应提交读取。
BASES = {
    "server": "2d5656e5f647ff4c335a2edd2efb8c966f032006",
    "web": "34d0a15b15a70aa06fb46f49b3bd5cda0895e142",
    "client": "d2371443ea10ae07c2dfa456233dcc00b1f59392",
    "android": "c1e2b224a5bd21df19ff19aa21aa3383f764627b",
}
VERSION = r"0\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
RELEASE = re.compile(rf"chore\(release\): publish v({VERSION})")
HEADER = re.compile(r"^([a-zA-Z][a-zA-Z0-9-]*)(?:\([^()\r\n]+\))?(!)?:[ \t]+\S")
BREAKING = re.compile(r"^BREAKING[ -]CHANGES?:[ \t]*\S", re.MULTILINE)


class Bump(IntEnum):
    NONE = 0
    PATCH = 1
    MINOR = 2


def git(repo, *args):
    return subprocess.check_output(["git", "-C", repo, *args]).decode("utf-8")


def history(repo, *args):
    raw = git(repo, "log", "--format=%H%x00%P%x00%B", "-z", *args)
    fields = raw.split("\0")[:-1]
    for index in range(0, len(fields), 3):
        sha, parents, message = fields[index:index + 3]
        subject, _, body = message.partition("\n")
        yield sha, parents, subject, body


def classify(repo, sha, parents, subject, body):
    match = HEADER.match(subject)
    if BREAKING.search(body):
        return Bump.MINOR
    if match:
        kind = match[1].lower()
        if match[2] or kind == "feat":
            return Bump.MINOR
        return Bump.PATCH if kind in {"fix", "perf", "refactor", "revert"} else Bump.NONE
    if subject.startswith('Revert "'):
        return Bump.PATCH
    joined = parents.split()
    if len(joined) > 1:
        first = joined[0]
        if not git(repo, "diff", "--name-only", first, sha).strip():
            return Bump.NONE
        # Git 默认合并标题没有类型，按合入的最高类别计一次。
        result = Bump.NONE
        for side in joined[1:]:
            for entry in history(repo, "--first-parent", f"{first}..{side}"):
                kind = classify(repo, *entry)
                if kind == Bump.MINOR:
                    return kind
                result = max(result, kind)
        return result
    raise ValueError(f"Unclassified commit {sha}: {subject}")


def committed_version(repo, name, revision):
    def read(path):
        return git(repo, "show", f"{revision}:{path}")

    def field(source, pattern):
        matches = re.findall(pattern, source, flags=re.MULTILINE)
        if len(matches) != 1:
            raise ValueError(f"{name} at {revision}: expected one version field matching {pattern!r}")
        return matches[0]

    code = None
    if name == "android":
        gradle = read("src/app/main/build.gradle.kts")
        version = field(gradle, r'^\s*versionName = "([^"]+)"')
        code = int(field(gradle, r"^\s*versionCode = ([0-9]+)\s*$"))
    elif name == "server":
        version = field(read("src/core/version/version.go"), r'^const Server = "([^"]+)"')
    elif name == "client":
        version = read("VERSION").strip()
    elif name == "web":
        version = json.loads(read("package.json"))["version"]
    else:
        raise ValueError(f"Unknown component: {name}")
    if not re.fullmatch(VERSION, version):
        raise ValueError(f"{name} at {revision}: invalid development version {version!r}")
    return version, code


def apply_batch(released, bump):
    if bump == Bump.NONE:
        return released
    version, code = released
    _, minor, patch = map(int, version.split("."))
    version = f"0.{minor + 1}.0" if bump == Bump.MINOR else f"0.{minor}.{patch + 1}"
    return version, (None if code is None else code + 1)


def calculate(repo, base, tip, name):
    if base not in git(repo, "rev-list", "--first-parent", tip).splitlines():
        raise ValueError(f"{repo.name}: first-parent history must include {base}; fetch full history")
    revisions = f"{base}..{tip}"
    if git(repo, "rev-parse", "--is-shallow-repository").strip() == "true":
        shallow = Path(git(repo, "rev-parse", "--path-format=absolute", "--git-path", "shallow").strip())
        if set(shallow.read_text().splitlines()).intersection(git(repo, "rev-list", revisions).splitlines()):
            raise ValueError(f"{repo.name}: history is incomplete; fetch full history")
    released = committed_version(repo, name, base)
    pending = Bump.NONE
    for entry in history(repo, "--reverse", "--first-parent", revisions):
        sha, _, subject, _ = entry
        marker = RELEASE.fullmatch(subject)
        if not marker:
            pending = max(pending, classify(repo, *entry))
            continue
        candidate = apply_batch(released, pending)
        if marker[1] != candidate[0]:
            raise ValueError(f"{name} at {sha}: {subject!r} does not match calculated version {candidate[0]}")
        stale = plan_files(repo, name, *candidate, revision=sha)
        if stale:
            files = ", ".join(path.relative_to(repo).as_posix() for path in stale)
            expected = candidate[0]
            if candidate[1] is not None:
                expected += f" (versionCode {candidate[1]})"
            raise ValueError(f"{name} at {sha}: committed metadata in {files} does not match {expected}")
        released = candidate
        pending = Bump.NONE
    return apply_batch(released, pending)


def replace_field(text, pattern, value):
    updated, count = re.subn(pattern, lambda m: m[1] + str(value), text, flags=re.MULTILINE)
    if count != 1:
        raise ValueError(f"Expected one version field matching {pattern!r}, found {count}")
    return updated


def local_lock_versions(text, names, version):
    blocks = text.split("[[package]]")
    found = set()
    for index, block in enumerate(blocks[1:], 1):
        package = tomllib.loads(block)
        if package["name"] in names and "source" not in package:
            found.add(package["name"])
            blocks[index] = replace_field(block, r'^(version = ")[^"]+', version)
    if found != names:
        raise ValueError(f"Missing workspace packages in Cargo.lock: {names - found}")
    return "[[package]]".join(blocks)


def plan_files(repo, name, version, code, *, revision=None):
    changes = {}

    def read(filename):
        if revision is not None:
            return subprocess.check_output(["git", "-C", repo, "show", f"{revision}:{filename}"])
        return (repo / filename).read_bytes()

    def edit(filename, transform):
        path = repo / filename
        original = read(filename)
        text = original.decode("utf-8").replace("\r\n", "\n")
        result = transform(text)
        if result != text:
            if b"\r\n" in original:
                result = result.replace("\n", "\r\n")
            changes[path] = (original, result.encode("utf-8"))

    if name == "android":
        def gradle(text):
            text = replace_field(text, r'^(\s*versionName = ")[^"]+', version)
            return replace_field(text, r"^(\s*versionCode = )\d+", code)
        edit("src/app/main/build.gradle.kts", gradle)
    elif name == "server":
        edit("src/core/version/version.go", lambda t: replace_field(t, r'^(const Server = ")[^"]+', version))
    elif name == "client":
        workspace = tomllib.loads(read("Cargo.toml").decode("utf-8"))["workspace"]
        names = set()
        for member in workspace["members"]:
            package = tomllib.loads(read(f"{member}/Cargo.toml").decode("utf-8"))["package"]
            if package.get("version") != {"workspace": True}:
                raise ValueError(f"{member}: expected version.workspace = true")
            names.add(package["name"])
        edit("VERSION", lambda _: version + "\n")
        edit("Cargo.toml", lambda t: replace_field(t, r'(^\[workspace\.package\]\n(?:[^\[\n][^\n]*\n)*?version = ")[^"]+', version))
        edit("Cargo.lock", lambda t: local_lock_versions(t, names, version))
    elif name == "web":
        def update_json(text, key, lock=False):
            data = json.loads(text)
            if data[key] == version and (not lock or data["packages"][""]["version"] == version):
                return text
            data[key] = version
            if lock:
                data["packages"][""]["version"] = version
            return json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        edit("package.json", lambda t: update_json(t, "version"))
        edit("package-lock.json", lambda t: update_json(t, "version", lock=True))
        edit("public/version.json", lambda t: update_json(t, "webVersion"))
    return changes


def write_file(path, original, updated):
    if path.read_bytes() != original:
        raise ValueError(f"File changed during version calculation: {path}")
    fd, tmpname = tempfile.mkstemp(dir=path.parent)
    tmp = Path(tmpname)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(updated)
        tmp.chmod(stat.S_IMODE(path.stat().st_mode))
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description="Recalculate development versions by release batch.")
    parser.add_argument("--check", action="store_true", help="Report stale versions without writing files.")
    args = parser.parse_args()
    changes = {}
    tips = {}
    for name, base in BASES.items():
        repo = ROOT / name
        if Path(git(repo, "rev-parse", "--show-toplevel").strip()).resolve() != repo.resolve():
            raise ValueError(f"Initialize the {name} submodule before calculating versions")
        tips[repo] = git(repo, "rev-parse", "HEAD").strip()
        version, code = calculate(repo, base, tips[repo], name)
        suffix = f" (versionCode {code})" if name == "android" else ""
        print(f"{name} {version}{suffix} @ {tips[repo][:12]}")
        changes.update(plan_files(repo, name, version, code))
    if any(git(repo, "rev-parse", "HEAD").strip() != tip for repo, tip in tips.items()):
        raise ValueError("A repository changed during version calculation. Run again.")
    for path, (original, updated) in changes.items():
        print(f"{'Stale' if args.check else 'Updating'}: {path.relative_to(ROOT)}")
        if not args.check:
            write_file(path, original, updated)
    return int(args.check and bool(changes))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        sys.exit(f"Version calculation failed: {error}")
