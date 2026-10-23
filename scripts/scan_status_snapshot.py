"""将隔离验证的扫描功能合入最新提交内容，不写 Git 索引或工作树。"""

import json
import re
import subprocess
import tempfile
from pathlib import Path


CONTRACT_ADDITIONS = {
    'docs/contracts/http.schema.json': (
        '$defs', ('ScanStatus', 'RootStatistic', 'RootStatistics'), 'ScanJob'),
    'docs/contracts/openapi.yaml': (
        'paths', ('/provider-instances/{id}/scan-status',
                  '/provider-instances/{id}/root-statistics'),
        '/provider-instances/{id}/scan-jobs'),
}


def merge_contract(name, current, feature):
    """仅加入本功能的新定义或端点，保持最新提交的其他契约及排版。"""
    container, keys, anchor = CONTRACT_ADDITIONS[name]
    source = json.loads(feature.decode('utf-8-sig'))[container]
    text = current.decode('utf-8-sig')
    expected = json.loads(text)
    target = expected[container]
    additions = {}
    for key in keys:
        if key not in source:
            raise RuntimeError(f'Feature contract is missing: {key}')
        if key in target:
            if target[key] != source[key]:
                raise RuntimeError(f'Committed contract differs from feature: {key}')
        else:
            additions[key] = source[key]
    if not additions:
        return current
    matches = list(re.finditer(r'(?m)^([ \t]*)' + re.escape(json.dumps(anchor)) + r'\s*:', text))
    if len(matches) != 1:
        raise RuntimeError(f'Contract anchor is ambiguous: {anchor}')
    match = matches[0]
    newline = '\r\n' if '\r\n' in text else '\n'
    insertion = ''.join(match[1] + json.dumps(key) + ': ' +
                        json.dumps(value, ensure_ascii=False) + ',' + newline
                        for key, value in additions.items())
    merged = text[:match.start()] + insertion + text[match.start():]
    target.update(additions)
    if json.loads(merged) != expected:
        raise RuntimeError(f'Contract merge changed unrelated content: {name}')
    prefix = b'\xef\xbb\xbf' if current.startswith(b'\xef\xbb\xbf') else b''
    return prefix + merged.encode('utf-8')


def merge_snapshot(name, base, current, feature):
    """按隔离基线三方合并；任何删除、同名新增或文本冲突均拒绝猜测。"""
    if name in CONTRACT_ADDITIONS:
        if current is None:
            raise RuntimeError(f'Committed contract is missing: {name}')
        return merge_contract(name, current, feature)
    if current == base or current == feature:
        return feature
    if feature == base:
        return current
    if base is None:
        raise RuntimeError(f'Added feature file already exists with different content: {name}')
    if current is None:
        raise RuntimeError(f'Committed file was deleted after isolated baseline: {name}')
    if any(b'\0' in value for value in (base, current, feature)):
        raise RuntimeError(f'Binary file requires manual snapshot merge: {name}')
    scratch = (Path(__file__).resolve().parents[1] / 'deploy').resolve()
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='scan-snapshot-', dir=scratch) as directory:
        Path(directory).resolve().relative_to(scratch)
        paths = [Path(directory) / part for part in ('current', 'base', 'feature')]
        for path, value in zip(paths, (current, base, feature)):
            path.write_bytes(value.replace(b'\r\n', b'\n'))
        result = subprocess.run(
            ['git', 'merge-file', '--stdout', '--diff3', '-L', 'latest-HEAD',
             '-L', 'isolated-base', '-L', 'scan-feature', *map(str, paths)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if result.returncode != 0:
            raise RuntimeError(f'Three-way snapshot merge failed for {name}; review competing changes')
        return result.stdout
