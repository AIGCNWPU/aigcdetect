# Spec Delta

## Purpose

对外市场 API 输出直观篡改结论（0–100 总分、逐区域置信度、可视化叠加图）、接口耗时与材料类别自动判断，并对齐成熟产品的错误码语义。

## ADDED Requirements

### Requirement: 直观篡改结论输出
市场 API SHALL 在 2.1 与 2.3 结果中输出 0–100 篡改总分（tamperScore）、每个疑似区域的置信度与可选叠加可视化图（includeOverlay=true 时返回 base64），分数携带未校准语义与参考线说明。

#### Scenario: 请求叠加图
- **WHEN** 调用方请求 includeOverlay=true 且检测存在篡改候选
- **THEN** 返回叠加可视化图 base64 及其格式说明

### Requirement: 接口耗时与类别自动判断
市场 API SHALL 在响应信封返回接口耗时（duration，毫秒），并支持 materialType=auto 由平台自动判断材料类别。

#### Scenario: 自动判断类别
- **WHEN** 调用方提交 materialType=auto 的票据图片
- **THEN** 返回结果的 materials[].type 为平台判定的类别而非 unknown
