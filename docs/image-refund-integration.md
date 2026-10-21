# 2.2 案件资料与图片整理

已实现资料填写、多图选择/拖拽、校验、缩略图、大图预览和移除，以及AI生成/局部篡改检测、商品与描述核对和案件风险汇总前端。内容仅在当前页面内存中，刷新或离开不恢复；真实检测算法和服务器保存仍待接入。

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
node tests/image-refund-detection.browser.mjs
node tests/image-refund-review.browser.mjs
$env:REFUND_TEST_DIST='1'
node tests/image-refund.browser.mjs
node tests/image-refund-detection.browser.mjs
node tests/image-refund-review.browser.mjs
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

## AI生成与局部篡改接入

`src/modules/image/refund/detection.js` 导出 `refundDetection`，进入页面后也可使用 `window.Veritas.refundDetection`。这是独立于材料接收回执的检测适配器；接收材料不代表检测完成。`configure({ai, tamper, comparison})` 配置三类函数，`configure(null)` 清除配置；配置整体替换，处理中须先取消。可只配置部分函数，但用户须选择已接入的项目。未配置时点击检测只给出反馈，不请求现有501接口、不生成结论。

每次调用接收 `{fields, image: {id, file, width, height}}` 和 `{signal}`，其中fields是本次资料快照，image.id仅为当前页面的图片关联标识。适配器须将signal传到底层上传/请求；如果真实服务先创建任务，应在适配器内完成可取消的等待或轮询，返回最终结果。本轮未实现公共任务服务。

```js
import { refundDetection } from '../src/modules/image/refund/detection.js';

// 替换为实际服务地址，并在此处映射公共文件、案件、任务与结果协议。
async function detect(url, { fields, image }, { signal }) {
  const body = new FormData();
  body.set('fields', JSON.stringify(fields));
  body.set('imageId', image.id);
  body.set('image', image.file, image.file.name);
  const response = await fetch(url, { method: 'POST', body, signal });
  if (!response.ok) throw new Error('检测失败，请稍后重试。');
  return response.json(); // 须映射成下表的内部结果形态，且保持实际图片关联。
}
refundDetection.configure({
  ai: (input, options) => detect('/your-ai-endpoint', input, options),
  tamper: (input, options) => detect('/your-tamper-endpoint', input, options),
  comparison: (input, options) => detect('/your-comparison-endpoint', input, options),
});
```

| 返回字段 | 前端适配要求 |
| --- | --- |
| imageId / kind | 必须分别匹配输入图片id和本次检测类型ai或tamper，错图或错类型拒绝展示 |
| risk | low / medium / high / unknown，分别显示低/中/高风险/无法判断；由服务给出，不在前端推断概率或阈值 |
| summary | 非空结果说明，最多4000字符，按文本显示 |
| coverage / scope | full或partial，以及非空实际处理范围说明（最多2000字符）；部分覆盖不代表整图已检测 |
| regions | tamper必需，最多100项；空数组表示没有可定位区域，不能由此推断安全 |
| regions[].id / type | 唯一非空区域id（最多100字符）；add / replace / splice / remove / unknown，分别为添加/替换/拼接/消除/未分类 |
| regions[].description | 非空区域说明，最多2000字符，按文本显示 |
| regions[].box | x、y、width、height为0—1归一化矩形，左上原点，宽高大于0，矩形不能超出图片 |

区域坐标必须对应浏览器显示方向的原图（包含旋转方向处理）；服务如在裁剪、缩放图上检测，适配器应先映射回原图，再归一化。前端在无裁切的原图容器上按百分比定位，支持框/区域按钮双向选择及标注开关。

前端逐项处理图片与检测类型，显示实际的排队、检测中、完成、失败和取消，不模拟百分比。单项60秒超时并取消该请求；失败不阻断其他项，可单独重试。取消/离开向服务发出AbortSignal并立即结束前端等待，迟到响应忽略；这不等于撤销服务器已经执行的任务。材料提交和检测互斥，检测期间冻结编辑，仍允许逐图核查、取消和导航离开。

案件资料变化使当前结果失效；新增图片保持未检测，已存在图片结果保留；移除图片清理其结果。历史版本、后台任务持久化和案件共享引用仍待公共服务对接。

## 第二轮验证记录

开发先运行新增Node用例，确认检测模块缺失时失败；先运行新增浏览器验收，确认检测工作区缺失时失败，再实现功能。验收数据由测试脚本通过适配入口注入，仅用于自检；正式页面与构建包不含这些样例或演示开关。

2026-10-21：22项Node测试全部通过（原14项＋本轮8项）。源码版与构建版Edge检测验收通过：两类结果独立、部分覆盖、区域框位置、框/按钮双向选择与键盘操作、标注开关、单项失败重试、新图/移除/编辑关联、取消及导航离开、1440px桌面与390px窄屏。原材料整理浏览器回归通过，构建与包语法检查、构建版HTTP冒烟、OpenSpec全量11项严格校验通过。

独立只读代码审查发现重复同步相同输入可能丢失在途结果：新增用例先复现“检测结束仍为running”，修复为保留同一材料条目的对象关联后，22项全量测试及源码/构建版浏览器回归均通过。真实后端、算法准确率及公共任务联调不在本轮验证范围。

- [检测工作区桌面截图（测试数据）](screenshots/image-refund-detection-desktop.png)
- [检测工作区窄屏截图（测试数据）](screenshots/image-refund-detection-mobile.png)

第二轮功能提交 `b97b8b91bd151dd1ae388558272599af0852743a` 已推送 `codex/image-refund` 并更新 [PR #1](https://github.com/AIGCNWPU/aigcdetect/pull/1)。该提交的 [push检查](https://github.com/AIGCNWPU/aigcdetect/actions/runs/39542414690) 与 [PR检查](https://github.com/AIGCNWPU/aigcdetect/actions/runs/39542417768) 均为success；PR包含代码、四份OpenSpec、接入说明和截图，保持开放待组长合并。

## 商品核对与案件汇总接入

检测选择增加“商品与描述核对”，默认保持原AI/篡改两项选择，用户按需勾选核对。`comparison` 与其他适配器使用相同输入 `{fields, image}` 和 `{signal}`、逐图状态、60秒超时、取消和单项重试。它独立于AI来源与篡改结果，不需要先获得另外两类结果，也不以来源风险推断商品是否一致。

| comparison返回字段 | 要求 |
| --- | --- |
| imageId / kind | 对应输入图片id，kind固定为comparison |
| summary | 非空核对概述，最多4000字符 |
| coverage / scope | full或partial，实际核对范围非空且最多2000字符 |
| checks | 恰好3项，dimension分别为appearance、style、issue，不可重复或缺项 |
| checks[].outcome | match、mismatch、unknown，对应一致、不一致、无法判断 |
| checks[].observed | 图片观察内容，非空且最多2000字符；无法看清时也须说明可见性限制 |
| checks[].evidence | 判断依据，非空且最多2000字符；不足以判断时解释原因 |

参照资料由前端从本次输入快照生成：商品外观对应商品名称与补充资料，款式对应style，问题现象对应description。服务不能重写用户资料；缺少款式参照时style项只能返回unknown，否则拒绝该张图片的核对结果。所有返回文字按文本展示，编辑资料即失效旧结论；新增/删除图片、取消、重试与其他两类遵循同一生命周期。

案件风险汇总不新增服务请求。`case-summary.js` 从同一会话计算逐图清单，`case-summary-view.js` 展示三类状态、风险、区域与待核对项；“三项完整处理”仅统计三项均成功且full的图片数量，不代表低风险或售后审核通过。无结果、失败、取消、部分覆盖均不计入该数量。

筛选规则：需关注含中/高/未知AI或篡改风险、可定位篡改区域、不一致或无法判断的核对项；未完成或部分覆盖含任一类未成功或partial；失败或已取消单独筛选。分类互有重叠，不把筛选为空解释为案件安全。展开区域清单可跳回原图对应框，核对详情跳至该图对照表；两者都移动焦点，区域跳转会恢复标注显示。未提供案件总风险评分、自动处理决定、导出、服务器保存或历史版本。

## 第三轮验证记录

新增核对与汇总Node测试先因缺少模块失败，新增浏览器验收先因缺少案件汇总页面失败，再实现功能。测试数据仅从测试脚本注入，正式页面无样例结论或演示开关。

2026-10-21：28项Node测试全部通过（原22项＋本轮6项）。源码版与构建版Edge验收通过：三项参照/观察/依据/结论、独立失败重试、部分覆盖、汇总分类和筛选空态、图片/区域/核对详情定位、资料编辑失效、新增/移除图片、导航取消及迟到响应忽略。1440px桌面与390px窄屏均无横向溢出，浏览器无页面异常；原材料整理与两类检测浏览器回归通过。

独立只读审查发现刷新时区域清单收起、跳转详情焦点丢失两项问题；新增浏览器断言先复现失败，再保存区域展开状态并补齐稳定焦点标识。修复后源码/构建验收及独立Edge复核通过，包括筛选隐藏再显示保留展开状态、移除/失效清理状态。

项目检查、构建、构建包语法检查、构建版HTTP冒烟（10个预留接口明确返回501）、OpenSpec全量11项严格校验及git diff --check通过。真实后端、算法准确率、公共任务和历史版本联调仍未验证，完整业务验收与归档继续待办。

- [商品核对桌面截图（测试数据）](screenshots/image-refund-review-desktop.png)
- [商品核对窄屏截图（测试数据）](screenshots/image-refund-review-mobile.png)
- [案件汇总桌面截图（测试数据）](screenshots/image-refund-summary-desktop.png)
- [案件汇总窄屏截图（测试数据）](screenshots/image-refund-summary-mobile.png)
