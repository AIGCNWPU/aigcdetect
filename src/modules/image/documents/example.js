// Generated from verified review record 5dc6b477-d3f3-47b8-a7b8-6c99ad06280d
// (runtime/reviews, invoice_review objective, two same-number invoices; 2026-10-26 run,
// reused by Agent SDK acceptance on 2026-10-31). Values below are copied verbatim
// from that record's fields and checks; display previews are rescaled copies of the
// uploaded originals. No API or runtime dependency.
export const invoiceShowcase = {
  title: "发票核验示例",
  subtitle: "上传材料后，可逐项查看核对结果与需要关注的问题。",
  materials: [
    {
      id: "a",
      tab: "发票 A · 核心材料",
      image: "/public/image-examples/invoice/invoice-a.jpg",
      summary: "购买方 李*娜 · *肉*风味卤牛肉",
      fields: [
        { label: "发票代码", value: "2024330000123" },
        { label: "发票号码", value: "0001345" },
        { label: "开票日期", value: "2024年08月29日" },
        { label: "价税合计", value: "1999.99（壹仟玖佰玖拾玖圆玖角玖分）" },
        { label: "金额 / 税额", value: "1999.99 / 259.99" },
      ],
      issues: [
        { title: "价税合计与金额、税额不相符", detail: "金额 1999.99 ＋ 税额 259.99 ≠ 价税合计 1999.99，票面算术矛盾。" },
        { title: "发票号码格式异常", detail: "号码 0001345 长度不足，不符合现行数电发票号码规则。" },
        { title: "发票代码格式异常", detail: "代码 2024330000123 不符合对应票种的代码结构。" },
      ],
      passes: [
        { title: "开票日期为有效日历日期", detail: "2024年08月29日 可解析且真实存在。" },
        { title: "大小写金额一致", detail: "壹仟玖佰玖拾玖圆玖角玖分 ＝ 1999.99。" },
        { title: "行项目金额一致", detail: "数量 1 × 单价 1999.99 ＝ 行金额 1999.99。" },
      ],
    },
    {
      id: "b",
      tab: "发票 B · 辅助材料",
      image: "/public/image-examples/invoice/invoice-b.jpg",
      summary: "购买方 江*速 · 贵州茅台酒业*飞天系列",
      fields: [
        { label: "发票代码", value: "2024330000123" },
        { label: "发票号码", value: "0001345" },
        { label: "开票日期", value: "2024年08月29日" },
        { label: "价税合计", value: "30000.00（叁万圆整）" },
        { label: "金额 / 税额", value: "30000.00 / 62.31" },
      ],
      issues: [
        { title: "价税合计与金额、税额不相符", detail: "金额 30000.00 ＋ 税额 62.31 ≠ 价税合计 30000.00，票面算术矛盾。" },
        { title: "税额与税率不相符", detail: "税率 13% × 行金额 30000.00 ≠ 税额 62.31。" },
        { title: "发票号码格式异常", detail: "号码 0001345 长度不足，且与发票 A 同号。" },
      ],
      passes: [
        { title: "开票日期为有效日历日期", detail: "2024年08月29日 可解析且真实存在。" },
        { title: "大小写金额一致", detail: "叁万圆整 ＝ 30000.00。" },
        { title: "行项目金额一致", detail: "数量 2 × 单价 15000.00 ＝ 行金额 30000.00。" },
      ],
    },
  ],
  provenance: {
    sourceRecord: "5dc6b477-d3f3-47b8-a7b8-6c99ad06280d",
    objective: "invoice_review",
    invoiceASha256: "c8bc0825d6f55080701886f3e6487c2798d096e6690bef9b2c2f47f5e35d6181",
    invoiceBSha256: "59412255e06151506235b41d220b491376471a4b552f35385a90253fab580d59",
  },
};
