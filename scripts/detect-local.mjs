// 服务器本地批量检测:绕过网关与浏览器,直接调用 Native-Scale 推理服务(127.0.0.1:8600)。
// 用法(在仓库根目录): node scripts/detect-local.mjs [视频文件或目录 ...]
//   缺省检测 ../demo-videos 下所有视频;目录会递归展开。
// 适用场景:SSH 隧道/端口转发不稳定时,在 VS Code 终端(服务器侧)直接跑。
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SERVICE = process.env.VIDEO_GENERAL_SERVICE_URL || 'http://127.0.0.1:8600';
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv']);

async function expand(target) {
  const info = await stat(target);
  if (info.isFile()) return [target];
  const out = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...await expand(child));
    else if (VIDEO_EXT.has(path.extname(entry.name).toLowerCase())) out.push(child);
  }
  return out;
}

const health = await (await fetch(`${SERVICE}/health`)).json();
if (!health.modelReady) {
  console.error(`检测服务未就绪: ${health.error || '模型未加载'}`);
  process.exit(1);
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : [path.resolve('../demo-videos')];
const files = (await Promise.all(targets.map(expand))).flat().sort();
if (!files.length) {
  console.error('未找到视频文件。');
  process.exit(1);
}

console.log(`检测服务就绪,共 ${files.length} 个视频:\n`);
const rows = [];
for (const file of files) {
  const started = Date.now();
  const form = new FormData();
  form.set('video', new File([await readFile(file)], path.basename(file)), path.basename(file));
  try {
    const response = await fetch(`${SERVICE}/detect`, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 120)}`);
    const result = await response.json();
    rows.push({ name: path.basename(file), risk: result.risk, duration: result.duration, frames: result.sampledFrames, ms: Date.now() - started });
  } catch (error) {
    rows.push({ name: path.basename(file), risk: '失败', duration: '-', frames: '-', ms: Date.now() - started, error: String(error.message).slice(0, 80) });
  }
}

const riskLabel = { high: '高风险(AI生成)', medium: '中风险', low: '低风险(真实)' };
const width = Math.max(...rows.map(r => r.name.length), 4);
for (const row of rows) {
  const label = riskLabel[row.risk] || row.risk;
  console.log(`${row.name.padEnd(width)}  ${label.padEnd(14)} 时长${String(row.duration).padStart(3)}s  ${String(row.frames).padStart(3)}帧  ${String(row.ms).padStart(5)}ms${row.error ? `  ✗ ${row.error}` : ''}`);
}
const failed = rows.filter(r => r.error).length;
console.log(`\n完成:${rows.length - failed} 成功,${failed} 失败。`);
