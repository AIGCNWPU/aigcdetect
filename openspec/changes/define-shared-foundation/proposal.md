# Proposal

负责人：维护者。状态：空框架已接入，公共业务能力待实现。

## Why

为10个检测场景提供一致的导航、场景入口、任务和原材料引用边界，支持多人分别开发并通过PR集成。

## What Changes

- 已有：4个模块、10个独立空白页面、模块服务接入点、501业务接口、构建和检查。
- 待实现：正式身份和权限、文件存储、异步任务、检测结果、版本及报告。
- 非目标：提前实现算法、邀请成员或部署生产环境。

## Capabilities

### New Capabilities

- `shared-foundation`：场景框架及最少公共能力。

### Modified Capabilities

无。

## Impact

公共映射以[design](design.md)为准，业务实现分别归属10个工作包。
