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
  for(const line of tasks.split(/\r?\n/)) {
    if(/^- \[x\]/i.test(line) && !/证据：.*\[[^\]]+\]\([^)]+\)/.test(line)) {
      throw new Error(`已完成任务必须附实际验证记录链接：${change}: ${line}`);
    }
  }
}
for(const name of clientFiles){
  await access(path.join(root,name));
  if(name.includes('/server/')||name.endsWith('/service.js')) throw new Error(`服务端文件不能进入浏览器包：${name}`);
}
console.log(`Checks passed: ${scripts} JS files, ${links} local documentation links, ${scenarios.length} work packages with completion evidence checks, browser bundle boundary.`);
