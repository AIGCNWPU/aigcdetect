// 2.1 通用图片检测报告导出入口：提交检测结果，由服务端标准流水线生成规范 docx/pdf。
// 版式规范见 ../report-standard/spec.md；本文件不再在前端拼装报告样式。

import { exportStandardReport } from "../report-standard/client.js";

export async function exportGeneralReport(item, format = "pdf", { signal } = {}) {
  void signal; // 服务端一次性生成（数秒），无需中途取消；保留参数兼容旧调用。
  const name = item?.name || item?.file?.name || "image";
  return exportStandardReport({
    scenario: "general",
    format: format === "word" ? "docx" : "pdf",
    payload: { name, result: item?.result || item },
    fallbackName: `智鉴图片检测报告-${String(name).replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60)}`,
  });
}
