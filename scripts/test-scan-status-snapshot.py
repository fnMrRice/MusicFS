"""验证快照合并不会覆盖并行提交，也不会写真实仓库状态。"""

import json
import hashlib
import subprocess
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
from scan_status_snapshot import merge_snapshot


class SnapshotTests(unittest.TestCase):
    def test_independent_text_changes_are_combined(self):
        base = b'header\nalpha\nunchanged\nomega\nfooter\n'
        current = base.replace(b'alpha', b'committed metadata')
        feature = base.replace(b'omega', b'scan status')
        self.assertEqual(merge_snapshot('library.go', base, current, feature),
                         current.replace(b'omega', b'scan status'))

    def test_competing_text_changes_are_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'Three-way'):
            merge_snapshot('library.go', b'base\n', b'metadata\n', b'scan\n')

    def test_new_file_collision_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'already exists'):
            merge_snapshot('new.go', None, b'committed', b'feature')

    def test_upstream_deletion_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'deleted'):
            merge_snapshot('old.go', b'base', None, b'feature')

    def test_unchanged_and_identical_files_are_retained(self):
        self.assertEqual(merge_snapshot('new.go', None, None, b'new'), b'new')
        self.assertEqual(merge_snapshot('same.go', b'base', b'feature', b'feature'), b'feature')
        self.assertEqual(merge_snapshot('same.go', b'base', b'current', b'base'), b'current')

    def test_contract_only_adds_selected_definitions(self):
        name = 'docs/contracts/http.schema.json'
        current = b'{\n  "$defs": {\n    "ScanJob": {"metadataRefresh": true}\n  }\n}\n'
        feature = {'$defs': {'ScanJob': {'old': True}, 'Unrelated': {},
                            'ScanStatus': {'type': 'object'}, 'RootStatistic': {}, 'RootStatistics': {}}}
        result = merge_snapshot(name, b'old baseline', current, json.dumps(feature).encode())
        expected = json.loads(current)
        expected['$defs'].update({key: feature['$defs'][key]
                                 for key in ('ScanStatus', 'RootStatistic', 'RootStatistics')})
        self.assertEqual(json.loads(result), expected)
        self.assertIn(b'    "ScanJob": {"metadataRefresh": true}', result)
        self.assertEqual(merge_snapshot(name, None, result, json.dumps(feature).encode()), result)

    def test_contract_only_adds_selected_paths(self):
        name = 'docs/contracts/openapi.yaml'
        current = b'{\n  "paths": {\n    "/provider-instances/{id}/scan-jobs": {"newField": true}\n  }\n}\n'
        additions = {f'/provider-instances/{{id}}/{part}': {'get': {}}
                     for part in ('scan-status', 'root-statistics')}
        feature = {'paths': {**additions, '/unrelated': {}}}
        result = merge_snapshot(name, None, current, json.dumps(feature).encode())
        expected = json.loads(current)
        expected['paths'].update(additions)
        self.assertEqual(json.loads(result), expected)

    def test_conflicting_contract_definition_is_rejected(self):
        name = 'docs/contracts/http.schema.json'
        feature = {'$defs': {'ScanStatus': {}, 'RootStatistic': {}, 'RootStatistics': {}}}
        current = json.dumps({'$defs': {'ScanStatus': {'different': True}}}).encode()
        with self.assertRaisesRegex(RuntimeError, 'differs'):
            merge_snapshot(name, None, current, json.dumps(feature).encode())


def staged_candidate():
    """只读暂存内容模拟另一任务提交后的 HEAD，输出三份共享文件供审阅。"""
    root = Path(__file__).resolve().parents[1]
    repo, feature = root / 'server', root / 'deploy/scan-status-server'
    def git(folder, *args):
        return subprocess.check_output(['git', *args], cwd=folder)
    index = Path(git(repo, 'rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
    before = index.read_bytes()
    head = git(repo, 'rev-parse', 'HEAD').decode().strip()
    baseline = git(feature, 'rev-parse', 'HEAD').decode().strip()
    output = root / 'deploy/scan-status-snapshot-review/staged-shared-files'
    if output.exists():
        raise RuntimeError(f'Staged snapshot preview already exists: {output}')
    names = ['docs/contracts/http.schema.json', 'docs/contracts/openapi.yaml', 'src/app/api/library.go']
    merged = {}
    for name in names:
        merged[name] = merge_snapshot(name, git(feature, 'show', f'{baseline}:{name}'),
                                      git(repo, 'show', f':{name}'), (feature / name).read_bytes())
    if index.read_bytes() != before or git(repo, 'rev-parse', 'HEAD').decode().strip() != head:
        raise RuntimeError('Repository state changed during read-only validation; retry after concurrent commit')
    for name, raw in merged.items():
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
    report = {'candidate': str(output), 'head': head,
              'indexUnchanged': True, 'indexSHA256': hashlib.sha256(before).hexdigest(), 'files': names}
    (output / 'manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    if sys.argv[1:] == ['--staged-candidate']:
        staged_candidate()
    else:
        unittest.main()
