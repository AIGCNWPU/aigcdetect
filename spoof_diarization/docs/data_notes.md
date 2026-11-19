# 数据核实记录（data_notes）

本文件对应 TASK_SPEC 第 1.3 节的七条必须核实事项。
核实方式分两种，文中逐条标注：

- **[已核实]** 2026-11-04 直接读取官方源（HF 数据集仓库的 `README.md`、`metadata/*.jsonl` 原文、
  `modify_config_pipeline.json`、文件树与字节大小；DailyTalk 官方仓库与 lhotse 的 `daily_talk` recipe；
  HoliAntiSpoof 与 pyannote community-1 的模型卡）；
- **[待本地复核]** 需要下载 14.7 GB 数据、在本机跑脚本才能确定，命令与预期写在各条下面，
  跑完 `verify_data.py` 会打印实测值。

> 说明：本次核实环境没有 GPU、没有下载数据集，且 shell 不可用，所以凡标 [待本地复核] 的条目
> 都只给了可执行命令与判据，没有编造测量值。`python verify_data.py --report docs/data_notes_measured.md`
> 会一次性把这几条测出来。

---

## 0. 目录与文件命名 [已核实]

数据集仓库 `wsntxxn/DailyTalkEdit`（Apache-2.0）的结构：

```
daily_talk_edit/
├── concat_utts/
│   ├── <id>_original.wav          # 原始对话，两人都真
│   └── <id>_modified.wav          # 其中一个人的一句话被 CosyVoice-3 克隆替换
├── modified_utts/
│   └── <id>_<utt_id>_modified.wav # 被替换那一句的单独音频
└── metadata/
    ├── train.jsonl / val.jsonl / test.jsonl
    └── modify_config_pipeline.json
```

补充事实：

- 数据集卡里 `modify_config_pipeline.json` 写在 `metadata/` 下（不是仓库根目录）。
- HF 网页预览里出现的 `LA_E_*.flac` 属于论文混合测试集的 ID 列表，与 `daily_talk_edit/` 无关。
- 文件大小（同一版本快照）：`test.jsonl` = 379,446 B，`val.jsonl` = 158,958 B，
  `train.jsonl` = 1,467,535 B，`modify_config_pipeline.json` = 3,069,270 B。

## 1. `<id>` 与 DailyTalk `dialog_idx` 的对应 [已核实 + 待本地复核]

[已核实] `<id>` 就是 DailyTalk 的 `dialog_idx`（整数，直接以字符串形式出现）。
证据：`modify_config_pipeline.json` 的键就是 `<id>`，且每条记录带 `dialog_id` 与
`target_utterance_idx`，例如：

```json
"0": {"dialog_id": "0", "target_utterance_idx": 9, "modified_text": "I want to invest in the stock market.", ...}
```

[已核实] `modified_utts` 的文件名里第二个数字就是这个 `target_utterance_idx`，5 例全部吻合：

| `<id>` | `target_utterance_idx` | 实际存在的文件 |
| --- | --- | --- |
| 0 | 9 | `0_9_modified.wav` |
| 1000 | 6 | `1000_6_modified.wav` |
| 1004 | 17 | `1004_17_modified.wav` |
| 1015 | 11 | `1015_11_modified.wav` |
| 1240 | 15 | `1240_15_modified.wav` |

[待本地复核] DailyTalk `metadata.json` 里 `utt_idx` 键的**写法**（是 `"9"` 还是 `"0_9"`）。
代码不依赖这一点：`DailyTalkIndex` 建全量索引（正则 `^(?P<key>.+)_(?P<speaker>[01])_d(?P<dialog>\d+)$`），
两种写法都能解析；`turns()` 用尾部数字排序得到句序。

```bash
python verify_data.py --split test --samples 5
```

看输出里 `<id>` / 句数 / 目标句序 / 目标句 key / 目标句说话人 那张表。

## 2. `fake_region` 的格式 [已核实]

- 类型：`list`，元素是 `[start, end]`；每条形如 `[[13.29, 17.37]]`；
- **单位是秒**，浮点数，不是采样点（`7` 号对话 13.29–17.37 秒，若当采样点则不足 1 毫秒，不可能）；
- 在当前抓到的行里，**每条只有一个区间**（用 `[[a, b], [c, d]]` 模式检索无命中）；
  代码仍然按"多区间"处理（`normalize_regions` 支持列表套列表）。
- 其余字段：`filename`、`semantic_influence`（自然语言描述，长度 300–1500 字符）。

test.jsonl 原文 5 条（逐字，已裁剪 `semantic_influence` 以便阅读，脚本会打印完整行）：

```json
{"filename": "7_modified.wav",  "fake_region": [[13.29, 17.37]], "semantic_influence": "The spoofed utterance introduces a temporal incongruity ..."}
{"filename": "9_modified.wav",  "fake_region": [[39.97, 48.37]], "semantic_influence": "The spoofed utterance transforms the other speaker's error ..."}
{"filename": "11_modified.wav", "fake_region": [[9.93, 14.25]],  "semantic_influence": "The spoofed utterance \"Yeah, I did. But my fiancee is having second thoughts\" ..."}
{"filename": "14_modified.wav", "fake_region": [[27.55, 30.79]], "semantic_influence": "The spoofed utterance introduces an element of inconvenience ..."}
{"filename": "16_modified.wav", "fake_region": [[30.57, 36.29]], "semantic_influence": "The spoofed utterance from the other speaker subtly shifts ..."}
```

区间长度在 1–10 s 量级（实测样例：1.04 s、2.36 s、3.24 s、4.32 s、9.28 s），与"一句被替换"相符。

## 3. `concat_utts` 是不是"无间隔直接拼接" [已核实：是]

在 val 全量 197 个可用对话上实测（`build_gt val` 的统计）：

| 指标 | 实测值 |
| --- | --- |
| `gap = 原音频时长 − 各句时长之和` 的 max\|gap\| | **0.3094 s** |
| \|gap\| ≤ 0.06 s 的比例 | **99.49%**（196/197） |
| 互相关对齐比例 | 100% |

结论：**基本是无间隔直接拼接**，各句起点可以直接用累计时长算。
那 1 个 0.31 s 的离群样本是边缘情况，不影响结论（`--align auto` 会处理）。

判据（`build_pair` 里已经实现）：

```
gap = duration(<id>_original.wav) - Σ duration(每个单句 wav)
|gap| <= 0.06 s  →  无间隔，各句起点 = 累计时长
|gap| >  0.06 s  →  说明有间隔或重采样，用归一化互相关逐句对齐（--align auto 默认就做）
```

```bash
python verify_data.py --split test --samples 10
# 看 "3 / 4" 那张表里的 "差值" 列与结论行
```

`build_gt.py --align auto|always|off` 对应三种策略；对齐结果写在标注的
`checks.aligned` / `checks.alignment_scores` 里，可以逐条审。

## 4. `modified` 时间轴与 `fake_region` 是否一致 [部分已核实，端点待本地复核]

[已核实] **`fake_region` 的长度等于 `modified_utts` 文件时长，字节级吻合 3/3**
（三个样本分别落在 val 与 test 两个划分）。这直接验证了"用 modified 单句时长替换原时长"这个前提：

| `<id>` | `fake_region` | 区间长 | `modified_utts` 字节数 | 反推时长 |
| --- | --- | --- | --- | --- |
| 0 | `[[17.72, 20.08]]` | 2.36 s | `0_9_modified.wav` 226,640 B | (226640−80)/96000 = 2.360 s |
| 123 | `[[4.58, 5.62]]` | 1.04 s | `123_2_modified.wav` 99,920 B | (99920−80)/96000 = 1.040 s |
| 1240 | `[[33.33, 36.57]]` | 3.24 s | `1240_15_modified.wav` 311,120 B | (311120−80)/96000 = 3.240 s |

（80 B 是 WAV 头开销；96000 B/s = 48000 Hz × 2 B，见第 6 条。）

[待本地复核] 起点对齐：把被替换句的时长替换进原时间轴后，计算出的 `[start, start+d]`
是否等于 `fake_region`。判据是端点差 ≤ 0.5 s；`build_gt.py` 会把
`checks.region_computed` / `checks.region_given` / `checks.region_abs_diff` 写进标注，
统计汇总在 `data/gt/{split}_build_stats.json` 的 `fake_region_check`。

```bash
python build_gt.py --split test --limit 10
cat data/gt/test_build_stats.json | python -m json.tool | head -60
```

## 5. 被替换句的说话人怎么来 [已核实机制，取值待本地复核]

DailyTalkEdit 没有说话人标签，`fake_region` 只给时间。做法：

1. 用 `target_utterance_idx` 取 DailyTalk `metadata.json` 里该对话的第 N 句；
2. 该句的 `speaker` 字段就是 `fake_speaker`；
3. 单句 wav 名 `{utt_key}_{speaker}_d{dialog_id}.wav`，`speaker ∈ {0, 1}`，其中 **0 = 男，1 = 女**
   （lhotse 的 `daily_talk` recipe：`gender="F" if utt['speaker'] == 1 else "M"`）。

[待本地复核] 解析成功率与分布（`fake_speaker` 里 0/1 各多少）。`verify_data.py` 的第 5 节会打印。

## 6. 采样率与声道 [已核实：实测，纠正早期反推]

用 `soundfile.info` 在服务器上逐个读过（`scripts/probe_audio.py`），**三套音频格式并不一致**：

| 文件 | 采样率 | 声道 | 编码 | 例 |
| --- | --- | --- | --- | --- |
| DailyTalk 单句 `data/<id>/<utt>_<spk>_d<id>.wav` | **44 100 Hz** | 1 | PCM_16 | `0/1_0_d0.wav` = 1.9365 s / 170,840 B |
| DailyTalkEdit `concat_utts/<id>_{original,modified}.wav` | **44 100 Hz** | 1 | PCM_16 | `0_modified.wav` = 25.4296 s / 2,242,968 B |
| DailyTalkEdit `modified_utts/<id>_<utt>_modified.wav` | **24 000 Hz** | 1 | **FLOAT（32 bit）** | `0_9_modified.wav` = 2.360 s / 226,640 B |

> 早期版本这里写过"由字节数反推 48 kHz"，**那是错的**：当时拿 96,000 B/s 去凑
> 226,640 B≈2.36 s 属于巧合（24 kHz float32 正好也是 96,000 B/s）。
> 以本表实测值为准。

**这条差异有实际后果**：拿 24 kHz 的单句去和 44.1 kHz 的整段做样本级互相关，
相关分数只有 0.04（相对速率差 1.8375 倍），必须重采样或只用"时长（秒）"。
`gtbuild` 的时间轴只用到时长，所以不受影响；`align_starts` 只在两边同采样率
（DailyTalk 单句 vs concat，都是 44.1 kHz）时才启用。

## 6b. 句子顺序的坑 [已核实]

DailyTalk `metadata.json` 里每个对话内部的键是 `"0".."n-1"`（句序），
但**从 zip 直接建索引时，写入顺序是文件名的字典序**（`0,1,10,11,2,…`）。
如果按"原始顺序"取句，整条时间轴会错位（实测导致伪造区间最大差 20.19 s）。
必须**无条件按尾部数字排序**；修正后：

| 指标 | 修正前 | 修正后 |
| --- | --- | --- |
| 伪造区间最大差 | 20.1936 s | **0.005 s** |
| ≤0.5 s 的比例 | 27.4% | **100%**（197/197） |
| modified 时间轴最大偏差 | 7.1689 s | **0.0619 s** |

## 7. val / test 各有多少对样本 [已核实]

在服务器上用 `wc -l` 数了官方 `metadata/*.jsonl`（2026-11-04，hf-mirror 下载的原文件）：

| 文件 | 字节 | 行数（= 对话对数） |
| --- | --- | --- |
| `val.jsonl` | 158,958 | **200** |
| `test.jsonl` | 379,446 | **475** |
| `train.jsonl` | 1,467,535 | 1,800（不使用） |

也就是 val 400 个文件、test 950 个文件。本方案只用 val（选阈值）与 test（报告），
**train 一律不碰**（HoliAntiSpoof 在 train 上训练过）。

顺带实测到的环境事实（同样影响排期）：

- `hf-mirror.com` 可用，单连接约 **630 KB/s**；`huggingface.co` 直连不通；
- `drive.google.com` 从服务器**不可达**，所以 DailyTalk 的 Google Drive 下载走不通，
  需要另行提供（本机上传或镜像）；
- `pyannote/speaker-diarization-community-1` 与 `pyannote/segmentation-3.0` 在 hf-mirror 上
  返回 **403**（需要 HF token 且在模型页同意条款），`pyannote/wespeaker-*` 可匿名访问。

---

## 8. 与 TASK_SPEC 1.4 的差异说明

标注里的 `turns` 是在**各自时间轴上**算的：

- `condition="original"`：`turns` 用原音频时间轴，`fake_speaker=null`，`fake_regions=[]`；
- `condition="modified"`：`turns` 用"替换目标句时长、后续整体平移"后的时间轴，
  `fake_regions` 直接取 metadata 的 `fake_region`（不取我们算的区间，避免自证循环），
  两者的差写进 `checks.region_abs_diff` 供核查。

附加字段（不影响评测，便于追错）：`dialog_id`、`target_utt_idx`、`checks`、
`modified_utt_path`、`modified_utt_duration`、`semantic_influence`。

## 9. 其他已核实的外部事实

**pyannote community-1**（模型卡）：

```python
pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-community-1", token=...)
output = pipeline("audio.wav", num_speakers=2)
output.speaker_diarization            # 普通结果（可能有重叠）
output.exclusive_speaker_diarization  # 独占结果，本方案用它
```

需要 `pyannote.audio` 4.x（`exclusive_speaker_diarization` 是 community-1 引入的），
输入自动重采样到 16 kHz，多声道自动下混。

**HoliAntiSpoof**（模型卡）：

- 底座 `Qwen/Qwen2.5-Omni-7B` + PEFT 适配器 `wsntxxn/HoliAntiSpoof`，`PeftModel.from_pretrained` 后可 `merge_and_unload()`；
- 用户提示词：`Determine whether this audio clip is a spoof or not. If it is a spoof, determine the spoofing method and the spoofing region.`
- `max_new_tokens=1024`、贪心、`output_scores=True`、`return_dict_in_generate=True`；
- 模型卡用 `real_fake_seq_idx = 6` 读 `real` / `fake` 两个 token 的 logit，但没解释为什么是 6；
- 输出是 JSON 文本，`real_or_fake` 之外还可能有 `spoof_method` 与区间字段。
  本实现不硬编码 6：先按 `real_or_fake` 键锚定找真正的取值步，再与 6 交叉检查，
  不一致时告警并把实际步号写进 `detection_*.json` 的 `logit_step`。
