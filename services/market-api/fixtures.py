#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fixture 模式：离线回放平台保存的真实检测结果，用于开发联调与自动化测试。

数据源：runtime/reviews/general/<job>/result.json 与 runtime/reviews/<uuid>/result.json。
fixture 任务经同一映射代码输出，`data.dataSource = "fixture"` 明确标注非本次真机检测。
"""

import json
import os
import time
from pathlib import Path

DEFAULT_ROOT = os.environ.get(
    "AIGC_MARKET_API_FIXTURE_ROOT",
    "/sdb/data_public/lvjiawen/aigc_platform/runtime/reviews",
)


class FixtureStore:
    def __init__(self, root=DEFAULT_ROOT):
        self.root = Path(root)
        self._general = None
        self._documents = None

    def _list(self, pattern, key_file):
        items = []
        for path in sorted(self.root.glob(pattern)):
            try:
                items.append(json.loads((path / key_file).read_text(encoding="utf-8")))
            except Exception:
                continue
        return items

    def general_results(self):
        if self._general is None:
            self._general = []
            for path in sorted((self.root / "general").glob("*/result.json")):
                try:
                    rows = json.loads(path.read_text(encoding="utf-8"))
                    if isinstance(rows, list) and rows and rows[0].get("status") == "completed":
                        self._general.append(rows[0])
                except Exception:
                    continue
        return self._general

    def documents_results(self):
        # 仅保留“有材料且有已渲染页图”的完整样本，保证回放结果可断言。
        if self._documents is None:
            self._documents = [
                d for d in self._list("*", "result.json")
                if d.get("materials") and any((m.get("pages") or []) for m in d["materials"])
            ]
        return self._documents

    def pick(self, scenario, seed):
        """按确定性顺序选择一条已完成的保存结果（测试可复现）。"""
        pool = self.general_results() if scenario == "general" else self.documents_results()
        if not pool:
            return None
        return pool[seed % len(pool)]


class FixtureTasks:
    """内存任务表：taskNo → {scenario, seed, created_at, status}。"""

    def __init__(self, store):
        self.store = store
        self.tasks = {}

    def submit(self, scenario, task_no):
        self.tasks[task_no] = {"scenario": scenario, "seed": len(self.tasks), "createdAt": time.time()}
        return task_no

    def result(self, task_no):
        task = self.tasks.get(task_no)
        if not task:
            return None
        payload = self.store.pick(task["scenario"], task["seed"])
        if payload is None:
            return {"status": "failed", "reason": "fixture_unavailable"}
        return payload
