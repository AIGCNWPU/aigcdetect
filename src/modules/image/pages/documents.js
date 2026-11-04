import { documentRegions } from "../documents/regions.js";
import { invoiceShowcase } from "../documents/example.js";
import { api } from "../../../api.js";

const docEscape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const docFormats = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const docStatus = {
  queued: "等待处理",
  running: "正在核验",
  completed: "已完成",
  succeeded: "已完成",
  partial: "部分完成",
  failed: "处理失败",
  not_run: "未执行",
  resource_limit: "超过处理限制",
  PASS: "本项通过",
  FAIL: "发现矛盾",
  WARN: "需要复核",
  NEI: "证据不足",
  NOT_APPLICABLE: "不适用",
  ERROR: "检查失败",
};
const docTypes = {
  unknown: "未分类",
  digital_invoice: "数电发票",
  invoice: "增值税发票",
  receipt: "收据 / 付款凭证",
  identity: "身份证",
  certificate: "证明",
  contract: "合同",
  order: "订单",
  bank_receipt: "银行付款回单",
  bank_statement: "银行流水",
  acceptance_record: "验收记录",
  delivery_note: "交付单",
  reimbursement_form: "报销单",
  research_approval: "科研审批",
  project_approval: "项目审批",
  travel_approval: "出差审批",
  household_register: "户籍材料",
  application_form: "申请表",
  authorization: "授权书",
};
export const documentReviewFunctions = {
  invoice_review: "发票核验",
  procurement_review: "采购履约核验",
  merchant_reconciliation: "收付款核对",
  research_reimbursement: "报销材料核验",
  identity_consistency: "身份材料核对",
};
const docMaterialTips = {
  invoice_review: "可用发票作为核心，附合同、付款回单与验收资料。",
  procurement_review: "可用合同或订单作为核心，附发票、交付与付款资料。",
  merchant_reconciliation: "可用收据或订单作为核心，附流水、退款与手续费说明。",
  research_reimbursement:
    "可用发票或报销单作为核心，附项目审批、采购合同与验收记录。",
  identity_consistency:
    "可用身份证或申请表作为核心，附与核验目的相关的证明材料。",
};
const docFieldRoles = {
  buyer: "购方",
  seller: "销方",
  subject: "本人 / 主体",
  payer: "付款方",
  payee: "收款方",
  transaction: "交易",
};
const docFields = {
  invoice_status_declaration: "票面状态声明",
  gross_amount_words: "大写金额",
  name: "姓名 / 名称",
  identity_number: "身份证号",
  tax_identifier: "纳税人识别号",
  invoice_number: "发票号码",
  invoice_code: "发票代码",
  gross_amount: "价税合计",
  net_amount: "不含税金额",
  tax_amount: "税额",
  payment_amount: "付款金额",
  birth_date: "出生日期",
  issue_date: "开具日期",
  invoice_date: "发票日期",
  transaction_date: "交易日期",
  transaction_number: "交易编号",
  gender: "性别",
  current_address: "现住址",
  registered_address: "登记地址",
  amount_uppercase: "大写金额",
};
function docFieldLabel(field) {
  const labels = {
    original_voucher_number:"原凭证号",displayed_payment_time:"交易时间",amount_due:"应缴金额",displayed_document_number:"证件号码",current_income_amount:"本期收入",authorized_agent:"委托代理人",legal_representative:"法定代表人",application_id:"小程序编号",application_name:"小程序名称",shop_url:"店铺地址",declaration_date:"申报日期",income_amount:"收入金额",declared_tax_amount:"已申报税额", phone_number:"联系电话", displayed_receipt_total:"票面合计", displayed_cash:"现金付款", business_credit_code:"统一社会信用代码", authorization_contract_number:"授权合同编号", authorization_start_date:"授权开始日期", authorization_end_date:"授权结束日期", employment_start_date:"入职日期", registration_date:"注册日期", dispatch_number:"出库编号", dispatch_items:"出库明细", customer_contact:"客户", item_description: "商品或服务", quantity: "数量", unit_price: "单价",
    line_net_amount: "明细金额", line_tax_amount: "明细税额", tax_rate: "税率",
    certificate_number: "证明编号", certificate_reference: "文书编号",
    issuing_authority: "出具机关", tax_type: "税种", tax_period: "税款所属期",
    treasury_date: "入退库日期", paid_tax_amount: "已缴税额", tax_status_date: "纳税状态日期",
    account_list: "账户清单", payment_account: "付款账户", household_number: "户号",
    order_number: "订单编号", order_total: "订单金额", displayed_order_date: "订单显示日期",
    contract_number: "合同编号", contract_total: "合同金额", loan_amount: "借款金额",
    loan_date: "借款日期", repayment_date: "还款日期", commitment_end_date: "承诺截止日期",
    monthly_rent: "月租金", deposit_months: "押金月数", prepaid_months: "预付月数",
    initial_payment: "首付款", initial_payment_composition: "首付款组成", payment_adjustment: "金额调整",
  };
  const base = docFields[field.key] || labels[field.key] || "相关内容";
  const role = {buyer:"购买方",seller:"销售方",payer:"付款方",payee:"收款方",borrower:"借款人",lender:"出借人",tenant:"承租人",landlord:"出租人",operator:"经营者",grantee:"被授权人",grantor:"授权方",recipient:"收货方",issuer:"出具方",party_a:"甲方",party_b:"乙方",lessor:"出租人",lessee:"承租人",lessee_representative:"承租方签字代表",taxpayer:"纳税人",withholding_agent:"扣缴义务人",holder:"持证人",account_holder:"账户主体"}[field.role];
  return role && ["name","identity_number","tax_identifier","registered_address","current_address","phone_number","authorized_agent","legal_representative"].includes(field.key)
    ? `${role}${field.key === "name" ? (["operator","grantee","borrower","lender","tenant","landlord","lessor","lessee_representative"].includes(field.role) ? "姓名" : "名称") : base}` : base;
}
function docFieldValue(field) {
  const value = String(field.value ?? "未提供");
  if (/^\s*\[/.test(value)) {
    try {
      const rows = JSON.parse(value);
      if (Array.isArray(rows)) return `<ul>${rows.map((row, i) => {
        if (typeof row !== "object" || row === null) return `<li>${docEscape(row)}</li>`;
        const labels = {item_code:"商品编号",item_description:"商品",specification:"规格",quantity:"数量",taxType:"税种",value:"内容",unit:"单位"};
        return `<li>${Object.entries(row).filter(([key]) => labels[key]).map(([key, item]) => `${labels[key]}：${docEscape(item)}`).join("；") || `第${i + 1}项内容待确认`}</li>`;
      }).join("")}</ul>`;
    } catch { /* Not a structured field: retain displayed text. */ }
  }
  return `<strong>${docEscape(value)}</strong>`;
}
const docReasons = {
  calendar_date_only: "核验显示日期是否符合日历规则。",
  invoice_number_length_only: "核验票号格式；未查询税务登记真实性。",
  pre_national_rollout_requires_regional_rule:
    "该日期早于全国数电票推广，需要适用地区与试点时期的规则依据。",
  displayed_upper_lower_amount_consistency:
    "核对显示的大写金额与小写金额是否一致。",
  no_confirmed_core_relationship: "未确认与核心材料的关联，本次不直接比较。",
  duplicate_source_excluded: "重复来源已排除，避免重复计入。",
  material_type_outside_objective: "材料类型不在本次核验目标范围内。",
  objective_scope_not_configured: "当前目标缺少适用规则。",
  no_supported_fields: "未提取到可用于规则核验的字段。",
  institution_policy_not_configured: "尚未配置本机构的具体审核政策。",
  core_material_type_outside_objective: "核心材料类型与核验目的不匹配。",
  jurisdiction_rule_pack_not_configured: "当前地区尚无专用规则包。",
  engineering_rule_scope_only:
    "本目标的基础规则适用，不代表材料真实性已经通过。",
  confirmation_role_or_evidence_unavailable:
    "已记录您的关联声明，但提取字段不足以按声明角色核对。",
  no_comparable_fields_for_relation: "已关联材料缺少可以比较的对应字段。",
  missing_or_ambiguous_role_field: "对应角色的字段缺失或存在多个候选。",
  debug_only_disabled: "本次未调用外部解释服务。",
  user_disabled: "您已关闭本阶段检测。",
  no_rendered_page: "没有可检测的页图。",
  relationship_or_role_not_confirmed:
    "材料间的主体或交易关系尚未确认，请补充关联依据。",
  recognition_requires_review: "文字识别存在歧义，请核对原材料。",
  missing_or_ambiguous_amounts: "金额字段缺失或存在多个候选值。",
  displayed_amount_arithmetic_only: "核验本材料显示的不含税金额、税额与合计。",
  confirmed_relation_calendar_date_comparison: "核对已确认关联材料的日期。",
  same_scope_amount_comparison: "核对同一交易与金额口径下的金额。",
  field_rule_not_configured: "该字段尚未配置适用规则。",
  effective_period_not_comparable: "材料的有效时间未明确，暂不能直接比较。",
  incomplete_or_unconfirmed_settlement_scope: "付款集合或核验范围尚不完整。",
  same_invoice_not_confirmed: "尚未确认材料对应同一张发票。",
  missing_field_value: "缺少可核验的字段值。",
  amount_scope_or_basis_not_confirmed: "金额范围或含税口径尚未确认。",
  not_requested: "本次未启用解释。",
  disabled: "本次未启用解释。",
  no_suspicious_region: "未触发疑似修改解释。",
};

export function validateDocumentFiles(existing, incoming) {
  const accepted = [],
    errors = [];
  let total = existing.reduce((sum, file) => sum + file.size, 0);
  for (const file of incoming) {
    const extension = file.name.toLowerCase().split(".").pop();
    let error;
    if (extension === "doc")
      error = "旧版 DOC 暂不支持，请另存为 DOCX 或 PDF 后上传";
    else if (!docFormats[extension]) error = "仅支持 PNG、JPG、PDF 和 DOCX";
    else if (!file.size) error = "文件为空";
    else if (file.size > 12 * 1024 * 1024) error = "单个文件不能超过 12 MB";
    else if (existing.length + accepted.length >= 10)
      error = "每批最多 10 个文件";
    else if (total + file.size > 24 * 1024 * 1024)
      error = "本批文件总大小不能超过 24 MB";
    if (error) errors.push(`${file.name}：${error}`);
    else {
      accepted.push(file);
      total += file.size;
    }
  }
  return { accepted, errors };
}

export async function createDocumentReviewPayload(state) {
  if (!state.files.length) throw new Error("请先添加材料。");
  if (!state.files.some((item) => item.id === state.coreMaterialId))
    throw new Error("请选择一份核心材料。");
  const files = [];
  for (const item of state.files) {
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 16384)
      binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    files.push({
      id: item.id,
      name: item.file.name,
      mediaType: docFormats[item.file.name.toLowerCase().split(".").pop()],
      materialType: item.materialType || "unknown",
      contentBase64: btoa(binary),
    });
  }
  const confirmations = Object.entries(state.confirmations || {})
    .filter(([, value]) => value.enabled)
    .map(([materialId, value]) => {
      if (!value.reason?.trim())
        throw new Error("请填写已确认材料关联的依据。");
      return {
        materialId,
        kind: "same_transaction",
        coreRole: "transaction",
        auxiliaryRole: "transaction",
        reason: value.reason.trim(),
        amountScopeConfirmed: value.amount === true,
        dateScopeConfirmed: false,
        documentScopeConfirmed: value.invoice === true,
      };
    });
  return {
    action: "review",
    confirmations,
    objective: state.objective,
    jurisdiction: state.jurisdiction || "CN",
    coreMaterialId: state.coreMaterialId,
    context: {
      region: Object.hasOwn(documentRegions, state.region) ? state.region : "unspecified",
      ...(state.businessDate ? { businessDate: state.businessDate } : {}),
    },
    files,
    relations: [],
    options: {
      runModels: state.runModels !== false,
      explain: false,
      semanticReview: state.semanticReview !== false,
      privacyMode: state.privacyMode === "original" ? "original" : "redacted",
    },
  };
}

export function documentRegionStyle(region, size) {
  const box = region?.box;
  if (
    !Array.isArray(size) ||
    size.length !== 2 ||
    !size.every((n) => Number.isFinite(n) && n > 0) ||
    !Array.isArray(box) ||
    box.length !== 4 ||
    !box.every(Number.isFinite)
  )
    return null;
  const [x1, y1, x2, y2] = box,
    [w, h] = size;
  if (x1 < 0 || y1 < 0 || x2 > w || y2 > h || x2 <= x1 || y2 <= y1) return null;
  return `left:${(x1 / w) * 100}%;top:${(y1 / h) * 100}%;width:${((x2 - x1) / w) * 100}%;height:${((y2 - y1) / h) * 100}%`;
}
function docBadge(status) {
  const tone = ["FAIL", "failed", "ERROR"].includes(status)
    ? "danger"
    : ["PASS", "completed", "succeeded"].includes(status)
      ? "success"
      : "muted";
  return `<span class="doc-badge doc-${tone}">${docEscape(docStatus[status] || "待复核")}</span>`;
}
function docReason(item) {
  if (item.reason === 'identity_format_not_18_digits_or_ocr_ambiguity') {
    const value = String(item.evidence?.[0]?.value || '');
    return `身份证号应为18位，当前内容为${value.length}位：${value}。请核对号码。`;
  }
  const specific = {
    identity_impossible_birth_date: '身份证号码中的出生日期无效，请核对号码中的年月日。',
    identity_checksum_mismatch: '身份证号码末位校验不匹配，请核对号码是否有误。',
    identity_structure_checksum_only: '身份证号码位数、出生日期及校验位符合要求。',
    account_set_difference_not_automatic_violation: '材料列出的账户不同，请核对下方各份材料的账户内容。',
    account_sets_equal: '各份材料列出的账户一致。',
  };
  if (specific[item.reason]) return specific[item.reason];

  const value = item.message || item.explanation || item.reason || item.summary || "";
  return (
    docReasons[value] ||
    (/[\u3400-\u9fff]/.test(value)
      ? value
      : item.status === "FAIL"
        ? "本项发现不一致，请核对下方字段及来源。"
        : item.status === "PASS"
          ? "已完成本项内容核验；仅代表此项规则满足。"
          : "该项缺少充分依据，请核对材料及适用范围。")
  );
}
function docMaterialIds(item) {
  return [...new Set([item.materialId, ...(item.materialIds || []),
    ...(item.evidence || []).map(ref => ref.materialId)].filter(Boolean))];
}
function docEvidence(refs = [], names = {}) {
  if (!refs.length) return '<p class="doc-muted">本项暂无可展示的核验内容，请结合原件核对。</p>';
  return `<div class="doc-evidence">${refs.map(ref => {
    const source = ref.source || {};
    return `<div class="doc-evidence-item"><p><strong>${docEscape(names[ref.materialId] || "本材料")}</strong> · ${docEscape(docFieldLabel(ref))}${source.page ? ` · 第 ${docEscape(source.page)} 页` : ""}</p><p>核验内容：${docFieldValue(ref)}</p></div>`;
  }).join("")}</div>`;
}
const docHiddenReasons = new Set(['historical_region_table_not_configured', 'missing_or_ambiguous_related_field', 'identity_or_related_field_requires_review', 'no_confirmed_core_relationship', 'institution_policy_not_configured']);
const docCheckTitles = {identity_structure:'身份证号码核验', identity_birth_date:'出生日期核对', identity_gender:'性别核对', identity_historical_region:'登记地区核对'};
export function groupDocumentChecks(items = []) {
  const groups = new Map();
  for (const item of items) {
    if (docHiddenReasons.has(item.reason)) continue;
    const key = item.rule || item.title || "材料内容核对";
    if (!groups.has(key)) groups.set(key, { title: item.title || docCheckTitles[item.rule] || "材料内容核对", items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}
function docGroupedChecks(items, names) {
  return groupDocumentChecks(items).map(group => `<div class="doc-issue"><h4>${docEscape(group.title)} · ${group.items.length} 项</h4><table><thead><tr><th>核对项</th><th>结果与说明</th><th>核验内容</th></tr></thead><tbody>${group.items.map(item => `<tr><td>${[...new Set((item.evidence || []).map(docFieldLabel))].map(docEscape).join("、") || "材料内容"}</td><td>${item.rule === "identity_structure" && item.status === "FAIL" ? '<span class="doc-badge doc-danger">号码异常</span>' : docBadge(item.status)}<p>${docEscape(docReason(item))}</p></td><td>${docEvidence(item.evidence, names)}</td></tr>`).join("")}</tbody></table></div>`).join("");
}
export function renderDocumentChecks(checks = [], names = {}) {
  const visible = (Array.isArray(checks) ? checks : []).filter(item => !docHiddenReasons.has(item.reason));
  const conflicts = visible.filter(item => ['FAIL','WARN'].includes(item.status));
  const passed = visible.filter(item => item.status === 'PASS');
  return `<div class="doc-facts">${[['疑似矛盾事实', conflicts], ['已通过事实', passed]].map(([label,items]) => `<details class="doc-details doc-fact-group ${label==='疑似矛盾事实'?'doc-fact-warning':'doc-fact-passed'}"><summary>${label}<span class="doc-fact-count">${items.length}</span></summary>${items.length ? docGroupedChecks(items,names) : '<p class="doc-muted">暂无可展示结果。</p>'}</details>`).join('')}</div>`;
}

function docStage(title, stage, note) {
  const value = stage || { status: "not_run" };
  const scored=['completed','partial','succeeded'].includes(value.status)&&Number.isFinite(value.score);
  const result=scored ? (value.score>=.5 ? (title==='图像真实性'?'发现疑似AI生成线索':'发现疑似修改线索') : (title==='图像真实性'?'未发现明显AI生成线索':'未发现明显修改线索')) : '';
  return `<div class="doc-stage"><h4>${title}</h4>${result?`<p><strong>${result}</strong></p>`:''}${docBadge(value.status)}${Number.isInteger(value.completedPages) ? `<p>覆盖 ${value.completedPages} / ${value.totalPages} 页</p>` : ""}<p>${docEscape(note)}</p></div>`;
}
const docReviewReasons = {
  not_requested: "本次仅进行本地核验。",
  user_disabled: "本次仅进行本地核验。",
  disabled: "本次仅进行本地核验。",
  not_configured: "智能复核服务尚未配置，相关事项仍待核查。",
  provider_disabled: "智能复核服务暂未启用，相关事项仍待核查。",
  unsupported_model: "智能复核服务配置需更新，相关事项仍待核查。",
  provider_not_configured: "智能复核服务尚未配置，相关事项仍待核查。",
  no_pending_items: "本次没有可交由智能复核的待审事项；其他补证项请查看上方说明。",
  task_budget_exhausted: "本次智能复核额度已用完，相关事项仍待核查。",
  no_semantic_items: "本次没有需要进一步理解的内容。",
  no_review_needed: "本次没有需要进一步理解的内容。",
  budget_exhausted: "本次智能复核额度已用完，相关事项仍待核查。",
};
export function readableReviewText(value,aliases={},names={}) {
  return String(value||'')
    .replace(/[（(]\s*(?:[eq]\d+[\s、,，/与和及至—–-]*)+[）)]/gi,'')
    .replace(/(?<![A-Za-z0-9])[eq]\d+(?![A-Za-z0-9])/gi,'')
    .replace(/(?<![A-Za-z0-9])m(\d+)(?![A-Za-z0-9])/gi,(whole,n)=>names[aliases[whole]]||`材料${n}`)
    .replace(/\(\s*\)|（\s*）/g,'').replace(/[,，、/]{2,}/g,'、').replace(/(?:evidenceComplete=false|unsupported_field)/g,'部分内容尚待确认');
}
function docScopedItems(data, selectedId, scope) {
  const materials=data?.materials || [];
  const assessment=data?.review?.executionAssessment?.items || [];
  const resolve=item=>{
    const origin=assessment.find(a=>a.id===item.assessmentId || a.id===item.id);
    const combined=origin ? {...origin,...item,evidence:item.evidence?.length?item.evidence:origin.evidence,materialIds:item.materialIds?.length?item.materialIds:origin.materialIds} : item;
    combined.evidence=(combined.evidence||[]).map(ref=>{const m=materials.find(m=>m.id===ref.materialId)||data?.batch?.materials?.find(m=>m.id===ref.materialId);const f=m?.fields?.find(f=>f.id===ref.fieldId),b=m?.textBlocks?.find(b=>b.id===ref.blockId);return f?{...f,...ref}:b?{...ref,key:ref.key||'content',value:ref.value??b.text,source:{page:b.page,...ref.source}}:ref;}).filter(ref=>ref.value!==undefined||ref.source?.observedText);
    return combined;
  };
  const relevant=item=>{
    const ids=docMaterialIds(item);
    return (!selectedId || ids.includes(selectedId) || (materials.length===1&&!ids.length)) && (!scope || (scope==='cross' ? ids.length>1 : ids.length<=1));
  };
  const checks=[...materials.flatMap(m=>(m.checks||[]).map(c=>({...c,materialId:m.id}))), ...(data?.review?.candidates||[]), ...(data?.review?.checks||data?.review?.results||[])];
  const warnings=(data?.presentation?.warnings||[]).filter(i=>!/^visual-|^origin-|^semantic-/.test(i.id||''));
  const facts=[],seen=new Set();
  for(const raw of [...checks,...warnings]) {
    const item=resolve(raw);
    if(!relevant(item))continue;
    if(!item.status)item.status='WARN';
    const key=JSON.stringify([item.rule||item.title,item.status,docMaterialIds(item).sort(),(item.evidence||[]).map(e=>[e.materialId,e.fieldId,e.key,e.value])]);
    if(!seen.has(key)){seen.add(key);facts.push(item);}
  }
  const ai=data?.presentation?.aiReview || {status:'not_run'};
  const findings=['completed','succeeded','partial'].includes(ai.status) ? (ai.findings||[]).map(resolve).filter(relevant).sort((a,b)=>({issues_found:0,reasonable:1,needs_more_information:2}[a.verdict]??2)-({issues_found:0,reasonable:1,needs_more_information:2}[b.verdict]??2)) : [];
  return {facts,ai,findings};
}
export function renderDocumentPresentation(data, names = {}, selectedId = null, scope = null) {
  const {facts,ai,findings}=docScopedItems(data,selectedId,scope);
  const status={completed:'已完成',succeeded:'已完成',partial:'部分完成',failed:'未能完成'}[ai.status]||'未执行';
  const heading=scope==='cross'?'跨文件智能核查':'本文件智能核查';
  const summary= !scope && ['completed','succeeded'].includes(ai.status) && (data?.materials||[]).length<=1 ? ai.summary : '';
  const message=['completed','succeeded','partial'].includes(ai.status)?'暂无可展示的智能核查结论。':docReviewReasons[ai.reason]||'尚未取得智能核查结果。';
  const clean=text=>docEscape(readableReviewText(text,ai.materialAliases||{},names));
  const groups=new Map();
  for(const item of findings){const key=JSON.stringify([docMaterialIds(item).sort(),item.verdict]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
  const blocks=[...groups.values()].map(items=>{
    const item=items[0],pending=item.verdict==='needs_more_information';
    const title=item.verdict==='issues_found'?'发现需要核对的内容':pending?'信息不足，待进一步确认':'已核对内容未见矛盾';
    const explanations=[...new Set(items.map(i=>readableReviewText(i.explanation||i.message||i.summary,ai.materialAliases||{},names)).filter(Boolean))];
    const warnings=[...new Set(items.map(i=>readableReviewText(i.warning,ai.materialAliases||{},names)).filter(Boolean))];
    const refs=[...new Map(items.flatMap(i=>i.evidence||[]).map(e=>[JSON.stringify([e.materialId,e.fieldId,e.blockId,e.value]),e])).values()];
    const body=`${warnings.length?`<p class="doc-smart-warning">${docEscape(warnings[0])}</p>`:''}<details class="doc-details"><summary>查看核验内容与说明</summary>${warnings.slice(1).map(t=>`<p>${docEscape(t)}</p>`).join('')}${explanations.map(t=>`<p>${docEscape(t)}</p>`).join('')}${docEvidence(refs,names)}</details>`;
    return pending?`<details class="doc-smart-pending"><summary>${title}</summary>${explanations.map(t=>`<p>${docEscape(t)}</p>`).join('')}${docEvidence(refs,names)}</details>`:`<article class="doc-smart-finding"><h4>${title}</h4><p class="doc-muted">${docMaterialIds(item).map(id=>docEscape(names[id]||'相关材料')).join(' · ')}</p>${body}</article>`;
  }).join('');
  return `<section class="doc-smart-review"><div class="doc-row"><h3>${heading}</h3><span class="doc-badge doc-muted">${status}</span></div><p>智能识别材料矛盾内容。</p>${summary?`<p>${clean(summary)}</p>`:''}${blocks||`<p class="doc-muted">${docEscape(message)}</p>`}</section>${renderDocumentChecks(facts,names)}`;
}
export function bindDocumentNavigation(container) {
  container.querySelectorAll('[data-doc-view-locations]').forEach(button=>button.addEventListener('click',()=>{
    const viewer=button.closest('[data-doc-result]')?.querySelector('[data-doc-location-viewer]');
    if(viewer&&!viewer.open)viewer.showModal();
  }));
  container.querySelectorAll('[data-doc-location-viewer]').forEach(viewer=>{
    viewer.querySelector('[data-doc-close-viewer]')?.addEventListener('click',()=>viewer.close());
    viewer.addEventListener('click',event=>{if(event.target===viewer)viewer.close();});
    viewer.querySelector('[data-doc-zoom]')?.addEventListener('input',event=>{viewer.style.setProperty('--doc-zoom',event.target.value+'%');viewer.querySelector('output').textContent=event.target.value+'%';});
    viewer.querySelector('[data-doc-show-marks]')?.addEventListener('change',event=>{viewer.querySelectorAll('.doc-regions').forEach(layer=>{layer.hidden=!event.target.checked;});});
  });
  container.querySelectorAll('[data-doc-target]').forEach(button=>button.addEventListener('click',()=>{
    const target=button.dataset.docTarget;
    if(!['generation','tamper','local','cross'].includes(target))return;
    const section=button.closest('[data-doc-result]')?.querySelector(`[data-doc-section="${target}"]`);
    button.closest('[data-doc-result]')?.querySelectorAll('[data-doc-target]').forEach(item=>item.setAttribute('aria-current',String(item===button)));
    section?.scrollIntoView({behavior:'smooth',block:'start'});
    section?.focus({preventScroll:true});
  }));
}
export function bindDocumentExample(container, onChange = () => {}) {
  const tabs = Array.from(container.querySelectorAll('[data-doc-example-tab]'));
  if (!tabs.length) return;
  const select = (id, focus) => {
    const tab = tabs.find(item => item.dataset.docExampleTab === id) || tabs[0];
    if (!tab) return;
    for (const item of tabs) {
      const on = item === tab;
      item.setAttribute('aria-selected', String(on));
      item.tabIndex = on ? 0 : -1;
      const panel = container.querySelector(`[data-doc-example-panel="${item.dataset.docExampleTab}"]`);
      if (panel) panel.hidden = !on;
    }
    onChange(tab.dataset.docExampleTab);
    if (focus) tab.focus();
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab.dataset.docExampleTab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      select(tabs[next].dataset.docExampleTab, true);
    });
  }
}
export function renderDocumentResult(data, selectedId, sourceFiles = []) {
  const materials = Array.isArray(data?.materials) ? data.materials : [],
    material = materials.find((item) => item.id === selectedId) || materials[0],
    names = Object.fromEntries(materials.map((item) => [item.id, item.name])),
    review = data?.review || {};
  const coreName = names[review.plan?.coreMaterialId] || materials[0]?.name || '未指定';
  if (!material) return '<p class="doc-empty">尚无材料处理结果。</p>';
  const source = sourceFiles.find((item) => item.id === material.id),
    pages = Array.isArray(material.pages) ? material.pages : [],
    fields = Array.isArray(material.fields) ? material.fields : [],
    stages = material.stages || {};
  const previews = pages
    .map((page) => {
      const preview =
        /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
          page.previewDataUrl || "",
        )
          ? page.previewDataUrl
          : pages.length === 1 && source?.file?.type.startsWith("image/")
            ? source.preview
            : null;
      const regions = (page.regions || [])
        .map((region) => documentRegionStyle(region, page.rendered_size))
        .filter(Boolean);
      return `<figure class="doc-page"><figcaption>第 ${docEscape(page.page || page.number || 1)} 页 ${docBadge(page.status)}</figcaption>${preview ? `<div class="doc-image"><img src="${docEscape(preview)}" alt="${docEscape(material.name)} 第 ${docEscape(page.page || page.number || 1)} 页"><div class="doc-regions" aria-label="疑似修改区域">${regions.map((style, i) => `<span style="${style}" title="疑似修改区域 ${i + 1}"></span>`).join("")}</div></div>` : '<p class="doc-empty">没有可展示的页图，不能据此判断视觉风险。</p>'}${regions.length ? `<p class="doc-region-note">疑似修改位置</p>` : ""}</figure>`;
    })
    .join("");
  const moduleHead=(step,title,subtitle)=>`<header class="doc-module-heading"><span class="doc-step-number">${step}</span><div><h3>${title}</h3><p>${subtitle}</p></div></header>`;
  return `<div data-doc-result class="doc-report"><header class="doc-report-heading"><div><span class="doc-eyebrow">智鉴 · 材料核验报告</span><h3>${docEscape(material.name)}</h3><p>从图像线索到材料事实，查看本文件的核查结果</p></div><span class="doc-report-mark" aria-hidden="true">▤</span></header><div class="doc-visible-preview"><h4>材料图像与标记</h4>${previews}</div><nav class="doc-result-nav" aria-label="核验模块">${[['generation','AI生成核查'],['tamper','篡改核验'],['local','文件内容'],['cross','交叉内容']].map(([target,label],i)=>`<button type="button" data-doc-target="${target}" aria-current="${i===0?'true':'false'}"><span>0${i+1}</span>${label}</button>`).join('')}</nav><section class="doc-section doc-result-module" data-doc-section="generation" tabindex="-1">${moduleHead('01','AI生成核查','检查材料图像中的生成线索')}<div class="doc-visual-result">${docStage("图像真实性", stages.mirror, "识别图像生成痕迹。")}</div></section><section class="doc-section doc-result-module" data-doc-section="tamper" tabindex="-1">${moduleHead('02','篡改核验','查看疑似修改线索及对应位置')}<div class="doc-visual-result">${docStage("修改位置", stages.seed, "")}<button type="button" class="doc-location-button" data-doc-view-locations${previews.includes('<img ')?'':' disabled'}>查看疑似修改区域</button></div></section><section class="doc-section doc-result-module" data-doc-section="local" tabindex="-1">${moduleHead('03','文件真实性内容核查','核查本文件的事实、条款与内容一致性')}${renderDocumentPresentation(data,names,material.id,'local')}</section><section class="doc-section doc-result-module" data-doc-section="cross" tabindex="-1">${moduleHead('04','交叉内容核查','围绕核心文件核对各份材料中的相关事实')}<div class="doc-core-context">核心材料<span class="doc-core-name">${docEscape(coreName)}</span></div>${renderDocumentPresentation(data,names,material.id,'cross')}</section><dialog class="doc-location-viewer" data-doc-location-viewer aria-label="疑似修改位置"><header><strong>${docEscape(material.name)} · 疑似修改位置</strong><button type="button" data-doc-close-viewer autofocus>关闭</button></header><div class="doc-viewer-tools"><label>缩放 <input type="range" data-doc-zoom min="50" max="250" step="10" value="100"><output>100%</output></label><label><input type="checkbox" data-doc-show-marks checked> 显示标记</label></div><div class="doc-viewer-pages">${previews}</div></dialog></div>`;
}
export function renderDocumentShowcase(activeTab = "") {
  const data = invoiceShowcase,
    id = activeTab || data.materials[0].id;
  const groups = (m) =>
    `<section class="doc-example-group doc-example-issues"><h4>发现异常<small>${m.issues.length} 项</small></h4><ul>${m.issues.map((item) => `<li><strong>${docEscape(item.title)}</strong><p>${docEscape(item.detail)}</p></li>`).join("")}</ul></section><section class="doc-example-group doc-example-passes"><h4>未发现异常<small>${m.passes.length} 项</small></h4><ul>${m.passes.map((item) => `<li><strong>${docEscape(item.title)}</strong><p>${docEscape(item.detail)}</p></li>`).join("")}</ul></section>`;
  return `<section class="doc-example" aria-labelledby="doc-example-title"><header class="doc-example-heading"><div><span class="doc-example-kicker">看见结果 · 看懂核验</span><h2 id="doc-example-title">${docEscape(data.title)}</h2><p>${docEscape(data.subtitle)}</p></div><span class="doc-example-badge">真实核验示例</span></header><div class="doc-example-tabs" role="tablist" aria-label="切换示例材料">${data.materials.map((m) => `<button type="button" role="tab" id="doc-example-tab-${m.id}" aria-selected="${m.id === id}" aria-controls="doc-example-panel-${m.id}" tabindex="${m.id === id ? 0 : -1}" data-doc-example-tab="${m.id}">${docEscape(m.tab)}</button>`).join("")}</div>${data.materials.map((m) => `<div class="doc-example-panel" id="doc-example-panel-${m.id}" role="tabpanel" aria-labelledby="doc-example-tab-${m.id}" data-doc-example-panel="${m.id}"${m.id === id ? "" : " hidden"}><figure class="doc-example-figure"><img src="${docEscape(m.image)}" alt="${docEscape(m.tab)}预览" loading="lazy" width="1000" height="648"><figcaption>${docEscape(m.summary)}</figcaption></figure><div class="doc-example-body"><dl class="doc-example-fields">${m.fields.map((f) => `<div><dt>${docEscape(f.label)}</dt><dd>${docEscape(f.value)}</dd></div>`).join("")}</dl><div class="doc-example-groups">${groups(m)}</div></div></div>`).join("")}<p class="doc-example-note">${docEscape(data.note)}</p></section>`;
}
export const docExampleCss = `.main-content:has(.feature-workspace):has(.doc-workspace){overflow-y:auto}.feature-workspace:has(.doc-workspace){flex:0 0 auto;min-height:auto;height:auto;overflow:visible}.main-content:has(.doc-workspace) .workspace-footer{flex:0 0 auto}.doc-example{margin:34px 0 0;padding:26px;border:1px solid #e6dff0;border-radius:20px;background:radial-gradient(ellipse at 8% 0,#f1eafc 0,transparent 46%),linear-gradient(140deg,#faf8fe,#fff 62%);box-shadow:0 10px 34px #50317807}.doc-example-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px}.doc-example-kicker{font-size:11px;letter-spacing:2px;color:#9879b6}.doc-example-heading h2{font-size:22px;letter-spacing:-.4px;color:#352542;margin:7px 0!important}.doc-example-heading p{font-size:12px;color:#8b8098;margin:0!important;max-width:760px}.doc-example-badge{border:1px solid #e1d6ec;border-radius:20px;background:white;color:#806193;font-size:11px;padding:7px 14px;white-space:nowrap}.doc-example-tabs{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:16px}.doc-example-tabs button{border:1px solid #e3daee!important;background:white!important;color:#7b6a8e!important;font-size:12px;padding:8px 15px!important;border-radius:9px!important}.doc-example-tabs button[aria-selected=true]{background:#7454b6!important;border-color:#7454b6!important;color:white!important;font-weight:600}.doc-example-panel[hidden]{display:none!important}.doc-example-panel{display:grid;grid-template-columns:minmax(0,.72fr) minmax(0,1fr);gap:22px;align-items:start}.doc-example-figure{margin:0;min-width:0}.doc-example-figure img{display:block;width:100%;max-width:390px;height:auto;border-radius:12px;border:1px solid #e6e1ee;background:#f6f4f9;box-shadow:0 8px 20px #26143212}.doc-example-figure figcaption{max-width:390px;font-size:11px;color:#8d8199;margin-top:10px;line-height:1.7}.doc-example-body{min-width:0}.doc-example-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 16px;padding:0}.doc-example-fields>div{border:1px solid #ece6f4;border-radius:8px;background:#ffffffc4;padding:8px 10px;min-width:0}.doc-example-fields dt{font-size:10px;color:#a294b0}.doc-example-fields dd{margin:3px 0 0;font-size:11px;color:#5d4e6b;font-weight:600;overflow-wrap:anywhere}.doc-example-groups{display:grid;grid-template-columns:1fr 1fr;gap:12px}.doc-example-group{border-radius:11px;padding:14px;font-size:11px;min-width:0}.doc-example-group h4{display:flex;align-items:center;gap:8px;font-size:12px!important;margin:0 0 10px!important}.doc-example-group h4 small{font-weight:500;font-size:10px;border-radius:20px;padding:2px 7px;background:#fff9;color:inherit;white-space:nowrap}.doc-example-group ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}.doc-example-group li{min-width:0}.doc-example-group strong{display:block;font-size:11px;line-height:1.6}.doc-example-group p{margin:3px 0 0!important;font-size:10px;line-height:1.7;color:#8b8098;overflow-wrap:anywhere}.doc-example-issues{background:#fffbf7;border:1px solid #f0dfd2}.doc-example-issues h4{color:#a4623f}.doc-example-passes{background:#fafdfa;border:1px solid #dcebe2}.doc-example-passes h4{color:#477a62}.doc-example-note{font-size:10px;color:#9d92a8;margin:14px 0 0!important}@media(max-width:1000px){.doc-example-panel{grid-template-columns:1fr}.doc-example-figure img,.doc-example-figure figcaption{max-width:460px}.doc-example-groups{grid-template-columns:1fr 1fr}}@media(max-width:620px){.doc-example{padding:16px;margin-top:24px}.doc-example-heading{flex-direction:column;gap:10px}.doc-example-heading h2{font-size:18px}.doc-example-fields{grid-template-columns:1fr}.doc-example-groups{grid-template-columns:1fr}.doc-example-figure img,.doc-example-figure figcaption{max-width:none}}`;
const docCss = `.doc-location-button{margin-top:12px;color:#705095!important;border-color:#d9c9e9!important;background:#f8f3fe!important}.doc-location-viewer{width:min(1000px,94vw);max-height:92vh;padding:0;border:1px solid #ddd3ea;border-radius:16px;box-shadow:0 20px 100px #21182d55;color:#333047}.doc-location-viewer::backdrop{background:#1d162c99;backdrop-filter:blur(3px)}.doc-location-viewer>header{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:16px 20px;border-bottom:1px solid #eee8f4}.doc-viewer-tools{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:12px 20px;background:#f8f5fc}.doc-viewer-tools label{display:flex;gap:10px;align-items:center;font-size:12px}.doc-viewer-pages{max-height:70vh;overflow:auto;padding:16px;background:#eeedf2}.doc-viewer-pages .doc-page{width:var(--doc-zoom,100%);max-width:none;margin:0 0 16px}.doc-viewer-pages .doc-image{width:100%}.doc-regions[hidden]{display:none!important}.doc-visible-preview{margin:18px 0;padding:18px;border:1px solid #e9e4f0;border-radius:14px;background:#faf9fc}.doc-visible-preview .doc-page{max-width:440px;margin:12px auto}.doc-visible-preview h4{color:#755d97;font-size:13px}.doc-visible-preview .doc-image{border:1px solid #e4e0eb;border-radius:7px;overflow:hidden}.doc-result-nav{display:flex;flex-wrap:wrap;gap:8px;margin:15px 0}.doc-result-module{scroll-margin-top:90px}.doc-smart-review{background:#f4f0fb;border:1px solid #dacded;border-radius:12px;padding:18px;margin:16px 0}.doc-smart-finding{background:white;border-radius:8px;padding:14px;margin-top:12px}.doc-fact-group>summary{font-size:14px!important}.doc-issue{margin:12px 0}.doc-result-module:focus{outline:2px solid #b29ace;outline-offset:5px;}.doc-workspace{--doc-purple:#7454b6;padding:26px;color:#263146;font-size:13px;line-height:1.65}.doc-workspace *{box-sizing:border-box}.doc-workspace h2{font-size:21px;letter-spacing:-.02em}.doc-workspace h3{font-size:16px;margin:0 0 12px}.doc-workspace h4{font-size:12px;margin:0 0 8px}.doc-workspace p{margin:0 0 8px}.doc-workspace button,.doc-workspace input,.doc-workspace select{font:inherit}.doc-workspace button,.doc-workspace select{border:1px solid #dde1e9;background:white;border-radius:9px;padding:8px 11px;color:inherit}.doc-workspace button{cursor:pointer}.doc-workspace button:disabled{opacity:.5;cursor:not-allowed}.doc-workspace button:focus-visible,.doc-workspace input:focus-visible,.doc-workspace select:focus-visible{outline:3px solid #9d86d2;outline-offset:3px}.doc-core-name{display:inline-block;padding:4px 10px;border:1px solid #d7cbe9;border-radius:7px;background:#f6f2fb;overflow-wrap:anywhere}.doc-row{display:flex;gap:12px;align-items:center;justify-content:space-between}.doc-muted{color:#727d8f;font-size:12px}.doc-grid{display:grid;grid-template-columns:minmax(250px,.85fr) minmax(0,1.6fr);gap:24px;margin-top:22px}.doc-panel{border:1px solid #e6e7ef;border-radius:16px;padding:20px;background:#ffffffb8;min-width:0}.doc-label{display:block;font-weight:600;margin:15px 0 6px}.doc-workspace select{width:100%}.doc-upload{display:block;border:1px dashed #a997c9;border-radius:13px;padding:23px 12px;text-align:center;background:#f8f5fd;cursor:pointer;margin:18px 0 8px}.doc-upload strong{display:block;color:#7051a7;font-size:14px}.doc-upload input{display:block;max-width:100%;font-size:11px;margin:12px auto 0}.doc-file{padding:12px 0;border-bottom:1px solid #edf0f5;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:9px;align-items:start}.doc-file label{overflow-wrap:anywhere;cursor:pointer}.doc-file small{display:block;color:#8a93a3}.doc-file select{font-size:11px;padding:5px;margin-top:5px}.doc-file button{border:0;padding:0 4px;color:#7e8794;background:transparent}.doc-relation{padding-top:10px;font-size:11px}.doc-relation label{display:block;margin-top:6px}.doc-relation input[type=text]{width:100%;border:1px solid #dde1e9;border-radius:6px;padding:7px;margin-top:4px}.doc-primary{background:var(--doc-purple)!important;color:white!important;border:0!important;width:100%;margin-top:17px;font-weight:600!important;padding:12px!important}.doc-toggle{display:flex;gap:8px;margin-top:17px;font-size:12px}.doc-notice{background:#fff8ea;border:1px solid #f0dfb9;border-radius:10px;padding:12px;color:#83632c;margin:12px 0!important;overflow-wrap:anywhere}.doc-error{background:#fff0f0;color:#a73535;border-color:#efcbcb}.doc-progress{margin:18px 0;background:#f0ecf8;border-radius:12px;padding:14px}.doc-progress strong{display:block}.doc-progress progress{width:100%;height:7px;accent-color:#8060cd}.doc-empty{padding:22px 12px;background:#f7f8fb;border-radius:10px;text-align:center;color:#7b8597;font-size:12px}.doc-empty-hero{padding:55px 20px}.doc-empty-hero .doc-empty-icon{font-size:35px;color:#a28aba;margin-bottom:18px}.doc-empty-hero h3{color:#4a5364}.doc-flow{display:flex;gap:7px;flex-wrap:wrap;margin:15px 0}.doc-flow span{background:#f0edf7;border-radius:20px;padding:4px 10px;font-size:11px;color:#7a679b}.doc-badge{display:inline-block;border-radius:20px;padding:3px 8px;font-size:10px;white-space:nowrap}.doc-success{color:#36735a;background:#eaf5ef}.doc-danger{color:#a54536;background:#fbece8}.doc-muted.doc-badge{color:#7b738a;background:#f1eef7}.doc-section+.doc-section{margin-top:25px;padding-top:22px;border-top:1px solid #e6e7ef}.doc-stage-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:16px 0}.doc-stage{padding:11px;border-radius:10px;background:#f7f8fb}.doc-stage p{font-size:10px;color:#7b8595;margin-top:7px}.doc-stage small{font-size:9px}.doc-details{border-top:1px solid #edf0f5;padding:13px 0}.doc-details summary{cursor:pointer;font-weight:600;font-size:12px}.doc-table-wrap{overflow-x:auto}.doc-workspace table{width:100%;border-collapse:collapse;font-size:11px;margin:12px 0}.doc-workspace th,.doc-workspace td{text-align:left;padding:8px;border-bottom:1px solid #edf0f5;overflow-wrap:anywhere}.doc-workspace th{color:#788497;font-weight:500}.doc-page{margin:15px 0}.doc-page figcaption{font-size:11px;margin-bottom:8px}.doc-image{position:relative;width:100%;line-height:0;background:#f2f3f6}.doc-image img{width:100%;height:auto;display:block}.doc-regions{position:absolute;inset:0;pointer-events:none}.doc-regions span{position:absolute;border:2px solid #e1852e;background:#ef962322}.doc-region-note{font-size:11px;color:#9d641e;margin-top:8px!important}.doc-check{display:flex;align-items:flex-start;gap:9px;border-bottom:1px solid #edf0f5;padding:11px 0;font-size:12px}.doc-check>div{min-width:0}.doc-issue summary{line-height:1.8}.doc-issue[open]{background:#fafbfe;border-radius:10px;padding:14px}.doc-issue>p{margin-top:12px}.doc-evidence{display:grid;gap:10px;margin-top:12px}.doc-evidence-item{border:1px solid #e3e8f0;border-radius:9px;padding:12px;overflow-wrap:anywhere}.doc-evidence blockquote{margin:8px 0;padding:10px 12px;background:#f0f3f8;border-left:3px solid #9aaed0;white-space:pre-wrap;overflow-wrap:anywhere}.doc-check ul{padding-left:18px;margin:6px 0;font-size:11px;overflow-wrap:anywhere}.doc-result-picker{margin-bottom:16px}.doc-action-title{margin-top:18px!important}.doc-review-summary{background:#f7f5fc;border-radius:12px;padding:16px;margin-top:18px}.doc-conclusion h3{font-size:19px}.doc-conclusion ul{padding-left:20px}.doc-workspace ul.doc-notice{padding-left:30px}.doc-footer-note{font-size:11px;color:#8490a1;margin-top:18px!important}@media(max-width:1100px){.doc-grid{grid-template-columns:1fr}}@media(max-width:550px){.doc-workspace{padding:15px}.doc-panel{padding:15px}.doc-stage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.doc-core-name{display:inline-block;padding:4px 10px;border:1px solid #d7cbe9;border-radius:7px;background:#f6f2fb;overflow-wrap:anywhere}.doc-row{align-items:flex-start;flex-wrap:wrap}}.doc-report{--doc-ink:#243047;--doc-line:#e8e9f0;color:var(--doc-ink)}.doc-report-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:24px;background:linear-gradient(120deg,#f6f3fc,#f8fafc);border:1px solid #e6dff2;border-radius:18px}.doc-eyebrow{font-size:11px;letter-spacing:1px;color:#8165af;font-weight:600}.doc-report-heading h3{font-size:21px;margin:8px 0!important;overflow-wrap:anywhere}.doc-report-heading p{font-size:12px;color:#7a8293;margin:0!important}.doc-report-mark{width:48px;height:48px;display:grid;place-items:center;flex-shrink:0;border-radius:15px;color:#8d70b7;background:#eee7f7;font-size:23px}.doc-report .doc-result-nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:5px;background:#f1f2f7;border-radius:12px;margin:18px 0 24px}.doc-report .doc-result-nav button{border:0;background:transparent;padding:12px 4px;font-size:12px;white-space:nowrap;color:#788092;border-radius:9px;transition:background .15s,color .15s}.doc-report .doc-result-nav button span{display:block;font-size:10px;font-weight:700;margin-bottom:3px;color:#a49ab5}.doc-report .doc-result-nav button[aria-current=true]{background:white;color:#6d48a1;box-shadow:0 2px 8px #2522440c}.doc-report .doc-result-nav button:hover{background:#fff;color:#6d48a1}.doc-report .doc-result-module{padding:22px;margin:16px 0;border:1px solid var(--doc-line);border-radius:16px;background:white;box-shadow:0 3px 14px #24283b04}.doc-module-heading{display:flex;align-items:center;gap:12px;margin-bottom:18px}.doc-step-number{display:grid;place-items:center;width:34px;height:34px;flex-shrink:0;border-radius:10px;background:#f1edf7;color:#8b70af;font-size:12px;font-weight:700}.doc-module-heading h3{font-size:16px;margin:0 0 4px!important}.doc-module-heading p{margin:0!important;color:#8a91a0;font-size:11px}.doc-visual-result .doc-stage{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#f8f9fc;padding:16px;border:1px solid #eef0f5;border-radius:10px}.doc-visual-result .doc-stage h4{margin:0;font-size:12px}.doc-visual-result .doc-stage p{margin:0;font-size:12px}.doc-visual-result .doc-stage p:last-child{flex-basis:100%;font-size:11px}.doc-report .doc-smart-review{padding:20px;background:linear-gradient(130deg,#f4effc,#f9f7fc);border:1px solid #e4d9f1;border-left:3px solid #9273bd;border-radius:12px;margin:18px 0}.doc-smart-review>.doc-row h3{color:#64448d;font-size:15px;margin:0}.doc-smart-review>p{font-size:12px;color:#8a7a9e;margin-top:8px}.doc-smart-finding{line-height:1.9;border:1px solid #ede7f4;padding:16px!important}.doc-fact-group{border:1px solid #e7eaf0!important;border-radius:10px;padding:0!important;margin:10px 0;overflow:hidden}.doc-fact-group>summary{display:flex;align-items:center;gap:10px;padding:15px;font-size:13px!important;list-style:none}.doc-fact-group>summary:before{content:'›';font-size:20px;line-height:1;transition:transform .15s;color:#929aaa}.doc-fact-group[open]>summary:before{transform:rotate(90deg)}.doc-fact-count{margin-left:auto;background:#f0f2f6;color:#7e8799;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:500}.doc-fact-warning>summary{color:#ac664d;background:#fffcf8}.doc-fact-passed>summary{color:#4b836c;background:#fafdfa}.doc-fact-group>.doc-issue{margin:0;padding:16px}.doc-report .doc-evidence-item{padding:10px;background:#f8f9fc;border:1px solid #eef0f5;font-size:11px}.doc-report .doc-evidence-item p{margin:0 0 5px}.doc-core-context{display:flex;align-items:center;gap:10px;font-size:12px;color:#838a99;padding-bottom:2px}.doc-core-context .doc-core-name{color:#685382;font-weight:600;max-width:80%}.doc-preview-card{padding-bottom:0}.doc-preview-card summary{display:flex;align-items:center;padding:4px 0}.doc-workspace .doc-grid{grid-template-columns:minmax(260px,.7fr) minmax(0,1.5fr);gap:24px}.doc-workspace>.doc-grid>.doc-panel{box-shadow:0 5px 24px #29233d05;border-color:#ece9f1}.doc-workspace .doc-upload{background:linear-gradient(135deg,#faf8fe,#f4f1fa);padding:28px 16px}.doc-workspace .doc-primary{background:linear-gradient(110deg,#7550a8,#8b68b7)!important;box-shadow:0 4px 14px #7958a92a}.doc-report table{table-layout:fixed}.doc-report td{vertical-align:top}.doc-report th:first-child{width:19%}.doc-report th:nth-child(2){width:32%}@media(max-width:1100px){.doc-workspace .doc-grid{grid-template-columns:1fr}}@media(max-width:550px){.doc-report-heading{padding:16px}.doc-report-heading h3{font-size:17px}.doc-report-mark{display:none}.doc-report .doc-result-module{padding:14px}.doc-report .doc-result-nav button{font-size:11px}.doc-report .doc-smart-review{padding:14px}.doc-report table,.doc-report tbody,.doc-report tr,.doc-report td{display:block;width:100%;box-sizing:border-box}.doc-report thead{display:none}.doc-report tr{border-bottom:1px solid #e5e8ef;padding-bottom:12px;margin-bottom:12px}.doc-report td{border:0;padding:6px 0}.doc-fact-group>.doc-issue{padding:12px}}@media(prefers-reduced-motion:reduce){.doc-report *{transition:none!important}}`;

export function renderImageDocuments(container, route) {
  void route;
  const state = {
    files: [],
    coreMaterialId: "",
    objective: "invoice_review",
    jurisdiction: "CN",
    region: "unspecified",
    businessDate: "",
    runModels: true,
    semanticReview: true,
    privacyMode: "redacted",
    busy: false,
    data: null,
    errors: [],
    selectedId: "",
    phase: "",
    disposed: false,
    confirmations: {},
    exampleTab: "",
  };
  const controller = new AbortController();
  let pollTimer, releasePoll;
  const dispose = () => {
    state.disposed = true;
    controller.abort();
    clearTimeout(pollTimer);
    releasePoll?.();
    for (const item of state.files)
      if (item.preview) URL.revokeObjectURL(item.preview);
    window.removeEventListener("hashchange", dispose);
  };
  window.addEventListener("hashchange", dispose, { once: true });
  const options = (values, selected) =>
    Object.entries(values)
      .map(
        ([value, label]) =>
          `<option value="${docEscape(value)}"${value === selected ? " selected" : ""}>${docEscape(label)}</option>`,
      )
      .join("");
  const draw = () => {
    if (state.disposed) return;
    const materials = state.data?.materials || [],
      disabled = state.busy ? " disabled" : "";
    container.innerHTML = `<style>${docCss}${docExampleCss}</style><div class="doc-workspace"><div class="doc-row"><div><h2>让每份材料的疑点，有据可查</h2><p class="doc-muted">选定要核验的核心文件，其他材料作为辅助依据。</p></div><span class="doc-badge doc-muted">材料核验工作台</span></div><div class="doc-flow"><span>01 选择核验目的</span><span>02 添加相关材料</span><span>03 查看问题与建议</span></div><div class="doc-grid"><section class="doc-panel"><h3>本次核验</h3><label class="doc-label" for="doc-objective">核验功能</label><select id="doc-objective"${disabled}>${options(
      documentReviewFunctions,
      state.objective,
    )}</select><p class="doc-muted">${docEscape(docMaterialTips[state.objective])}以上为材料建议，不是必交清单。</p><label class="doc-label" for="doc-jurisdiction">规则适用地区</label><select id="doc-jurisdiction"${disabled}>${options({ CN: "中国大陆", other: "其他地区" }, state.jurisdiction)}</select><label class="doc-label" for="doc-region">业务适用地区</label><select id="doc-region"${disabled}>${options(documentRegions, state.region)}</select><p class="doc-muted">地区仅提供审核背景，不能替代单位制度。未覆盖的要求会提示补充依据。</p><label class="doc-label" for="doc-date">业务发生日期</label><input id="doc-date" type="date" value="${docEscape(state.businessDate)}"${disabled}><label class="doc-upload"><strong>＋ 添加核心与辅助材料</strong><span class="doc-muted">图片 · PDF · Word（DOCX）</span><input id="doc-files" type="file" multiple accept=".png,.jpg,.jpeg,.pdf,.docx" aria-label="选择待核验文件"${disabled}></label><p class="doc-muted">最多 10 份，每份 12 MB，总计 24 MB。旧版 DOC 请先另存为 DOCX 或 PDF。</p><div role="group" aria-label="选择核心材料"><p class="doc-label">材料清单 · ${state.files.length} 份</p>${state.files.length ? '<p class="doc-muted">选中圆点的文件为核心，其余为辅助材料。</p>' : '<p class="doc-empty">添加材料后，请明确选择一份核心文件。</p>'}${state.files.map((item) => `<div class="doc-file"><input type="radio" name="doc-core" value="${item.id}" id="core-${item.id}"${state.coreMaterialId === item.id ? " checked" : ""}${disabled}><div><label for="core-${item.id}">${docEscape(item.file.name)}<small>${(item.file.size / 1024 / 1024).toFixed(2)} MB · ${state.coreMaterialId === item.id ? "核心材料" : "辅助材料"}</small></label><select data-type="${item.id}" aria-label="${docEscape(item.file.name)} 的材料类型"${disabled}>${options(docTypes, item.materialType)}</select>${state.coreMaterialId && state.coreMaterialId !== item.id ? `<div class="doc-relation"><label><input type="checkbox" data-relation="${item.id}"${state.confirmations[item.id]?.enabled ? " checked" : ""}${disabled}> 我确认与核心属于同一笔交易</label>${state.confirmations[item.id]?.enabled ? `<label>关联依据<input type="text" data-reason="${item.id}" value="${docEscape(state.confirmations[item.id]?.reason || "")}" placeholder="例如合同编号、付款用途及人工核对情况" maxlength="500"${disabled}></label><label><input type="checkbox" data-scope="${item.id}" data-key="amount"${state.confirmations[item.id]?.amount ? " checked" : ""}${disabled}> 金额范围与含税口径相同</label><label><input type="checkbox" data-scope="${item.id}" data-key="invoice"${state.confirmations[item.id]?.invoice ? " checked" : ""}${disabled}> 对应同一张发票</label><small>仅记录您的确认，尚未外部验证。</small>` : ""}</div>` : ""}</div><button type="button" data-remove="${item.id}" aria-label="移除 ${docEscape(item.file.name)}"${disabled}>×</button></div>`).join("")}</div><label class="doc-toggle"><input id="doc-models" type="checkbox"${state.runModels ? " checked" : ""}${disabled}><span>整图 AI 检测与局部篡改定位<br><span class="doc-muted">关闭后仍解析材料并执行可用内容规则。</span></span></label><label class="doc-toggle"><input id="doc-semantic" type="checkbox"${state.semanticReview ? " checked" : ""}${disabled}><span>智能复核<br><span class="doc-muted">智能识别材料矛盾内容。</span></span></label><label class="doc-label" for="doc-privacy">复核内容处理</label><select id="doc-privacy"${state.busy || !state.semanticReview ? " disabled" : ""}>${options({ redacted: "脱敏核查", original: "原文核查" }, state.privacyMode)}</select><p class="doc-muted">${!state.semanticReview ? "本次材料内容不发送至外部复核服务。" : state.privacyMode === "redacted" ? "发送前隐藏姓名、证件号、税号和账户等标识；保留必要金额与业务日期，部分内容可能无法完整核查。" : "开启原文核查后，允许将核查必需的原文内容发送至智能复核服务。"}</p><button class="doc-primary" id="doc-start"${state.busy || !state.coreMaterialId ? " disabled" : ""}>${state.busy ? "核验进行中…" : "开始核验"}</button><p class="doc-footer-note">整份文件在本平台解析，仅按所选模式发送必要的复核内容。</p></section><section class="doc-panel" aria-label="核验结果"><button type="button" class="doc-primary" id="doc-example"${disabled}>查看真实材料核验示例</button>${state.example?'<p class="doc-notice">真实材料核验案例</p>':''}<div class="doc-row"><h3>核验结果</h3>${state.data ? docBadge(state.data.status) : '<span class="doc-badge doc-muted">尚未开始</span>'}</div><div role="status" aria-live="polite">${state.errors.length ? `<ul class="doc-notice doc-error">${state.errors.map((item) => `<li>${docEscape(item)}</li>`).join("")}</ul>` : ""}${state.busy ? `<div class="doc-progress"><strong>当前正在检测，请您耐心等待~</strong><p>${docEscape(state.phase || "正在提交材料")}</p><progress aria-label="正在处理材料"></progress><p class="doc-muted">完成后将展示核验结果与对应内容。</p></div>` : ""}</div>${materials.length ? `<label class="doc-label" for="doc-result-select">查看文件</label><select id="doc-result-select" class="doc-result-picker">${materials.map((item) => `<option value="${docEscape(item.id)}"${state.selectedId === item.id ? " selected" : ""}>${docEscape(item.name)}${state.coreMaterialId === item.id ? " · 核心" : ""}</option>`).join("")}</select>${renderDocumentResult(state.data, state.selectedId, state.files)}` : state.data && !state.busy ? renderDocumentResult(state.data, state.selectedId, state.files) : '<div class="doc-empty doc-empty-hero"><div class="doc-empty-icon" aria-hidden="true">▤</div><h3>从一个明确的核验目标开始</h3><p>例如：核查一张发票，附上合同与付款凭证。</p><p>查看需要关注的问题与对应内容。</p></div>'}${state.data?.limitations?.length ? `<details class="doc-details"><summary>本次核验范围</summary><ul>${state.data.limitations.map((item) => `<li>${docEscape(item)}</li>`).join("")}</ul></details>` : ""}<p class="doc-footer-note">智鉴提供辅助审核结果，具体问题与待补材料见上方说明。</p></section></div>${renderDocumentShowcase(state.exampleTab)}</div>`;
    bindDocumentNavigation(container);
    bindDocumentExample(container, id => {
      state.exampleTab = id;
    });
    container
      .querySelector("#doc-files")
      .addEventListener("change", (event) => {
        const result = validateDocumentFiles(
          state.files.map((item) => item.file),
          Array.from(event.target.files || []),
        );
        for (const file of result.accepted)
          state.files.push({
            id: `material-${crypto.randomUUID()}`,
            file,
            materialType: "unknown",
            preview: file.type.startsWith("image/")
              ? URL.createObjectURL(file)
              : null,
          });
        state.errors = result.errors;
        state.data = null;
        draw();
      });
    for (const [id, key] of [
      ["doc-objective", "objective"],
      ["doc-jurisdiction", "jurisdiction"],
      ["doc-privacy", "privacyMode"],
      ["doc-region", "region"],
      ["doc-date", "businessDate"],
    ])
      container.querySelector(`#${id}`).addEventListener("change", (event) => {
        state[key] = event.target.value;
        if (key === "jurisdiction" && state.jurisdiction !== "CN") state.region = "unspecified";
        state.data = null;
        draw();
      });
    container
      .querySelector("#doc-models")
      .addEventListener("change", (event) => {
        state.runModels = event.target.checked;
        state.data = null;
        draw();
      });
    container.querySelector('#doc-example')?.addEventListener('click',()=>loadExample());
    container.querySelector("#doc-semantic").addEventListener("change", (event) => {
      state.semanticReview = event.target.checked;
      state.data = null;
      draw();
    });
    container.querySelectorAll('[name="doc-core"]').forEach((input) =>
      input.addEventListener("change", (event) => {
        state.coreMaterialId = event.target.value;
        state.confirmations = {};
        state.data = null;
        draw();
      }),
    );
    container.querySelectorAll("[data-type]").forEach((input) =>
      input.addEventListener("change", (event) => {
        state.files.find(
          (item) => item.id === input.dataset.type,
        ).materialType = event.target.value;
        state.data = null;
        draw();
      }),
    );
    container.querySelectorAll("[data-relation]").forEach((input) =>
      input.addEventListener("change", () => {
        state.confirmations[input.dataset.relation] = {
          enabled: input.checked,
          reason: "",
          amount: false,
          invoice: false,
        };
        state.data = null;
        draw();
      }),
    );
    container.querySelectorAll("[data-reason]").forEach((input) =>
      input.addEventListener("input", () => {
        state.confirmations[input.dataset.reason].reason = input.value;
        if (state.data) {
          const position = input.selectionStart;
          state.data = null;
          draw();
          const next = container.querySelector(
            `[data-reason="${input.dataset.reason}"]`,
          );
          next.focus();
          next.setSelectionRange(position, position);
        }
      }),
    );
    container.querySelectorAll("[data-scope]").forEach((input) =>
      input.addEventListener("change", () => {
        state.confirmations[input.dataset.scope][input.dataset.key] =
          input.checked;
        state.data = null;
        draw();
      }),
    );
    container.querySelectorAll("[data-remove]").forEach((button) =>
      button.addEventListener("click", () => {
        const item = state.files.find(
          (file) => file.id === button.dataset.remove,
        );
        if (item?.preview) URL.revokeObjectURL(item.preview);
        state.files = state.files.filter((file) => file !== item);
        delete state.confirmations[item?.id];
        if (state.coreMaterialId === item?.id) {
          state.coreMaterialId = "";
          state.confirmations = {};
        }
        state.data = null;
        draw();
      }),
    );
    container
      .querySelector("#doc-result-select")
      ?.addEventListener("change", (event) => {
        state.selectedId = event.target.value;
        draw();
      });
    container.querySelector("#doc-start").addEventListener("click", start);
  };
  async function loadExample(initial=false){
    try{const response=await api.invoke('/image/documents',{action:'example'},{signal:controller.signal});
      if(state.disposed||state.busy||(initial&&(state.files.length||state.data)))return;
      state.data=response;state.example=true;state.selectedId=state.data.materials[0]?.id;state.errors=[];draw();
    }catch{if(!state.disposed&&!initial){state.errors=['示例暂不可用。'];draw();}}
  }
  async function start() {
    if (state.busy) return;
    state.busy = true; state.example = false;
    state.errors = [];
    state.data = null;
    state.selectedId = "";
    state.phase = "正在读取并提交材料";
    draw();
    try {
      const payload = await createDocumentReviewPayload(state);
      if (state.disposed) return;
      let response = await api.invoke("/image/documents", payload, {
        signal: controller.signal,
      });
      while (!state.disposed) {
        const data = response;
        if (
          !data ||
          !["queued", "running", "completed", "partial", "failed"].includes(
            data.status,
          )
        )
          throw new Error("服务返回了无法识别的核验状态，请稍后重试。");
        state.data = data;
        state.selectedId = state.selectedId || data.materials?.[0]?.id || "";
        state.phase =
          {
            parsing: "正在解析图片与文档",
            mirror: "正在检查整图来源",
            seed: "正在定位局部修改线索",
            ocr: "正在提取文字与字段",
            rules: "正在核验单份及跨文件内容",
            semantic_review: "正在进一步核查相关内容",
            explanation: "正在整理核验意见",
          }[data.phase] ||
          { queued: "材料已接收，等待处理", running: "正在解析并核验材料" }[
            data.status
          ] ||
          "核验完成";
        if (data.status === "failed")
          state.errors = [
            data.error?.message || "本次核验处理失败，请检查材料后重试。",
          ];
        draw();
        if (!["queued", "running"].includes(data.status)) break;
        if (!data.reviewId) throw new Error("未收到有效核验编号，请重新提交。");
        await new Promise((resolve) => {
          releasePoll = resolve;
          pollTimer = setTimeout(resolve, 1500);
        });
        releasePoll = null;
        if (state.disposed) break;
        response = await api.invoke(
          "/image/documents",
          { action: "status", reviewId: data.reviewId },
          { signal: controller.signal },
        );
      }
    } catch (error) {
      if (error.name !== "AbortError" && !state.disposed)
        state.errors = [error.message || "核验未完成，请检查服务后重试。"];
    } finally {
      state.busy = false;
      draw();
    }
  }
  draw();
  void loadExample(true);
  return dispose;
}
