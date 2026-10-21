// 无依赖的 ZIP（store）打包，排除本机配置、依赖、凭证和临时文件。
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
execFileSync(process.execPath,[path.join(root,'scripts/build.mjs')],{stdio:'inherit'});
execFileSync(process.execPath,['--test',path.join(root,'tests/framework.test.mjs'),path.join(root,'tests/collaboration.test.mjs'),path.join(root,'tests/video-general.test.mjs')],{stdio:'inherit'});
const whitelist=['src','scripts','public','docs','dist','tests','.github','.agents','openspec'];
const files=['index.html','package.json','package-lock.json','README.md','CONTRIBUTING.md','.gitignore'];
async function walk(relative){
  for(const item of await readdir(path.join(root,relative),{withFileTypes:true})){
    const name=path.posix.join(relative,item.name);
    if(item.isDirectory()) await walk(name);
    else if(item.isFile()) files.push(name);
  }
}
for(const relative of whitelist) await walk(relative);
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let i=0;i<8;i++) value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc32(buffer){let crc=0xffffffff;for(const value of buffer) crc=crcTable[(crc^value)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
const local=[],central=[];
let offset=0;
for(const relative of files.sort()){
  const data=await readFile(path.join(root,relative));
  const name=Buffer.from('aigcdetect/'+relative);
  const crc=crc32(data);
  const header=Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(0,8);header.writeUInt16LE(0,10);header.writeUInt16LE(0x5d54,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  local.push(header,name,data);
  const record=Buffer.alloc(46);
  record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(0x5d54,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(data.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42);
  central.push(record,name);offset+=header.length+name.length+data.length;
}
const directory=Buffer.concat(central);
const end=Buffer.alloc(22);
end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
const output=path.resolve(root,'../output');
await mkdir(output,{recursive:true});
const archive=path.join(output,'aigcdetect-source.zip');
await writeFile(archive,Buffer.concat([...local,directory,end]));
console.log(`Packaged ${files.length} files: ${archive}`);
