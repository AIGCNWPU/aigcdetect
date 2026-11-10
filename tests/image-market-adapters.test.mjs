import test from "node:test";
import assert from "node:assert/strict";
import { marketProducts, buildRequest, normalizeResponse, fieldMap } from "../scripts/image-validation/aliyun-market/adapters.mjs";
import { createMarketClient, loadBudget, saveBudget, marketEnvName, endpointEnvName } from "../scripts/image-validation/aliyun-market/client.mjs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

test("商品注册表覆盖四类试点且身份证明端点有官方默认值", () => {
  const keys = marketProducts.map((product) => product.key);
  for (const key of ["invoice-ocr", "idcard-ocr", "invoice-verify", "vat-verify", "doc-compare", "tamper-detect", "aigc-detect"]) assert.ok(keys.includes(key), key);
  const idcard = marketProducts.find((product) => product.key === "idcard-ocr");
  assert.match(idcard.endpointDefault, /^https:\/\/cardnumber\.market\.alicloudapi\.com\//);
  for (const key of ["invoice-ocr", "invoice-verify", "doc-compare", "tamper-detect"]) assert.match(marketProducts.find((product) => product.key === key).endpointDefault, /^https:\/\/[a-z]+\.market\.alicloudapi\.com\//, `${key} 应有商品页端点`);
});

test("身份证 OCR 归一化提取字段并保留篡改分", () => {
  const normalized = normalizeResponse("idcard-ocr", { status: 200, body: { data: { face: { name: "张三", gender: "男", nationality: "汉", birth: "19900101", address: "某市", num: "110101199001010000" }, quality_info: { tamper_score: 12.5, is_copy: false } } } });
  assert.equal(normalized.kind, "ocr");
  const fields = fieldMap(normalized);
  assert.equal(fields.name, "张三");
  assert.equal(fields.id_number, "110101199001010000");
  assert.equal(normalized.tamperScore, 12.5);
  assert.equal(normalized.isCopy, false);
  assert.equal(fields.address, "某市");
});

test("增值税发票 OCR 兼容官方与常见字段命名", () => {
  for (const body of [
    { data: { invoiceCode: "044031900111", invoiceNum: "12345678", totalAmount: "372.49", totalTax: "44.79" } },
    { data: { fpdm: "044031900111", fphm: "12345678", jshj: "372.49", hjse: "44.79" } },
  ]) {
    const fields = fieldMap(normalizeResponse("invoice-ocr", { status: 200, body }));
    assert.equal(fields.invoice_code, "044031900111");
    assert.equal(fields.invoice_number, "12345678");
    assert.equal(fields.gross_amount, "372.49");
    assert.equal(fields.tax_amount, "44.79");
  }
});

test("篡改与 AIGC 检测归一化阈值判定", () => {
  const tampered = normalizeResponse("tamper-detect", { status: 200, body: { data: { tamper: true, regions: [{ left: 10, top: 20, w: 100, h: 50 }] } } });
  assert.equal(tampered.tampered, true);
  assert.deepEqual(tampered.regions, [{ x: 10, y: 20, width: 100, height: 50 }]);
  const clean = normalizeResponse("tamper-detect", { status: 200, body: { data: { tamperScore: 5 } } });
  assert.equal(clean.tampered, false);
  const aigc = normalizeResponse("aigc-detect", { status: 200, body: { data: { score: 0.98 } } });
  assert.equal(aigc.aiGenerated, true);
  const human = normalizeResponse("aigc-detect", { status: 200, body: { data: { score: 0.03 } } });
  assert.equal(human.aiGenerated, false);
});

test("验真与文档比对归一化", () => {
  const encoded = Buffer.from(JSON.stringify({ fpxx: { fphm: "23412000000052124997", jshj: "306500.00" } })).toString("base64");
  const verified = normalizeResponse("invoice-verify", { status: 200, body: { code: "0000", msg: "查验成功", content: encoded } });
  assert.equal(verified.verified, true);
  assert.equal(verified.mismatch, false);
  assert.equal(verified.content.fpxx.jshj, "306500.00");
  const mismatch = normalizeResponse("invoice-verify", { status: 200, body: { code: "CY0017", msg: "发票数据不一致", content: "" } });
  assert.equal(mismatch.verified, false);
  assert.equal(mismatch.mismatch, true);
  const rejected = normalizeResponse("invoice-verify", { status: 200, body: { code: "CY0005", msg: "发票代码格式错误" } });
  assert.equal(rejected.formatRejected, true);
  const compare = normalizeResponse("doc-compare", { status: 200, body: { doc: { match_list: [{ match_detail: [{ type: "modify", tci_detail: [{ type: "reference", word: "李*娜" }, { type: "query", word: "江*速" }] }, { type: "delete", tci_detail: [{ type: "reference", word: "宁波增值税" }] }, { type: "insert", tci_detail: [{ type: "query", word: "新增" }] }] }] } } });
  assert.equal(compare.differenceCount, 3);
  assert.deepEqual(compare.diffs[0], { type: "modify", reference: "李*娜", query: "江*速" });
});

test("客户端：预算记账、原始留档与未配置端点拒绝", async () => {
  const dir = await mkdtemp("market-client-");
  const budget = await loadBudget(path.join(dir, "budget.json"), { limit: 2 });
  const budgetFile = path.join(dir, "budget.json");
  const responses = [];
  const client = createMarketClient({
    appcode: "TESTCODE",
    budget,
    live: true,
    archiveDir: path.join(dir, "raw"),
    saveBudget: () => saveBudget(budgetFile, budget),
    fetchImpl: async () => { responses.push(1); return { status: 200, text: async () => JSON.stringify({ data: { ok: true } }) }; },
  });
  const first = await client.call({ kind: "idcard-ocr", url: "https://cardnumber.market.alicloudapi.com/rest/160601/ocr/ocr_idcard.json", body: { image: "x" } });
  assert.equal(first.ok, true);
  await assert.rejects(() => client.call({ kind: "idcard-ocr", body: {} }), /endpoint missing/);
  await client.call({ kind: "idcard-ocr", url: "https://cardnumber.market.alicloudapi.com/rest/160601/ocr/ocr_idcard.json", body: { image: "y" } });
  await assert.rejects(() => client.call({ kind: "idcard-ocr", url: "https://example.invalid/x", body: {} }), /test_budget_exhausted/);
  assert.equal(budget.attempts, 2);
  const ledger = JSON.parse(await readFile(budgetFile, "utf8"));
  assert.equal(ledger.requests.length, 2);
  assert.match(ledger.requests[0].url, /^cardnumber\.market\.alicloudapi\.com\//);
  const raw = await readFile(path.join(dir, "raw", "001-idcard-ocr.json"), "utf8");
  assert.match(raw, /ocr_idcard\.json/);
  assert.equal(raw.includes("TESTCODE"), false, "归档不得包含 AppCode");
  const dry = createMarketClient({ budget: { attempts: 0, limit: 5, requests: [] } });
  await assert.rejects(() => dry.call({ url: "https://x" }), /dry mode/);
  await rm(dir, { recursive: true, force: true });
});

test("环境变量命名与请求构造", () => {
  assert.equal(marketEnvName("invoice-ocr"), "ALIYUN_APPCODE_INVOICE_OCR");
  assert.equal(endpointEnvName("tamper-detect"), "ALIYUN_MARKET_ENDPOINT_TAMPER_DETECT");
  assert.deepEqual(buildRequest("invoice-ocr", { image: "abc" }), { body: { img: "abc" } });
  assert.deepEqual(buildRequest("idcard-ocr", { image: "abc" }), { body: { image: "abc", configure: { side: "face", quality_info: true } } });
  assert.deepEqual(buildRequest("tamper-detect", { image: "zzz" }), { body: { base64: "zzz", detectThreshold: "0.9887", restrictProbability: "0.8" } });
  assert.throws(() => buildRequest("no-such"), /unknown product/);
});

async function mkdtemp(prefix) {
  const os = await import("node:os");
  const dir = path.join(os.tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  return dir;
}
