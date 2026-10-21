# 3.3 首轮：案件与视频材料整理

负责人④闭耀松；需求3.3；统一分支 `bys/image-video-aftersales` 同时承载2.2图片与3.3视频售后凭证检测。用户于2026-10-21确认首轮范围并授权开发、自检、提交PR。

## 已交付与后续范围

首轮交付01的前端：案件资料、选择/拖拽MP4和WebM、逐项校验、视频列表、原生播放/暂停/定位、切换与移除、提交适配入口。每案最多5个视频，单个不超过200 MiB、10分钟；这些是已确认的本场景前端限制，不是公共协议。格式检查在有界读取内遍历MP4文件头（最多64个box），并验证WebM的EBML DocType（头部读取上限64 KiB）；首帧解码通过不保证视频后续帧没有损坏，播放失败仍提供提示。

02 AI来源检测、03修改线索及片段定位、04商品描述核对、05图视频汇总尚待后续增量；真实上传、存储、服务端取消、历史记录和报告导出未接入。与2.2共用分支不代表已共享案件；不得用相同的显示案件编号推断公共案件关联。完整目标保留在[OpenSpec](../openspec/changes/add-video-aftersales/specs/video-aftersales/spec.md)。

## 页面和数据

- 入口 `#/video/aftersales`；[页面](../src/modules/video/pages/aftersales.js)、[材料管理](../src/modules/video/aftersales/materials.js)、[提交适配](../src/modules/video/aftersales/submission.js)。
- 案件编号100、商品名称200、问题描述2000字符为必填；商品款式200和商品资料2000字符为选填。校验去除首尾空白。页面DOM使用文本方式显示文件名及服务反馈。
- 文件仅存于当前页内存与对象URL，不自动上传，也不做base64复制或转码。离开或刷新需要重新填写并选择文件。
- 每次仅一个活动播放器；切换、移除、离开均先暂停卸载，移除和离开回收URL。后台校验临时video在首帧就绪后卸载。读取超时15秒，离开主动中断读取。
- 提交期间锁定资料、添加和移除，仍允许播放、切换及导航。未完成提交离开会传递取消信号并立即释放前端锁；适配器迟到回执被忽略，失败保留材料供重试。

## 后端接入

在场景初始化后调用 `window.Veritas.videoAftersales.configure(handler)`，或在客户端模块中导入单例 `aftersalesVideoSubmission`。这里是场景内适配接口，未变更公共service/contracts；需由后续适配器对齐[公共约定](../openspec/changes/define-shared-foundation/specs/shared-foundation/spec.md)的权限、案件与材料引用及版本。

```js
window.Veritas.videoAftersales.configure(async (snapshot, { signal }) => {
  // snapshot.fields: { caseNumber, productName, style, productInfo, description }
  // snapshot.videos: [{ id, file: File, duration: 秒, width, height }]
  // 调用真实上传服务并传递signal；将服务端接收回执映射到下面形态。
  const receipt = await uploadAftersalesMaterials(snapshot, { signal });
  return { accepted: receipt.accepted, receiptId: receipt.id };
});
```

上例的 `uploadAftersalesMaterials` 需由后端接入方实现。适配器接收独立字段/视频记录快照，File引用保留，临时URL不进入提交。只有 `accepted === true` 且非空字符串receiptId才显示“材料已接收”；不代表完成检测。默认未配置不发请求；`configure(null)`恢复默认。取消前端等待不等于撤销已上传内容，真实服务需支持signal及服务端幂等/取消语义。

## 实际自检（2026-10-21）

测试采用先失败后实现：材料/提交6个测试首次因功能缺失失败，页面测试首次因没有表单失败，再实现后全部通过。

- `npm test`：34项通过，含新[材料与提交测试](../tests/video-aftersales.test.mjs)6项。覆盖格式/大小/必填/长度、时长600秒边界和超限、无效尺寸、混合失败、并发数量、移除/迟到读取释放、无适配器、快照、回执、重复提交与取消重试。
- [浏览器脚本](../tests/video-aftersales.browser.mjs)：使用真实[测试素材](../tests/fixtures/README.md)，在Edge桌面1440px与窄屏390px验证MP4/WebM播放和定位、切换/移除、拖放、恶意文件名按文本显示、损坏签名/截断媒体、空文件、数量限制、未接入不请求、失败重试、有效回执、提交中离开取消、迟到回执忽略、合法free前置MP4、Matroska改名WebM拒绝、15秒超时、读取中离开回收URL。测试回执只由测试注入，产品不内置模拟服务。
- 浏览器源码和构建版均运行；2.2原有四套浏览器脚本回归，保留案件/检测/核对/汇总/页签行为。
- 项目语法与文档链接检查、构建及构建包语法、HTTP冒烟和11项OpenSpec严格校验记录在本次交付中；远程CI在PR提交后核实。
- 独立代码审查发现的两处格式边界已修复：MP4不再假设ftyp必须在首box，WebM不再只校验共用EBML魔数；增加真实媒体回归后通过。

复现命令（浏览器脚本使用与2.2相同的可选Playwright环境）：

```powershell
npm test
npm run check
npm run build
node --check dist/assets/app.js
node tests/video-aftersales.browser.mjs
$env:REFUND_TEST_DIST='1'
node tests/video-aftersales.browser.mjs
Remove-Item Env:REFUND_TEST_DIST
npx --yes --package @fission-ai/openspec@1.13.1 openspec validate --all --strict --no-interactive
```

截图为自动测试的本地图案及测试回执，不是检测结果：[桌面](screenshots/video-aftersales-desktop.png)、[窄屏](screenshots/video-aftersales-mobile.png)。

## 交付状态

代码与四份OpenSpec一起提交统一分支PR，替代原 `bys/image-refund` 的PR #2；保留历史提交。由组长合并，不提前归档3.3完整工作包。已提交[统一PR #3](https://github.com/AIGCNWPU/aigcdetect/pull/3)，旧PR #2因远程分支改名自动关闭且未合并。功能提交 `a3c6af4` 的[PR CI](https://github.com/AIGCNWPU/aigcdetect/actions/runs/39562300736)和[push CI](https://github.com/AIGCNWPU/aigcdetect/actions/runs/39562290043)均成功；后续文档记录提交以[PR最新检查](https://github.com/AIGCNWPU/aigcdetect/pull/3/checks)为准。
