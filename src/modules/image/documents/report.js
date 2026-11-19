// 2.3 材料核验报告导出入口：提交核验结果，由服务端标准流水线生成规范 docx/pdf。
// 版式规范见 ../report-standard/spec.md；本文件不再在前端拼装报告样式。

import { exportStandardReport } from "../report-standard/client.js";

export async function exportDocumentsReport(data, sourceFiles = [], format = "pdf", { signal } = {}) {
  void sourceFiles; // 页面预览图已包含在核验结果（materials[].pages[].previewDataUrl）中。
  void signal; // 服务端一次性生成（数秒），无需中途取消；保留参数兼容旧调用。
  const materials = Array.isArray(data?.materials) ? data.materials : [];
  const objective = data?.review?.plan?.objective || "材料核验";
  return exportStandardReport({
    scenario: "documents",
    format: format === "word" ? "docx" : "pdf",
    payload: data || {},
    fallbackName: `智鉴材料核验报告-${String(objective).replace(/[\\/:*?"<>|]/g, "_")}-${materials.length}份材料`,
  });
}
