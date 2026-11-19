# 统一部署

主应用使用 Node.js 22.13 及以上版本（现网运行时22.23.4），从源码构建dist后执行`node scripts/serve.mjs --dist`。账号使用`node:sqlite`，数据库放在`VERITAS_DATA_DIR/app.db`，不要将数据库或真实配置提交到Git。

## 主应用与已有模型服务

| 环境变量 | 用途 |
| --- | --- |
| BIND_HOST、PORT | 网关监听地址与端口 |
| NODE_ENV=production | 生产运行标记 |
| VERITAS_PUBLIC_ORIGIN | 售后服务允许的准确HTTPS站点来源；例如`https://aigcdetect.online`，未配置时只接受回环地址 |
| PROXY_BACKEND=1、BACKEND_URL | 学术API代理 |
| AUDIO_SERVICE_URL | 音频服务；浏览器访问同源`/api/v1/audio/health`与`/api/v1/audio/forgery` |
| IMAGE_GENERAL_SERVICE_URL、IMAGE_DOCUMENTS_SERVICE_URL | 可选的独立图片/材料服务；不配置时使用仓库内实现 |
| VIDEO_GENERAL_SERVICE_URL、VLAFORGE_SERVICE_URL | 通用视频与换脸服务 |
| VERITAS_REFUND_CONFIG、VERITAS_VIDEO_CONFIG | 售后私有配置文件 |
| VERITAS_DATA_DIR | 持久账号、会话和检测记录 |
| VERITAS_COMMIT、VERITAS_RELEASE | `/api/v1/version`展示的部署版本 |

文字模型、EGTE和网页导入配置见根目录`.env.example`。密钥仅留在服务器。独立模型服务和模型资产不随网页构建重复加载；调整GPU服务前确认共享卡资源与服务归属。

## 发布与回滚

先对旧应用、启动配置和私有配置做受限权限备份，并通过SQLite backup接口生成一致的数据库副本。模型权重、未修改的Python环境可保留原路径并登记，避免重复占用数据盘。

在新的版本目录恢复服务器私有配置并安装依赖，在隔离端口运行全部测试、构建与业务验收。验收应分别记录真实推理、静态示例及失败状态；健康接口成功不代表模型任务完成。

确认后再切换网关进程，保持域名隧道入口和数据目录稳定。旧版本目录保留，回滚时重启旧版本启动脚本即可；只有明确需要回退数据时才恢复数据库备份，避免覆盖发布后产生的账号数据。

生产发布不应覆盖其他同学的工作区，不应把旧站整份前端覆盖到新主分支，也不应把私密配置写进发布说明。
