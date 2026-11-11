// 浏览器端标准报告导出适配：提交检测结果到 /api/v1/image/report，
// 由服务端统一流水线生成规范 docx/pdf（见 report-standard/spec.md）。

import { api } from "../../../api.js";

function downloadBytes(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filenameFromDisposition(header, fallback) {
  if (!header) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8) { try { return decodeURIComponent(utf8[1]); } catch { /* fall through */ } }
  const plain = /filename="([^"]+)"/i.exec(header);
  if (plain) { try { return decodeURIComponent(plain[1]); } catch { return plain[1]; } }
  return fallback;
}

/**
 * 导出标准报告。
 * @param {"general"|"documents"} scenario 场景
 * @param {"pdf"|"docx"} format 输出格式
 * @param {object} payload 场景结果（2.1：{name,result}；2.3：核验返回数据）
 * @param {string} fallbackName 服务端未返回文件名时的兜底名
 */
export async function exportStandardReport({ scenario, format = "pdf", payload, fallbackName }) {
  if (!["general", "documents"].includes(scenario)) throw new Error("未知的报告场景。");
  const url = new URL(api.baseUrl + "/api/v1/image/report", globalThis.location?.origin || "http://localhost");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, format, payload }),
  });
  if (!response.ok) {
    let message = "报告生成失败，请稍后重试。";
    try { message = (await response.json())?.error?.message || message; } catch { /* keep default */ }
    throw new Error(message);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const mime = format === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/pdf";
  const filename = filenameFromDisposition(response.headers.get("content-disposition"), `${fallbackName}.${format}`);
  downloadBytes(bytes, filename, mime);
  return { kind: format, bytes: bytes.length, filename };
}
