# 两人对话的按说话人伪造检测 —— 总报告

> 版本 2026-11-06 · 代码在 `spoof_diarization/` · 数据 DailyTalkEdit val/test（各抽 20%）· 检测后端 HoliAntiSpoof（Qwen2.5-Omni-7B + DoRA）

---

## 0. 一页速览

| 项 | 结果 |
| --- | --- |
| 任务 | 给定两人对话音频，判断**谁的声音是 AI 伪造的**，输出 `A_fake / B_fake / both_fake / both_real` |
| 方法 | pyannote 分离 → 静音掩码（每人一条等长音轨）→ HoliAntiSpoof 逐条判定 → 阈值判决 |
| 是否训练 | **否**，全部为现成模型推理 |
| 主指标（test 20%，93 对 / 186 文件 / 372 单位） | **EER 7.53% · AUC 0.9775 · 准确率 92.47% · 篡改归属准确率 84.95%** |
| val 20%（40 对 / 80 文件 / 159 单位，τ 在此选） | EER 10.54% · AUC 0.9468 · 准确率 90.57% · 归属 75.00% |
| 消融：纯静音填充 | EER 5.06% · 归属 82.50%（**比底噪填充更好**） |
| 消融：完美分离（上界） | EER 2.92% · AUC 0.9955 · 归属 92.50% |
| 关键结论 | ① 分离是主要瓶颈（吃掉 7.6 个 EER 点）② 底噪填充反而拖后腿 ③ test 误报集中在 B |

---

## 1. 背景与问题定义

### 1.1 要解决的问题

现有音频鉴伪模型（HoliAntiSpoof）吃的是**整段音频**，输出"这段是不是伪造的"。但真实业务场景是**两人对话**，而且往往只改了一个人的一句话：

```
25 秒的双人对话 ── 只有第 9 句被换成克隆音（2.36 秒）
整段送检 → 模型说"fake" → 但"谁"是假的？业务答不出来
```

所以这个功能要解决的是**归因（attribution）**：不是"这段假不假"，而是"**哪一个说话人**是假的"。

### 1.2 输出定义

| 输出 | 含义 |
| --- | --- |
| `both_real` | 两人都是真人 |
| `A_fake` / `B_fake` | 只有 A（先开口的人）/ B 是假的 |
| `both_fake` | 两人都假 |

同时输出每个说话人的 `p_fake`、判定用的阈值 τ、以及模型原始输出（留档）。

### 1.3 为什么不能直接整段检测

- 篡改只占对话的 5–15%，整段送检时真人的正常语音会把伪造痕迹"稀释"掉；
- 模型对整段给的 `fake_region` 在本场景**方向都可能是反的**（见仓库 `docs/音频区间定位实验.md`：模型把真人那一侧标成伪造）；
- 判不出"是谁"，业务无法处置。

所以要先把两个人**分开**，再分别判。

### 1.4 技术路线（方案已定，本报告是它的实现与验证）

```
对话音频 ──① 说话人分离（pyannote, 固定 2 人）
        ──② 静音掩码导出：每人一条与原音频等长的 wav，对方说话处替换为底噪
        ──③ 伪造检测：两条 wav 分别送 HoliAntiSpoof，得到每人的 p_fake
        ──④ 判定：A 假 / B 假 / 都假 / 都真
        ──⑤ 评测（仅在有标注的数据集上）
```

**不训练任何模型。**

---

## 2. 数据集的建立

### 2.1 原始数据：DailyTalk

来源：<https://github.com/keonlee9420/DailyTalk>（CC-BY-SA 4.0，学术使用），共 **2,541 个两人对话**。

```
dailytalk/
├── metadata.json
└── data/
    └── <dialog_id>/                     # 一个对话一个目录
        ├── 0_1_d0.wav                   # <句序>_<说话人>_d<对话号>.wav
        ├── 0_1_d0.txt
        ├── 1_0_d0.wav
        └── …
```

`metadata.json` 的结构：

```json
"0": {
  "0": {"speaker": 1, "text": "What are you working on?", "turn": 12, "index": "0-0"},
  "9": {"speaker": 0, "text": "I need to pay my bills.",  "turn": 12, "index": "0-9"}
}
```

三个字段容易误解，实测确认：

| 字段 | 含义 | 依据 |
| --- | --- | --- |
| 内层键 `"0".."n-1"` | **该对话内的句序** | 与文件名前缀一致 |
| `turn` | **这个对话总共有几句**（不是句序） | 对话 0/154/408/1031 分别是 12/6/12/20，同一对话内每条都相同 |
| `index` | **全局唯一句 id**，格式 `对话号-句序` | lhotse 用它做 supervision id |

实测音频参数：

| 项 | 实测值 |
| --- | --- |
| 采样率 / 声道 / 编码 | **44 100 Hz / 单声道 / PCM_16** |
| 单句时长 | 0.75 – 9.9 s，平均 ~2 s |
| 每对话句数 | 6 – 20 句，平均 ~9 |
| 说话人 | 只有 0 / 1（0=男，1=女），**严格交替**（抽 300 个对话检查，0 例外） |
| 有无时间信息 | **没有**。每句各从一个文件、从 t=0 开始，没有"这句话在原对话里第几秒" |

> 因为没有时间信息，要还原一整段对话只能"按句序把文件拼起来"——这正是 DailyTalkEdit 做的事。

### 2.2 评测数据：DailyTalkEdit

来源：<https://huggingface.co/datasets/wsntxxn/DailyTalkEdit>（Apache-2.0，约 14.7 GB），由 HoliAntiSpoof 作者在 DailyTalk 上改造得到。

**改造方式**：每个对话挑**一句**，用 **CosyVoice-3 克隆该说话人自己的音色**重新说出改写后的文本，其余 11 句原封不动。

```
daily_talk_edit/
├── concat_utts/
│   ├── <id>_original.wav      # 12 句无间隔拼接，两人都真
│   └── <id>_modified.wav      # 其中一句被替换
├── modified_utts/
│   └── <id>_<utt_id>_modified.wav   # 被替换那一句单独存
└── metadata/
    ├── {train,val,test}.jsonl
    └── modify_config_pipeline.json
```

规模（实测 `wc -l`）：

| 划分 | 对话对数 | 文件数 | 用途 |
| --- | --- | --- | --- |
| train | 1,800 | 3,600 | **不使用**（HoliAntiSpoof 训练过，会泄漏） |
| val | **200** | 400 | 只用来选阈值 τ |
| test | **475** | 950 | 只用来报最终结果 |

`metadata/*.jsonl` 每行：

```json
{"filename": "0_modified.wav",
 "fake_region": [[17.72, 20.08]],
 "semantic_influence": "The spoofed utterance introduces a temporal incongruity …"}
```

- `fake_region`：**秒**为单位的 `[start, end]` 列表（当前版本每条只有一个区间），就是被替换那句的时间范围；
- `semantic_influence`：这句改写对对话语义的影响（自然语言描述）。

`modify_config_pipeline.json` 每条补充了"改的是哪句、改成什么"：

```json
"0": {"dialog_id": "0", "target_utterance_idx": 9,
      "modified_text": "I want to invest in the stock market.",
      "original_dialogue": "[0] Speaker 1: What are you working on?\n[1] Speaker 0: …"}
```

**三套音频的格式并不一致**（这是踩过的坑，实测）：

| 文件 | 采样率 | 编码 | 例 |
| --- | --- | --- | --- |
| DailyTalk 单句 | 44 100 Hz | PCM_16 | `1_0_d0.wav` = 1.9365 s / 170,840 B |
| `concat_utts/*.wav` | 44 100 Hz | PCM_16 | `0_modified.wav` = 25.4296 s / 2,242,968 B |
| `modified_utts/*.wav` | **24 000 Hz** | **float32** | `0_9_modified.wav` = 2.360 s / 226,640 B |

后果：拿 24 kHz 的单句直接和 44.1 kHz 的整段做**样本级**互相关，相关分数只有 0.04（时间轴被拉伸 1.8375 倍）。所以时间轴只用"**秒**"这一层信息，不跨采样率做波形对齐。

### 2.3 我们补的标注（`build_gt.py`）

DailyTalkEdit **没有说话人标签**，`fake_region` 只给时间。要评测"谁被判对了"，必须补两样东西：

1. **被篡改句的说话人**（`fake_speaker`）——用 `target_utterance_idx` 去 DailyTalk 的 metadata 里查；
2. **逐句时间轴**（`turns`）——按句序把各句时长累加，必要时用互相关校正。

#### 关键校验（全部在 `data/gt/{split}_build_stats.json` 里）

| 校验项 | val | test |
| --- | --- | --- |
| 拼接是否无间隔（\`\|gap\| ≤ 0.06 s\` 的比例） | **99.49%**（196/197） | 99.36%（466/469） |
| 计算出的伪造区间 vs `fake_region` 最大差 | **0.005 s** | **0.005 s** |
| ≤ 0.5 s 的比例 | **100%** | **100%** |
| modified 时间轴重建偏差 ≤0.1 s 的比例 | 100%（max 0.062 s） | 98.93%（max 65.4 s，5 个离群） |
| 成功构建的对话对 | 197 / 200 | 469 / 475 |
| 被篡改人分布（speaker 0 / 1） | 104 / 93 | 217 / 252 |

失败原因统一是：`modify_config_pipeline.json` 里有这个对话，但 **DailyTalk 原始数据里没有**（DailyTalkEdit 用的是 2,475 个对话，DailyTalk 有 2,541 个，作者筛掉了 66 个）。

#### 踩过的两个坑

1. **句子顺序**：从 zip 直接建索引时，键的写入顺序是文件名的字典序（`0,1,10,11,2,…`），不是对话顺序。按原顺序取句会让整条时间轴错位——实测伪造区间最大差 **20.19 s**。修正为"无条件按尾部数字排序"后降到 **0.005 s**。
2. **采样率不一致**：见 2.2 的表，首版把 24 kHz 单句当 44.1 kHz 用，导致互相关永远匹配不上。

#### 标注文件格式（`data/gt/{val,test}.jsonl`，一行一个文件）

```json
{"file_id": "0_modified", "pair_id": "0", "split": "val", "condition": "modified",
 "audio_path": "/abs/0_modified.wav", "duration": 25.4296,
 "turns": [{"start": 0.0, "end": 1.55, "speaker": 1, "utt_idx": 0}, "…"],
 "fake_speaker": 0, "fake_regions": [[17.72, 20.08]],
 "checks": {"gap_seconds": -0.002, "gapless": true, "region_abs_diff": 0.004, "…"}}
```

- `condition="original"` 时 `fake_speaker=null`、`fake_regions=[]`；
- 评测单位是"**文件 + 说话人**"，每个文件产生 2 个单位，标签 = 该说话人是否有伪造区间。

### 2.4 数据集的已知限制

1. 只覆盖两种真实情况：**两人都真** + **一个人一句话被改**；没有"整个人都假""两人都假"；
2. 篡改是**同音色克隆**（用本人音色），是最难的一档，不能代表"换人声"场景；
3. 每段对话只有一个伪造区间，且只改一句；
4. 采样评测时 val/test 各抽 20%（原因见 6.4）。

---

## 3. Pipeline

```
                     ┌──────────────────────────────────────────┐
对话 wav（44.1 kHz）──►│ ① 分离  pyannote/speaker-diarization-     │
                     │    community-1 · 固定 2 人 · exclusive    │
                     │    按首次开口把 SPEAKER_xx 改名 A / B      │
                     └───────────────┬──────────────────────────┘
                                     │ 实测例：A 8 段/11.36 s，B 5 段/9.94 s
                     ┌───────────────▼──────────────────────────┐
                     │ ② 掩码  每人一条，与原音频等长             │
                     │    自己片段保留，pad=0.2 s 且不越界        │
                     │    对方位置填"两人都不说话"处的底噪        │
                     │    边界 20 ms 半余弦交叉淡化               │
                     └───────────────┬──────────────────────────┘
                                     │ A.wav / B.wav 均 1,121,445 帧 = 25.4296 s
                     ┌───────────────▼──────────────────────────┐
                     │ ③ 检测  HoliAntiSpoof（7B，bf16，整段一次）│
                     │    贪心解码，max_new_tokens=1024          │
                     │    在 real_or_fake 键之后定位决策步        │
                     │    p_fake = softmax(real_logit, fake_logit)[1] │
                     └───────────────┬──────────────────────────┘
                                     │ 实测例：A 31.125/31.125→0.500，B 25.0/34.5→0.9999
                     ┌───────────────▼──────────────────────────┐
                     │ ④ 判定  is_fake = p_fake ≥ τ              │
                     │    τ 仅在 val 上按说话人级 EER 选          │
                     └───────────────┬──────────────────────────┘
                                     │ A_fake / B_fake / both_fake / both_real
                     ┌───────────────▼──────────────────────────┐
                     │ ⑤ 评测  EER/AUC、混淆矩阵、DER、归属、错误分解 │
                     └──────────────────────────────────────────┘
```

### 3.1 说话人分离

- 模型：`pyannote/speaker-diarization-community-1`（需在 HF 页面同意条款，`HF_TOKEN` 传入）；
- 固定 `num_speakers=2`，取 **`exclusive_speaker_diarization`**（独占结果，保证同一时刻只归一个人，掩码时两边不重叠）；
- **命名规则**：pyannote 的 `SPEAKER_xx` 编号是随机的，按**首次开口时间**重命名——先开口的记作 `A`，另一个 `B`；原始编号保存在 `diarization.json` 的 `pyannote_labels`；
- 异常情况只告警不中断：只检出一个说话人、某人总时长 < 1 s。

实现要点：**不把文件路径传给 pyannote**，而是用 `soundfile` 读成 `{"waveform": tensor, "sample_rate": sr}` 传进去。原因是 pyannote.audio 4.x 传路径会走 `torchcodec`，而这个库对 torch 版本极其敏感（我们的环境里它就加载失败）。

产物：`diarization.json`、`diarization.rttm`。

### 3.2 静音掩码导出

目标：给每个说话人生成一条**和原音频完全等长**的音轨——自己说话的段落保留原声，其余位置填底噪。

| 步骤 | 做法 |
| --- | --- |
| 外扩 | 每段首尾各外扩 `pad=0.2 s`，**但不得进入对方片段**：左边界取 `max(s-pad, 对方上一个片段的结束)`，右边界取 `min(e+pad, 对方下一个片段的开始)` |
| 底噪素材 | 取"两人都不说话"的片段（单段 ≥ 0.1 s），拼成素材库循环铺满；起点由 `seed` 决定，可复现 |
| 兜底 | 素材总长 < 0.5 s 时，退化成 **−60 dBFS 高斯白噪声** |
| 边界 | 每个保留片段首尾做 20 ms **半余弦交叉淡化**（语声 ↔ 底噪互补，不是淡到 0） |
| 等长 | 全部按采样帧计算，导出后逐条断言帧数相同 |

可配置：`pad`、`fade`、`fill`（`noise` / `zero`）。

产物：`A.wav`、`B.wav`、`mask_meta.json`（保留区间、底噪来源、长度自检）。

### 3.3 伪造检测

- 模型：`Qwen/Qwen2.5-Omni-7B` + PEFT 适配器 `wsntxxn/HoliAntiSpoof`（bf16，单卡 ≥ 24 GB）；
- 提示词（模型卡默认）：`Determine whether this audio clip is a spoof or not. If it is a spoof, determine the spoofing method and the spoofing region.`
- 生成：贪心解码，`max_new_tokens=1024`，`output_scores=True`，`return_dict_in_generate=True`；
- **决策步不硬编码**：模型卡写死在第 6 步读 `real`/`fake` 两个 token 的 logit，但没说原因。实现里改为——
  1. 在生成序列里找到解码为 `real`/`fake` 的候选 token；
  2. 用正则锚定"紧跟 `real_or_fake` 键之后"的那一个（避免把键名里的 `fake` 当成值）；
  3. 断言它等于 6，不一致就告警并把实际步号写进结果；
  4. `p_fake = softmax([real_logit, fake_logit])[1]`。
- 两种后端：**本地**（整段一次推理，本报告的数据都用它）与 **HTTP**（复用已部署的 `backend/server.py`；注意该服务对 >30 s 音频会滑窗取最大，与本地不等价）。

产物：`detection_A.json`、`detection_B.json`（含两个 logit、决策步、解析后的字段、**原始输出**、过滤前后的区间）。

### 3.4 判定

- 每个说话人：`is_fake = p_fake ≥ τ`；
- 文件级：`A_fake / B_fake / both_fake / both_real`；
- **τ 只在 val 上选**：按说话人单位计算 EER 对应的阈值，写进 `outputs/threshold*.json`；test 只读不选。

### 3.5 评测指标

| 指标 | 定义 |
| --- | --- |
| 说话人级 EER / AUC | 每个"文件+说话人"一个样本，用 `p_fake` 算（与阈值无关） |
| 准确率 / 精确率 / 召回 / 平衡准确率 | 用 τ 判完后算 |
| 文件级混淆矩阵 | 真值 `both_real / A_fake / B_fake` × 预测四类 |
| 原始文件误报率 | `original` 文件里"被判出任意一人是假"的比例 |
| 篡改归属准确率 | `modified` 文件里"正好判出被篡改的人、且另一人判真"的比例 |
| DER | pyannote.metrics，collar 0.25 s，original / modified 分开报 |
| 伪造句归属正确率 | `fake_regions` 那段时间里，有多少比例被分给了正确的人（衡量分离，不衡量检测） |
| 错误分解 | 判错的 `modified` 文件归类：分离分错人 / 检测漏报 / 真人误报 |

**配对问题**：预测的 A/B 与标注的 0/1 没有天然对应关系，按"时间重叠最大"做 2×2 一对一配对；之后所有比较都在**标注编号空间**里做（混淆矩阵行列同源）。

---

## 4. 实验结果

### 4.1 主结果

阈值 τ = **0.9959**（在 val 20% 上按说话人级 EER 选，test 直接复用）。

| 指标 | val 20%（40 对 / 80 文件） | test 20%（93 对 / 186 文件） |
| --- | --- | --- |
| 说话人级 **EER** | 10.54% | **7.53%** |
| **AUC** | 0.9468 | **0.9775** |
| 准确率 @τ | 90.57% | **92.47%** |
| 精确率 / 召回 | 0.761 / 0.897 | 0.804 / 0.925 |
| 平衡准确率 | 90.29% | 92.47% |
| 仅 modified 的 EER | 15.19% | 7.53% |
| **原始文件误报率** | 7.50%（3/40） | 13.98%（13/93） |
| **篡改归属准确率** | 75.00%（30/40） | **84.95%**（79/93） |
| DER（original / modified） | 9.97% / 11.05% | 11.33% / 12.43% |
| DER 分量（miss / FA / confusion） | 6.4% / 0.0% / 2.5% | 7.8% / 0.0% / 1.7% |
| 伪造句归属正确率 | 77.45% | 81.46% |
| 说话人单位数 | 159 | 372 |

### 4.2 test 文件级混淆矩阵

| 真值 ＼ 预测 | both_real | A_fake | B_fake | both_fake | 合计 |
| --- | --- | --- | --- | --- | --- |
| **both_real** | **80** | 0 | 13 | 0 | 93 |
| **A_fake** | 4 | **35** | 1 | 3 | 43 |
| **B_fake** | 2 | 0 | **44** | 4 | 50 |

### 4.3 消融 A：填充材料（val 20%，同样本同 τ）

| 条件 | EER | AUC | 准确率 | 原始误报率 | 篡改归属 | DER |
| --- | --- | --- | --- | --- | --- | --- |
| 底噪填充（主方案） | 10.54% | 0.9468 | 90.57% | 7.50% | 75.00% | 9.97 / 11.05% |
| **纯静音 `fill=zero`** | **5.06%** | **0.9752** | **94.34%** | **5.00%** | **82.50%** | 同（分离不变） |

**结论**：数字静音填充反而全面更好，而分离质量完全没变 → 差异 100% 来自检测器对掩码材料的反应。
"从别处裁底噪再循环铺满"会留下不自然的噪声接缝，被模型当成了可疑线索。
这条推翻了"底噪填充更自然"的直觉，也是**最直接的改进点**（按原位置取底噪、只在边界淡化）。

### 4.4 消融 B：oracle 分离（上界，val 20%）

用标注 `turns` 代替 pyannote 做掩码（DER 自然是 0，同时充当该通路自检）。

| 条件 | EER | AUC | 准确率 | 原始误报率 | 篡改归属 | DER |
| --- | --- | --- | --- | --- | --- | --- |
| pyannote（实际） | 10.54% | 0.9468 | 90.57% | 7.50% | 75.00% | 9.97 / 11.05% |
| **oracle（上界）** | **2.92%** | **0.9955** | **97.50%** | **2.50%** | **92.50%** | 0 |

**结论**：完美分离下检测器本身已经很强（EER 2.9%、AUC 0.996、误报 2.5%）。
分离误差吃掉了 **7.6 个 EER 点、17.5 个归属准确率点**——**分离是当前主要瓶颈**。

### 4.5 错误分析（test 20%，14 个判错的 modified 文件）

| 原因 | 数量 |
| --- | --- |
| 检测器把真人误报（false positive） | 7 |
| 检测器漏报（miss） | 6 |
| 分离把伪造句分错了人 | 1 |
| 合计 | 14 |

典型错例（`p_fake` 为两人）：

| 文件 | 真值 | 预测 | 原因 | p_fake(A/B) |
| --- | --- | --- | --- | --- |
| 70_modified | A_fake | both_real | 分离分错 + 漏报 | 0.980 / 0.798 |
| 214_modified | B_fake | both_fake | 真人误报 | 0.998 / 1.000 |
| 443_modified | B_fake | both_real | 漏报 | 0.989 / 0.003 |
| 577_modified | A_fake | both_real | 漏报 | 0.202 / 0.995 |

**两个现象值得追**：

1. **误报集中在 B**：93 个原始文件里 13 个判 `B_fake`、**0 个判 `A_fake`**。这种单向偏置不是随机误差，怀疑与 B 的掩码里底噪占比、或 A/B 命名顺序有关。
2. **τ 在 test 上偏松**：τ 按 val 的 EER 选，搬到 test 后 EER 反而更低（7.5% vs 10.5%），但原始文件误报翻倍（14%）。产品若更怕误报，τ 应按"误报率上限"定，而不是 EER。

---

## 5. 工程实现

### 5.1 代码结构

```
spoof_diarization/
├── config.yaml              # 唯一配置源，命令行可覆盖任意键（--set a.b=v）
├── build_gt.py              # 构建 data/gt/{val,test}.jsonl
├── verify_data.py           # 核实数据集事实（七条）
├── diarize.py               # ① 分离
├── mask_export.py           # ② 掩码
├── detect.py                # ③ 检测
├── decide.py                # ④ 判定（按 τ 刷新）
├── evaluate.py              # ⑤ 评测
├── run_pipeline.py          # 单文件全流程
├── run_eval.py              # 批量推理 + 评测（含 --sample-ratio / --oracle-diarization）
├── spoofdiar/               # 实现（15 个模块：config/utils/audio/dailytalk/gtbuild/
│                            #   diarization/masking/parsing/detector/decision/metrics/
│                            #   evaluation/pipeline/debug_plots）
├── scripts/                 # 运维与工具脚本（取数、建环境、渲染报告、诊断）
├── tests/test_units.py      # 30 个单测（不需要模型/数据）
├── docs/data_notes.md       # 数据核实记录
├── docs/REPORT.md           # 本文件
└── outputs/reports/         # 汇总报告、各条件 report.md / metrics.json / 混淆矩阵 png
```

### 5.2 关键设计

| 设计 | 原因 |
| --- | --- |
| 所有时长按**采样帧**算，导出后断言帧数相等 | 等长是掩码方案的前提，错一帧就会污染后续检测 |
| `diarization.json` / `detection_*.json` / `result.json` 三级缓存 | 7B 模型推理慢，支持断点续跑；`--force` 才重算 |
| τ 与推理解耦（先出 `p_fake`，再统一按 τ 回写 `is_fake`） | val 选完阈值后不用重新推理 |
| 抽样按"被篡改人 0/1"分层 + 固定 seed | 20% 样本仍能覆盖两类，且可复现 |
| 报告里的 DER 用 `pyannote.metrics`，自实现只作兜底 | spec 要求 pyannote 口径；自实现的分母/重叠处理尚未对齐（见 7.2） |

### 5.3 运行环境

| 项 | 值 |
| --- | --- |
| GPU | A100-40G（检测器 ~18 GB 显存） |
| Python | 3.11（独立 venv，**不动线上 HoliAntiSpoof 服务所在环境**） |
| 关键版本 | torch 2.9.1+cu128、pyannote.audio 4.0.7、transformers 4.57.6 |
| HF 访问 | 走 `hf-mirror.com`（`huggingface.co` 直连不通），`HF_TOKEN` 用于 gated 模型 |

### 5.4 实测耗时

| 环节 | 耗时 |
| --- | --- |
| 模型加载（7B） | 55.5 s |
| 单文件全流程（20–25 s 对话） | **4.3 – 6.5 s**（分离 ~3–4 s + 检测 2×~1 s） |
| val 20%（80 文件） | 8.4 min |
| test 20%（186 文件） | 13.3 min |
| 消融 `fill=zero`（80 文件） | 6.3 min |
| oracle（80 文件，跳过分离） | ~7 min |
| 建标注（197 对，含互相关对齐） | 1–3 min |

---

## 6. 复现

```bash
cd spoof_diarization
pip install -r requirements.txt
export HF_TOKEN=hf_xxx          # 需先在 pyannote 模型页同意条款
source scripts/run_env.sh       # 服务器上的环境变量与 venv 路径

# 1) 数据核实
python verify_data.py --split test --samples 5

# 2) 标注（--align always 用互相关校正时间轴）
bash scripts/run_build_gt.sh val  --align always --force
bash scripts/run_build_gt.sh test --align always --force

# 3) val 20%：推理 + 选 τ + 评测
$VENV run_eval.py --split val --sample-ratio 0.2 --backend local --device cuda:2 \
    --set detect.local.model_root=/path/to/models --set diarization.device=cuda:2

# 4) test 20%：复用 val 的 τ
$VENV run_eval.py --split test --sample-ratio 0.2 --backend local --device cuda:2 \
    --threshold-file outputs/threshold_sample20.json \
    --set detect.local.model_root=/path/to/models --set diarization.device=cuda:2

# 5) 消融
$VENV run_eval.py --split val --sample-ratio 0.2 --fill zero --threshold 0.9959 …
$VENV run_eval.py --split val --sample-ratio 0.2 --oracle-diarization --threshold 0.9959 …

# 6) 渲染静态 HTML 报告
$VENV scripts/render_html_report.py --main outputs/test --main-label test \
    --compare outputs/val:'val 20%（主线）' outputs/val_fill-zero:'val 消融 fill=zero' \
              outputs/val_oracle:'val 消融 oracle 分离' \
    --examples 3 --out outputs/reports/report.html
```

单文件推理（不需要标注）：

```bash
$VENV run_pipeline.py --input dialog.wav --out outputs/single/dialog --debug-plot
```

### 6.1 产物一览

```
outputs/{val,test,val_fill-zero,val_oracle}/
├── {file_id}/result.json            # 逐文件结论（含每人的 p_fake/片段/区间）
├── {file_id}/detection_{A,B}.json   # 模型原始输出与 logit
├── predictions.jsonl                # 每条结果 + 配对 + 真值
├── unit_scores.csv                  # file_id, gt_speaker, pred_speaker, label, p_fake, is_fake
├── metrics.json                     # 全部指标
├── confusion_matrix.csv / .png
├── sample_pairs.json                # 抽样清单（可复现）
└── report.md                        # 自动生成的中文报告

outputs/reports/
├── report.html                      # 自包含静态报告（含波形示例）
└── SUMMARY.md                       # 四组实验汇总
```

### 6.2 为什么是 20% 而不是全量

test 全量 475 对 = 950 个文件，按 6.5 s/文件约 1.7 小时（单卡）；val 全量 400 文件约 45 分钟。
20% 抽样（val 40 对、test 93 对）在 EER 上已经足够稳定（样本量 159/372 个单位），
因此正式结果用 20%，需要时把 `--sample-ratio` 改成 `1.0` 即可复跑全量。

---

## 7. 已知问题与后续改进

### 7.1 影响结果的

| 问题 | 现状 | 建议 |
| --- | --- | --- |
| 底噪填充拖后腿 | `fill=zero` 明显更好 | 按原位置取底噪（而不是循环铺满），或直接用 zero 作默认 |
| 分离是瓶颈 | 吃掉 7.6 EER 点 / 17.5 归属点 | 更强的分离模型（precision-2）、或产品侧做声纹注册 |
| 误报集中在 B | test 上 13 例全是 B | 需要专门排查（B 的语音占比/底噪长度是否与 A 系统不同） |
| τ 偏松 | test 误报 14% | 按"误报率上限"选 τ，或报告 τ-p 曲线 |
| 长对话掩码信息密度低 | 25 s 里只有 11 s 是本人语音 | 按"本人语音占比"切片或加权 |

### 7.2 不影响结论但该修的

1. **自实现 DER 与 pyannote 口径不一致**（报告里会提示 `⚠ N 个文件两套 DER 相差 >0.05`）：分母、重叠处理与 pyannote 不同。报告用的是 pyannote 值，兜底实现仅在缺 pyannote 时生效。
2. **5 个 test 文件的时间轴离群**（最大 65 s 偏差）：伪造区间本身仍准确（差 0.005 s），但整段时间轴偏差大，可能是原文件末尾有多余音频。
3. `2416_modified` 里有一个说话人 `p_fake=None`：该文件分离只检出一个说话人（已单列告警），属预期行为。

### 7.3 尚未做的

- **前端展示**：目前只有静态 HTML 报告；接 web 页面需要后端加 `/api/v1/dialogue/forgery`、前端加上传页；
- **全量评测**：只跑了 20%；
- **更多伪造类型**：本数据集只有 TTS 克隆；VC / 拼接 / 局部编辑没有覆盖。

---

## 附录 A：数据集事实清单（可直接引用）

| 事实 | 值 | 来源 |
| --- | --- | --- |
| DailyTalk 对话数 | 2,541 | 官方 README |
| DailyTalkEdit 对话数 | 2,475（train 1800 / val 200 / test 475） | `wc -l metadata/*.jsonl` |
| DailyTalk 音频 | 44.1 kHz / 单声道 / PCM_16 | `soundfile.info` |
| concat_utts 音频 | 44.1 kHz / 单声道 / PCM_16 | 同上 |
| modified_utts 音频 | **24 kHz / 单声道 / float32** | 同上 |
| 拼接是否无间隔 | 是（val 99.49%、test 99.36% 的 \|gap\| ≤ 0.06 s） | `build_stats.json` |
| fake_region 格式 | `[[start_sec, end_sec]]` | 原始 jsonl |
| fake_region 与重建区间最大差 | 0.005 s（val/test 100% ≤0.5 s） | `build_stats.json` |
| 说话人是否交替 | 严格交替（抽 300 个对话，0 例外） | 本地统计 |
| 篡改句说话人分布 | val 0:104 / 1:93；test 0:217 / 1:252 | `build_stats.json` |
| 被篡改句占比 | 一句 / 整段，约 5–15% 时长 | 抽样统计 |

## 附录 B：单文件产物示例（`outputs/test/70_modified/result.json`，真实数据）

```json
{
  "file_id": "70_modified", "duration": 21.019,
  "verdict": "both_real", "threshold": 0.99593,
  "diarization_warning": null,
  "speakers": [
    {"id": "A", "pyannote_label": "SPEAKER_00", "segments": [5 段],
     "total_speech": 7.357, "p_fake": 0.979668, "is_fake": false, "fake_regions": []},
    {"id": "B", "pyannote_label": "SPEAKER_01", "segments": [4 段],
     "total_speech": 7.492, "p_fake": 0.798187, "is_fake": false, "fake_regions": []}
  ],
  "config": {"pad": 0.2, "fade": 0.02, "fill": "noise"}
}
```

这个样本真值是 `A_fake`，被判成 `both_real`：A 的 `p_fake=0.9797` 已经很高，但**低于 τ=0.9959**，
所以没触发；同时报告把它的原因标为「分离分错人 + 漏报」。它很典型地说明了两件事：
① p_fake 的量级是对的（0.98 对真人来说异常高），② τ 取 EER 最优点时在个别样本上偏保守。
