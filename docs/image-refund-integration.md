# 2.2 案件资料与图片整理

本轮只实现资料填写、多图选择/拖拽、校验、缩略图、大图预览和移除。内容仅在当前页面内存中，刷新或离开不恢复。不含AI检测、区域标注、结果汇总或服务器保存。

## 使用

运行 `npm run dev`，打开 `http://127.0.0.1:4173/#/image/refund`。案件编号、商品名称、问题描述为提交必填；款式和补充资料可选。添加JPG/PNG/WebP图片，单张最大5 MiB、最多10张、单图最多4000万像素。文件扩展名、声明类型、内容签名和浏览器解码均检查；无效文件逐项提示，有效图片继续加入。

默认点击“提交材料”只提示后端未接入，不发送资料。所有服务端业务入口仍返回501。

## 后端接入位置

页面使用 `src/modules/image/refund/submission.js` 中的 `refundSubmission`。前端准备好后，在启动代码中配置一次适配函数（不要把生产密钥放到前端）：

```js
import { refundSubmission } from '../src/modules/image/refund/submission.js';

// 以下URL仅为示例：由后端接入者替换，不是本PR新增的服务。
refundSubmission.configure(async ({ fields, files }, { signal }) => {
  const body = new FormData();
  body.set('fields', JSON.stringify(fields));
  for (const file of files) body.append('images', file, file.name);
  const response = await fetch('/your-material-upload-endpoint', {
    method: 'POST', body, signal, credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('材料提交失败，请稍后重试。');
  const data = await response.json();
  // 在此映射真正的后端响应，必须有明确接收回执。
  return { accepted: data.accepted === true, receiptId: data.receiptId };
});
```

进入页面后也可通过 `window.Veritas.refund.configure(handler)` 配置。传入 `null` 恢复未接入状态。现有 `POST /api/v1/image/refund` 还是JSON场景占位，不能直接发送上述FormData就认为已接入；需由后端实现者对齐上传、权限和场景请求协议。

适配输入：

| 项目 | 类型与含义 |
| --- | --- |
| `fields.caseNumber` | 案件编号文本，1—100字符 |
| `fields.productName` | 商品名称文本，1—200字符 |
| `fields.style` | 款式文本，可空，最多200字符 |
| `fields.productInfo` | 商品资料文本，可空，最多2000字符 |
| `fields.description` | 问题描述文本，1—2000字符 |
| `files` | 通过前端校验的File数组，非远程文件引用 |
| `signal` | 页面离开时取消请求的AbortSignal；适配器应传给底层请求 |

这些是场景内部适配数据，不替代公共案件/文件/版本协议。后端仍需独立校验输入与权限。适配器只有返回 `{ accepted: true, receiptId: '非空回执' }` 才显示材料已接收，不表示已检测。失败恢复编辑；提交时禁用编辑和重复提交，不清空原始资料。

提交等待期间允许点击导航离开页面；尚未完成时发送取消信号、结束前端等待并释放提交锁和预览资源，迟到回执不会更新新页面。适配器应将signal传给实际上传请求；前端取消不等于撤销服务器已经接收的材料。

## 自动与浏览器自检

```powershell
npm ci
npm run check
npm test
npm run build
npx --yes --package @fission-ai/openspec@1.13.1 openspec validate --all --strict --no-interactive
```

可选浏览器验收脚本不增加项目运行依赖，将固定版本的工具装在已忽略的tmp目录：

```powershell
npm install --prefix tmp/browser-check --no-save --package-lock=false playwright@1.56.1
node tests/image-refund.browser.mjs
$env:REFUND_TEST_DIST='1'
node tests/image-refund.browser.mjs
Remove-Item Env:REFUND_TEST_DIST
```

默认使用本机Edge。其他系统可安装该工具的Chromium并设置 `BROWSER_CHANNEL=chromium`。脚本启动临时本地服务，生成一张标明测试用途的图片，验证填写、混合无效文件、拖拽、特殊字符文件名、大图/焦点、移除、未接入提示、刷新清空及390px窄屏；输出截图后自动关闭服务与浏览器。

## 验证记录

2026-10-21：最终Node测试14项全部通过（原框架5项＋本功能9项）；npm ci、项目检查、构建与离线包语法检查通过；OpenSpec 1.13.1严格校验11项通过；构建版HTTP冒烟验证页面资源、目录及10个明确501接口通过；git diff --check通过。源码版和构建版Edge浏览器验收均通过，覆盖空/损坏/超限文件、10张上限、拖拽、预览与焦点、移除、资料保持、提交状态、离开取消、URL释放及刷新清空。桌面1440px、窄屏390px无横向溢出，控制台无异常。独立只读代码检查未发现具体待修复问题。真实后端/算法不属于本轮验证。

- [桌面截图](screenshots/image-refund-desktop.png)
- [窄屏截图](screenshots/image-refund-mobile.png)

开发过程中先运行新增测试观察到材料模块缺失和空页面无法填写的失败，再实现相应功能使其通过。后续变更按失败复现与全量回归处理。

自检补充：提交过程中离开页面、适配器不响应取消时，原实现会保留提交锁。新增用例复现失败后修复为取消与响应竞速，迟到回执不接收；14项全量测试及浏览器离开页面用例均通过。

## 交付记录

2026-10-21：功能提交 `ad7b151fba99022e48e255f72ff7e1ba1ef85170` 已推送个人分支 `codex/image-refund`，代码与四份OpenSpec已一同更新至 [PR #1](https://github.com/AIGCNWPU/aigcdetect/pull/1)。该提交的 [push检查](https://github.com/AIGCNWPU/aigcdetect/actions/runs/39539705057) 和 [PR检查](https://github.com/AIGCNWPU/aigcdetect/actions/runs/39539709677) 均为success。PR保留开放，等待组长合并；2.2其余能力、真实后端及工作包归档未完成。
