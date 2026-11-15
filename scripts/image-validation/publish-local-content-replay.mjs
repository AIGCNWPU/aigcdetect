// Publish two automatic development replays without modifying historical folders.
import {mkdir,cp,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [rootArg,outArg]=process.argv.slice(2);
if(!rootArg||!outArg)throw new Error('Usage: publish-local-content-replay.mjs PLATFORM_ROOT NEW_OUTPUT');
const root=path.resolve(rootArg),out=path.resolve(outArg),base=path.join(root,'runtime/replay/local-content-20261027');
if(!out.startsWith(path.join(root,'runtime')+path.sep))throw new Error('Output must be inside runtime');
await mkdir(out,{mode:0o700});
let sections='',style='';
for(const [folder,source] of [['target20','target20-v4'],['expanded15','expanded-v4']]){
 await cp(path.join(base,source),path.join(out,folder),{recursive:true,errorOnExist:true,force:false});
 const html=await readFile(path.join(out,folder,'index.html'),'utf8');
 style+=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';
 const start=html.indexOf('<section'),end=html.lastIndexOf('</section>')+10;
 if(start<0||end<10)throw new Error('Missing generated sections');
 sections+=html.slice(start,end).replace(/(href|src)="(group-[^"]+)"/g,`$1="${folder}/$2"`);
}
const intro='12组35张真实中文图像，自动抽取254个业务字段，形成23个核心标识候选。本轮API与大模型调用均为0。原20张复用已冻结OCR；新增15张实际重新运行本机OCR。字段数、告警数均不是准确率。';
await writeFile(path.join(out,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>中文材料本地核验 2026-10-27</title><style>${style}body{max-width:1400px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>中文材料本地核验 · 2026-10-27</h1><p>${intro}</p><p>字段、状态、原因、证据均由实际生产规则自动生成；作者标注与人工复核单列，不参与规则执行。下方可展开完整OCR和逐项检查。</p><p><a href="target20/index.html">原6组20张</a> · <a href="expanded15/index.html">新增6组15张</a> · <a href="target20/group-34/local-results.md">第34组新原因与金额差值</a> · <a href="README.md">范围说明</a></p>${sections}</html>`,{flag:'wx'});
await writeFile(path.join(out,'README.md'),`# 自动本地核验结果 · 2026-10-27\n\n${intro}\n\n[全部结果](index.html) · [原20张](target20/index.html) · [新增15张](expanded15/index.html)\n\n## 自动输出和人工内容\n\nOCR文字块由OCR程序识别；业务字段由格式、标签、正则、行列和段落适配提取；逐项检查由规则计算，中文原因由代码模板及计算值组合。状态、原因、证据不是人工逐条编写。作者说明与开发核对清单另外保存，未输入规则。识别分数不是真实性概率，字段表不等于全文转成结构化字段，完整OCR另附。\n\n## 本轮新增\n\n缴费详情、承诺函、纳税证明、生活缴费凭证、借条、订单详情。实际新增5个格式适配，承诺函为既有格式的新增样本。第2组作者分类名为税收完税证明，但图片实际为移动缴费详情，按图片处理并保留原分类。新增15张71字段9候选，未出现零字段文件；仍有未完成检查，不能解释为内容全部提取或全部通过。\n\n## 边界\n\n同户号但供电单位不同只产生待确认候选和WARN；承诺账户集合不同保留WARN，未确认完整唯一清单前不判定违规。17位身份号保留原样并报告结构异常。机构制度未配置仍NEI，地区与高校调研并非已经执行的逐机构制度。开发样本被用于规则迭代，不能当独立测试准确率。本轮未重跑MIRROR、SEED、真实API及本地语言模型。\n`,{flag:'wx'});
const hashes={};
async function walk(dir){for(const ent of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory())await walk(p);else hashes[path.relative(out,p)]=createHash('sha256').update(await readFile(p)).digest('hex');}}
await walk(out);await writeFile(path.join(out,'copy-checksums.json'),JSON.stringify(hashes,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,files:Object.keys(hashes).length}));
