# 2.3 目标驱动的材料核验与阶段实验

2026-10-23修正：前台与接口统一按核验功能开放，不再提供用户机构身份选项或按身份限制功能；下述2026-10-22机构场景表仅保留为内部需求研究记录。新请求不含role，购方/销方等材料语义角色不变。

更新：2026-10-22。实现 `core-material-review/0.1`，延续 `add-image-documents`。本文件区分已经执行的工程规则、场景建议和尚缺的机构政策；模型风险与内容矛盾保持分开。

## 如何理解“正则化的对比”

这里按业务规则核验实现：正则表达式负责字段格式和别名；金额使用 BigInt 定点运算；日期使用明示格式与日历校验；主体、交易、版本和集合范围有各自条件。不存在用一个正则表达式证明材料真实的步骤。规则结果构成大模型解释的证据，大模型不能改写原规则结论，也不能把内容矛盾自动升格为图像篡改。

## 已实现的接口

文件：`src/modules/image/documents/server/review-plan.js`。

```js
planReview(batch, {coreMaterialId, objective, jurisdiction, ...trustedContext});
evaluateReview(batch, {coreMaterialId, objective, jurisdiction, ...trustedContext});
buildUserConfirmedRelations(batch, {coreMaterialId, confirmations});
```

`batch` 沿用已有来源/版本契约。`planReview` 输出核心材料、场景适用性、星状边、显式集合、未参与原因、重复文件及预算。`evaluateReview` 返回 `perMaterial` 单份检查、`checks` 单份与集合检查、`candidates` 核心与辅助的比较、`incompletePages`、`coverage` 和 `plan`。每条字段证据保留材料版本、字段版本、源文件哈希、OCR框或Word结构位置。`overallAuthenticity` 始终为空；检查通过不代表官方登记验证。

必须明确 `coreMaterialId`，缺失时直接输入错误，不猜测核心。每批最多200材料、2000字段，每个辅助材料最多8条关系，最多8个集合、1600个集合成员引用。关系按核心邻接筛选，不执行旧 `evaluateBatch` 的全批两两枚举。每个关系只查规则包内相同语义键和确认角色；一个角色字段有多个候选时生成一条NEI，绝不把这些候选展开成笛卡尔积。

选择计划与运行顺序为：建立ID与来源哈希索引 → 单份规则 → 可信核心星状边比较 → 显式完整集合计算。普通辅助文件之间的边被排除并标注 `not_adjacent_to_core`。同名、同额不自动建边。重复上传保留单份检查和来源，但不重复生成星状比较；这不表示重复报销。缺页、解析失败和Word未渲染仍记为未覆盖。

关系需绑定当前批次ID与版本，修订后旧关系不可直接重用。可信服务器上下文支持 `same_entity`、`same_transaction`，独立来源依据不能是正在比较的字段本身。金额还需要币种、含税/未税口径、同一金额范围；日期需要同一日期事件；票号需要确认同一张票。未确认时均为NEI，不因两个金额不同直接报告错误。

本地工作台允许用户**显式确认**关系：`confirmations` 每项包括辅助 `materialId`、`kind`、`coreRole`、`auxiliaryRole`、必填 `reason`，以及可选金额/日期/同票范围确认。服务端 helper 验证引用和角色后生成稳定关系ID，固定 `reviewer: local-workbench-user`，标注 `trust: user_asserted_not_external_verified` 和未启用公共身份认证。客户端自报 reviewer、basisType 或已确认关系对象不能直接作为可信上下文。这是可追溯的用户声明，不是权威核验。没有确认项就没有自动建边。

付款和票据集合只接受核心为目标的显式成员；完整性、审核者、原因或范围缺失为NEI。沿用原有付款唯一标识去重、正负退款计算、发票签发者/票号去重和红蓝关联规则。不会默认单笔付款等于整票，也不会把一个PDF内所有页都假定为同一张票。集合本身需有已确认的业务范围，不是因为文件同时上传而自动形成。

## 角色与实际材料建议

目录在 `review-scenarios.js`，版本 `target-review-scenarios/0.1`，可调用 `getReviewScenarios()` 获取。以下是用于设计核验的材料建议，不是强制提交清单。

|角色/目标|核心|可能辅助|本轮可执行与限制|
|---|---|---|---|
|公安/政务身份审核 `government_police` / `identity_consistency`|身份证或申请表|已持有的户籍、证明、授权材料|确认同人后比身份号/姓名/日期；中国身份号结构和校验位；不判亲属、户籍、活体或真实身份|
|税务 `government_tax` / `invoice_review`|数电票/发票|合同、订单、付款、验收|格式、价税、中文大小写、同交易矛盾；官方发票查验和抵扣资格未执行|
|公司 `company` / `procurement_review`|采购合同/核心发票|订单、验收单、交货、银行回单|有范围才比较金额和主体；专有验收条款、审批授权未配置|
|个体经营 `sole_trader` / `merchant_reconciliation`|收据/订单/发票|收款凭据、银行流水、退款|明示完整收付款集合计算；佣金、平台手续费和非同期间流水不直接等额|
|大学科研 `university_research` / `research_reimbursement`|科研采购发票/报销单|项目批准、合同、验收、付款、差旅审批|已有字段与集合检查；课题可列支类别、学校额度、差旅上限未配置，不臆造阈值|

公司、个体、大学及税务也可使用 `invoice_review`；具体角色/目标兼容表由目录给出。未知目标、核心材料类型不适用或角色不适用均明确NEI；不会偷偷套用全部规则。

中国身份证/税票/大写金额规则需要材料 `jurisdiction: CN` 或明确的批次CN上下文。ID（印尼）及未确认地区不执行中国专有格式规则；金额和日期仍按独立条件核验。仅“中文文本”不能自动推断税票法域。

依据与适用边界（2026-10-22复核公开来源）：

- [财政部电子凭证会计数据标准推广通知](https://www.mof.gov.cn/jrttts/202505/t20250521_3964264.htm)：支持凭证种类、结构化数据的场景设计；没有据此硬编码报销必交清单。
- [国家税务总局2024年第11号公告](https://fgk.chinatax.gov.cn/zcfgk/c100012/c5236067/content.html)：数电票格式依据，保留既有生效范围和早期试点NEI，不模拟税务数据库。
- [公安派出所出具证明工作的意见（北京政府转载）](https://www.beijing.gov.cn/zhengce/zhengcefagui/201905/t20190522_59518.html)：设计法定证件与证明职责边界，不建议向群众反复索取证件已经能够说明的事项。
- [西北工业大学费用类报销申请参考](https://z.nwpu.edu.cn/info/1702/15369.htm)：仅作历史高校材料场景示例，未把页面历史金额阈值当作现行或其他高校政策。

每次审核保留 `institution_policy: NEI`，直到机构提供适用版本、时间和审核过的规则配置。角色目录不宣称已经完成五套机构制度。

## Word结构证据

`validateBatch` 支持 `representation: docx_text`、`pages: []`。字段来源 `provider: docx_xml`，`location` 直接沿用解析器1起始结构位置：`{part:'word/document.xml',paragraph:1}` 或 `{part,table:1,row:1,cell:1}`。这类来源不得包含伪造的page/polygon，不能当作已取得页图；规则仍可读真实字段，视觉覆盖显示未执行。未渲染的Word检查不会作为整文件完成。

## 阶段实验（已执行）

新记录：`runtime/replay/review-20261022/rules-phase1/rules-experiment.json` 与 `rules-summary.json`。原实验、图片和OCR未改写。复现时必须指定不存在的新输出目录：

```sh
node scripts/image-validation/evaluate-target-review.mjs \
  /sdb/data_public/lvjiawen/aigc_platform \
  /sdb/data_public/lvjiawen/aigc_platform/runtime/replay/review-20261022/rules-phase1-rerun
node --test tests/image-documents-review.test.mjs
```

本轮重新运行规则，复用带图像哈希验证的真实OCR：旧中文公开材料12页、CORD前5页，以及迁移验收中在新服务器真实跑出的中文设备票第一页。总18次样本运行，17张唯一图片；重复的一页不能当作新增数据。没有启动新的模型推理，也没有调用DeepSeek。完整来源、OCR账本哈希和推理所在主机记录在新报告。

|检查|结果|解释|
|---|---|---|
|字段提取|102个，包含重复页10个|不是字段准确率；未知字段保持缺证|
|全部本地规则/覆盖结果|62 PASS，47 NEI，0 FAIL|包括场景适用性与政策未配置；不等于真伪结果|
|印尼5页|0项中国身份号/税票格式检查|中文字段包覆盖不足，保留NEI而非假通过|
|设备票提取后总额加1元|价税与大小写两规则FAIL|合成字段故障，未改原图，不能称检出真实图像篡改|
|10/100/200材料工程测试|星状候选9/99/199|每份一个可比字段，验证无全对组合；不是耗时吞吐承诺|
|重复字段候选|双方各101个同语义字段，仅生成1条NEI|避免字段候选笛卡尔积|

中文材料均已参与既有版式开发，许可和来源沿用[真实中文验证](chinese-validation.md)；不能把政府公开PDF等同可任意重发的授权数据集。CORD遵守[官方数据页](https://huggingface.co/datasets/naver-clova-ix/cord-v2) CC-BY-4.0及项目归属，固定revision保留在报告。其官方test已用于本项目历史诊断，本次不得称独立留出。模型训练重合和真实篡改标签仍不明确。

当前独立留出数量为0。下一阶段应先冻结新的中文同交易核心与辅助材料组、来源/许可/哈希和人工关系标签，再开展提示词优化；开发集、受控故障、留出集分目录记录。优先补充：多次付款与退款、同名不同人、同PDF多票、被委托人和公司不一致但合法的关系，以及核心票据含税金额与合同未税金额场景。

尚未完成的业务覆盖：完整C01–C15/G01–G08、发票行项目/物品数量语义、OCR未知模板、学校/机关真实政策、权威登记与真实性查询。当前规则只能给出有依据的显示内容问题及缺证，不能自行裁定造假、违法或拒绝业务受理。
