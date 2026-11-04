# 正式 GPU 服务器迁移记录（2026-11-03）

## 范围与目录

迁移 `ljw/image-review-20261102` 当前工作区，包含尚未提交的前端示例、100张/ZIP上传、资源队列与结果导航修改。保留Git历史与工作区状态，不合并主分支，不提交或推送GitHub。

目标账号数据盘根目录以 `$USER_DATA` 表示：

- 代码与运行记录：`$USER_DATA/projects/aigc_platform/project`、`runtime/`、`migration/`。
- 当前模型：`$USER_DATA/models/aigc_platform/{dda_hplus,seed,ocr}`。
- Python环境：`$USER_DATA/conda/envs/aigc-{mirror-runtime,seed-runtime,ocr-runtime}`。保留现有Python 3.10依赖，使用随迁移的独立解释器，属于venv环境而非新建Conda环境。
- 缓存：`$USER_DATA/cache/aigc_platform`。
- 数据集目录：`$USER_DATA/datasets/aigc_platform`。历史回放保留在运行记录中；未将其他账号的大型共享数据集整体复制。

`runtime/activate.sh` 显式设置项目根目录、Node/OpenSpec路径和缓存路径。`weights`、`datasets`、`runtime/cache`、`runtime/envs` 通过链接兼容现有代码路径。

## 传输与安全边界

通过用户亲自在终端完成的SSH登录复用连接；不记录密码，不读取或输出API密钥或账号认证文件。按用户本次明确授权，API配置通过SSH原样复制至目标项目并设置0600；不读取或输出密钥内容。传输使用rsync续传，不执行删除操作。

当前工作区是Git worktree，不能复制 `.git` 文本指针作为独立仓库。使用Git bundle恢复历史，然后恢复索引基线，保持未提交代码及未跟踪文件。SEED源码单独恢复固定Git版本，用于其启动时版本检查。

Python环境中的解释器链接、pyvenv.cfg与命令入口更新为目标路径；原始历史实验记录不替换绝对路径。验收生成新的清单和报告。

## 验收要求

1. rsync checksum比较代码、权重及运行资产，原环境重定位改动单独记录。
2. Python导入、pip check、Node构建、项目测试、OpenSpec 1.13.1严格校验。
3. 重新查询空闲GPU，单卡依次执行DDA-H＋分类和区域诊断、SEED定位；执行真实中文发票OCR和PDF解析。
4. 前端通过实际服务访问并检查异步接口。静态示例正常不等于模型推理验收通过。
5. 外部API、LibreOffice Word渲染、其他成员场景与未迁移的大型数据集独立列出状态，不计入本次图片链路已通过项。

本文件为迁移方案与验收清单；最终状态以 `runtime/replay/formal-validation-20261103/summary.json`、`dda-cpu-result.json`、`gpu-acceptance-status.json` 和迁移核对日志为准。

## 本次部署状态

- 15组代码、权重、解释器、依赖和回放资产内容校验通过。venv入口和pyvenv.cfg属于明确记录的路径重定位，不要求与旧路径逐字相同。
- 498项项目测试、check/build/smoke通过；明确固定OpenSpec 1.13.1，11项严格校验通过。启动PATH优先选择固定版本，避免Node全局工具中的其他版本抢先。
- 三个Python环境pip check和核心导入通过，PyTorch 2.6.0+cu124识别CUDA。
- 中文发票实际OCR成功；PDF单页解析完成；DOCX真实调用私有LibreOffice 26.2.6.3，完成一页PDF/图像渲染。
- DDA-H＋实际CPU推理成功：score=0.9492493867874146，与源端固定原图结果差2.384185791015625e-7。此项不冒充GPU或区域响应验收。
- 一次真实Agent SDK智能核验会话成功，使用合成脱敏材料；SDK记录5轮、4次工具调用、3957输入token和2273输出token。未上传真实原图或OCR原文。
- 正式服务HTTP及页面检查通过，通用图片静态示例加载、材料工作台均正常；私有配置和服务端源码的HTTP访问返回404。
- DDA-H＋完整GPU检测通过：score=0.9492489695549011，6处区域响应；SEED真实定位通过：score=0.9971495270729065，43处候选区域。候选区域数记录运行结果，不等同于定位准确率。
- 受限显存实测：DDA峰值预留约3.65 GiB，SEED约2.35 GiB。正式服务器显式配置至少12 GiB空闲才启动、PyTorch分配上限8 GiB；动态选卡，资源不足继续排队。代码默认仍保留24000 MiB门槛，其他环境不随此次部署降低门槛。
- 后台独立GPU验收已完成；无需继续运行等待任务。
- 正式服务真实上传接口验收通过：POST /api/v1/image/general返回queued，随后轮询至completed；score=0.9492489695549011，完整保存诊断与区域响应结果（http-upload-result.json）。这次通过正式服务而非直接执行模型脚本。

## 启动与访问

代码目录为`$USER_DATA/projects/aigc_platform/project`，平台根目录为其上级。模型、缓存和环境仍位于规定的独立数据盘目录。服务监听`127.0.0.1:4184`，不直接公开未登录的材料接口。

服务使用当前账号的systemd用户服务，已启用linger，退出SSH后继续运行：

```bash
systemctl --user status aigc-platform.service
systemctl --user restart aigc-platform.service
```

在本地电脑终端通过SSH转发远端4184端口，浏览器打开本地转发端口的`/#/image/general`或`/#/image/documents`。也可使用VS Code端口面板转发4184。

目标日志位于`runtime/logs/server.log`和`runtime/logs/gpu-acceptance.log`；验收目录为`runtime/replay/formal-validation-20261103/`。旧MIRROR/DocShield对照权重和其他账号的共享大数据集不属于当前上线推理依赖，未作为本次运行资产迁移。其他成员业务后端未做模型推理验收。
