# 两人对话的按说话人伪造检测（静音掩码方案）

给定一段**只有两个说话人**的对话音频，判断两个人各自的声音是真人还是 AI 伪造，
输出"谁是假的"。不训练任何模型，全部用现成模型推理。

```
dialog.wav
   │
   ├─① diarize.py       pyannote community-1，固定 2 人，取独占结果
   │                    按首次开口把 SPEAKER_xx 重命名成 A / B
   │
   ├─② mask_export.py   对方说话处换成底噪；A.wav / B.wav 与原音频等长同采样率
   │
   ├─③ detect.py        HoliAntiSpoof 分别判 A、B
   │                    p_fake = softmax([real_logit, fake_logit])[1]
   │
   ├─④ decide.py        is_fake = p_fake >= τ（τ 只在 val 上按 EER 选）
   │
   └─⑤ evaluate.py      EER/AUC、文件级混淆矩阵、DER、归属正确率、错误分解
```

## 目录

| 文件 | 作用 |
| --- | --- |
| `config.yaml` | 全部参数（pad / fade / fill / 模型 / 路径 / batch） |
| `verify_data.py` | 核实数据集事实（对应 `docs/data_notes.md` 的七条） |
| `build_gt.py` | 构建 `data/gt/{val,test}.jsonl` |
| `diarize.py` | 说话人分离 → `diarization.json` / `.rttm` |
| `mask_export.py` | 静音掩码 → `A.wav` / `B.wav` / `mask_meta.json` |
| `detect.py` | 单条掩码音轨 → `detection_{A,B}.json` |
| `decide.py` | 按阈值刷新逐文件判定 |
| `evaluate.py` | 已有结果 → 全部指标与 `report.md` |
| `run_pipeline.py` | 单文件全流程（不需要标注） |
| `run_eval.py` | 批量推理 + 评测（val 选阈值 / test 出结果） |
| `docs/data_notes.md` | 数据核实记录（哪些已核实、哪些要本地跑） |
| `spoofdiar/` | 具体实现；脚本只做参数解析 |
| `tests/` | 不依赖模型和数据的单元测试 |

## 环境

```bash
pip install -r requirements.txt
export HF_TOKEN=hf_xxx        # 先从 HF 页面同意 pyannote 模型条款
```

- 说话人分离需要 `pyannote.audio` **4.x**（`exclusive_speaker_diarization` 是 community-1 引入的）；
- HoliAntiSpoof 是 `Qwen/Qwen2.5-Omni-7B` + PEFT 适配器，bf16 推理建议 ≥24 GB 显存；
  权重可以放在本地目录，用 `detect.local.model_root` 指过去（下面应有
  `Qwen2.5-Omni-7B/` 与 `HoliAntiSpoof/`），也可以直接写 HF id 在线拉取；
- 如果机器上已经跑着仓库里的 `backend/server.py`（HoliAntiSpoof HTTP 服务），
  设 `detect.backend: http` 就能直接复用它，本地就不用再加载一份 7B 模型。

## 数据

```bash
# 1) DailyTalkEdit（约 14.7 GB，只用 val / test）
huggingface-cli download wsntxxn/DailyTalkEdit --repo-type dataset --local-dir data/DailyTalkEdit

# 2) DailyTalk 原始数据（补说话人标签；Google Drive 链接见官方仓库 README）
#    解压后目录里应有 metadata.json 和 data/
```

然后改 `config.yaml`：

```yaml
paths:
  dailytalkedit_root: /abs/path/DailyTalkEdit     # 下面应有 daily_talk_edit/
  dailytalk_root: /abs/path/dailytalk             # 下面应有 metadata.json 和 data/
```

> **train 划分一律不用**：HoliAntiSpoof 在 train 上训练过，用了就是数据泄漏。
> `build_gt.py --split` 只接受 val / test。

## 快速开始

```bash
cd spoof_diarization

# 0) 先核数据（会打印 fake_region 原文、拼接时长差、伪造区间对照、采样率、样本数）
python verify_data.py --split test --samples 5

# 1) 构建标注
python build_gt.py --split val
python build_gt.py --split test
#    顺便切 5 条伪造句（含原句）到 debug/gt_check/ 供试听，核对说话人和时间
python build_gt.py --split test --export-check 5

# 2) 冒烟：val 前 10 对（20 个文件）
python run_eval.py --split val --limit 10

# 3) 全量 val，按 EER 选阈值 → outputs/threshold.json
python run_eval.py --split val

# 4) 全量 test，用 val 的阈值出正式结果
python run_eval.py --split test

# 5) 消融：纯静音填充（结果写 outputs/test_fill-zero/）
python run_eval.py --split test --fill zero
```

单文件推理（不需要标注）：

```bash
python run_pipeline.py --input dialog.wav --out outputs/single/dialog --debug-plot
```

也可以分步跑，方便调试单环节：

```bash
python diarize.py     --input dialog.wav --out-dir outputs/single/dialog
python mask_export.py --input dialog.wav --diarization outputs/single/dialog --out-dir outputs/single/dialog
python detect.py      --input outputs/single/dialog/A.wav --speaker A \
                      --segments-json outputs/single/dialog/diarization.json \
                      --out outputs/single/dialog/detection_A.json
python decide.py      --results outputs/test
```

## 输出

单个文件：

```
outputs/{split}/{file_id}/
├── diarization.json / diarization.rttm   分离结果（A/B、原始标签、告警）
├── A.wav / B.wav                         掩码音轨，与原音频等长
├── mask_meta.json                        保留了哪些片段、底噪来源、长度自检
├── detection_A.json / detection_B.json   p_fake、两个 logit、决策步、原始输出
└── result.json                           最终判定
```

整个 split（`evaluate.py` 生成）：

```
outputs/{split}/
├── predictions.jsonl      每个文件的结果 + A/B↔GT 配对 + 真实标签
├── unit_scores.csv        file_id, condition, gt_speaker, pred_speaker, label, p_fake, is_fake
├── metrics.json           全部指标
├── confusion_matrix.csv/.png
└── report.md              指标表格 + 10 条典型错误
```

`result.json` 形如：

```json
{
  "file_id": "7_modified",
  "duration": 23.36,
  "verdict": "B_fake",
  "threshold": 0.42,
  "diarization_warning": null,
  "speakers": [
    {"id": "A", "pyannote_label": "SPEAKER_01", "segments": [[0.4, 3.2]],
     "total_speech": 2.8, "p_fake": 0.03, "is_fake": false, "fake_regions": []},
    {"id": "B", "pyannote_label": "SPEAKER_00", "segments": [[3.4, 7.5]],
     "total_speech": 4.1, "p_fake": 0.91, "is_fake": true, "fake_regions": [[14.0, 16.2]]}
  ],
  "config": {"pad": 0.2, "fade": 0.02, "fill": "noise"}
}
```

## 配置与命令行覆盖

`config.yaml` 是唯一配置源，任何键都能被命令行覆盖：

```bash
python run_eval.py --split test --set mask.pad=0.3 --set detect.backend=http
```

常用参数另有专用开关：`--fill`、`--threshold`、`--device`、`--limit`、`--tag`、`--force`、
`--backend`（pad / fade 在 `mask_export.py` 上有专用参数）。优先级：
命令行 > `config.yaml` > 代码默认值。

阈值优先级：`--threshold` > `decide.threshold` > `decide.threshold_file` > 0.5。
`evaluate.py --split test` 在没有阈值文件时会直接报错，避免"忘了在 val 上选阈值"。

## 实现要点

1. **等长**：所有时长都换算成采样帧，保留区间按帧取整，输出 `frames` 与输入逐条断言相等；
   `mask_meta.json` 的 `length_check` 留证。
2. **底噪**：从两人都不说话的片段（单段 ≥0.1 s）拼素材循环铺满，保留原底噪电平；
   素材不足 0.5 s 时退化成 -60 dBFS 白噪声。底噪起点由 `seed` 决定，可复现。
3. **外扩不越界**：`pad` 外扩遇到对方片段就截断，两侧分别取"对方片段的结束/开始时间"。
4. **边界交叉淡化**：`fade`（默认 20 ms）半余弦过渡，语声与底噪互补，不是淡到 0。
5. **决策步不写死 6**：在生成序列里找 `real_or_fake` 键之后真正的 `real`/`fake` token
   （避免把键名里的 `fake` 当成值），读该步两个 logit，再与 6 交叉检查并告警。
6. **阈值纪律**：τ 只用 val 的说话人单位按 EER 选，写进 `outputs/threshold.json`；
   test 只读不选。val 选完会用新 τ 重算所有 `result.json` 的 `is_fake` / `verdict` 再评测。
7. **配对**：预测的 A/B 与 GT 的 0/1 没有天然对应，2×2 枚举选总重叠最大者；
   之后所有文件级比较都在 GT 编号空间里做，混淆矩阵行列同源。
8. **断点续跑**：`diarization.json`、`detection_*.json`、`result.json` 都有缓存，
   `--force` 才重算。

## 单元测试

```bash
python -m unittest discover -s tests -v
```

不加载任何模型、不需要数据集，只依赖 numpy / soundfile（画图那段需要 matplotlib）。
覆盖：区间运算、掩码外扩不越界与等长、底噪来源与白噪声兜底、模型输出解析、
EER / AUC / DER / 配对、配置覆盖与校验、互相关对齐，以及用假分离器+假检测器把
整条链路跑通（含 `result.json` 结构与等长断言）。

## 验收自检

| 要求 | 怎么查 |
| --- | --- |
| 每个文件都有 `result.json` | `ls outputs/val/*/result.json \| wc -l` 与 `wc -l < data/gt/val.jsonl` 对比；`metrics.json` 的 `diagnostics.n_missing_results` 应为 0 |
| `A.wav`/`B.wav` 与原音频等长 | `mask_meta.json` 的 `length_check.*.ok` 全为 true |
| `debug/` 里有波形对比图 | `run_eval.py` 默认给前 3 个文件画图；`--plot N` 可调 |
| 原始输出已保存、解析失败率 0 | `grep -l '"raw_text": ""' outputs/val/*/detection_*.json` 应为空；失败时 `warnings` 里会写明原因 |
| 阈值来自 val | `outputs/threshold.json` 的 `split` 应为 `val` |
| 消融可跑 | `run_eval.py --split test --fill zero`，结果目录带 `_fill-zero` 后缀 |

## 已知限制

- DailyTalkEdit 只覆盖"两人都真"和"一人一句被改"两种情况，没有"整个人都假""两人都假"；
- 模型的 `fake_region` 输出在本场景下不可靠（端点常落在拼接缝上、方向可能相反，
  详见仓库 `docs/音频区间定位实验.md`），所以 `result.json` 里的 `fake_regions` 只用于分析，
  不参与判定；
- HTTP 后端（`backend/server.py`）对 >30 s 音频会滑窗取最可疑窗口，与本地整段推理不完全等价，
  两边分数不可直接混用；
- 说话人分离本身有 DER 误差，伪造句被分错人时会直接导致判错，
  `report.md` 的"错误分解"把这类错误单列出来。
