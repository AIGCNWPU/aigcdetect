"""配置加载：默认值 + config.yaml + 命令行覆盖。

约定：
    * `DEFAULTS` 是唯一的事实来源，config.yaml 只是覆盖它；
    * `paths.*` 里的相对路径按配置文件所在目录解析，写成绝对路径；
    * 命令行 `--set a.b=v` 逐个覆盖，值会自动转成 int / float / bool / None。
"""
from __future__ import annotations

import copy
import os
from pathlib import Path
from typing import Any, Iterable

DEFAULTS: dict[str, Any] = {
    "seed": 1234,
    "paths": {
        "dailytalkedit_root": None,
        "dailytalk_root": None,
        "data_gt": "data/gt",
        "outputs": "outputs",
        "debug": "debug",
    },
    "diarization": {
        "model": "pyannote/speaker-diarization-community-1",
        "device": "cuda",
        "num_speakers": 2,
        "exclusive": True,
        "min_speech_seconds": 1.0,
        "hf_token_env": "HF_TOKEN",
    },
    "mask": {
        "pad": 0.2,
        "fade": 0.02,
        "fill": "noise",
        "noise": {
            "min_segment": 0.1,
            "min_total": 0.5,
            "fallback_dbfs": -60.0,
        },
        "keep_masked_audio": True,
    },
    "detect": {
        "backend": "local",
        "local": {
            "model_root": None,
            "base_model": "Qwen/Qwen2.5-Omni-7B",
            "adapter": "wsntxxn/HoliAntiSpoof",
            "device": "cuda:0",
            "dtype": "bfloat16",
            "attn": "sdpa",
            "merge_adapter": True,
            "max_new_tokens": 1024,
            "expected_logit_step": 6,
        },
        "http": {
            "url": "http://127.0.0.1:8000",
            "timeout": 900,
        },
        "prompt": (
            "Determine whether this audio clip is a spoof or not. If it is a spoof, "
            "determine the spoofing method and the spoofing region."
        ),
        "system": (
            "You are Qwen, a virtual human developed by the Qwen Team, Alibaba Group, "
            "capable of perceiving auditory and visual inputs, as well as generating text and speech."
        ),
        "cache": True,
        "min_region_overlap_ratio": 0.1,
        "min_region_overlap_seconds": 0.05,
    },
    "decide": {
        "threshold": None,
        "threshold_file": "outputs/threshold.json",
        "threshold_scope": "all",
    },
    "eval": {
        "collar": 0.25,
        "frame_step": 0.01,
        "top_errors": 10,
    },
}

FILL_CHOICES = ("noise", "zero")
BACKEND_CHOICES = ("local", "http")
SCOPE_CHOICES = ("all", "modified")


# --------------------------------------------------------------------------- #
# 基础读写
# --------------------------------------------------------------------------- #
def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """递归合并，override 优先；不修改入参。"""
    merged = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def split_key(key: str) -> list[str]:
    return [part for part in str(key).split(".") if part]


def get(cfg: dict[str, Any], key: str, default: Any = None) -> Any:
    node: Any = cfg
    for part in split_key(key):
        if not isinstance(node, dict) or part not in node:
            return default
        node = node[part]
    return node


def put(cfg: dict[str, Any], key: str, value: Any) -> None:
    """按点分路径写入，缺失的中间层自动建字典。"""
    parts = split_key(key)
    if not parts:
        raise ValueError("空配置键")
    node = cfg
    for part in parts[:-1]:
        nxt = node.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            node[part] = nxt
        node = nxt
    node[parts[-1]] = value


def coerce(text: str) -> Any:
    """把命令行字符串转成合适的 Python 值。"""
    raw = text.strip()
    low = raw.lower()
    if low in ("null", "none", "~"):
        return None
    if low == "true":
        return True
    if low == "false":
        return False
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        pass
    return text


def parse_overrides(items: Iterable[str] | None) -> dict[str, Any]:
    """把 ["mask.pad=0.3", "detect.backend=http"] 解析成嵌套字典。"""
    out: dict[str, Any] = {}
    for item in items or []:
        if "=" not in item:
            raise ValueError(f"--set 需要 key=value 形式，收到：{item!r}")
        key, _, value = item.partition("=")
        put(out, key.strip(), coerce(value))
    return out


# --------------------------------------------------------------------------- #
# 路径
# --------------------------------------------------------------------------- #
def _resolve_paths(cfg: dict[str, Any], base_dir: Path) -> None:
    paths = cfg.get("paths") or {}
    for key, value in list(paths.items()):
        if isinstance(value, str) and value:
            path = Path(os.path.expanduser(value))
            if not path.is_absolute():
                path = (base_dir / path).resolve()
            paths[key] = str(path)
    cfg["paths"] = paths

    # 阈值文件也按配置文件所在目录解析，避免换个工作目录就找不到
    decide = cfg.get("decide") or {}
    threshold_file = decide.get("threshold_file")
    if isinstance(threshold_file, str) and threshold_file:
        path = Path(os.path.expanduser(threshold_file))
        if not path.is_absolute():
            path = (base_dir / path).resolve()
        decide["threshold_file"] = str(path)
        cfg["decide"] = decide


def load_config(
    path: str | os.PathLike[str] | None = None,
    overrides: Iterable[str] | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """读取配置。

    path 为 None 时只使用 DEFAULTS（路径按当前工作目录解析）。
    overrides 支持 `--set` 字符串列表或其解析结果。
    """
    cfg = copy.deepcopy(DEFAULTS)
    config_path: Path | None = None

    if path:
        config_path = Path(path).expanduser().resolve()
        if not config_path.is_file():
            raise FileNotFoundError(f"配置文件不存在：{config_path}")
        try:
            import yaml
        except ImportError as exc:  # pragma: no cover - 依赖缺失时给出可读提示
            raise RuntimeError("需要 PyYAML：pip install pyyaml") from exc
        with open(config_path, "r", encoding="utf-8") as handle:
            loaded = yaml.safe_load(handle) or {}
        if not isinstance(loaded, dict):
            raise ValueError(f"配置文件顶层必须是字典：{config_path}")
        cfg = _deep_merge(cfg, loaded)

    base_dir = config_path.parent if config_path else Path.cwd()

    if isinstance(overrides, dict):
        cfg = _deep_merge(cfg, overrides)
    elif overrides:
        cfg = _deep_merge(cfg, parse_overrides(overrides))

    _resolve_paths(cfg, base_dir)
    validate(cfg)
    return cfg


def validate(cfg: dict[str, Any]) -> None:
    fill = get(cfg, "mask.fill")
    if fill not in FILL_CHOICES:
        raise ValueError(f"mask.fill 只能是 {FILL_CHOICES}，收到 {fill!r}")
    backend = get(cfg, "detect.backend")
    if backend not in BACKEND_CHOICES:
        raise ValueError(f"detect.backend 只能是 {BACKEND_CHOICES}，收到 {backend!r}")
    scope = get(cfg, "decide.threshold_scope")
    if scope not in SCOPE_CHOICES:
        raise ValueError(f"decide.threshold_scope 只能是 {SCOPE_CHOICES}，收到 {scope!r}")
    if float(get(cfg, "mask.pad", 0.0)) < 0:
        raise ValueError("mask.pad 不能为负")
    if float(get(cfg, "mask.fade", 0.0)) < 0:
        raise ValueError("mask.fade 不能为负")
    if int(get(cfg, "diarization.num_speakers", 2)) != 2:
        raise ValueError("本方案固定两人对话，diarization.num_speakers 必须为 2")


def summary(cfg: dict[str, Any]) -> dict[str, Any]:
    """写进 result.json 的最小配置快照。"""
    return {
        "pad": float(get(cfg, "mask.pad")),
        "fade": float(get(cfg, "mask.fade")),
        "fill": get(cfg, "mask.fill"),
    }
