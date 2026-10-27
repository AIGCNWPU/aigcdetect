# 图片与证件票据开发指导

**2026-10-26 本地内容核验修复**：新增[可执行规则、格式和关联设计](local-content-rules.md)，以[真实中文目标材料迭代复跑](local-content-rule-evaluation-20261026.md)验收，区分旧结果、作者口径、实际可见异常及模拟语义衔接。以下早期结果仍按原阶段保留。

**2026-10-26 全国研究与真实效果增量**：已扩展为[31地及代表高校研究](national-review-research-20261026.md)，汇总100条来源记录；完成[真实中文样本与8次大模型调用](chinese-real-evaluation-20261026.md)及[原图对照复核](chinese-semantic-audit-20261026.md)。实测暴露字段覆盖、自动关联、警告输出和定位效果不足，未宣称业务验收通过。

**2026-10-26 前次增量**：已补充[地区与机构材料调研](regional-review-research-20261026.md)、[本地执行度与按需智能复核](execution-and-semantic-review.md)，并接入脱敏/原文模式及结果页面。工程验证和未完成项见[本轮交付记录](review-delivery-20261026.md)。以下早期记录保留，不视为当前全部状态。

**2026-10-22 新服务器增量**：2.3已接入真实基础工作台与异步HTTP；当前方案、验收和限制以[核心材料工作台](target-review-delivery.md)为准。以下2026-10-21内容保留为历史背景，旧绝对路径按迁移映射使用。

负责人：③ 吕佳文。需求：2.1 通用 AI 生成图片检测、2.3 AI 证件与票据图片检测。评审日期：2026-10-21。当前阶段：三套模型已加载实测，票据离线协作与金额规则原型已实现，继续后端验证；正式业务接口、页面与完整验收待完成。前端使用本仓库已有的 VERITAS 智鉴，不另选框架。

本目录组织两个已有工作包的开发依据、交接和评测，不替代 OpenSpec 验收规格。先阅读[技术边界](architecture.md)、[跨材料规则](cross-material-rules.md)、[资产与评测](assets-and-validation.md)，最后核对[决策记录](decisions.md)。

本轮可执行进展与失败案例见[票据多方法协作与证据复核](receipt-fusion.md)。

迁往校园内网服务器的 rsync 脚本、资产目录、Python 环境恢复及 OpenSpec/skills 交接见[服务器迁移](server-migration.md)。迁移保留未提交工作区，不需要先 commit。

## 仓库与分支

真实仓库为 `/home/lvjiawen/project/aigc-detection-platform`，远端为 `git@github.com:AIGCNWPU/aigcdetect.git`。准备时已将干净的 main 快进到 `41d7b21`，并从同一提交创建以下本地分支：

| 需求 | 分支 | 唯一 OpenSpec 工作包 |
| --- | --- | --- |
| 2.1 | `ljw/image-general` | [add-image-general](../../openspec/changes/add-image-general/proposal.md) |
| 2.3 | `ljw/image-documents` | [add-image-documents](../../openspec/changes/add-image-documents/proposal.md) |

团队要求两个工作包分别维护，未强制一个场景一个 Git 分支。本次按场景拆分，便于独立 PR 和控制共享图片模块冲突。分支命名依据最新[贡献约定](../../CONTRIBUTING.md)，不再使用旧版 `codex/` 前缀。准备结束时检出 `ljw/image-general`；文档尚未 commit，不能把工作区文件误认为已经进入两个分支的历史。

用户明确要求今天暂不 commit、push 或合并。后续获准提交时，每个可检查功能提交代码与所属工作包文档；维护者合并 main 后再同步、归档。2.3 依赖 2.1 的模型结果契约，不依赖通用图片页面；先合入稳定契约，或在对齐的样例契约上分别开发。共享文档合入后由另一分支同步，不重复维护副本。

## 目录安排

| 位置 | 用途与当前状态 |
| --- | --- |
| `docs/image-workstream/` | 本次创建的组织指导文档，可随 PR 提交 |
| `src/modules/image/pages/general.js` | 已有 2.1 页面入口，待实现 |
| `src/modules/image/pages/documents.js` | 已有 2.3 页面入口，待实现 |
| `openspec/changes/add-image-general/` | 继续维护原有四类文档 |
| `openspec/changes/add-image-documents/` | 继续维护原有四类文档 |
| `tmp/image-workspace/planning/` | 已提取用户方案的正文、配置与 schema 参考，Git 忽略 |
| `tmp/image-workspace/reports/`、`logs/` | 已创建本地准备记录目录，Git 忽略 |
| `/data/lvjiawen/baselines` | 模型源码、权重、独立运行环境与下载断点；完成状态以本地账本和推理报告为准 |
| `/data/aigc/datasets` | 已有数据集，只读引用，避免重复复制 |

不复制压缩包中的五个变更到工程；不创建第二个业务仓库。原压缩包 SHA-256 为 `239332c60b060a06745fef35e4b70beee53e87041fcd7448afc973847158fcbe`。本地导入记录位于 `tmp/image-workspace/reports/source-import.json`。

提取的 13 个被清单覆盖的参考文件中，12 个与包内 SHA-256 一致；`01_solution_and_requirements.md` 不一致，且排除 CRLF 换行差异。原文件和清单均保留，详情在 `tmp/image-workspace/reports/source-checksums.json`。当前以用户最新说明、团队规范及实际读到的正文为评审依据；不能声称整个方案包完整性校验通过。模型下载清单本身校验匹配。

## 开发顺序与交接

| 阶段 | 交付 | 进入下一阶段的依据 |
| --- | --- | --- |
| 0 范围确认 | 两个工作包逐文件更新，确认材料规则和公共接口边界 | 用户确认关键范围，OpenSpec 结构校验通过 |
| 1 模型资产 | 固定源码、检查点、依赖环境、哈希和下载账本 | 文件完整性、加载和单例推理分别有记录 |
| 2 后端验证 | MIRROR、DocShield 票据字段框选、OCR、规则和证据链；随后接入 PDF 辅助输入 | 真伪样本、字段定位、OCR 对照、跨材料异常与脱敏测试结果 |
| 3 前端接入 | 单图/批量、原图/PDF页对照、筛选、字段与冲突联动 | 真实服务端到端验证及截图 |
| 4 联调与 PR | 公共材料/任务/版本/报告对齐，代码与工作包一起提交 | 项目检查与业务验收，未完成项明确 |

具体公共能力归属见[团队分工](../TEAM_DEVELOPMENT.md)与[公共设计](../../openspec/changes/define-shared-foundation/design.md)。共享 `service.js`、`contracts.d.ts`、HTTP 服务和构建清单修改需要对齐组长及④。本文不重新定义公共字段或队列状态。

OpenSpec CLI 已可用，版本为团队固定的 1.13.1；无需重新下载安装。当前两个工作包的文档存在，但各自三个业务里程碑均未完成。文档校验不代表算法接入或检测准确率达标。

## 本轮后端与规模验证

见[后端与 PDF 实现](backend-pdf.md)、[金融材料场景](financial-material-rules.md)、[数据清单](dataset-inventory.md)、[规模评估](scale-evaluation.md)。后端为场景内核心，公共 HTTP/页面和脱敏交付尚未完成。

## 2026-10-21 SEED 主测更新

按用户新要求，本轮主测改为 SEED 本地定位 + OCR/规则 + DeepSeek 脱敏摘要解释，DocShield-9B 完整保留作对照。此前“外部 API 全部关闭”是历史方案；现仅允许用户授权的 DeepSeek 白名单摘要，原图与 OCR 原文仍不外发。下载、同样本误报/漏报、实际 API 验证与边界见[SEED 接入记录](seed-integration.md)。公共接口和业务前端尚未接入。
