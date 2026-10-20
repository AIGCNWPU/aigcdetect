# Proposal

需求章节：2.1 通用AI生成图片检测。负责人：待认领。状态：业务待实现。

## Why

为AI图片检测提供独立的“通用AI生成图片检测”业务能力，当前只完成场景导航与空白页面。

## What Changes

- 单张与批量上传：支持上传单张图片，也可一次提交多张图片，逐张查看检测结果。
- AI生成图片识别：分析图片中的AI生成线索，展示每张图片的来源风险。
- 图片与结果对照：在结果页保留图片预览，方便用户对照原图查看检测结论。
- 批次结果筛选：集中查看批次中的图片，支持按风险情况筛选，快速找到需要关注的图片。
- 图片检测报告：汇总图片、检测结果及相关说明，支持保存和导出。

- 当前网页保持空白；本工作包获准进入业务开发后再实现上述内容。
- 非目标：其他场景业务、成员邀请、生产部署；不在前端存储密钥。
- 完整需求见[需求摘录](../../references/AI检测平台_需求摘录.md)第 6 页。

## Capabilities

### New Capabilities

- `image-general`：通用AI生成图片检测。

### Modified Capabilities

无。

## Impact

场景 `#/image/general`，业务接口 `POST /api/v1/image/general`。复用[公共约定](../define-shared-foundation/specs/shared-foundation/spec.md)，具体请求和结果类型在实现时与公共部分对齐。
