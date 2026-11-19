import { readFile, writeFile, mkdir, copyFile, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createOpenApi } from './openapi.mjs';
import { modules } from '../src/catalog.js';
import { build } from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
// Built JS/CSS carry content hashes so the server can mark them immutable; stale hashed files are cleared first.
await rm(path.join(root,'dist/assets'),{recursive:true,force:true});
await mkdir(path.join(root,'dist/assets'),{recursive:true});
await mkdir(path.join(root,'dist/public'),{recursive:true});
await mkdir(path.join(root,'docs'),{recursive:true});
const hashedCss={};
for (const file of ['styles.css', 'portal.css']) {
  const data=await readFile(path.join(root, 'src', file));
  const hash=createHash('sha256').update(data).digest('hex').slice(0, 10).toUpperCase();
  hashedCss[file]=file.replace(/\.css$/, `-${hash}.css`);
  await writeFile(path.join(root, 'dist/assets', hashedCss[file]), data);
}
const result=await build({
  entryPoints: Object.fromEntries(['entry', 'app', 'portal'].map(name => [name, path.join(root, 'src', name + '.js')])),
  outdir: path.join(root, 'dist/assets'),
  bundle: true,
  format: 'esm',
  splitting: true,
  entryNames: '[name]-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  platform: 'browser',
  target: ['es2022'],
  define: { WORKSPACE_STYLES: JSON.stringify('./' + hashedCss['styles.css']) },
  metafile: true,
});
const entryOutput=Object.entries(result.metafile.outputs).find(([, output]) => output.entryPoint?.replaceAll('\\', '/').endsWith('src/entry.js'))[0];
const entryFile=path.relative(path.join(root, 'dist/assets'), path.resolve(entryOutput)).replaceAll('\\', '/');
await copyFile(path.join(root,'public/favicon.svg'),path.join(root,'dist/public/favicon.svg'));
await copyFile(path.join(root,'public/favicon.png'),path.join(root,'dist/public/favicon.png'));
await copyFile(path.join(root,'public/brand-logo.png'),path.join(root,'dist/public/brand-logo.png'));
await copyFile(path.join(root,'public/brand-wordmark.svg'),path.join(root,'dist/public/brand-wordmark.svg'));
await copyFile(path.join(root,'public/portal-prism.webp'),path.join(root,'dist/public/portal-prism.webp'));
await cp(path.join(root,'public/refund-demos'),path.join(root,'dist/public/refund-demos'),{recursive:true});
await cp(path.join(root,'public/video-aftersales-demos'),path.join(root,'dist/public/video-aftersales-demos'),{recursive:true});
await cp(path.join(root,'public/video-demos'),path.join(root,'dist/public/video-demos'),{recursive:true});
await cp(path.join(root,'public/vendor/refund-pdf'),path.join(root,'dist/public/vendor/refund-pdf'),{recursive:true});
// fflate is bundled by esbuild; keep the browser build beside dist for the dev import map path without tracking a vendor copy.
await mkdir(path.join(root,'dist/public/vendor/fflate'),{recursive:true});
await copyFile(path.join(root,'node_modules/fflate/esm/browser.js'),path.join(root,'dist/public/vendor/fflate/browser.js'));
await cp(path.join(root,'public/image-examples'),path.join(root,'dist/public/image-examples'),{recursive:true});
await cp(path.join(root,'public/demo'),path.join(root,'dist/public/demo'),{recursive:true});
const html=(await readFile(path.join(root,'index.html'),'utf8')).replace(/^  <script type="importmap">[^\n]+<\/script>\r?\n/m, '')
  .replace('./src/portal.css', './assets/' + hashedCss['portal.css']).replace('./src/entry.js', './assets/' + entryFile).replaceAll('./src/', './assets/');
await writeFile(path.join(root,'dist/index.html'),html);
await writeFile(path.join(root,'docs/openapi.json'),JSON.stringify(createOpenApi(),null,2)+'\n');
let matrix='# 场景与接口映射\n\n4 个模块 / 10 个检测业务场景。新闻和小说已接入EGTE句级AI检测，新闻三审三校和小说重复/水稿检测已接入服务端模型适配层；学术检测由独立后端代理执行；图片与视频售后提供当前材料分析；通用图片与证件票据提供异步图像检测与材料核验。\n\n';
for(const module of modules){
  matrix+=`## ${module.title}\n\n| 场景 | 前端路由 | 请求 | 来源页码 |\n| --- | --- | --- | --- |\n`;
  for(const scenario of module.scenarios){
    matrix+=`| ${scenario.title} | \`#${scenario.path}\` | \`${scenario.api.method} ${scenario.api.path}\` | ${scenario.sourcePage} |\n`;
  }
}
matrix+='## 已实现的独立预处理接口\n\n| 能力 | 前端路由 | 请求 | 状态 |\n| --- | --- | --- | --- |\n| 新闻公开正文网页导入 | `#/text/news` | `POST /api/v1/text/news/import` | 已实现通用公开HTML提取；不包含检测算法 |\n| 小说公开章节网页导入 | `#/text/novel` | `POST /api/v1/text/novel/import` | 已实现；不包含检测算法 |\n';
await writeFile(path.join(root,'docs/需求与接口映射.md'),matrix);
console.log('Build complete: dist/index.html, docs/openapi.json, sentence-level EGTE UI, news proofreading, novel quality detection, and import endpoints.');
