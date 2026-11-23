"""从各实现仓库的第一父提交历史更新开发版本。"""

import argparse
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
# 各产品第一次在制品或包元数据中声明 0.1.0 的提交。
BASES = {
    "server": "e41d040abeb6cd64b5f4e41aba559e69beacaf31",
    "web": "b843dee8f880eca957e193ed9e83e674764f3da7",
    "client": "ba24c810ec0e19fb7a43c3d85680954c4885b192",
    "android": "438ac916b7b2b3f45d201d02b1e4d924f6b3acf9",
}
# 采用 Conventional Commits 前的标题按实际改动分类；哈希对应已发布历史。
LEGACY = {
    "minor": {
        "13ecc7c848fe22a6398c4598eff8a787d4b56dc4", "0e63b228d3c74f3deef5844c801f914bcfe37e29",
        "be89a3a46cb5f466ccf440ac013c6ab05a1d9861", "0660d542dc82a88b070ad8ab72682cbf28cd434d",
        "804d658a569e019ac5ad2d68599ba22408cecf95", "bcfe04c12db2f1a08765e25d1af214ef4f26e856",
        "10a4d99fb88b78701284b70c7d0bca2c41aa516f", "0799279ea2944a73c7f91f20669fb9b60a430759",
        "95ac4219d57f8ff06928051cdfe8b20ada97471b", "fdacb307179d855b7186d87a666daa65926d3a55",
        "56bf34268a6b9a88693f8aa731d5cf11c1971906", "80ca6ccf79e31f2d1a1bf2caa7dcdc7bb7cdfebc",
        "912e95a2c97d712d098c958d0f767d3e074c992b", "8ff03a53b3b010804ea6f0c5cf3db17bcf4dcd44",
        "6feafa00e7797b75b448d8f69744b4c81fa9e7de", "ab5a6c3a883c1c3ae94d21e5914812b9d434c4b9",
        "3a158bcfc55600beb5b0055ca752e40290865eea", "e010ee78fd6bfa6cb99c213b853b1ea5c05f2d69",
        "c11a0d1ddfe5d14009d62d96d04730770564bbdc", "0b01c8b264b3c9c0094a63f52fca02a7477c6e2c",
        "c41821044752b1ace24ee7f5410481315e19627c", "fdbb93abe2a4f971c13d54f1342291ea7a43ada7",
        "6ac5af52ca87fee2dd205e155ef8e32a9a839323", "5440b61d4cd1b76118c7ddeaf74e34f32b990bba",
    },
    "patch": {
        "2b3ad8b86d6805e56025e8cea12f30a9a4d1b82e", "66ef0dba0f7d31e07acaf79935cd23a017c9abdf",
        "392d82b4a479826a3d32d1fbb1089e9acccfca6d",
    },
    "skip": {
        "1c4024fcd2dfd3b66506d1faa8846b3da72e5242", "21a1f97fea7f0135ec649bdd782cb709da8870c5",
        "54fd7c8b84b3f4b9dda04c6f6b1c67cc7468e116",
    },
}
HEADER = re.compile(r"^([a-zA-Z][a-zA-Z0-9-]*)(?:\([^()\r\n]+\))?(!)?:[ \t]+\S")
BREAKING = re.compile(r"^BREAKING[ -]CHANGES?:[ \t]*\S", re.MULTILINE)


def git(repo, *args):
    return subprocess.check_output(["git", "-C", repo, *args]).decode("utf-8")


def history(repo, *args):
    raw = git(repo, "log", "--format=%H%x00%P%x00%s%x00%b", "-z", *args)
    fields = raw.split("\0")[:-1]
    for index in range(0, len(fields), 4):
        yield fields[index:index + 4]


def classify(repo, sha, parents, subject, body):
    match = HEADER.match(subject)
    if BREAKING.search(body):
        return "minor"
    if match:
        kind = match[1].lower()
        if match[2] or kind == "feat":
            return "minor"
        return "patch" if kind in {"fix", "perf", "refactor", "revert"} else "skip"
    for kind, commits in LEGACY.items():
        if sha in commits:
            return kind
    if subject.startswith('Revert "'):
        return "patch"
    joined = parents.split()
    if len(joined) > 1:
        first = joined[0]
        if not git(repo, "diff", "--name-only", first, sha).strip():
            return "skip"
        # Git 默认合并标题没有类型，按合入的最高类别计一次。
        result = "skip"
        for side in joined[1:]:
            for entry in history(repo, "--first-parent", f"{first}..{side}"):
                kind = classify(repo, *entry)
                if kind == "minor":
                    return kind
                if kind == "patch":
                    result = kind
        return result
    raise ValueError(f"Unclassified commit {sha}: {subject}")


def calculate(repo, base, tip):
    if base not in git(repo, "rev-list", "--first-parent", tip).splitlines():
        raise ValueError(f"{repo.name}: first-parent history must include {base}; fetch full history")
    revisions = f"{base}..{tip}"
    if git(repo, "rev-parse", "--is-shallow-repository").strip() == "true":
        shallow = Path(git(repo, "rev-parse", "--path-format=absolute", "--git-path", "shallow").strip())
        if set(shallow.read_text().splitlines()).intersection(git(repo, "rev-list", revisions).splitlines()):
            raise ValueError(f"{repo.name}: history is incomplete; fetch full history")
    minor, patch, code = 1, 0, 1
    for entry in history(repo, "--reverse", "--first-parent", revisions):
        kind = classify(repo, *entry)
        if kind == "minor":
            minor += 1
            patch = 0
        elif kind == "patch":
            patch += 1
        else:
            continue
        code += 1
    return f"0.{minor}.{patch}", code


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


def plan_files(repo, name, version, code):
    changes = {}

    def edit(filename, transform):
        path = repo / filename
        original = path.read_bytes()
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
        workspace = tomllib.loads((repo / "Cargo.toml").read_text(encoding="utf-8"))["workspace"]
        names = set()
        for member in workspace["members"]:
            package = tomllib.loads((repo / member / "Cargo.toml").read_text(encoding="utf-8"))["package"]
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
    parser = argparse.ArgumentParser(description="Recalculate development versions from Git history.")
    parser.add_argument("--check", action="store_true", help="Report stale versions without writing files.")
    args = parser.parse_args()
    changes = {}
    tips = {}
    for name, base in BASES.items():
        repo = ROOT / name
        if Path(git(repo, "rev-parse", "--show-toplevel").strip()).resolve() != repo.resolve():
            raise ValueError(f"Initialize the {name} submodule before calculating versions")
        tips[repo] = git(repo, "rev-parse", "HEAD").strip()
        version, code = calculate(repo, base, tips[repo])
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
