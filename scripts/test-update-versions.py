"""验证发布批次的版本计算、Android 构建号及锁文件更新边界。"""

from pathlib import Path
import json
import runpy
import subprocess
import tempfile
import unittest

versions = runpy.run_path(str(Path(__file__).with_name("update-versions.py")))


class VersionHistoryTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.repo = Path(temp.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Version Test")
        self.git("config", "user.email", "version@example.invalid")
        self.git("config", "core.autocrlf", "false")
        self.gradle = self.repo / "src/app/main/build.gradle.kts"
        self.gradle.parent.mkdir(parents=True)
        self.base = self.version_commit("chore: publish the existing build", "0.5.3", 9)

    def git(self, *args):
        return subprocess.check_output(["git", "-C", self.repo, "-c", "commit.gpgSign=false", *args]).decode().strip()

    def commit(self, subject):
        (self.repo / "changes").write_text(subject, encoding="utf-8")
        self.git("add", "changes")
        self.git("commit", "-q", "-m", subject)
        return self.git("rev-parse", "HEAD")

    def version_commit(self, subject, version, code):
        self.gradle.write_text(
            f'android {{\n    defaultConfig {{\n        versionCode = {code}\n'
            f'        versionName = "{version}"\n    }}\n}}\n', encoding="utf-8",
        )
        self.git("add", "src/app/main/build.gradle.kts")
        self.git("commit", "-q", "--allow-empty", "-m", subject)
        return self.git("rev-parse", "HEAD")

    def check(self, version, code, base=None):
        self.assertEqual(versions["calculate"](self.repo, base or self.base, "HEAD", "android"), (version, code))

    def test_batch_uses_highest_change_and_adds_one_android_code(self):
        self.check("0.5.3", 9)
        self.commit("docs: update the guide")
        self.check("0.5.3", 9)
        self.commit("fix(ui): restore focus")
        self.commit("perf: reduce startup time")
        self.check("0.5.4", 10)
        self.commit("feat(player): seek")
        self.commit("feat: add lyrics")
        self.commit("fix: restore queue order")
        self.check("0.6.0", 10)

    def test_breaking_changes_share_one_minor_release(self):
        self.commit("refactor!: replace the adapter")
        self.check("0.6.0", 10)
        self.commit("fix: correct output\n\nBREAKING CHANGE: use the new format")
        self.check("0.6.0", 10)

    def test_repeated_writes_and_preparatory_commits_do_not_close_a_batch(self):
        self.commit("feat: add a player")
        calculated = versions["calculate"](self.repo, self.base, "HEAD", "android")
        self.assertEqual(calculated, ("0.6.0", 10))
        changes = versions["plan_files"](self.repo, "android", *calculated)
        self.assertEqual(set(changes), {self.gradle})
        versions["write_file"](self.gradle, *changes[self.gradle])
        self.check("0.6.0", 10)
        self.assertEqual(versions["plan_files"](self.repo, "android", *calculated), {})
        self.version_commit("chore(release): prepare v0.6.0", *calculated)
        self.commit("fix: handle an empty queue")
        self.check("0.6.0", 10)
        self.version_commit("chore(release): publish v0.6.0 candidate", *calculated)
        self.commit("fix: keep the selected track")
        self.check("0.6.0", 10)
        self.git("commit", "--allow-empty", "--cleanup=verbatim", "-qm", "chore(release): publish v0.6.0  ")
        self.commit("fix: restore playback")
        self.check("0.6.0", 10)

    def test_each_published_batch_becomes_the_next_base(self):
        self.commit("fix: restore the session")
        self.commit("fix: restore queue order")
        first = self.version_commit("chore(release): publish v0.5.4", "0.5.4", 10)
        self.check("0.5.4", 10)
        self.check("0.5.4", 10, base=first)
        self.commit("docs: record the release")
        self.check("0.5.4", 10)
        self.commit("fix: reset seek state")
        self.check("0.5.5", 11)
        self.commit("feat: add album browsing")
        self.check("0.6.0", 11)
        self.version_commit("chore(release): publish v0.6.0", "0.6.0", 11)
        self.commit("perf: reduce artwork allocations")
        self.check("0.6.1", 12)
        self.check("0.6.1", 12, base=first)

    def test_marker_must_match_the_committed_version(self):
        self.commit("feat: add a player")
        self.version_commit("chore(release): publish v0.6.0", "0.5.4", 10)
        with self.assertRaises(ValueError):
            versions["calculate"](self.repo, self.base, "HEAD", "android")

    def test_marker_must_match_the_calculated_android_code(self):
        self.commit("fix: load playlists")
        self.version_commit("chore(release): publish v0.5.4", "0.5.4", 11)
        with self.assertRaisesRegex(ValueError, "does not match"):
            versions["calculate"](self.repo, self.base, "HEAD", "android")

    def test_web_marker_reads_every_version_from_the_commit(self):
        old, new = "0.5.3", "0.6.0"
        (self.repo / "public").mkdir()

        def write_web(package, lock, root_package, public):
            files = {
                "package.json": {"version": package},
                "package-lock.json": {"version": lock, "packages": {"": {"version": root_package}}},
                "public/version.json": {"webVersion": public},
            }
            for filename, data in files.items():
                (self.repo / filename).write_text(json.dumps(data) + "\n", encoding="utf-8")

        write_web(old, old, old, old)
        self.git("add", "package.json", "package-lock.json", "public/version.json")
        self.git("commit", "-qm", "chore: record the previous web release")
        base = self.git("rev-parse", "HEAD")
        self.commit("feat(web): add album browsing")
        write_web(new, new, new, new)
        self.git("add", "package.json", "package-lock.json", "public/version.json")
        self.git("commit", "-qm", f"chore(release): publish v{new}")
        self.assertEqual(versions["calculate"](self.repo, base, "HEAD", "web"), (new, None))

        for field, lock, root_package, public in [
            ("package-lock.json version", old, new, new),
            ("package-lock.json root package", new, old, new),
            ("public/version.json webVersion", new, new, old),
        ]:
            with self.subTest(field=field):
                write_web(new, lock, root_package, public)
                self.git("add", "package-lock.json", "public/version.json")
                self.git("commit", "-q", "--amend", "--no-edit")
                write_web(new, new, new, new)
                self.assertEqual(versions["plan_files"](self.repo, "web", new, None), {})
                with self.assertRaises(ValueError):
                    versions["calculate"](self.repo, base, "HEAD", "web")

    def test_rewriting_unpublished_commit_ids_preserves_the_batch(self):
        old = self.commit("fix: restore focus")
        self.check("0.5.4", 10)
        self.git("-c", "user.name=Release Test", "commit", "-q", "--amend", "--no-edit")
        self.assertNotEqual(old, self.git("rev-parse", "HEAD"))
        self.assertEqual(self.git("rev-parse", old + "^{tree}"), self.git("rev-parse", "HEAD^{tree}"))
        self.check("0.5.4", 10)

    def test_default_merge_counts_once(self):
        self.git("switch", "-qc", "feature")
        self.commit("feat: add a view")
        self.commit("fix: align the view")
        self.git("switch", "-q", "main")
        self.git("merge", "--no-ff", "-qm", "Merge branch 'feature'", "feature")
        self.check("0.6.0", 10)

    def test_nested_merge_keeps_its_declared_type(self):
        self.git("switch", "-qc", "feature")
        self.git("switch", "-qc", "fix")
        self.commit("fix: handle tracks")
        self.git("switch", "-q", "feature")
        self.git("merge", "--no-ff", "-qm", "feat!: change track representation", "fix")
        self.git("switch", "-q", "main")
        self.git("merge", "--no-ff", "-qm", "Merge branch 'feature'", "feature")
        self.check("0.6.0", 10)

    def test_shallow_side_branch_is_detected_even_if_base_is_available(self):
        self.git("switch", "-qc", "feature")
        self.commit("feat: offer playback")
        last_fix = self.commit("fix: handle silence")
        self.git("switch", "-q", "main")
        self.git("merge", "--no-ff", "-qm", "Merge branch 'feature'", "feature")
        (self.repo / ".git/shallow").write_text(last_fix + "\n", encoding="ascii")
        with self.assertRaisesRegex(ValueError, "incomplete"):
            versions["calculate"](self.repo, self.base, "HEAD", "android")

    def test_workspace_lock_leaves_registry_packages_unchanged(self):
        local = '[[package]]\nname = "musicfs"\nversion = "0.1.0"\n'
        external = local + 'source = "registry+https://example.invalid"\n'
        self.assertEqual(versions["local_lock_versions"](local + external, {"musicfs"}, "0.2.1"),
                         local.replace("0.1.0", "0.2.1") + external)


if __name__ == "__main__":
    unittest.main()
