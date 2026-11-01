import { readdir, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modules, scenarios } from '../src/catalog.js';
import { clientFiles } from './source-files.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const files=[];
async function walk(relative){
  for(const item of await readdir(path.join(root,relative),{withFileTypes:true})){
    const name=path.join(relative,item.name);
    if(item.isDirectory()) await walk(name);
    else if(item.isFile()) files.push(name);
  }
}
for(const name of ['src','scripts','tests','docs','openspec','.github']) await walk(name);
files.push('README.md','CONTRIBUTING.md');
let scripts=0,links=0;
for(const name of files){
  const file=path.join(root,name);
  if(/\.(?:js|mjs)$/.test(name)){execFileSync(process.execPath,['--check',file],{stdio:'pipe'});scripts++;}
  if(name.endsWith('.md')){
    const text=await readFile(file,'utf8');
    for(const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)){
      const target=match[1].split('#')[0];
      if(!target || /^[a-z]+:/i.test(target)) continue;
      await access(path.resolve(path.dirname(file),decodeURIComponent(target)));
      links++;
    }
  }
}
for(const module of modules) for(const scene of module.scenarios){
  const change=`openspec/changes/add-${module.id}-${scene.id}`;
  for(const artifact of ['proposal.md','design.md','tasks.md',`specs/${module.id}-${scene.id}/spec.md`]) await access(path.join(root,change,artifact));
  const tasks=await readFile(path.join(root,change,'tasks.md'),'utf8');
  const pendingMilestones=['1.1 按已分配场景核对需求与框架，完善design和具体开发任务。','1.2 完成对应需求的业务功能、自检与关键验收，记录未完成项。','1.3 核对公共接口和跨场景引用，提交代码与文档PR并配合联调。'];
  for(const milestone of pendingMilestones) if(tasks.includes(`- [x] ${milestone}`)) throw new Error(`整体业务里程碑尚未完成，不应勾选：${change} ${milestone}`);
}
for(const name of clientFiles){
  await access(path.join(root,name));
  if(name.includes('/server/')||name.endsWith('/service.js')) throw new Error(`服务端文件不能进入浏览器包：${name}`);
}
console.log(`Checks passed: ${scripts} JS files, ${links} local documentation links, ${scenarios.length} pending work packages, browser bundle boundary.`);
