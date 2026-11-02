# Spec Delta

## Purpose

为单张和批量图片提供可追溯的AI来源检测、原图对照、筛选与报告，使用户能够区分模型实际结果、检测范围、失败和未执行情况，并供其他场景按材料版本复用。

## ADDED Requirements

### Requirement: 单张与批量上传
系统 SHALL 提供“单张与批量上传”能力：支持上传单张图片，也可一次提交多张图片，逐张查看检测结果。

#### Scenario: 单张与批量上传的正常使用
- **WHEN** 用户在“通用AI生成图片检测”场景提交该操作所需的有效材料并执行操作
- **THEN** 系统完成上述对应处理，并将结果或必要状态关联到原材料与本次操作

#### Scenario: 批次含不可读取图片
- **WHEN** 同批包含有效图片与损坏或超出已配置限制的文件
- **THEN** 逐项记录错误及原因，其他有效图片保留实际处理结果，不将整批显示为全部成功

### Requirement: AI生成图片识别
系统 SHALL 提供“AI生成图片识别”能力：分析图片中的AI生成线索，展示每张图片的来源倾向、模型分数、模型版本和处理范围；未经校准的分数不得宣称为现实真实性概率。

#### Scenario: AI生成图片识别的正常使用
- **WHEN** 用户在“通用AI生成图片检测”场景提交该操作所需的有效材料并执行操作
- **THEN** 系统完成上述对应处理，并将结果或必要状态关联到原材料与本次操作

#### Scenario: 模型未就绪
- **WHEN** 所需模型未加载、资产缺失或推理失败
- **THEN** 标明不可用或失败，不产生随机分数、模拟成功或低风险结论

### Requirement: 图片与结果对照
系统 SHALL 提供“图片与结果对照”能力：在结果页保留实际输入版本的图片预览，方便用户对照原图查看检测结论，不将生成的修复图作为未知真实原作。

#### Scenario: 图片与结果对照的正常使用
- **WHEN** 用户在“通用AI生成图片检测”场景提交该操作所需的有效材料并执行操作
- **THEN** 系统完成上述对应处理，并将结果或必要状态关联到原材料与本次操作

### Requirement: 批次结果筛选
系统 SHALL 提供“批次结果筛选”能力：集中查看批次中的图片，支持按风险情况和处理状态筛选；失败或未执行项不得归入低风险。

#### Scenario: 批次结果筛选的正常使用
- **WHEN** 用户在“通用AI生成图片检测”场景提交该操作所需的有效材料并执行操作
- **THEN** 系统完成上述对应处理，并将结果或必要状态关联到原材料与本次操作

### Requirement: 图片检测报告
系统 SHALL 提供“图片检测报告”能力：汇总图片、检测结果、模型版本、处理范围及失败或未完成项，支持保存和导出，并保留所用材料版本。

#### Scenario: 图片检测报告的正常使用
- **WHEN** 用户在“通用AI生成图片检测”场景提交该操作所需的有效材料并执行操作
- **THEN** 系统完成上述对应处理，并将结果或必要状态关联到原材料与本次操作

### Requirement: 失败与修订保持真实状态
系统 MUST 遵守[公共约定](../../../define-shared-foundation/specs/shared-foundation/spec.md)，区分未检测、失败、覆盖不足和实际结果；输入修订后不得沿用旧材料结果作为新结果。

#### Scenario: 处理失败
- **WHEN** 材料不可读取或业务服务处理失败
- **THEN** 显示明确失败或缺项，不输出伪造的成功报告或低风险结论

#### Scenario: 原材料已更新
- **WHEN** 用户修改或替换原材料后查看历史结果
- **THEN** 结果保留原材料或版本关联，并提示重新检测，不静默替换为新材料的检测结论

### Requirement: 跨场景来源结果复用
系统 SHALL 允许证件票据及售后场景按有权限的材料版本引用通用来源结果，保留结果来源、覆盖范围和版本，不要求先完成其他场景的页面或业务流程。

#### Scenario: 证件或售后引用结果
- **WHEN** 场景引用已完成的通用图片来源检测
- **THEN** 返回对应材料版本的真实结果，并将来源风险与该场景自己的篡改或字段核对问题分别表达

### Requirement: 可追溯的用户诊断展示
系统 SHALL 采用用户指定DDA H+发布模型，保留原336中心裁剪与FP32推理；新增真实HTTP检测、来源元数据、官方C2PA离线验证、压缩差异与高频残差诊断、双遮挡敏感性区域。热图记录原分数及遮挡分数，固定阈值0.05且两种遮挡均超过才标记，后台留存分类响应方法和实际中心检测范围；客户界面按2026-11-01精简方案展示。元数据缺失、C2PA不存在不计入AI风险。凭证的签名/内容绑定/信任状态分别保存，禁止远程凭证抓取。新增真实数据集示例与报告导出。

#### Scenario: 上传检测或查看示例
- **WHEN** 用户上传材料或选择明确标注的冻结示例
- **THEN** 显示对应真实结果和证据，范围保留在后台记录，示例不触发模型调用，失败不产生模拟成功


### Requirement: Customer facing detection copy
The interface SHALL present concise detection results without crop-boundary overlays or internal diagnostic thresholds.

#### Scenario: Customer reads detection results
- **WHEN** a customer opens image detection results
- **THEN** no crop-range text or repeated score disclaimers are shown, and general-image highlights are labeled 疑似AI成图区域


### Requirement: Complete real examples and benchmark data
系统 SHALL 提供有原图且各阶段已执行的材料示例，通用图片示例直接可见，基准比较仅使用用户指定的八子集TPR实测数值。

#### Scenario: Visitor opens image workbenches
- **WHEN** 用户进入图片工作台
- **THEN** 可直接看到实测案例图片与结果，材料案例包含实际视觉与智能核验，基准表保留真实排名和指标名称

### Requirement: 20261102 流程与展示修订
系统 SHALL 将对比方法展示为智鉴、方法1、方法2、方法3，列名为生成模型；不显示本地实测标签、介绍句或内部排序说明。

#### Scenario: 新流程验收
- **WHEN** 用户提交材料或查看评测结果
- **THEN** 用户浏览评测表时，八行成绩及真实最大值样式保留，算法内部名称不显示。
