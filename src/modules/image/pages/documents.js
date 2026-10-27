import { documentRegions } from "../documents/regions.js";
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
  const value = item.message || item.reason || item.summary || "";
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
export function renderDocumentChecks(checks = [], names = {}) {
  if (!Array.isArray(checks) || !checks.length)
    return '<p class="doc-empty">暂无可执行的检查项；不代表材料内容已经通过核验。</p>';
  return `<div>${checks.map(check => `<details class="doc-details doc-issue"><summary>${docBadge(check.status)} ${docEscape(check.title || docReason(check))}</summary><p>${docEscape(check.explanation || docReason(check))}</p>${docEvidence(check.evidence, names)}</details>`).join("")}</div>`;
}
function docStage(title, stage, note) {
  const value = stage || { status: "not_run" };
  return `<div class="doc-stage"><h4>${title}</h4>${docBadge(value.status)}${Number.isInteger(value.completedPages) ? `<p>覆盖 ${value.completedPages} / ${value.totalPages} 页</p>` : ""}${Number.isFinite(value.score) ? `<p>模型分数 ${value.score.toFixed(3)}<br><small>未校准，不代表真实概率。</small></p>` : ""}<p>${docEscape(value.message || docReasons[value.reason] || note)}</p></div>`;
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
export function renderDocumentPresentation(data, names = {}, selectedId = null) {
  const materials = Array.isArray(data?.materials) ? data.materials : [];
  const localChecks = materials.flatMap((item) => (item.checks || []).map(check => ({ materialId: item.id, ...check })));
  const crossChecks = [...(data?.review?.candidates || []), ...(data?.review?.checks || data?.review?.results || [])];
  const failedChecks = [...localChecks, ...crossChecks].filter((item) => item.status === "FAIL");
  const presentation = data?.presentation || {
    status: failedChecks.length ? "issues_found" : "needs_more_information",
    title: failedChecks.length ? "发现需要核对的问题" : "请核对已完成项目与待补材料",
    summary: "以下为当前已取得的核验结果。",
    warnings: failedChecks.map((item) => ({ ...item, message: docReason(item) })),
    actions: [],
  };
  const tone = presentation.status === "issues_found" ? "doc-error" : "";
  const assessment = data?.review?.executionAssessment?.items || [];
  const resolveItem = item => {
    const origin = assessment.find(a => a.id === item.assessmentId || a.id === item.id);
    return origin ? { ...origin, ...item, evidence: item.evidence || origin.evidence, materialIds: item.materialIds?.length ? item.materialIds : origin.materialIds } : item;
  };
  const relevant = item => !selectedId || docMaterialIds(item).includes(selectedId) || (materials.length === 1 && !docMaterialIds(item).length);
  const warnings = (Array.isArray(presentation.warnings) ? presentation.warnings : []).map(resolveItem).filter(relevant);
  const actions = selectedId && materials.length > 1
    ? (presentation.actionItems || []).filter(relevant).map(item => item.message)
    : Array.isArray(presentation.actions) ? presentation.actions : [];
  const ai = presentation.aiReview || { status: "not_run" };
  const aiComplete = ["completed", "succeeded"].includes(ai.status);
  const aiStatus = aiComplete ? "已完成" : ai.status === "failed" ? "未能完成" : ai.status === "partial" ? "部分完成" : "未执行";
  const findings = aiComplete || ai.status === "partial"
    ? (Array.isArray(ai.findings) ? ai.findings : []).map(resolveItem).filter(relevant) : [];
  const aiMessage = selectedId && materials.length > 1 && (aiComplete || ai.status === "partial")
    ? findings.length ? "以下为与当前材料相关的智能复核结果。" : "当前材料暂无可单独展示的智能复核结果。"
    : aiComplete || ai.status === "partial"
    ? ai.summary || "请查看下方复核发现。"
    : docReviewReasons[ai.reason] || (ai.status === "failed" ? "智能复核未完成，相关事项仍待核查。" : "本次尚未取得智能复核结论。");
  const localCount = warnings.filter(item => docMaterialIds(item).length <= 1).length;
  const crossCount = warnings.length - localCount;
  const heading = selectedId ? warnings.length ? "当前材料发现需要核对的问题" : "当前材料核验结果" : presentation.title || "核验结果";
  const summary = selectedId ? `本文件问题 ${localCount} 项，关联问题 ${crossCount} 项。点击展开查看核验内容与说明。` : presentation.summary || "请查看本次核验发现。";
  const renderIssue = item => `<details class="doc-details doc-issue"><summary><strong>${docEscape(item.title || "内容核验问题")}</strong>${item.evidence?.length ? `<span class="doc-muted"> · ${[...new Set(item.evidence.map(docFieldLabel))].map(docEscape).join("、")}</span>` : ""}${docMaterialIds(item).length > 1 ? `<span class="doc-muted"> · ${docMaterialIds(item).map(id => docEscape(names[id] || "相关材料")).join("、")}</span>` : ""}</summary><p>${docEscape(item.message || "请核对相关材料。")}</p>${docEvidence(item.evidence, names)}</details>`;
  const localIssues = warnings.filter(item => docMaterialIds(item).length <= 1);
  const crossIssues = warnings.filter(item => docMaterialIds(item).length > 1);
  return `<section class="doc-section doc-conclusion"><div class="doc-notice ${warnings.length ? "doc-error" : selectedId ? "" : tone}"><h3>${docEscape(heading)}</h3><p>${docEscape(summary)}</p></div><h4>本文件核验</h4>${localIssues.length ? localIssues.map(renderIssue).join("") : '<p class="doc-muted">暂无本文件问题提醒，未完成事项请查看核验依据。</p>'}${crossIssues.length ? `<details class="doc-details doc-cross-issues"><summary>跨材料核验 · ${crossIssues.length} 项</summary>${crossIssues.map(renderIssue).join("")}</details>` : ""}${actions.length ? `<details class="doc-details"><summary>后续处理建议</summary><ul>${actions.map(action => `<li>${docEscape(action)}</li>`).join("")}</ul></details>` : ""}<details class="doc-details doc-review-summary"><summary>智能复核 · ${aiStatus}</summary><p>${docEscape(aiMessage)}</p>${findings.map(item => `<div><p>${item.title ? `<strong>${docEscape(item.title)}</strong>：` : ""}${docEscape(item.explanation || item.message || item.reason || item.summary || "请核对所引用的材料内容。")}</p>${docEvidence(item.evidence, names)}</div>`).join("")}</details></section>`;

}
export function renderDocumentResult(data, selectedId, sourceFiles = []) {
  const materials = Array.isArray(data?.materials) ? data.materials : [],
    material = materials.find((item) => item.id === selectedId) || materials[0],
    names = Object.fromEntries(materials.map((item) => [item.id, item.name])),
    review = data?.review || {};
  const isSelected = item => !material || docMaterialIds(item).includes(material.id);
  const selectedCross = [...(review.candidates || []), ...(review.checks || review.results || []).filter(check => !check.materialId)].filter(isSelected);
  const selectedEdges = (review.plan?.edges || []).filter(edge => [edge.coreMaterialId, edge.auxiliaryMaterialId].includes(material?.id));
  const excluded = (review.plan?.excluded || []).filter(isSelected);
  const cross = `<section class="doc-section"><h3>围绕核心材料的交叉核验</h3><p class="doc-muted">仅核对有依据的主体、交易与时间关系；同批上传不代表关联已确认。</p>${renderDocumentChecks(selectedCross, names)}${review.plan ? `<p class="doc-muted">已选择 ${selectedEdges.length} 条核心关联 · ${selectedCross.length} 项跨材料检查 · ${excluded.length} 份未参与材料</p>${excluded.length ? `<details class="doc-details"><summary>未参与核对的材料及原因</summary><ul>${excluded.map((item) => `<li>${docEscape(names[item.materialId] || "辅助材料")}：${docEscape(docReason(item))}</li>`).join("")}</ul></details>` : ""}` : ""}${
    review.unresolvedConfirmations?.length
      ? renderDocumentChecks(
          review.unresolvedConfirmations.filter(isSelected).map((item) => ({
            ...item,
            message: `${names[item.materialId] || "辅助材料"}：${docReason(item)}`,
          })),
          names,
        )
      : ""
  }</section>`;
  const conclusion = renderDocumentPresentation(data, names, material?.id);
  if (!material) return `${conclusion}<p class="doc-empty">尚无材料处理结果。</p><details class="doc-details"><summary>查看核验依据</summary>${cross}</details>`;
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
      return `<figure class="doc-page"><figcaption>第 ${docEscape(page.page || page.number || 1)} 页 ${docBadge(page.status)}</figcaption>${preview ? `<div class="doc-image"><img src="${docEscape(preview)}" alt="${docEscape(material.name)} 第 ${docEscape(page.page || page.number || 1)} 页"><div class="doc-regions" aria-label="疑似修改区域">${regions.map((style, i) => `<span style="${style}" title="疑似修改区域 ${i + 1}"></span>`).join("")}</div></div>` : '<p class="doc-empty">没有可展示的页图，不能据此判断视觉风险。</p>'}${regions.length ? `<p class="doc-region-note">橙框：${regions.length} 个疑似修改位置，需结合原图及字段复核。</p>` : ""}</figure>`;
    })
    .join("");
  return `${conclusion}<section class="doc-section"><div class="doc-row"><h3>${docEscape(material.name)}</h3>${docBadge(material.status)}</div><details class="doc-details"><summary>材料预览与定位 · ${pages.length} 页 / 片段</summary>${previews || '<p class="doc-empty">暂无页图。Word 未渲染时只进行可用文字核验。</p>'}</details><details class="doc-details"><summary>查看核验依据与处理详情</summary><div class="doc-stage-grid">${docStage("整图来源 · MIRROR", stages.mirror, "检查整图 AI 生成线索。")}${docStage("局部定位 · SEED", stages.seed, "疑似修改与内容矛盾分别判断。")}${docStage("文字提取", stages.ocr, "用于字段核验及来源定位。")}${docStage("单份内容核验", stages.rules, "未发现修改线索时仍核验内容。")}${docStage("智能复核", stages.explanation, "对本地尚未解决的事项进行内容核查。")}</div>${material.message ? `<p class="doc-notice">${docEscape(material.message)}</p>` : ""}${Array.isArray(material.limitations) && material.limitations.length ? `<ul class="doc-notice">${material.limitations.map((item) => `<li>${docEscape(item)}</li>`).join("")}</ul>` : ""}<details class="doc-details"><summary>提取字段 · ${fields.length} 项</summary>${fields.length ? `<div class="doc-table-wrap"><table><thead><tr><th>字段</th><th>识别内容</th><th>来源</th></tr></thead><tbody>${fields.map((field) => `<tr><td>${docEscape(docFieldLabel(field))}</td><td>${docFieldValue(field)}</td><td>${field.source?.page ? `第 ${docEscape(field.source.page)} 页` : "文档结构"}${field.extractionAmbiguous ? " · 需复核" : ""}</td></tr>`).join("")}</tbody></table></div>` : '<p class="doc-empty">未提取到可核验的结构化字段。</p>'}</details><h4>单份文件检查依据</h4>${renderDocumentChecks(material.checks, names)}${cross}</details></section>`;
}
const docCss = `.doc-workspace{--doc-purple:#7454b6;padding:26px;color:#263146;font-size:13px;line-height:1.65}.doc-workspace *{box-sizing:border-box}.doc-workspace h2{font-size:21px;letter-spacing:-.02em}.doc-workspace h3{font-size:16px;margin:0 0 12px}.doc-workspace h4{font-size:12px;margin:0 0 8px}.doc-workspace p{margin:0 0 8px}.doc-workspace button,.doc-workspace input,.doc-workspace select{font:inherit}.doc-workspace button,.doc-workspace select{border:1px solid #dde1e9;background:white;border-radius:9px;padding:8px 11px;color:inherit}.doc-workspace button{cursor:pointer}.doc-workspace button:disabled{opacity:.5;cursor:not-allowed}.doc-workspace button:focus-visible,.doc-workspace input:focus-visible,.doc-workspace select:focus-visible{outline:3px solid #9d86d2;outline-offset:3px}.doc-row{display:flex;gap:12px;align-items:center;justify-content:space-between}.doc-muted{color:#727d8f;font-size:12px}.doc-grid{display:grid;grid-template-columns:minmax(250px,.85fr) minmax(0,1.6fr);gap:24px;margin-top:22px}.doc-panel{border:1px solid #e6e7ef;border-radius:16px;padding:20px;background:#ffffffb8;min-width:0}.doc-label{display:block;font-weight:600;margin:15px 0 6px}.doc-workspace select{width:100%}.doc-upload{display:block;border:1px dashed #a997c9;border-radius:13px;padding:23px 12px;text-align:center;background:#f8f5fd;cursor:pointer;margin:18px 0 8px}.doc-upload strong{display:block;color:#7051a7;font-size:14px}.doc-upload input{display:block;max-width:100%;font-size:11px;margin:12px auto 0}.doc-file{padding:12px 0;border-bottom:1px solid #edf0f5;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:9px;align-items:start}.doc-file label{overflow-wrap:anywhere;cursor:pointer}.doc-file small{display:block;color:#8a93a3}.doc-file select{font-size:11px;padding:5px;margin-top:5px}.doc-file button{border:0;padding:0 4px;color:#7e8794;background:transparent}.doc-relation{padding-top:10px;font-size:11px}.doc-relation label{display:block;margin-top:6px}.doc-relation input[type=text]{width:100%;border:1px solid #dde1e9;border-radius:6px;padding:7px;margin-top:4px}.doc-primary{background:var(--doc-purple)!important;color:white!important;border:0!important;width:100%;margin-top:17px;font-weight:600!important;padding:12px!important}.doc-toggle{display:flex;gap:8px;margin-top:17px;font-size:12px}.doc-notice{background:#fff8ea;border:1px solid #f0dfb9;border-radius:10px;padding:12px;color:#83632c;margin:12px 0!important;overflow-wrap:anywhere}.doc-error{background:#fff0f0;color:#a73535;border-color:#efcbcb}.doc-progress{margin:18px 0;background:#f0ecf8;border-radius:12px;padding:14px}.doc-progress strong{display:block}.doc-progress progress{width:100%;height:7px;accent-color:#8060cd}.doc-empty{padding:22px 12px;background:#f7f8fb;border-radius:10px;text-align:center;color:#7b8597;font-size:12px}.doc-empty-hero{padding:55px 20px}.doc-empty-hero .doc-empty-icon{font-size:35px;color:#a28aba;margin-bottom:18px}.doc-empty-hero h3{color:#4a5364}.doc-flow{display:flex;gap:7px;flex-wrap:wrap;margin:15px 0}.doc-flow span{background:#f0edf7;border-radius:20px;padding:4px 10px;font-size:11px;color:#7a679b}.doc-badge{display:inline-block;border-radius:20px;padding:3px 8px;font-size:10px;white-space:nowrap}.doc-success{color:#36735a;background:#eaf5ef}.doc-danger{color:#a54536;background:#fbece8}.doc-muted.doc-badge{color:#7b738a;background:#f1eef7}.doc-section+.doc-section{margin-top:25px;padding-top:22px;border-top:1px solid #e6e7ef}.doc-stage-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:16px 0}.doc-stage{padding:11px;border-radius:10px;background:#f7f8fb}.doc-stage p{font-size:10px;color:#7b8595;margin-top:7px}.doc-stage small{font-size:9px}.doc-details{border-top:1px solid #edf0f5;padding:13px 0}.doc-details summary{cursor:pointer;font-weight:600;font-size:12px}.doc-table-wrap{overflow-x:auto}.doc-workspace table{width:100%;border-collapse:collapse;font-size:11px;margin:12px 0}.doc-workspace th,.doc-workspace td{text-align:left;padding:8px;border-bottom:1px solid #edf0f5;overflow-wrap:anywhere}.doc-workspace th{color:#788497;font-weight:500}.doc-page{margin:15px 0}.doc-page figcaption{font-size:11px;margin-bottom:8px}.doc-image{position:relative;width:100%;line-height:0;background:#f2f3f6}.doc-image img{width:100%;height:auto;display:block}.doc-regions{position:absolute;inset:0;pointer-events:none}.doc-regions span{position:absolute;border:2px solid #e1852e;background:#ef962322}.doc-region-note{font-size:11px;color:#9d641e;margin-top:8px!important}.doc-check{display:flex;align-items:flex-start;gap:9px;border-bottom:1px solid #edf0f5;padding:11px 0;font-size:12px}.doc-check>div{min-width:0}.doc-issue summary{line-height:1.8}.doc-issue[open]{background:#fafbfe;border-radius:10px;padding:14px}.doc-issue>p{margin-top:12px}.doc-evidence{display:grid;gap:10px;margin-top:12px}.doc-evidence-item{border:1px solid #e3e8f0;border-radius:9px;padding:12px;overflow-wrap:anywhere}.doc-evidence blockquote{margin:8px 0;padding:10px 12px;background:#f0f3f8;border-left:3px solid #9aaed0;white-space:pre-wrap;overflow-wrap:anywhere}.doc-check ul{padding-left:18px;margin:6px 0;font-size:11px;overflow-wrap:anywhere}.doc-result-picker{margin-bottom:16px}.doc-action-title{margin-top:18px!important}.doc-review-summary{background:#f7f5fc;border-radius:12px;padding:16px;margin-top:18px}.doc-conclusion h3{font-size:19px}.doc-conclusion ul{padding-left:20px}.doc-workspace ul.doc-notice{padding-left:30px}.doc-footer-note{font-size:11px;color:#8490a1;margin-top:18px!important}@media(max-width:1100px){.doc-grid{grid-template-columns:1fr}}@media(max-width:550px){.doc-workspace{padding:15px}.doc-panel{padding:15px}.doc-stage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.doc-row{align-items:flex-start;flex-wrap:wrap}}`;

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
    container.innerHTML = `<style>${docCss}</style><div class="doc-workspace"><div class="doc-row"><div><h2>让每份材料的疑点，有据可查</h2><p class="doc-muted">选定要核验的核心文件，其他材料作为辅助依据。</p></div><span class="doc-badge doc-muted">材料核验工作台</span></div><div class="doc-flow"><span>01 选择核验目的</span><span>02 添加相关材料</span><span>03 查看问题与建议</span></div><div class="doc-grid"><section class="doc-panel"><h3>本次核验</h3><label class="doc-label" for="doc-objective">核验功能</label><select id="doc-objective"${disabled}>${options(
      documentReviewFunctions,
      state.objective,
    )}</select><p class="doc-muted">${docEscape(docMaterialTips[state.objective])}以上为材料建议，不是必交清单。</p><label class="doc-label" for="doc-jurisdiction">规则适用地区</label><select id="doc-jurisdiction"${disabled}>${options({ CN: "中国大陆", other: "其他地区" }, state.jurisdiction)}</select><label class="doc-label" for="doc-region">业务适用地区</label><select id="doc-region"${disabled}>${options(documentRegions, state.region)}</select><p class="doc-muted">地区仅提供审核背景，不能替代单位制度。未覆盖的要求会提示补充依据。</p><label class="doc-label" for="doc-date">业务发生日期</label><input id="doc-date" type="date" value="${docEscape(state.businessDate)}"${disabled}><label class="doc-upload"><strong>＋ 添加核心与辅助材料</strong><span class="doc-muted">图片 · PDF · Word（DOCX）</span><input id="doc-files" type="file" multiple accept=".png,.jpg,.jpeg,.pdf,.docx" aria-label="选择待核验文件"${disabled}></label><p class="doc-muted">最多 10 份，每份 12 MB，总计 24 MB。旧版 DOC 请先另存为 DOCX 或 PDF。</p><div role="group" aria-label="选择核心材料"><p class="doc-label">材料清单 · ${state.files.length} 份</p>${state.files.length ? '<p class="doc-muted">选中圆点的文件为核心，其余为辅助材料。</p>' : '<p class="doc-empty">添加材料后，请明确选择一份核心文件。</p>'}${state.files.map((item) => `<div class="doc-file"><input type="radio" name="doc-core" value="${item.id}" id="core-${item.id}"${state.coreMaterialId === item.id ? " checked" : ""}${disabled}><div><label for="core-${item.id}">${docEscape(item.file.name)}<small>${(item.file.size / 1024 / 1024).toFixed(2)} MB · ${state.coreMaterialId === item.id ? "核心材料" : "辅助材料"}</small></label><select data-type="${item.id}" aria-label="${docEscape(item.file.name)} 的材料类型"${disabled}>${options(docTypes, item.materialType)}</select>${state.coreMaterialId && state.coreMaterialId !== item.id ? `<div class="doc-relation"><label><input type="checkbox" data-relation="${item.id}"${state.confirmations[item.id]?.enabled ? " checked" : ""}${disabled}> 我确认与核心属于同一笔交易</label>${state.confirmations[item.id]?.enabled ? `<label>关联依据<input type="text" data-reason="${item.id}" value="${docEscape(state.confirmations[item.id]?.reason || "")}" placeholder="例如合同编号、付款用途及人工核对情况" maxlength="500"${disabled}></label><label><input type="checkbox" data-scope="${item.id}" data-key="amount"${state.confirmations[item.id]?.amount ? " checked" : ""}${disabled}> 金额范围与含税口径相同</label><label><input type="checkbox" data-scope="${item.id}" data-key="invoice"${state.confirmations[item.id]?.invoice ? " checked" : ""}${disabled}> 对应同一张发票</label><small>仅记录您的确认，尚未外部验证。</small>` : ""}</div>` : ""}</div><button type="button" data-remove="${item.id}" aria-label="移除 ${docEscape(item.file.name)}"${disabled}>×</button></div>`).join("")}</div><label class="doc-toggle"><input id="doc-models" type="checkbox"${state.runModels ? " checked" : ""}${disabled}><span>整图 AI 检测与局部篡改定位<br><span class="doc-muted">关闭后仍解析材料并执行可用内容规则。</span></span></label><label class="doc-toggle"><input id="doc-semantic" type="checkbox"${state.semanticReview ? " checked" : ""}${disabled}><span>智能复核<br><span class="doc-muted">仅对本地无法明确判断的内容进一步核查；关闭后仅在本地核验。</span></span></label><label class="doc-label" for="doc-privacy">复核内容处理</label><select id="doc-privacy"${state.busy || !state.semanticReview ? " disabled" : ""}>${options({ redacted: "脱敏核查", original: "原文核查" }, state.privacyMode)}</select><p class="doc-muted">${!state.semanticReview ? "本次材料内容不发送至外部复核服务。" : state.privacyMode === "redacted" ? "发送前隐藏姓名、证件号、税号和账户等标识；保留必要金额与业务日期，部分内容可能无法完整核查。" : "开启原文核查后，允许将核查必需的原文内容发送至智能复核服务。"}</p><button class="doc-primary" id="doc-start"${state.busy || !state.coreMaterialId ? " disabled" : ""}>${state.busy ? "核验进行中…" : "开始核验"}</button><p class="doc-footer-note">整份文件在本平台解析，仅按所选模式发送必要的复核内容。</p></section><section class="doc-panel" aria-label="核验结果"><div class="doc-row"><h3>核验结果</h3>${state.data ? docBadge(state.data.status) : '<span class="doc-badge doc-muted">尚未开始</span>'}</div><div role="status" aria-live="polite">${state.errors.length ? `<ul class="doc-notice doc-error">${state.errors.map((item) => `<li>${docEscape(item)}</li>`).join("")}</ul>` : ""}${state.busy ? `<div class="doc-progress"><strong>当前正在检测，请您耐心等待~</strong><p>${docEscape(state.phase || "正在提交材料")}</p><progress aria-label="正在处理材料"></progress><p class="doc-muted">完成后将展示核验结果、疑点与处理建议。</p></div>` : ""}</div>${materials.length ? `<label class="doc-label" for="doc-result-select">查看文件</label><select id="doc-result-select" class="doc-result-picker">${materials.map((item) => `<option value="${docEscape(item.id)}"${state.selectedId === item.id ? " selected" : ""}>${docEscape(item.name)}${state.coreMaterialId === item.id ? " · 核心" : ""}</option>`).join("")}</select>${renderDocumentResult(state.data, state.selectedId, state.files)}` : state.data && !state.busy ? renderDocumentResult(state.data, state.selectedId, state.files) : '<div class="doc-empty doc-empty-hero"><div class="doc-empty-icon" aria-hidden="true">▤</div><h3>从一个明确的核验目标开始</h3><p>例如：核查一张发票，附上合同与付款凭证。</p><p>查看需要关注的问题、对应位置与下一步建议。</p></div>'}${state.data?.limitations?.length ? `<details class="doc-details"><summary>本次核验范围</summary><ul>${state.data.limitations.map((item) => `<li>${docEscape(item)}</li>`).join("")}</ul></details>` : ""}<p class="doc-footer-note">智鉴提供辅助审核结果，具体问题与待补材料见上方说明。</p></section></div></div>`;
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
  async function start() {
    if (state.busy) return;
    state.busy = true;
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
        const data = response?.data;
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
  return dispose;
}
