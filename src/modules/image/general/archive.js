import {Unzip,UnzipInflate} from 'fflate';
const types={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
/** Decode in bounded chunks; archive paths are labels only, never filesystem targets. */
export async function expandImageUploads(files,{remaining=100,remainingBytes=1000*1048576}={}){
 const images=[],errors=[];let total=0;
 for(const file of files){
  if(!/\.zip$/i.test(file.name)){images.push(file);remaining--;total+=file.size;continue;}
  if(file.size>100*1048576){errors.push(`${file.name}：压缩包不能超过100 MB`);continue;}
  let entries=0,finished=0,selected=0,failed=false;
  const fail=message=>{failed=true;throw new Error(message);};
  try{
   const unzip=new Unzip(entry=>{
    if(++entries>2000)fail('压缩包文件条目过多');
    const name=entry.name.replaceAll('\\','/');
    const type=types[name.toLowerCase().split('.').pop()];
    if(!type||name.endsWith('/')||name.startsWith('__MACOSX/'))return;
    if(remaining<=0)fail('每批最多添加100张图片');
    remaining--;selected++;
    if(entry.originalSize>20*1048576)fail('压缩包内单张图片不能超过20 MB');
    let size=0;const chunks=[];
    entry.ondata=(error,data,final)=>{
     if(error)fail('压缩包损坏或不支持该压缩方式');
     size+=data.length;total+=data.length;
     if(size>20*1048576||total>remainingBytes){entry.terminate();fail('解压图片超过大小限制');}
     chunks.push(data);
     if(final){finished++;images.push(new File(chunks,name,{type}));}
    };
    entry.start();
   });
   unzip.register(UnzipInflate);
   for(let offset=0;offset<file.size;offset+=16384){
    const end=Math.min(offset+16384,file.size);
    unzip.push(new Uint8Array(await file.slice(offset,end).arrayBuffer()),end===file.size);
   }
   if(!selected)throw new Error('压缩包中没有JPG、PNG或WebP图片');
   if(finished!==selected||failed)throw new Error('压缩包不完整');
  }catch(error){errors.push(`${file.name}：${error.message}`);}
 }
 return {images,errors};
}
