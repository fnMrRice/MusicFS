"""验证开发版本按提交顺序递增及锁文件更新边界。"""

from pathlib import Path
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
        self.base = self.commit("chore: initial version")

    def git(self, *args):
        return subprocess.check_output(["git", "-C", self.repo, "-c", "commit.gpgSign=false", *args]).decode().strip()

    def commit(self, subject):
        (self.repo / "changes").write_text(subject, encoding="utf-8")
        self.git("add", "changes")
        self.git("commit", "-q", "-m", subject)
        return self.git("rev-parse", "HEAD")

    def check(self, version, code):
        self.assertEqual(versions["calculate"](self.repo, self.base, "HEAD"), (version, code))

    def test_reset_and_android_code(self):
        self.check("0.1.0", 1)
        self.commit("fix(ui): restore focus")
        self.check("0.1.1", 2)
        self.commit("feat(player): seek")
        self.check("0.2.0", 3)
        self.commit("perf: reduce startup time")
        self.commit("chore(release): update versions")
        self.check("0.2.1", 4)
        self.commit("refactor!: replace the adapter")
        self.check("0.3.0", 5)
        self.commit("fix: correct output\n\nBREAKING CHANGE: use the new format")
        self.check("0.4.0", 6)

    def test_default_merge_counts_once(self):
        self.git("switch", "-qc", "feature")
        self.commit("feat: add a view")
        self.commit("fix: align the view")
        self.git("switch", "-q", "main")
        self.git("merge", "--no-ff", "-qm", "Merge branch 'feature'", "feature")
        self.check("0.2.0", 2)

    def test_nested_merge_keeps_its_declared_type(self):
        self.git("switch", "-qc", "feature")
        self.git("switch", "-qc", "fix")
        self.commit("fix: handle tracks")
        self.git("switch", "-q", "feature")
        self.git("merge", "--no-ff", "-qm", "feat!: change track representation", "fix")
        self.git("switch", "-q", "main")
        self.git("merge", "--no-ff", "-qm", "Merge branch 'feature'", "feature")
        self.check("0.2.0", 2)

    def test_shallow_side_branch_is_detected_even_if_base_is_available(self):
        self.git("switch", "-qc", "feature")
        self.commit("feat: offer playback")
        last_fix = self.commit("fix: handle silence")
        self.git("switch", "-q", "main")
        self.git("merge", "--no-ff", "-qm", "Merge branch 'feature'", "feature")
        (self.repo / ".git/shallow").write_text(last_fix + "\n", encoding="ascii")
        with self.assertRaisesRegex(ValueError, "incomplete"):
            versions["calculate"](self.repo, self.base, "HEAD")

    def test_workspace_lock_leaves_registry_packages_unchanged(self):
        local = '[[package]]\nname = "musicfs"\nversion = "0.1.0"\n'
        external = local + 'source = "registry+https://example.invalid"\n'
        self.assertEqual(versions["local_lock_versions"](local + external, {"musicfs"}, "0.2.1"),
                         local.replace("0.1.0", "0.2.1") + external)


if __name__ == "__main__":
    unittest.main()
