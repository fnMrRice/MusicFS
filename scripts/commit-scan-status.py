"""从独立验证的扫描功能快照提交，保留并行任务的工作树与暂存内容。"""
import importlib.util
import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
from scan_status_snapshot import merge_snapshot

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    'selective_commit', ROOT / 'server/scripts/commit-bulk-merge.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
helper.OUTPUT = ROOT / 'deploy/scan-status-commit'
helper.MESSAGES = {
    'server': 'fix(library): 实时记录扫描进度并提供任务状态与目录统计',
    'web': 'feat(library): 自动检测扫描状态并显示目录曲目数量和大小',
    'parent': 'feat(library): 同步自动扫描状态与目录统计实现',
}
SOURCES = {
    'server': ROOT / 'deploy/scan-status-server',
    'web': ROOT / 'deploy/scan-status-web',
}
WEB_MERGED_FILES = [
    'src/api/scans.ts', 'src/features/directories/LocalMusicSource.tsx',
    'src/i18n/scans.ts', 'src/i18n/directories.ts', 'src/library/local-scan-state.ts',
    'tests/unit/scans-api.test.ts', 'tests/unit/metadata-refresh-state.test.ts',
]
PARENT_FILES = [
    'docs/architecture.md', 'scripts/stop-windows-server.ps1',
    'scripts/merge-scan-contracts.py', 'scripts/verify-scan-progress-deployment.mjs',
    'scripts/verify-scan-status-deployment.mjs', 'scripts/commit-scan-status.py',
    'scripts/scan_status_snapshot.py', 'scripts/test-scan-status-snapshot.py',
]


def source_files(area):
    source = SOURCES[area]
    changed = helper.git(source, 'diff', 'HEAD', '--name-only').decode().splitlines()
    added = helper.git(source, 'ls-files', '--others', '--exclude-standard').decode().splitlines()
    names = sorted(set(changed + added))
    if any('__pycache__' in name or name.startswith(('node_modules/', 'dist/')) for name in names):
        raise RuntimeError('Unexpected generated files in feature snapshot')
    return names


helper.SERVER_FILES = source_files('server')
helper.WEB_FILES = source_files('web')
helper.WEB_FILES = sorted(set(helper.WEB_FILES + WEB_MERGED_FILES))


def committed_file(repo, revision, name):
    """不存在的基线文件与空文件分别表示，避免覆盖其他任务新建的同名文件。"""
    if not helper.git(repo, 'ls-tree', '-z', revision, '--', name).strip():
        return None
    return helper.git(repo, 'show', f'{revision}:{name}')


def snapshot(repo, name, head):
    if repo == ROOT:
        if name != 'docs/architecture.md':
            return (repo / name).read_bytes()
        base = helper.git(repo, 'show', f'{head}:{name}').decode('utf-8')
        current = (repo / name).read_text(encoding='utf-8')
        prefix = '逐目录查找设置支持递归'
        before = helper.one_line(base, prefix)
        after = helper.one_line(current, prefix)
        statistics = helper.one_line(current, '本地音乐页面会自动查询当前账号')
        if statistics in base:
            raise RuntimeError('Scan status architecture is already committed')
        return base.replace(before, after + '\n\n' + statistics, 1).encode('utf-8')
    area = 'server' if repo == helper.SERVER else 'web'
    if area == 'web' and name in WEB_MERGED_FILES:
        # 元数据刷新与自动发现的交叉逻辑已人工合并并通过联合测试，采用审阅后冻结的快照。
        reviewed = ROOT / 'deploy/scan-status-reviewed-web'
        record = json.loads((reviewed / 'manifest.json').read_text(encoding='utf-8'))
        raw = (reviewed / name).read_bytes()
        if head != record['head'] or helper.digest(raw) != record['files'][name]:
            raise RuntimeError(f'Reviewed Web snapshot changed: {name}')
        return raw
    source = SOURCES[area]
    original = helper.git(source, 'rev-parse', 'HEAD').decode().strip()
    base = committed_file(source, original, name)
    current = committed_file(repo, head, name)
    return merge_snapshot(name, base, current, (source / name).read_bytes())


helper.snapshot = snapshot
original_prepare = helper.prepare


def prepare(area):
    original_prepare(area)
    if area != 'parent':
        return
    # 在主仓库的架构与子模块快照中追加本次辅助脚本。
    folder = helper.OUTPUT / area
    manifest_path = folder / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    extras = [name for name in PARENT_FILES if name not in manifest['files']]
    if helper.git(ROOT, 'diff', '--cached', '--name-only', '--', *extras).strip():
        raise RuntimeError('Helper scripts already contain staged changes')
    entries = []
    for name in extras:
        raw = (ROOT / name).read_bytes()
        saved = folder / 'files' / name
        saved.parent.mkdir(parents=True, exist_ok=True)
        saved.write_bytes(raw)
        manifest['files'][name] = {'source': helper.digest(raw), 'snapshot': helper.digest(raw)}
        blob = helper.git(ROOT, 'hash-object', '-w', '--stdin', '--path=' + name, data=raw).decode().strip()
        entries.append(f'100644 {blob}\t{name}\n')
    helper.git(ROOT, 'update-index', '--index-info', data=''.join(entries).encode(), index=folder / 'index')
    helper.git(ROOT, 'diff', '--cached', '--check', index=folder / 'index')
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(helper.git(ROOT, 'diff', '--cached', '--stat', index=folder / 'index').decode('utf-8'))


def preview(area):
    """只输出以最新 HEAD 为底的候选文件，不准备索引、不提交、不覆盖旧候选。"""
    if area == 'parent':
        raise RuntimeError('Snapshot preview supports server and web only')
    repo = helper.REPOSITORIES[area]
    head = helper.git(repo, 'rev-parse', 'HEAD').decode().strip()
    folder = ROOT / 'deploy/scan-status-snapshot-review' / f'{area}-{head[:12]}'
    if folder.exists():
        raise RuntimeError(f'Snapshot preview already exists: {folder}')
    names = helper.SERVER_FILES if area == 'server' else helper.WEB_FILES
    snapshots = {name: snapshot(repo, name, head) for name in names}
    if helper.git(repo, 'rev-parse', 'HEAD').decode().strip() != head:
        raise RuntimeError('HEAD changed during snapshot preview')
    for name, raw in snapshots.items():
        saved = folder / name
        saved.parent.mkdir(parents=True, exist_ok=True)
        saved.write_bytes(raw)
    manifest = {'head': head, 'files': {name: helper.digest(raw) for name, raw in snapshots.items()}}
    (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps({'snapshot': str(folder), **manifest}, ensure_ascii=False))


def commit(area):
    """以引用比较交换推进版本，同时锁住真实索引，避免并行提交丢失。"""
    repo, folder = helper.REPOSITORIES[area], helper.OUTPUT / area
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    head = manifest['head']
    names = list(manifest['files']) + list(manifest['gitlinks'])
    actual_index = Path(helper.git(repo, 'rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
    lock = actual_index.with_name(actual_index.name + '.lock')
    moved = False
    with lock.open('xb') as handle:
        try:
            if helper.git(repo, 'rev-parse', 'HEAD').decode().strip() != head:
                raise RuntimeError('HEAD changed after preparation')
            if helper.git(repo, 'diff', '--cached', '--name-only', '--', *names).strip():
                raise RuntimeError('Selected files were staged after preparation')
            for name, expected in manifest['files'].items():
                if helper.digest((repo / name).read_bytes()) != expected['source']:
                    raise RuntimeError(f'Working file changed after preparation: {name}')
                if helper.digest((folder / 'files' / name).read_bytes()) != expected['snapshot']:
                    raise RuntimeError(f'Snapshot changed: {name}')
            for name, expected in manifest['gitlinks'].items():
                if helper.git(ROOT / name, 'rev-parse', 'HEAD').decode().strip() != expected:
                    raise RuntimeError(f'Child HEAD changed: {name}')
            original = actual_index.read_bytes()
            (folder / 'original-index').write_bytes(original)
            previous = helper.git(repo, 'diff', '--cached', '--binary', '--no-ext-diff', head)
            (folder / 'previous-staged.patch').write_bytes(previous)
            shadow = folder / 'preserved-index'
            shadow.write_bytes(original)
            entries = helper.git(repo, 'ls-files', '--stage', '--', *names, index=folder / 'index')
            helper.git(repo, 'update-index', '--index-info', data=entries, index=shadow)
            tree = helper.git(repo, 'write-tree', index=folder / 'index').decode().strip()
            revision = helper.git(repo, '-c', 'commit.gpgsign=false', 'commit-tree', '--no-gpg-sign',
                                  tree, '-p', head, '-F', '-', data=(helper.MESSAGES[area] + '\n').encode()).decode().strip()
            remaining = helper.git(repo, 'diff', '--cached', '--binary', '--no-ext-diff', revision, index=shadow)
            if remaining != previous:
                raise RuntimeError('Unrelated staged changes would be altered')
            handle.write(shadow.read_bytes())
            handle.flush()
            os.fsync(handle.fileno())
            reference = helper.git(repo, 'symbolic-ref', 'HEAD').decode().strip()
            helper.git(repo, 'update-ref', '-m', helper.MESSAGES[area], reference, revision, head)
            moved = True
        except BaseException:
            handle.close()
            if not moved:
                lock.unlink()
            raise
    os.replace(lock, actual_index)
    (folder / 'committed.json').write_text(json.dumps({'commit': revision}), encoding='utf-8')
    if helper.git(repo, 'diff', '--cached', '--binary', '--no-ext-diff', revision) != previous:
        raise RuntimeError('Staged state changed immediately after commit; inspect saved index')
    print(f'Committed {area}: {revision}; unrelated staged changes preserved')


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('preview', 'prepare', 'commit') or sys.argv[2] not in helper.REPOSITORIES:
        raise SystemExit('Usage: commit-scan-status.py preview|prepare|commit server|web|parent')
    {'preview': preview, 'prepare': prepare, 'commit': commit}[sys.argv[1]](sys.argv[2])
