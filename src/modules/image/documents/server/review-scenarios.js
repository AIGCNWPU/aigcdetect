// Source references describe materials and rule scope, not a universal mandatory list.
export const SCENARIO_VERSION = 'target-review-scenarios/0.2';
const sources = {
  vouchers: {title:'财政部电子凭证会计数据标准推广通知',url:'https://www.mof.gov.cn/jrttts/202505/t20250521_3964264.htm',scope:'凭证种类及结构化数据；非报销必交清单'},
  tax: {title:'国家税务总局关于推广应用全面数字化电子发票的公告',url:'https://fgk.chinatax.gov.cn/zcfgk/c100012/c5236067/content.html',scope:'中国数电发票格式；非税务资格或真实性查询'},
  police: {title:'关于改进和规范公安派出所出具证明工作的意见',url:'https://www.beijing.gov.cn/zhengce/zhengcefagui/201905/t20190522_59518.html',scope:'法定证件与证明职责边界；不增加群众必交证明'},
  university: {title:'西北工业大学费用类报销申请办事参考',url:'https://z.nwpu.edu.cn/info/1702/15369.htm',scope:'历史高校材料示例；金额阈值及现行校内政策不采用'},
};
const financeKeys=['invoice_number','transaction_number','tax_identifier','name','gross_amount','net_amount','tax_amount','payment_amount','invoice_date','transaction_date'];
const profiles=[
  {id:'invoice_review',title:'发票核验',coreTypes:['invoice','digital_invoice','receipt'],auxiliaryTypes:['invoice','digital_invoice','receipt','contract','order','bank_receipt','bank_statement','acceptance_record','delivery_note','certificate'],fieldKeys:financeKeys,sourceIds:['vouchers','tax'],exceptions:['分期、预付、代付、红字、折让和未付款不要求单张等额','官方查验、抵扣资格与印章真实性未核验']},
  {id:'procurement_review',title:'采购履约核验',coreTypes:['contract','order','invoice','digital_invoice','delivery_note'],auxiliaryTypes:['contract','order','invoice','digital_invoice','receipt','bank_receipt','acceptance_record','delivery_note','certificate'],fieldKeys:financeKeys,sourceIds:['vouchers'],exceptions:['合同与发票完整集合需人工确认','交货、验收和付款时点不默认相同']},
  {id:'merchant_reconciliation',title:'收付款核对',coreTypes:['invoice','digital_invoice','receipt','order'],auxiliaryTypes:['invoice','digital_invoice','receipt','order','bank_receipt','bank_statement','certificate'],fieldKeys:financeKeys,sourceIds:['vouchers'],exceptions:['平台佣金、手续费、退款需单独说明','流水截图不能确认账户可用余额']},
  {id:'research_reimbursement',title:'报销材料核验',coreTypes:['invoice','digital_invoice','contract','reimbursement_form'],auxiliaryTypes:['invoice','digital_invoice','contract','order','research_approval','project_approval','acceptance_record','bank_receipt','travel_approval','certificate'],fieldKeys:financeKeys,sourceIds:['vouchers','university'],exceptions:['项目可列支范围、审批额度及学校现行制度需配置','项目负责人、报销人和供应商是不同角色']},
  {id:'identity_consistency',title:'身份材料核对',coreTypes:['identity','household_register','certificate','application_form','authorization'],auxiliaryTypes:['identity','household_register','certificate','application_form','authorization'],fieldKeys:['identity_number','name','birth_date','gender','registered_address','current_address'],sourceIds:['police'],exceptions:['同户、同名不证明同一人或亲属关系','现住址与号码地区码不能直接比较','不替代人口库、人像指纹或人工身份核验']},
];
export function getReviewScenarios() {return {version:SCENARIO_VERSION,researchedAt:'2026-10-23',profiles:structuredClone(profiles),sources:structuredClone(sources),policyStatus:'candidate_materials_not_mandatory_policy'};}
export function reviewScenario(objective,materialType) {
  const profile=profiles.find(p=>p.id===objective);
  if(!profile)return {status:'NEI',reason:'objective_rule_pack_not_configured',profile:null,sources:[]};
  if(!profile.coreTypes.includes(materialType))return {status:'NEI',reason:'core_material_type_outside_objective',profile:structuredClone(profile),sources:profile.sourceIds.map(id=>sources[id])};
  return {status:'PASS',reason:'engineering_rule_scope_only',profile:structuredClone(profile),sources:profile.sourceIds.map(id=>sources[id])};
}
