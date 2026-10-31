# academic-detection 前端

来源：`aigcdetect-source.zip`（VERITAS 智鉴）。已整理到本仓库 `frontend/`，默认对接同级 `backend/`（`http://127.0.0.1:8010`）。

## 启动

需要 Node.js >= 20。无第三方 npm 依赖。

```sh
# 终端 1：后端
conda activate academic
cd ../backend
EGTE_DEVICE=cuda:1 bash ./run_api.sh

# 终端 2：前端
cd frontend
npm run dev
```

打开 http://127.0.0.1:4173 ，学术检测场景：`#/text/academic`。

离线预览：`npm run build` 后打开 `dist/index.html`。

## 目录

| 路径 | 说明 |
| --- | --- |
| `src/` | 页面与模块源码 |
| `src/modules/text/pages/academic.js` | 论文/学术稿件检测页 |
| `scripts/` | 本地静态服务与构建 |
| `docs/` | 页面与 API 约定 |
| `dist/` | 构建产物 |

API 基址在 `src/api.js`（`DEFAULT_API_BASE_URL`）。
