# 3.3 售后视频凭证前端与后端接入

负责人④闭耀松；需求3.3；统一分支 `bys/image-video-aftersales` 同时承载2.2图片与3.3视频售后凭证检测。用户于2026-10-21确认首轮范围并授权开发、自检、提交PR。

## 已交付与后续范围

首轮交付01的前端：案件资料、选择/拖拽MP4和WebM、逐项校验、视频列表、原生播放/暂停/定位、切换与移除、提交适配入口。每案最多5个视频，单个不超过200 MiB、10分钟；这些是已确认的本场景前端限制，不是公共协议。格式检查在有界读取内遍历MP4文件头（最多64个box），并验证WebM的EBML DocType（头部读取上限64 KiB）；首帧解码通过不保证视频后续帧没有损坏，播放失败仍提供提示。

第二轮经本人确认，已补齐02 AI来源检测、03修改线索及片段定位、04商品描述核对、05图视频汇总的交互前端与适配器。真实检测、上传、存储、服务端取消、历史记录和报告导出未接入。与2.2共用分支不代表已共享案件；不得用相同的显示案件编号推断公共案件关联。完整目标保留在[OpenSpec](../openspec/changes/add-video-aftersales/specs/video-aftersales/spec.md)。

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

## 第二轮：检测、核对与图视频汇总

第二轮范围已由本人确认，继续维护原工作包与PR #3。页面分为“案件与凭证 / 检测与核对 / 图视频汇总”，检测区再分“来源与修改 / 商品核对”。桌面播放器与结果并排；窄屏纵排。页签支持方向键及Home/End，切换不清空资料，离开页签暂停播放；真正离开取消操作并卸载媒体。

- 02：单独展示AI生成风险、完整/部分覆盖、范围说明、摘要及服务返回的片段/代表画面。代表画面通过原视频定位复核。
- 03：独立展示修改风险及异常拼接、局部修改、添加、替换、消除线索；片段点击后暂停定位。未知风险与未覆盖范围不会当作低风险。
- 04：按外观、款式、问题现象列出原始资料、可见内容、证据、位置及一致/不一致/无法判断。缺少款式资料只能返回无法判断。
- 05：本页未关联视频和服务返回的案件材料分别展示；支持全部、待核对、未完成、失败或取消筛选，展开分类依据，查看图片区域及视频片段。后台检测刷新保留展开状态与操作焦点。

默认没有检测或案件服务，点击操作时才提示未接入；产品不内置模拟结果。公共service/contracts、2.2代码和其他场景不变；真实公共协议由后续适配器映射并与组长、相关负责人对齐。

### 检测适配器

页面初始化后配置单例 `window.Veritas.videoAftersalesDetection`（或导入[检测模块](../src/modules/video/aftersales/detection.js)中的 `aftersalesVideoDetection`）。`configure({ ai, tamper, comparison })`替换当前三类函数；仅重试某类时可以只配置该类，`configure(null)`清空。运行期间不可更改配置。

```js
window.Veritas.videoAftersalesDetection.configure({
  ai: async ({ fields, video }, { signal }) => detectSource(fields, video, signal),
  tamper: async ({ fields, video }, { signal }) => detectModification(fields, video, signal),
  comparison: async ({ fields, video }, { signal }) => compareProduct(fields, video, signal),
});
```

示例中的三个服务函数需由接入方实现。fields与提交接口相同；video为 `{id, version, file, duration, width, height}`，不包含临时URL。页面生成的version为数字，必须原样回传。每个视频、每个类型独立排队/运行/成功/失败，可只重试失败类型；单项60秒超时。检测期间锁定编辑与提交，可播放、切换页签、取消或离开。取消立即释放前端锁并传递AbortSignal；不响应取消的迟到结果不被接收。资料变化使旧结果失效；移除的视频不再保留结果。

所有成功响应必须含 `videoId`、`version`、`kind`、`coverage`（full/partial）、非空 `scope` 与 `summary`。ai/tamper另含：

```js
{
  risk: 'low', // low / medium / high / unknown
  segments: [{ id: 'segment-id', start: 1, end: 2, description: '核查依据', type: 'splice' }],
  frames: [{ time: 1, label: '代表画面' }]
}
```

该片段只说明结构，不是内置结果。segments和frames必需，可为空数组。片段须唯一id、0 ≤ start < end ≤ duration；最多100段。tamper的type必需，为splice/local/add/replace/remove/unknown之一；ai忽略type。代表画面最多30项，0 ≤ time < duration。位置校验失败拒绝该类响应。

comparison另含恰好三个checks，dimension分别为appearance/style/issue；每项含outcome（match/mismatch/unknown）、非空observed/evidence及segments（同上，忽略type）。用于展示的references由请求资料生成，不接受服务端替换原始资料。完整校验规则以[检测实现](../src/modules/video/aftersales/detection.js)为准。

### 同案件图视频读取适配器

页面挂载后配置 `window.Veritas.videoAftersalesCase.configure(handler)`。此服务属于当前页面，每次重新进入都要由接入层配置；不会自动调用。用户点击“加载案件凭证”时调用 `handler({caseNumber}, {signal})`，60秒超时。响应结构：

```js
{
  caseNumber: '请求中的案件编号',
  caseRef: '服务端案件引用',
  materials: [{
    caseRef: '与上层相同的案件引用', materialRef: '服务端材料引用', version: '保存版本字符串',
    type: 'video', name: '凭证.mp4', url: 'https://media.example.com/evidence.mp4', duration: 3,
    fields: { caseNumber: '案件编号', productName: '商品', style: '', productInfo: '', description: '问题' },
    results: { ai: { status: 'succeeded', result: { /* 以上检测结果结构 */ } } }
  }]
}
```

示例仅为协议说明，需填入完整真实结果。最多100份材料，materialRef唯一；材料caseRef必须一致，每类成功结果必须指向相同材料和保存版本。视频结果videoId为materialRef；图片结果imageId为materialRef，沿用[2.2检测与核对结构](image-refund-integration.md)，并额外回传相同version。材料type为image/video，视频duration须为正数；fields五项均提供字符串。缺少某类结果视为未检测；支持idle/queued/running/failed/cancelled/succeeded状态及可选error。

url可为空（保留依据但不能预览），或不含账号密码的绝对HTTP(S)地址。访问授权、签名URL及真实引用由服务端负责。视频地址应支持HTTP Range以便定位；预览会校验实际时长和片段终点，seeked后确认实际位置，不可定位则显示错误。关闭预览、切换页签或离开卸载src；更换案件编号、加载失败或取消均清除旧关联结果。服务端错误可直接抛出，由页面显示，不会误保留旧案件。

### 第二轮实际验证（2026-10-21）

- [自动测试](../tests/video-aftersales-review.test.mjs)覆盖三类响应校验、时间/版本拒绝、独立失败重试、取消迟到、超时、输入版本变化和案件引用/权限失败；全项目40项通过。
- [新浏览器回归](../tests/video-aftersales-review.browser.mjs)在Edge源码与构建版运行，覆盖独立结果、局部失败重试、三主页签与嵌套页签、原视频定位、版本失效、图视频筛选及预览、取消/导航释放、桌面1440px与窄屏390px；测试通过适配入口注入结果，产品不包含这些结果。
- 原视频材料浏览器脚本源码/构建版均通过；2.2原有四套浏览器脚本通过。
- 独立审查发现的汇总刷新丢失展开/焦点、远程定位吞掉片段终点并可能静默跳回0秒已修复。新增回归验证后台刷新保留状态、HTTP Range视频准确定位、时长不符拒绝以及不可定位明确报错。
- 检测与核对[桌面截图](screenshots/video-aftersales-review-desktop.png)、[窄屏截图](screenshots/video-aftersales-review-mobile.png)、[图视频汇总截图](screenshots/video-aftersales-summary-desktop.png)均使用本地测试图案与注入结果。

追加复现：`node tests/video-aftersales-review.browser.mjs`；设置 `REFUND_TEST_DIST=1` 后同样执行以验证构建版。真实后端联调及完整业务里程碑仍待完成，不提前归档。

第二轮项目检查：65个JS文件、本地文档链接及10个工作包证据检查通过；构建包语法、HTTP冒烟和全部11项OpenSpec严格校验通过。预览期间后台刷新后的焦点恢复也已由独立审查复核通过。
