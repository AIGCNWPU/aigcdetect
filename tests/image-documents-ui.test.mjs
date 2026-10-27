import test from "node:test";
import assert from "node:assert/strict";
import {
  documentReviewFunctions,
  validateDocumentFiles,
  createDocumentReviewPayload,
  documentRegionStyle,
  renderDocumentChecks,
  renderDocumentResult,
  renderDocumentPresentation,
} from "../src/modules/image/pages/documents.js";

const file = (name, size = 20) => ({
  name,
  size,
  arrayBuffer: async () => new Uint8Array([0, 1, 2, 253, 254, 255]).buffer,
});
test("混合上传保留有效文件，分别拒绝旧DOC、空文件、单文件/总量/数量超限", () => {
  const result = validateDocumentFiles(
    [],
    [
      file("a.pdf"),
      file("b.DOCX"),
      file("c.doc"),
      file("zero.png", 0),
      file("large.jpg", 13 * 1024 * 1024),
    ],
  );
  assert.deepEqual(
    result.accepted.map((f) => f.name),
    ["a.pdf", "b.DOCX"],
  );
  assert.equal(result.errors.length, 3);
  assert.equal(
    validateDocumentFiles(
      Array.from({ length: 10 }, () => file("a.pdf")),
      [file("b.pdf")],
    ).accepted.length,
    0,
  );
  assert.equal(
    validateDocumentFiles(
      [file("a.pdf", 12 * 1024 * 1024), file("b.pdf", 12 * 1024 * 1024)],
      [file("c.pdf")],
    ).accepted.length,
    0,
  );
});
test("上传必须明确核心文件，默认脱敏智能复核并保留声明类型与字节", async () => {
  const state = {
    files: [{ id: "a", file: file("a.pdf"), materialType: "digital_invoice" }],
    objective: "invoice_review",
  };
  await assert.rejects(() => createDocumentReviewPayload(state), /核心/);
  const request = await createDocumentReviewPayload({
    ...state,
    coreMaterialId: "a",
    runModels: false,
  });
  assert.equal("role" in request, false);
  assert.deepEqual(request.options, {
    runModels: false, explain: false, semanticReview: true, privacyMode: "redacted",
  });
  assert.deepEqual(request.context, { region: "unspecified" });
  assert.equal(request.jurisdiction, "CN");
  assert.equal(request.files[0].materialType, "digital_invoice");
  assert.equal(request.files[0].contentBase64, "AAEC/f7/");
  assert.deepEqual(request.relations, []);
  assert.deepEqual(request.confirmations, []);
});
test("跨材料确认需依据且金额/同票范围分别显式授权", async () => {
  const state = {
    files: [
      { id: "a", file: file("a.pdf") },
      { id: "b", file: file("b.pdf") },
    ],
    coreMaterialId: "a",
    confirmations: { b: { enabled: true, reason: "" } },
  };
  await assert.rejects(() => createDocumentReviewPayload(state), /关联的依据/);
  state.confirmations.b = {
    enabled: true,
    reason: "人工核对合同原件",
    amount: true,
    invoice: false,
  };
  const request = await createDocumentReviewPayload(state);
  assert.equal(request.confirmations[0].amountScopeConfirmed, true);
  assert.equal(request.confirmations[0].documentScopeConfirmed, false);
  assert.equal(request.confirmations[0].dateScopeConfirmed, false);
});
test("只显示在原始页尺寸内的有效框，不猜归一化或越界坐标", () => {
  assert.equal(
    documentRegionStyle({ box: [100, 50, 200, 100] }, [400, 200]),
    "left:25%;top:25%;width:25%;height:25%",
  );
  for (const box of [
    [-1, 0, 100, 100],
    [1, 1, 500, 100],
    [1, 1, 1, 100],
    [1, 1, NaN, 100],
  ])
    assert.equal(documentRegionStyle({ box }, [400, 200]), null);
  assert.equal(documentRegionStyle({ box: [1, 1, 20, 20] }, null), null);
});
test("检查理由及证据内容转义，不将证据不足或未执行显示为通过", () => {
  const html = renderDocumentChecks(
    [
      {
        status: "NEI",
        message: "<img src=x onerror=alert(1)>缺失",
        evidence: [
          {
            materialId: "a",
            key: "gross_amount",
            value: "<script>alert(2)</script>",
          },
        ],
      },
    ],
    { a: '"<b>文件' },
  );
  assert.ok(html.includes("证据不足"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("本项通过"));
});
test("结果分开展示五阶段、无图Word和未知状态，预览拒绝外部或脚本URL", () => {
  const html = renderDocumentResult(
    {
      materials: [
        {
          id: "a",
          name: "invoice.docx",
          status: "partial",
          pages: [
            {
              page: 1,
              status: "not_run",
              previewDataUrl: "https://external.test/private.png",
            },
          ],
          fields: [],
          stages: {
            mirror: { status: "not_run" },
            seed: { status: "failed" },
            rules: { status: "completed" },
          },
        },
      ],
      review: {},
    },
    "a",
  );
  for (const label of [
    "MIRROR",
    "SEED",
    "文字提取",
    "单份内容核验",
    "智能复核",
    "依据",
    "未执行",
    "处理失败",
  ])
    assert.ok(html.includes(label), label);
  assert.ok(!html.includes("https://external.test"));
  assert.ok(html.includes("没有可展示的页图"));
  assert.ok(html.includes("尚未开放") === false);
});
test("缩略图上的框按原图尺寸等比布局，未校准分数不称真实概率", () => {
  const html = renderDocumentResult(
    {
      materials: [
        {
          id: "a",
          name: "a.png",
          pages: [
            {
              page: 1,
              status: "completed",
              previewDataUrl: "data:image/png;base64,AAAA",
              rendered_size: [1000, 2000],
              regions: [{ box: [100, 200, 300, 800] }],
            },
          ],
          stages: { seed: { status: "completed", score: 0.71 } },
        },
      ],
    },
    "a",
  );
  assert.ok(html.includes("left:10%;top:10%;width:20%;height:30%"));
  assert.ok(html.includes("未校准，不代表真实概率"));
  assert.ok(html.includes("橙框：1"));
});

test("核心计划展示跨材料候选检查与未参与原因，单份检查不混入跨文件区域", () => {
  const html = renderDocumentResult(
    {
      materials: [
        { id: "a", name: "核心发票.pdf", pages: [] },
        { id: "b", name: "无关材料.pdf", pages: [] },
      ],
      review: {
        checks: [{ materialId: "a", status: "PASS", message: "仅单份检查" }],
        candidates: [{ status: "FAIL", message: "跨文件金额矛盾", materialIds: ["a", "b"] }],
        plan: {
          edges: [],
          excluded: [
            { materialId: "b", reason: "no_confirmed_core_relationship" },
          ],
        },
        coverage: { candidateCount: 1 },
      },
    },
    "a",
  );
  assert.ok(html.includes("跨文件金额矛盾"));
  assert.ok(!html.includes("未参与核对的材料及原因"));
  assert.ok(!html.includes("未确认与核心材料的关联"));
  assert.ok(!html.includes("仅单份检查"));
});

test("功能目录不暴露机构身份，不以身份过滤且选项不含括号备注", () => {
  assert.deepEqual(Object.values(documentReviewFunctions), ["发票核验", "采购履约核验", "收付款核对", "报销材料核验", "身份材料核对"]);
  assert.ok(Object.values(documentReviewFunctions).every(label => !/[()（）]/.test(label)));
});


test("复核开关与视觉检测独立，原文模式显式传递并包含地区日期", async () => {
  const request = await createDocumentReviewPayload({
    files: [{ id: "a", file: file("a.pdf") }], coreMaterialId: "a",
    runModels: true, semanticReview: false, privacyMode: "original",
    region: "CN-XZ", businessDate: "2026-10-26",
  });
  assert.deepEqual(request.options, { runModels: true, explain: false, semanticReview: false, privacyMode: "original" });
  assert.deepEqual(request.context, { region: "CN-XZ", businessDate: "2026-10-26" });
  const safe = await createDocumentReviewPayload({
    files: [{ id: "a", file: file("a.pdf") }], coreMaterialId: "a", privacyMode: "untrusted", region: "untrusted",
  });
  assert.equal(safe.options.privacyMode, "redacted");
  assert.equal(safe.context.region, "unspecified");
});

test("结论优先呈现问题建议与复核说明，技术阶段收起，所有服务内容转义", () => {
  const html = renderDocumentResult({
    status: "completed",
    materials: [{ id: "a", name: "发票.pdf", pages: [], stages: { mirror: { status: "completed", score: 0.1 } } }],
    presentation: {
      status: "issues_found", title: "发现一项金额矛盾", summary: "请核对合同与发票的含税口径。",
      warnings: [{ title: "金额不一致", message: "<img src=x onerror=alert(1)>", materialIds: ["a"] }],
      actions: ["核对付款条件"],
      aiReview: { status: "completed", summary: "可能存在分期付款约定。", findings: [{ title: "条款复核", explanation: "<script>不执行</script>" }] },
    },
  }, "a");
  assert.ok(html.indexOf("发现一项金额矛盾") < html.indexOf("材料预览"));
  assert.ok(html.includes('<details class="doc-details"><summary>查看核验依据与处理详情</summary>'));
  assert.ok(html.indexOf("查看核验依据与处理详情") < html.indexOf("MIRROR"));
  assert.ok(html.includes("核对付款条件"));
  assert.ok(html.includes("可能存在分期付款约定"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img src=x"));
});

test("复核未执行或失败不展示过期成功摘要，缺少结果不宣称核验通过", () => {
  for (const status of ["not_run", "failed"]) {
    const html = renderDocumentPresentation({
      presentation: { status: "needs_more_information", title: "仍需补充核查", warnings: [], actions: [],
        aiReview: { status, summary: "所有材料均合理", findings: [{ message: "已通过" }], reason: "provider_not_configured" },
      },
    });
    assert.ok(!html.includes("所有材料均合理"));
    assert.ok(!html.includes("已通过"));
    assert.ok(html.includes("相关事项仍待核查"));
  }
  const empty = renderDocumentResult({ status: "failed", materials: [] }, "");
  assert.ok(empty.includes("尚无材料处理结果"));
  assert.ok(!empty.includes("未发现问题"));
  assert.ok(!empty.includes("本项通过"));
});

 test('all 31 region choices are preserved when building an upload request',async()=>{
  const {documentRegions}=await import('../src/modules/image/documents/regions.js');
  assert.equal(Object.keys(documentRegions).length,32);
  for(const region of Object.keys(documentRegions)){
    const request=await createDocumentReviewPayload({files:[{id:'a',file:file('a.pdf'),materialType:'invoice'}],coreMaterialId:'a',objective:'invoice_review',jurisdiction:'CN',region});
    assert.equal(request.context.region,region);
  }
 });

test('切换材料只展示本份问题与涉及本份的差异，双方原文安全显示，详情默认收起',()=>{
 const ref=(materialId,value)=>({materialId,key:'name',role:'buyer',value,source:{page:1,observedText:`购买方名称：${value}`}});
 const data={materials:[{id:'a',name:'发票1',pages:[]},{id:'b',name:'发票2',pages:[]},{id:'c',name:'发票3',pages:[]}],
  presentation:{summary:'批次有99项问题',warnings:[
   {title:'发票1金额问题',message:'A错误',materialIds:['a'],evidence:[ref('a','甲公司')]},
   {title:'发票2专属错误',message:'B错误',materialIds:['b'],evidence:[ref('b','乙公司')]},
   {title:'名称不一致',message:'双方名称不同',materialIds:['a','b'],evidence:[ref('a','甲公司'),ref('b','<乙公司>')]},
   {title:'其他两份的差异',materialIds:['b','c'],evidence:[ref('b','乙公司'),ref('c','丙公司')]},
  ],actions:['发票2补材料'],aiReview:{status:'completed',summary:'批次复核摘要',findings:[{materialIds:['b'],explanation:'发票2专属复核'}]}}};
 const a=renderDocumentResult(data,'a');
 assert(a.includes('本文件问题 1 项，关联问题 1 项'));
 assert(a.includes('核验内容：<strong>甲公司'));assert(a.includes('核验内容：<strong>&lt;乙公司&gt;'));
 for(const unwanted of ['发票2专属错误','其他两份的差异','发票2补材料','发票2专属复核','批次有99项问题','批次复核摘要'])assert(!a.includes(unwanted),unwanted);
 assert(!/<details[^>]*\sopen(?:[\s>])/.test(a));
 const b=renderDocumentResult(data,'b');assert(!b.includes('发票1金额问题'));assert(b.includes('发票2专属错误'));assert(b.includes('发票2专属复核'));
});

test('原文缺失时标明未提供，不把归一化值伪装成原文',()=>{
 const html=renderDocumentPresentation({materials:[{id:'a'}],presentation:{warnings:[{title:'金额',materialIds:['a'],evidence:[{materialId:'a',key:'gross_amount',value:'123.00'}]}]}},{a:'发票1'},'a');
 assert(html.includes('核验内容：')); assert(html.includes('123.00'));assert(!html.includes('原文识别内容'));
});

test('字段使用简洁中文，跨材料问题集中折叠，核验内容不重复原文和提取值',()=>{
 const evidence=[{materialId:'a',key:'tax_amount',role:'transaction',value:'10',source:{observedText:'税额10'}},{materialId:'b',key:'item_description',role:'transaction',value:'服务费'}];
 const html=renderDocumentResult({materials:[{id:'a',name:'发票1'},{id:'b',name:'发票2'}],presentation:{warnings:[{title:'金额',materialIds:['a','b'],evidence}]}},'a');
 assert(html.includes('<details class="doc-details doc-cross-issues"><summary>跨材料核验 · 1 项</summary>'));
 assert(html.includes('核验内容：<strong>10</strong>'));
 for(const unwanted of ['交易 税额','tax_amount','item_description','原文识别内容','提取值：','跨材料：'])assert(!html.includes(unwanted),unwanted);
 assert(html.includes('商品或服务'));assert(!/<details[^>]*\sopen(?:[\s>])/.test(html));
});

test('出库明细与账户清单转中文条目，不显示JSON字段名',()=>{
 const html=renderDocumentPresentation({materials:[{id:'a'}],presentation:{warnings:[{title:'明细',materialIds:['a'],evidence:[{materialId:'a',key:'dispatch_items',value:JSON.stringify([{item_code:'10',item_description:'<音箱>',specification:'128g',quantity:'50'}])}]}]}},{a:'出库单'},'a');
 assert(html.includes('商品编号：10'));assert(html.includes('商品：&lt;音箱&gt;'));assert(!html.includes('item_description'));assert(!html.includes('item_code'));
});
