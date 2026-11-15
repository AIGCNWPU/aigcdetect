# 评测表对比方法公开标注

## 交付

通用图片页Benchmark评测表的对比列由「方法1、方法2、方法3」改为公开方法缩写与会议年份：

| 列 | 标注 | 方法 |
| --- | --- | --- |
| 方法1 | PGC · ICML 2026 | Peak-Guided Calibration for Generalizable AI-Generated Image Detection（arXiv 2605.21207） |
| 方法2 | PROBE · ICML 2026 | Where Detectors Fail: Probing Generative Space for Generalizable AI-Generated Image Detection（arXiv 2605.24906） |
| 方法3 | SAFE · KDD 2025 | Improving Synthetic Image Detection Towards Generalization: An Image Transformation Perspective |

智鉴列继续不显示内部模型名称。八行TPR数值、排序、最高值加粗样式与统计卡均保持不变，仅更换列名。数值仍为2026-11-01用户提供的Qwen-Image-Bench八子集本地实测TPR，本轮未重跑对比方法。

## 修改位置

- `src/modules/image/pages/general.js`：`renderImageBenchmark` 表头三列。
- `tests/image-general-ui.test.mjs`：单元断言改为新列名，内部标签负面断言保留（本地实测、DDA-H、QWEN-IMAGE-BENCH等仍不得出现）。
- `tests/image-client-integration.browser.mjs`：浏览器表头断言同步更新。
- `openspec/changes/add-image-general/`：spec新增「20261104 对比方法公开标注」条款，design与tasks追加同日记录。

## 许可说明

平台仅在界面引用公开方法名称与本地实测成绩，不集成、不分发三个方法的代码或权重。已核对：PGC官方仓库与其HuggingFace权重均为Apache-2.0；SAFE官方仓库为Apache-2.0；PROBE官方仓库（Amamiya-C/PROBE-AIGI-Detection）未附许可文件，如后续需要本地运行该基线，须先取得作者授权。展示第三方实测数字不触发上述代码许可义务。
