# Tasks

- [x] T1 常驻推理守护进程 inference_daemon.py（DDA+SEED 加载、/health /mirror /seed）
- [x] T2 local-runtime/general-service 优先调用常驻服务、不可达回退 spawn
- [x] T3 deploy/aigc-inference.service systemd unit + 正式服务器部署长挂起
- [x] T4 截图两前端 + DeepSeek flash 文案审查，意见落 design 附录
- [x] T5 2.3 前端：核验功能收敛 + 新增小票核验预选 + 材料类型默认自动
- [x] T6 2.3 结果页重构：智能复核放大置顶、通过项统计化、字段/阶段默认折叠、去重陈述
- [x] T7 2.1 前端同步简化；示例区移至 Benchmark 之上
- [x] T8 MCP 调研文档 mcp-integration.md
- [x] T9 MCP server（市场 API 同源映射 5 工具，stdio+HTTP）
- [x] T10 回归（node/pytest/check/build/openspec）+ 三端同步 + 正式服务器部署验收

- [x] T11 四类核验入口、智能选择、辅助文案删减及前后端目的兼容
- [x] T12 图层状态保持、逐文件删除/全部清空、智能核查证据三列及浏览器回归
- [x] T13 正式服务与DDA-H+核验、修复重复平台实例、同步正式GitHub工作分支及部署验收

本轮 T11–T13 验证记录：[2.3 界面与正式部署核查](../../../docs/image-workstream/documents-ux-acceptance-20261120.md)。

- [ ] T14 修复干净检出时 fflate 浏览器资源缺失，验证源码/构建访问并同步双仓库 CI
