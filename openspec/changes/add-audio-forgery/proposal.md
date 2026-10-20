# Proposal

需求章节：4.1 AI音频伪造检测。负责人：待认领。状态：业务待实现。

## Why

为AI音频检测提供独立的“AI音频伪造检测”业务能力，当前只完成场景导航与空白页面。

## What Changes

- 音频上传与试听：支持上传录音或语音文件，在线试听并查看历史检测记录。
- AI合成声音识别：检测语音合成、声音克隆等AI伪造线索，展示音频的整体风险。
- 可疑片段定位：标出疑似伪造片段的起止时间，方便快速找到需要核查的内容。
- 分段试听与核查：支持跳转到可疑片段试听，并结合前后录音进行人工核查。
- 音频检测报告：汇总整体风险、可疑时间段及已检测范围，支持保存和导出报告。

- 当前网页保持空白；本工作包获准进入业务开发后再实现上述内容。
- 非目标：其他场景业务、成员邀请、生产部署；不在前端存储密钥。
- 完整需求见[需求摘录](../../references/AI检测平台_需求摘录.md)第 12 页。

## Capabilities

### New Capabilities

- `audio-forgery`：AI音频伪造检测。

### Modified Capabilities

无。

## Impact

场景 `#/audio/forgery`，业务接口 `POST /api/v1/audio/forgery`。复用[公共约定](../define-shared-foundation/specs/shared-foundation/spec.md)，具体请求和结果类型在实现时与公共部分对齐。
