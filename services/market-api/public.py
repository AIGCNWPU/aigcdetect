# -*- coding: utf-8 -*-
"""对外响应脱敏投影（single chokepoint）。

原则：平台内部的模型身份、权重指纹、引擎版本与判定阈值**不出现在任何对外响应里**。
做法是在 `envelope()` 出口做递归剥离（denylist），并由
`services/market-api/tests/test_public_projection.py` 与
`services/market-api/tests/mcp-leak.test.mjs` 双重断言。

不能只靠“记得别加字段”：新增映射代码若带入内部键，这里会剥掉并记审计日志
（日志只写服务端 stderr，不返回给调用方）。
"""

from __future__ import annotations

import sys

# 内部身份与工作点：任何层级出现都剥离。
INTERNAL_KEYS = frozenset({
    "engine",              # 旧映射块：模型名 + weightsSha256
    "model",               # 单阶段模型名
    "modelId", "model_id",
    "modelVersion", "model_version",
    "engineVersion", "engine_version",
    "batchVersion", "batch_version",
    "weightsSha256", "weights_sha256", "weights",
    "checkpoint", "checkpointSha256",
    "threshold", "thresholds",   # 判定阈值 = 模型工作点，可反推内部配置
    "semanticReviewEngine", "semanticReviewModel",
    # 注意：providerChecks[].provider 是文件内的 AI 生成声明来源（豆包/千问/OpenAI），
    # 属对外的公开证据，不能剥离，因此 "provider" 不在此列表。
    "promptVersion", "prompts",  # 提示词
})

# 需要保留的语义说明键（与上面同名前缀但属于对外承诺，显式放行）。
ALLOW_KEYS = frozenset({"calibration", "semantics", "signal", "dataSource"})

_audit: set[str] = set()


def _audit_drop(path: str) -> None:
    if path not in _audit:
        _audit.add(path)
        sys.stderr.write(f"[public-projection] dropped internal field: {path}\n")


def strip_internal(value, _path: str = ""):
    """递归剥离内部字段；返回新对象，不修改入参。"""
    if isinstance(value, dict):
        cleaned = {}
        for key, item in value.items():
            if key in ALLOW_KEYS:
                cleaned[key] = strip_internal(item, f"{_path}.{key}")
                continue
            if key in INTERNAL_KEYS:
                _audit_drop(f"{_path}.{key}".lstrip("."))
                continue
            cleaned[key] = strip_internal(item, f"{_path}.{key}")
        return cleaned
    if isinstance(value, list):
        return [strip_internal(item, f"{_path}[]") for item in value]
    return value


def project_public(data):
    """出口投影：剥内部字段；空值保持空值。"""
    return strip_internal(data) if data is not None else data


def audited_drops() -> list[str]:
    """测试用：返回已剥离字段路径（仅本进程内累积）。"""
    return sorted(_audit)


def reset_audit() -> None:
    _audit.clear()
