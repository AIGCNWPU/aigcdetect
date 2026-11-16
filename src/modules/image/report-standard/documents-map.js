// 2.3 证件与票据材料核验 → 标准报告模型映射器。
// 输入为核验接口返回的完整结果（materials / review / presentation / limitations）；
// 只产出内容，不涉及版式。核对文字（识别值与 OCR 原文）按规范以引用形式写入报告。

import { createStdReport, p, h2, h3, table, list, image, chapter, formatStdTime } from './model.js';

const objectiveNames = {
  invoice_review: '发票核验', procurement_review: '采购履约核验', merchant_reconciliation: '收付款核对',
  research_reimbursement: '报销材料核验', identity_consistency: '身份材料核对',
  payment_review: '收付款核对', reimbursement_review: '报销材料核验', identity_review: '身份材料核对',
};
const typeNames = {
  unknown: '未分类', digital_invoice: '数电发票', invoice: '增值税发票', receipt: '收据 / 付款凭证',
  identity: '身份证', certificate: '证明', contract: '合同', order: '订单', bank_receipt: '银行付款回单',
  bank_statement: '银行流水', acceptance_record: '验收记录', delivery_note: '交付单',
  reimbursement_form: '报销单', research_approval: '科研审批', project_approval: '项目审批',
  travel_approval: '出差审批', household_register: '户籍材料', application_form: '申请表', authorization: '授权书',
};
const stageNames = { mirror: '整图 AI 检测', seed: '局部篡改定位', ocr: '文字提取', rules: '内容规则核验', explanation: '智能复核' };
const statusNames = {
  PASS: '本项通过', FAIL: '发现矛盾', NEI: '证据不足', NOT_APPLICABLE: '不适用', ERROR: '检查失败',
  completed: '已完成', succeeded: '已完成', failed: '未能完成', not_run: '未执行', partial: '部分完成',
  queued: '等待处理', running: '正在处理', resource_limit: '超过处理限制',
};
const fieldLabels = {
  gross_amount_words: '大写金额', name: '姓名 / 名称', identity_number: '身份证号', tax_identifier: '纳税人识别号',
  invoice_number: '发票号码', invoice_code: '发票代码', gross_amount: '价税合计', net_amount: '不含税金额',
  tax_amount: '税额', payment_amount: '付款金额', birth_date: '出生日期', issue_date: '开具日期',
  invoice_date: '发票日期', transaction_date: '交易日期', transaction_number: '交易编号', gender: '性别',
  current_address: '现住址', registered_address: '登记地址', amount_uppercase: '大写金额',
  original_voucher_number: '原凭证号', displayed_payment_time: '交易时间', amount_due: '应缴金额',
  displayed_document_number: '证件号码', current_income_amount: '本期收入', authorized_agent: '委托代理人',
  legal_representative: '法定代表人', application_id: '小程序编号', application_name: '小程序名称',
  shop_url: '店铺地址', declaration_date: '申报日期', income_amount: '收入金额', declared_tax_amount: '已申报税额',
  phone_number: '联系电话', displayed_receipt_total: '票面合计', displayed_cash: '现金付款',
  business_credit_code: '统一社会信用代码', authorization_contract_number: '授权合同编号',
  authorization_start_date: '授权开始日期', authorization_end_date: '授权结束日期', employment_start_date: '入职日期',
  registration_date: '注册日期', dispatch_number: '出库编号', dispatch_items: '出库明细', customer_contact: '客户',
  item_description: '商品或服务', quantity: '数量', unit_price: '单价', line_net_amount: '明细金额',
  line_tax_amount: '明细税额', tax_rate: '税率', certificate_number: '证明编号', certificate_reference: '文书编号',
  issuing_authority: '出具机关', tax_type: '税种', tax_period: '税款所属期', treasury_date: '入退库日期',
  paid_tax_amount: '已缴税额', tax_status_date: '纳税状态日期', account_list: '账户清单',
  payment_account: '付款账户', household_number: '户号', order_number: '订单编号', order_total: '订单金额',
  displayed_order_date: '订单显示日期', contract_number: '合同编号', contract_total: '合同金额',
  loan_amount: '借款金额', loan_date: '借款日期', repayment_date: '还款日期', commitment_end_date: '承诺截止日期',
  monthly_rent: '月租金', deposit_months: '押金月数', prepaid_months: '预付月数', initial_payment: '首付款',
  initial_payment_composition: '首付款组成', payment_adjustment: '金额调整',
};
const roleNames = {
  buyer: '购买方', seller: '销售方', payer: '付款方', payee: '收款方', borrower: '借款人', lender: '出借人',
  tenant: '承租人', landlord: '出租人', operator: '经营者', grantee: '被授权人', grantor: '授权方',
  recipient: '收货方', issuer: '出具方', party_a: '甲方', party_b: '乙方', lessor: '出租人', lessee: '承租人',
  lessee_representative: '承租方签字代表', taxpayer: '纳税人', withholding_agent: '扣缴义务人',
  holder: '持证人', account_holder: '账户主体', subject: '主体', transaction: '交易',
};
const nameLike = ['name', 'identity_number', 'tax_identifier', 'registered_address', 'current_address', 'phone_number', 'authorized_agent', 'legal_representative'];

const zhStatus = (status) => statusNames[status] || (status ? String(status) : '未记录');
const labelOf = (field) => {
  const base = fieldLabels[field?.key] || '相关内容';
  const role = roleNames[field?.role];
  return role && nameLike.includes(field?.key)
    ? `${role}${field.key === 'name' ? '名称' : base}`
    : base;
};
const percentText = (value) => (Number.isFinite(value) ? (value * 100).toFixed(1) : '');

/** 证据引用 → 提取文字：字段中文名：识别值（第 X 页，原文：“…”）。 */
function evidenceText(ref) {
  if (!ref) return '';
  const label = labelOf(ref);
  const value = ref.value !== undefined && ref.value !== null && ref.value !== '' ? String(ref.value) : (ref.source?.observedText || '');
  if (!value) return '';
  const page = ref.source?.page ? `第 ${ref.source.page} 页，` : '';
  const observed = ref.source?.observedText && String(ref.source.observedText) !== String(ref.value) ? `原文：“${ref.source.observedText}”` : '';
  return `${label}：${value}（${page}${observed ? `${observed}）` : '来源见材料）'}`.replace('（）', '');
}

function regionsOf(page) {
  return (page?.regions || []).filter((r) => [r?.x, r?.y, r?.width, r?.height].every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
}

/** 把同题同材料的相邻告警合并为一条（每组一条核验内容清单）。 */
function mergeWarnings(warnings = []) {
  const groups = [];
  for (const warning of warnings) {
    const key = `${warning.title || warning.id}｜${(warning.materialIds || []).join(',')}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(warning);
    else groups.push({ key, title: warning.title || '需关注事项', items: [warning] });
  }
  return groups;
}

export function buildDocumentsStdReport(data, { generatedAt = new Date().toISOString(), reportNo = '' } = {}) {
  const materials = Array.isArray(data?.materials) ? data.materials : [];
  const names = Object.fromEntries(materials.map((m) => [m.id, m.name || m.id]));
  const review = data?.review || {};
  const plan = review.plan || {};
  const coreId = plan.coreMaterialId || materials[0]?.id || '';
  const objective = objectiveNames[plan.objective] || plan.objective || '材料核验';
  const flatChecks = [...(review.checks || []), ...(review.results || [])];
  const globalChecks = flatChecks.filter((c) => !c.materialId);
  const localChecks = flatChecks.filter((c) => c.materialId);
  const countBy = (list, status) => list.filter((c) => c.status === status).length;
  const stats = {
    fail: countBy(flatChecks, 'FAIL'), pass: countBy(flatChecks, 'PASS'),
    nei: countBy(flatChecks, 'NEI'), na: countBy(flatChecks, 'NOT_APPLICABLE') + countBy(flatChecks, 'ERROR'),
  };
  const warnings = (data?.presentation?.warnings || []).filter((w) => w && (w.title || w.message));
  const issueCount = warnings.length;

  const meta1 = [
    ['核验场景', '证件与票据材料核验'],
    ['核验目的', objective],
    ['核心材料', names[coreId] || '未指定'],
    ['材料数量', `${materials.length} 份`],
    ['生成时间', formatStdTime(generatedAt)],
  ];
  if (reportNo) meta1.push(['报告编号', reportNo]);

  // 1 核验结论
  const conclusionBlocks = [
    p(issueCount
      ? `本次核验共发现 ${issueCount} 项需要关注的问题，其中票面矛盾 ${stats.fail} 项。${data?.presentation?.summary || '请核对下列问题后再办理相关业务。'}`
      : `本次核验未发现需要关注的问题。${data?.presentation?.summary || ''}`),
    table(
      [
        { title: '统计项', width: 33 }, { title: '数量', width: 17 },
        { title: '统计项', width: 33 }, { title: '数量', width: 17 },
      ],
      [
        ['需要关注的问题合计', String(issueCount), '已执行核验项合计', String(flatChecks.length)],
        ['发现矛盾（FAIL）', String(stats.fail), '本项通过（PASS）', String(stats.pass)],
        ['证据不足（NEI）', String(stats.nei), '不适用 / 检查失败', String(stats.na)],
      ],
      { caption: '核验结果统计' },
    ),
    p('以上统计基于本次已执行的核验项；证据不足与未执行项不代表材料通过，适用范围见第 7 章说明。', { noIndent: true }),
  ];

  // 2 核验范围与材料
  const materialRows = materials.map((m) => [
    m.name || m.id,
    typeNames[m.type] || m.type || '未分类',
    m.id === coreId ? '核心材料' : '辅助材料',
    String((m.pages || []).length || '—'),
    zhStatus(m.status),
  ]);
  const scopeBlocks = [
    table(
      [{ title: '材料', width: 34 }, { title: '类型', width: 22 }, { title: '角色', width: 16 }, { title: '页数', width: 10 }, { title: '处理状态', width: 18 }],
      materialRows,
      { caption: '材料清单' },
    ),
    ...globalChecks.map((check) => p(`${check.title || '核验范围'}：${zhStatus(check.status)}。${check.explanation || ''}`)),
  ];
  const excluded = (plan.excluded || []);
  if (excluded.length) {
    scopeBlocks.push(p('以下材料未参与本次核对：'));
    scopeBlocks.push(list(excluded.map((item) => `${names[item.materialId] || '辅助材料'}：${item.message || item.reason || '未确认与核心材料的关联'}`)));
  }

  // 3 需要关注的问题（含跨材料问题；同题相邻项合并）
  const issueBlocks = [];
  const merged = mergeWarnings(warnings);
  merged.forEach((group, index) => {
    const first = group.items[0];
    const materialNames = [...new Set((first.materialIds || []).map((id) => names[id] || '相关材料'))];
    issueBlocks.push(h2(group.title));
    const scope = materialNames.length > 1 ? `（涉及材料：${materialNames.join('、')}）` : materialNames.length === 1 ? `（材料：${materialNames[0]}）` : '';
    issueBlocks.push(p(`${first.message || first.detail || '请核对相关材料。'}${scope}`));
    const lines = [];
    for (const warning of group.items) {
      for (const ref of warning.evidence || []) lines.push(evidenceText(ref));
    }
    if (lines.length) {
      issueBlocks.push(p('核验内容：'));
      issueBlocks.push(list(lines.slice(0, 12)));
      if (lines.length > 12) issueBlocks.push(p(`其余 ${lines.length - 12} 条核验内容详见平台页面与第 4 章各材料提取字段。`, { noIndent: true }));
    }
  });
  if (!issueBlocks.length) issueBlocks.push(p('本次核验未发现需要关注的问题；各材料逐项结果见第 4 章。'));

  // 4 各材料核验详情
  const detailBlocks = [];
  for (const material of materials) {
    detailBlocks.push(h2(`${material.name || material.id}${material.id === coreId ? '（核心材料）' : ''}`));
    // 4.x.1 基本信息 + 预览
    detailBlocks.push(h3('材料预览与基本信息'));
    const pages = (material.pages || []).slice(0, 3);
    for (const page of pages) {
      if (/^data:image\/(?:png|jpeg|webp);base64,/.test(page.previewDataUrl || '')) {
        detailBlocks.push(image(page.previewDataUrl, `${material.name || material.id} 第 ${page.page || page.number || 1} 页${regionsOf(page).length ? `（橙框为 ${regionsOf(page).length} 处疑似修改位置）` : ''}`, { regions: regionsOf(page), widthCm: 12 }));
      }
    }
    if (!pages.some((page) => /^data:image\/(?:png|jpeg|webp);base64,/.test(page.previewDataUrl || ''))) {
      detailBlocks.push(p('本材料没有可展示的页面图，不能据此判断视觉风险。'));
    }
    detailBlocks.push(table(
      [{ title: '项目', width: 30 }, { title: '内容', width: 70 }],
      [
        ['材料类型', typeNames[material.type] || material.type || '未分类'],
        ['文件指纹（SHA-256）', material.fileSha256 ? `${String(material.fileSha256).slice(0, 32)}…` : '未记录'],
        ['页面数', String((material.pages || []).length)],
        ['处理状态', zhStatus(material.status)],
        ['内容格式', material.contentFormat || '未记录'],
      ],
    ));
    // 4.x.2 提取字段（核对文字进入报告）
    const fields = material.fields || [];
    detailBlocks.push(h3('提取字段'));
    if (fields.length) {
      detailBlocks.push(table(
        [{ title: '字段', width: 24 }, { title: '识别内容', width: 30 }, { title: 'OCR 原文', width: 30 }, { title: '页码', width: 8 }, { title: '识别分数', width: 8 }],
        fields.slice(0, 40).map((field) => [
          labelOf(field),
          String(field.value ?? '未提供'),
          field.source?.observedText || '—',
          field.source?.page ? String(field.source.page) : '—',
          percentText(field.confidence) || '—',
        ]),
        { caption: `${material.name || material.id} 提取字段` },
      ));
      if (fields.length > 40) detailBlocks.push(p(`字段较多，仅列出前 40 项，其余 ${fields.length - 40} 项可在平台页面查看。`, { noIndent: true }));
      detailBlocks.push(p('识别分数为文字识别置信度，仅作质量参考；存在识别歧义时以原件为准。', { noIndent: true }));
    } else {
      detailBlocks.push(p('本材料未提取到可核验的结构化字段。'));
    }
    // 4.x.3 处理阶段
    const stages = material.stages || {};
    const stageRows = Object.entries(stageNames)
      .filter(([key]) => stages[key])
      .map(([key, label]) => {
        const stage = stages[key] || {};
        let note = '';
        if (key === 'mirror' && Number.isFinite(stage.score)) note = `（分数 ${percentText(stage.score)}，未校准）`;
        if (key === 'seed') {
          const count = (stage.regions || stage.candidates || []).length;
          note = stage.status === 'completed' ? (count ? `（${count} 处候选）` : '（未见候选）') : '';
        }
        return [label, zhStatus(stage.status), `${stage.reason ? `${stage.reason}；` : ''}${stage.message || ''}${note}`.replace(/[；,]$/, '') || '—'];
      });
    detailBlocks.push(h3('处理阶段'));
    detailBlocks.push(stageRows.length
      ? table([{ title: '阶段', width: 22 }, { title: '状态', width: 18 }, { title: '说明', width: 60 }], stageRows)
      : p('本材料无阶段记录。'));
    // 4.x.4 单份核验结果
    const checks = material.checks || [];
    detailBlocks.push(h3('单份核验结果'));
    detailBlocks.push(checks.length
      ? table(
        [{ title: '核验项', width: 24 }, { title: '结论', width: 14 }, { title: '说明', width: 62 }],
        checks.map((check) => [check.title || check.rule || '核验项', zhStatus(check.status), check.explanation || check.message || check.reason || '—']),
        { caption: `${material.name || material.id} 单份核验结果` },
      )
      : p('本材料没有可执行的检查项；不代表材料内容已经通过核验。'));
  }

  // 5 跨材料核验（围绕核心材料的关联与比较）
  const crossBlocks = [];
  const edges = plan.edges || [];
  const ruleNames = {
    same_voucher_content: '同凭证内容比对', same_transaction_amount: '同交易金额比对',
    same_identifier_content: '同标识内容比对', duplicate_material: '重复材料核对',
  };
  const crossCandidates = (review.candidates || [])
    .map((candidate) => ({
      candidate,
      materialIds: [...new Set((candidate.evidence || []).map((ref) => ref.materialId).filter(Boolean))],
    }))
    .filter(({ materialIds }) => materialIds.length >= 2);
  if (edges.length || crossCandidates.length || review.pairs?.length || review.unresolvedConfirmations?.length) {
    if (edges.length) {
      crossBlocks.push(p(`本次围绕核心材料建立 ${edges.length} 条关联关系；仅核对有依据的主体、交易与时间关系，同批上传不代表关联已确认。`));
      crossBlocks.push(table(
        [{ title: '核心材料', width: 40 }, { title: '辅助材料', width: 40 }, { title: '关联依据', width: 20 }],
        edges.map((edge) => [names[edge.coreMaterialId] || edge.coreMaterialId || '—', names[edge.auxiliaryMaterialId] || edge.auxiliaryMaterialId || '—', edge.kind || edge.reason || '同批上传']),
        { caption: '核心关联关系' },
      ));
    }
    if (crossCandidates.length) {
      crossBlocks.push(p(`围绕核心材料执行跨材料比较 ${crossCandidates.length} 组，结果如下：`));
      const evidenceSummary = (candidate) => {
        const lines = (candidate.evidence || []).map(evidenceText).filter(Boolean);
        if (!lines.length) return '—';
        const shown = lines.slice(0, 4).map((line) => line.replace(/（[^（）]*）/g, '').trim());
        return lines.length > shown.length ? `${shown.join('；')} 等 ${lines.length} 项` : shown.join('；');
      };
      crossBlocks.push(table(
        [{ title: '比对项', width: 20 }, { title: '结论', width: 12 }, { title: '涉及材料', width: 32 }, { title: '比对内容', width: 36 }],
        crossCandidates.slice(0, 15).map(({ candidate, materialIds }) => [
          ruleNames[candidate.rule] || '内容比对',
          zhStatus(candidate.status),
          materialIds.map((id) => names[id] || id).join('、'),
          evidenceSummary(candidate),
        ]),
        { caption: '跨材料比较结果' },
      ));
    }
    const pairs = review.pairs || [];
    if (pairs.length) {
      crossBlocks.push(p(`跨材料比较 ${pairs.length} 组，比较内容与差异如下：`));
      crossBlocks.push(list(pairs.slice(0, 20).map((pair) => {
        const left = evidenceText(pair.left ?? pair.a) || '';
        const right = evidenceText(pair.right ?? pair.b) || '';
        const verdict = pair.status ? zhStatus(pair.status) : '';
        return [pair.title || pair.key || '内容比较', verdict, left, right && `对比：${right}`].filter(Boolean).join('｜');
      })));
    }
    const unresolved = review.unresolvedConfirmations || [];
    if (unresolved.length) {
      crossBlocks.push(p('以下关联待人工确认，未参与自动比较：'));
      crossBlocks.push(list(unresolved.map((item) => `${names[item.materialId] || '辅助材料'}：${item.message || item.reason || '关联依据不足'}`)));
    }
  }

  // 6 智能复核（条件章节）
  const aiBlocks = [];
  const ai = data?.presentation?.aiReview || {};
  if (['completed', 'succeeded', 'partial'].includes(ai.status)) {
    if (ai.summary) aiBlocks.push(p(ai.summary));
    const findings = (ai.findings || []).slice(0, 12);
    for (const finding of findings) {
      aiBlocks.push(h2(finding.title || '复核事项'));
      aiBlocks.push(p(finding.explanation || finding.message || finding.detail || finding.summary || '请核对所引用的材料内容。'));
      const lines = (finding.evidence || []).map(evidenceText).filter(Boolean);
      if (lines.length) { aiBlocks.push(p('核验内容：')); aiBlocks.push(list(lines.slice(0, 8))); }
    }
    aiBlocks.push(p('智能复核结论为辅助参考，不构成新增鉴伪证据；本地确定结论不因复核而改变。', { noIndent: true }));
  }

  // 7 核验说明与限制
  const noteItems = [
    '本报告由 VERITAS 智鉴在本地生成，汇总本次核验实际返回的结果。',
    '核验仅覆盖已提取字段和已配置规则；号码格式与关联信息校验不等于税务查验或身份真实性核验。',
    '文字识别可能存在歧义，提取字段与原文引用均为当前提交材料中的可见内容，不是篡改前的真实值。',
    '整图与篡改分数为未校准模型信号；疑似修改位置需结合原件与字段复核。',
    ...(Array.isArray(data?.limitations) ? data.limitations : []),
  ];

  // 附录 A 版本信息
  const versionRows = [];
  if (review.engineVersion) versionRows.push(['核验引擎', String(review.engineVersion)]);
  if (review.batchVersion) versionRows.push(['规则目录版本', String(review.batchVersion)]);
  if (review.plan?.version) versionRows.push(['核验方案版本', String(review.plan.version)]);
  for (const material of materials) {
    const mirror = material.stages?.mirror, seed = material.stages?.seed;
    if (mirror?.model) versionRows.push([`整图检测（${material.name || material.id}）`, String(mirror.model)]);
    if (seed?.model) versionRows.push([`篡改定位（${material.name || material.id}）`, String(seed.model)]);
  }

  const chapters = [
    chapter('核验结论', conclusionBlocks),
    chapter('核验范围与材料', scopeBlocks),
    chapter('需要关注的问题', issueBlocks),
    chapter('各材料核验详情', detailBlocks),
  ];
  if (crossBlocks.length) chapters.push(chapter('跨材料核验', crossBlocks));
  if (aiBlocks.length) chapters.push(chapter('智能复核', aiBlocks));
  chapters.push(chapter('核验说明与限制', [list([...new Set(noteItems)])]));
  if (versionRows.length) chapters.push(chapter('版本信息', [table([{ title: '组件', width: 36 }, { title: '版本 / 模型', width: 64 }], versionRows, { caption: '版本信息' })], { appendix: true }));

  return createStdReport({
    docTitle: '材料核验报告',
    subtitle: `${objective} · ${materials.length} 份材料`,
    scenario: 'image-documents',
    generatedAt,
    reportNo,
    meta: meta1,
    chapters,
  });
}
