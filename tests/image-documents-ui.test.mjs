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
  assert.ok(!html.includes("证据不足"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("alert(2)"));
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
    "图像真实性",
    "修改位置",
    "文件真实性内容核查",
    "本文件智能核查",
    "AI生成核查",
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
  assert.ok(!html.includes("模型分数"));
  assert.ok(html.includes('class="doc-region-note">疑似修改位置</p>'));
  assert.ok(html.includes("data-doc-view-locations"));
  assert.ok(html.includes("data-doc-location-viewer"));
  assert.ok(!html.includes("需结合原图及字段复核"));
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
  assert.ok(html.indexOf("仅单份检查") < html.indexOf('data-doc-section="cross"'));
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
  assert.ok(html.indexOf('data-doc-section="generation"') < html.indexOf('data-doc-section="local"'));
  assert.ok(html.includes('data-doc-target="generation"'));
  for (const label of ["MIRROR", "SEED", "文字提取", "后续处理建议"]) assert.ok(!html.includes(label));
  assert.ok(!html.includes("核对付款条件"));
  assert.ok(!html.includes("可能存在分期付款约定"));
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
    assert.ok(!html.includes('doc-success'));
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
 assert(a.includes('本文件智能核查'));assert(a.includes('跨文件智能核查'));
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
 assert(html.includes('疑似矛盾事实<span class="doc-fact-count">1</span>'));
 assert(html.includes('核验内容：<strong>10</strong>'));
 for(const unwanted of ['交易 税额','tax_amount','item_description','原文识别内容','提取值：','跨材料：'])assert(!html.includes(unwanted),unwanted);
 assert(html.includes('商品或服务'));assert(!/<details[^>]*\sopen(?:[\s>])/.test(html));
});

test('出库明细与账户清单转中文条目，不显示JSON字段名',()=>{
 const html=renderDocumentPresentation({materials:[{id:'a'}],presentation:{warnings:[{title:'明细',materialIds:['a'],evidence:[{materialId:'a',key:'dispatch_items',value:JSON.stringify([{item_code:'10',item_description:'<音箱>',specification:'128g',quantity:'50'}])}]}]}},{a:'出库单'},'a');
 assert(html.includes('商品编号：10'));assert(html.includes('商品：&lt;音箱&gt;'));assert(!html.includes('item_description'));assert(!html.includes('item_code'));
});

test('同规则多个字段集中在一个折叠块且保留每项状态与证据', () => {
 const checks = ['姓名','纳税人识别号','出具机关'].map((title,i)=>({rule:'same_certificate',title:'同证明编号内容核对',status:i?'WARN':'PASS',message:title+'需要核对',evidence:[{materialId:'a',key:'name',value:title+'甲'},{materialId:'b',key:'name',value:title+'乙'}]}));
 const html=renderDocumentChecks(checks,{a:'核心证明',b:'辅助证明'});
 assert.equal((html.match(/<details /g)||[]).length,2);
 assert.equal((html.match(/<tr>/g)||[]).length,5);
 for(const name of ['核心证明','辅助证明','姓名甲','出具机关乙'])assert(html.includes(name));
 assert(!html.includes(' open'));
});


test('身份证异常明确说明位数，隐藏未执行地区检查，核心名称转义',()=>{
 const checks=[{rule:'identity_structure',status:'FAIL',reason:'identity_format_not_18_digits_or_ocr_ambiguity',evidence:[{materialId:'a',key:'identity_number',value:'99511099506124726'}]},{rule:'identity_historical_region',status:'NEI',reason:'historical_region_table_not_configured',evidence:[]}];
 const html=renderDocumentResult({materials:[{id:'a',name:'证明<script>',checks,pages:[]}],review:{plan:{coreMaterialId:'a',edges:[],excluded:[]}}},'a');
 assert(html.includes('当前内容为17位'));assert(html.includes('号码异常'));
 assert(!html.includes('登记地区核对'));assert(!html.includes('历史地区'));assert(!html.includes('<script>'));
 assert(html.includes('doc-core-name">证明&lt;script&gt;'));
});


test('三模块依次展示，智能结论按来源分开，隐藏待补事实并保留通过事实',()=>{
 const ref=id=>({materialId:id,key:'name',value:id});
 const data={materials:[{id:'a',name:'核心证明',checks:[{rule:'x',status:'PASS',message:'单份通过',evidence:[ref('a')]},{rule:'y',status:'NEI',message:'不要展示缺证',evidence:[ref('a')]}]},{id:'b',name:'辅助证明'}],review:{plan:{coreMaterialId:'a'},executionAssessment:{items:[{id:'one',status:'NEI',materialIds:['a'],evidence:[ref('a')]},{id:'two',status:'NEI',materialIds:['a','b'],evidence:[ref('a'),ref('b')]}]}},presentation:{aiReview:{status:'completed',findings:[{assessmentId:'one',verdict:'reasonable',explanation:'单份语义正常'},{assessmentId:'two',verdict:'issues_found',explanation:'两份名称存在差异'},{assessmentId:'one',verdict:'needs_more_information',explanation:'不展示智能缺证'}]}}};
 const html=renderDocumentResult(data,'a'),v=html.indexOf('data-doc-section="generation"'),l=html.indexOf('data-doc-section="local"'),c=html.indexOf('data-doc-section="cross"');
 assert(v<l&&l<c);assert(html.includes('data-doc-target="cross"'));
 assert(html.slice(l,c).includes('单份语义正常'));assert(!html.slice(l,c).includes('两份名称存在差异'));assert(html.slice(c).includes('两份名称存在差异'));
 assert(html.includes('单份通过'));assert(!html.includes('不要展示缺证'));assert(html.includes('不展示智能缺证'));assert(html.indexOf('单份语义正常')<html.indexOf('不展示智能缺证'));assert(!html.includes('证据不足'));
 assert(!/<details[^>]* open/.test(html));
});
