# 金融材料场景知识库与规则边界

核查日期：2026-10-21。以下 12 类是从官方资料整理的材料关系及工程规则建议。它们已进入可查询的本地目录，但不等于 12 套业务算法全部实现。机构必交清单、额度、时限、资格判断需要有版本的项目业务依据；缺失候选材料输出 NEI，不直接判伪造或拒绝申请。

## 官方来源

|编号|来源|日期及范围|
|---|---|---|
|S01|[财政部电子凭证会计数据标准推广通知](https://www.mof.gov.cn/jrttts/202505/t20250521_3964264.htm)|2025-05-19；电子凭证类型与结构化数据；不规定本项目报销必交清单|
|S02|[上海税务：税前扣除凭证类型](https://shanghai.chinatax.gov.cn/zcfw/rdwd/202401/t470005.html)|2024-01；凭证种类参考，不由平台作税务资格判断|
|S03|[中国银行个人住房贷款](https://www.boc.cn/english/individuals/pbk/lns/202601/t20260105_25639182.html)|2026-01-05；仅此产品材料示例；机构与地区政策须确认|
|S04|[中国银行国内保理](https://www.boc.cn/cbservice/cb3/cb34/200807/t20080703_892.html)|2008-07-03；历史产品说明；仅作材料关系参考，现行要求未确认|
|S05|[建设银行商业汇票贴现](https://ebank.ccb.com/chn/company/gsjgsy/cpfw/gsyw/pjyw/syhptx/index.shtml)|页面未确认发布日期；含历史纸票和证照表述；不硬编码为当前必交要求|
|S06|[中国银行进口信用证](https://www.boc.cn/cbservice/cb3/cb33/200807/t20080701_856.html)|2008-07-01；历史产品说明；不沿用旧外汇表单要求|
|S07|[海关审价作业办事指南](https://online.customs.gov.cn/static/pages/guides/000729005002/000729005002.html)|页面未确认发布日期；限定价格质疑通知要求，不是所有进口业务通用清单|
|S08|[中国人寿山东理赔须知](https://sdapp.e-chinalife.com/info/lpxz/lpxz.htm)|页面未确认发布日期；区域保险理赔材料示例，产品及受益关系须确认|
|S09|[金融监管总局2024小额存款继承政策解读（上海政府转载）](https://jrj.sh.gov.cn/jcgk-zcjd/20240428/5ca252d9d9394621b7d1c39ddf3bcaa9.html)|2024-04-28；新政策适用范围应优先核对，不硬编码金额阈值|
|S10|[已故存款人小额存款提取2021通知（北京政府转载）](https://www.beijing.gov.cn/zhengce/zhengcefagui/qtwj/202204/t20220413_2675494.html)|2021；材料类型结合S09更新；不认定继承权|
|S11|[中国银行金融资产质押消费贷款](https://www.boc.cn/pbservice/pb2/202409/t20240929_25163937.html)|2024-09-29；此银行产品抵质押资产种类参考|
|S12|[郑商所银行标准仓单质押业务指引](https://www.czce.com.cn/cn/uploadfile/2025/01/08/20250108100926269.pdf)|2025-01-08；郑商所仓单业务；银行开户材料与借款人材料须分开|

## 采购与费用报销（expense）

来源范围：S01, S02。候选材料：invoice/digital_invoice/fiscal_receipt/receipt；contract/order；acceptance_record/delivery_note；bank_receipt/bank_statement。

拟议规则：
- 同票内部金额关系；明确交易及结算全集后比较发票、合同与付款集合
- 签发机构加票号区分凭证；重复上传不等于重复报销

例外与证据不足：代付、分期、红字、重开、未付款、含税与未税、代收机构均需说明。

## 差旅交通住宿（travel）

来源范围：S01。候选材料：rail_ticket/air_itinerary/invoice；hotel_invoice；travel_approval；bank_receipt。

拟议规则：
- 经确认的出差人与乘机乘车人核对；住宿期间与行程比较作为复核线索
- 交通退改与原票建立关联后算净额

例外与证据不足：跨午夜、多人预订、多人合住、合理提前延后、差旅补贴不能按票面直接等额比较。

## 医疗费用与保险理赔（medical_claim）

来源范围：S01, S08。候选材料：medical_receipt/medical_invoice；expense_detail；diagnosis/discharge_summary；claim_application；identity；birth_certificate/household_register/marriage_certificate/authorization。

拟议规则：
- 同就诊号、患者与期间核对；有完整清单时核对费用合计
- 身份、监护、受益及代理关系分别建边；既往结算与剩余申请额口径先确认

例外与证据不足：申请人不一定是患者或受益人；住院跨日、部分赔付、免赔及医保结算不能直接判金额冲突。

## 住房贷款与二手房交易（housing）

来源范围：S03。候选材料：loan_application；identity；income_proof；purchase_contract；downpayment_receipt/bank_receipt；credit_authorization；title_certificate；coowner_consent。

拟议规则：
- 区分新房和二手房、借款人与共有权人；经确认的同一房产核对地址和产权编号
- 确认首付款范围后核对合同与多笔付款；产权和征信状态保留外部未核验

例外与证据不足：共有人不必为借款人；代理付款、夫妻共有、旧地址、补充协议需关联，不因材料缺失直接拒贷。

## 应收账款保理（factoring）

来源范围：S04。候选材料：trade_contract；invoice；delivery_note/acceptance_record；receivable_transfer；factoring_agreement；debtor_confirmation；bank_receipt。

拟议规则：
- 合同、履约、开票与转让链分阶段；已转让债权集合有明确范围再汇总
- 收款主体为保理商时通过转让关系解释

例外与证据不足：融资额并不等于应收账款面值；折扣、保留款、部分转让、回购不能直接判假。

## 商业汇票贴现（bill_discount）

来源范围：S05。候选材料：commercial_bill；trade_contract；invoice；discount_application；authorization；corporate_identity。

拟议规则：
- 按出票、承兑、背书、持有人角色核对；贸易与票据集合明确后比对
- 票面日期顺序仅在票种和日期语义已确认时校验

例外与证据不足：贴现净到账小于票面可正常；电子票背书链、实时状态不可从截图推断。

## 信用证贸易材料（letter_of_credit）

来源范围：S06。候选材料：lc_application/letter_of_credit；trade_contract；commercial_invoice；bill_of_lading；packing_list；insurance_policy；lc_amendment。

拟议规则：
- 按最新明确生效的信用证修改书建立版本链；核对单据编号、币种、货物和单位
- 金额比较须明确贸易术语、运保费范围和分批装运

例外与证据不足：申请阶段与交单阶段材料不同；收货人可能为指示抬头；不宣称完成银行审单。

## 海关价格质疑材料（customs_price_query）

来源范围：S07。候选材料：price_query_notice；price_explanation；trade_contract/order；commercial_invoice；freight_invoice；insurance_policy；lc/payment_proof；account_book；inspection_report；goods_specification。

拟议规则：
- 由通知书具体要求确定材料范围；合同、货值、运保费和申报口径核对
- 有明确币种、汇率日期和价格组成才计算合计

例外与证据不足：不能将本场景清单套到普通发票提交；FOB/CIF和关联交易解释不自动等于造假。

## 已故存款人存款提取（inheritance）

来源范围：S09, S10。候选材料：death_certificate；identity；household_register/birth_certificate/marriage_certificate/will；commitment；authorization/notarial_deed。

拟议规则：
- 分别关联死亡证明对象、账户持有人、申请人、代理人；关系证明核对标识与时间
- 记录法律文书版本及关系路径，缺失边输出证据不足

例外与证据不足：户主不是当然继承人；同户不证明所有亲属关系；公证并非所有情况必需；不裁定继承权。

## 金融资产质押（deposit_pledge）

来源范围：S11。候选材料：identity；deposit_certificate/large_cd/savings_bond；pledge_agreement；loan_application；authorization。

拟议规则：
- 区分借款人与出质人；按资产编号和机构核对权属及合同关系
- 明确合同约定时比较期限，标注质押登记及冻结状态未外部核验

例外与证据不足：额度可小于资产金额；第三方出质需授权；图片不能证明可用余额或无其他质押。

## 标准仓单质押（warehouse_pledge）

来源范围：S12。候选材料：warehouse_receipt；pledge_application；pledge_authorization；pledge_agreement；registration_record。

拟议规则：
- 按仓单持有人—会员—银行三方关系核对授权、交易编码和仓单标识
- 同单位同品种汇总数量；明确适用指引及日期后比较质押期限与有效期

例外与证据不足：通用与非通用仓单编号要求不同；银行专用账户开户证照不能要求每位借款人提供；重复质押需登记信息验证。

## 费用分割与多主体分摊（shared_expense）

来源范围：S02。候选材料：invoice/fiscal_receipt；allocation_statement；allocation_agreement；payment_proof。

拟议规则：
- 原票与分割单经强关联后核对币种、期间和受益人；完整分摊全集才检验总额
- 原票影像在多个子包出现仅提示关联，不自动认定重复报销

例外与证据不足：只提交本单位分摊份额时不应要求等于整票金额；尾差和负向冲回需明确规则。

## 当前可执行范围

后端 `batch-engine.js` 实现了带来源和版本的字段核对、关联门槛、发票净额税额合计及已确认完整结算集合的去重求和。`catalog.js` 只产生场景适用性与候选材料覆盖信息，不把设计中的仓单期限、保险费用、继承关系、信用证单证审查伪装成已执行规则。所有来源与规则版本可追溯。

所有材料先按角色、交易、时点和金额口径建立关系。同名同额仅产生候选；代理、夫妻共有、公司与员工、患者与受益人应有不同角色。DocShield 只提供待核实视觉线索；这些规则不能反向证明是否发生图像篡改。
