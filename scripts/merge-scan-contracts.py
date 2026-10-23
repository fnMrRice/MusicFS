"""合并扫描状态与目录统计契约，保留同时进行的其他契约修改和格式。"""

import json
from pathlib import Path
import re
import sys


def merge_members(source, destination, path, keys, anchor):
    source_json = json.loads(source.read_text(encoding="utf-8-sig"))
    text = destination.read_text(encoding="utf-8-sig")
    before = json.loads(text)
    source_members, target_members = source_json, before
    for name in path:
        source_members, target_members = source_members[name], target_members[name]
    additions = {}
    for key in keys:
        if key in target_members:
            if target_members[key] != source_members[key]:
                raise ValueError(f"Existing contract differs: {key}")
        else:
            additions[key] = source_members[key]
    if not additions:
        return
    expression = r'(?m)^([ \t]*)' + re.escape(json.dumps(anchor)) + r'\s*:'
    matches = list(re.finditer(expression, text))
    if len(matches) != 1:
        raise ValueError(f"Contract anchor is ambiguous: {anchor}")
    match = matches[0]
    lines = [match[1] + json.dumps(key) + ": " + json.dumps(value, ensure_ascii=False) + ",\n"
             for key, value in additions.items()]
    updated = text[:match.start()] + "".join(lines) + text[match.start():]
    target_members.update(additions)
    if json.loads(updated) != before:
        raise ValueError("Contract merge changed unrelated content")
    destination.write_text(updated, encoding="utf-8", newline="\n")


source_root, destination_root = map(Path, sys.argv[1:3])
schema = "docs/contracts/http.schema.json"
api = "docs/contracts/openapi.yaml"
merge_members(source_root / schema, destination_root / schema, ["$defs"],
              ["ScanStatus", "RootStatistic", "RootStatistics"], "ScanJob")
merge_members(source_root / api, destination_root / api, ["paths"],
              ["/provider-instances/{id}/scan-status", "/provider-instances/{id}/root-statistics"],
              "/provider-instances/{id}/scan-jobs")
print("Scan contracts merged without changing existing definitions.")
