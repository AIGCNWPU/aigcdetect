import { presentRefundResult } from './presentation.js';

const refundPdfKinds={ai:'图片来源检测',tamper:'局部篡改检测',comparison:'商品与描述核对'};
const refundPdfStatuses={idle:'未检测',queued:'排队中',running:'检测中',succeeded:'已完成',failed:'失败',cancelled:'已取消'};
const refundPdfOutcomes={match:'一致',mismatch:'不一致',unknown:'无法判断'};
const refundPdfDimensions={appearance:'商品外观',style:'商品款式',issue:'问题现象'};
export function buildCurrentRefundReport(fields,entries,{generatedAt=new Date().toISOString()}={}) {
  if(!entries.length || entries.length>10)throw new Error('请先添加当前需要分析的图片。');
  const input=Object.fromEntries(['caseNumber','productName','style','productInfo','description'].map(key=>[key,String(fields[key]||'').trim()]));
  return {title:'售后凭证分析报告',generatedAt,fields:input,images:entries.map(entry=>({id:entry.id,name:entry.file.name,file:entry.file,width:entry.width,height:entry.height,states:Object.fromEntries(Object.entries(refundPdfKinds).map(([kind,title])=>{
    const state=entry[kind]||{status:'idle'},supplied=state.status==='succeeded'?state.result:null;
    const linked=supplied?.imageId===entry.id&&supplied?.kind===kind;
    const validComparison=kind!=='comparison'||Array.isArray(supplied?.checks)&&supplied.checks.length===3&&new Set(supplied.checks.map(c=>c.dimension)).size===3&&supplied.checks.every(c=>Object.hasOwn(refundPdfDimensions,c.dimension)&&Object.hasOwn(refundPdfOutcomes,c.outcome)&&typeof c.observed==='string'&&c.observed.trim()&&typeof c.evidence==='string'&&c.evidence.trim());
    const result=linked&&validComparison?supplied:null,copy=result?presentRefundResult(result):null;
    const status=state.status==='succeeded'&&!result?'failed':Object.hasOwn(refundPdfStatuses,state.status)?state.status:'idle';
    const value={title,status,label:result?.localization?copy.label:kind==='ai'&&result?({low:'来源信号较低',medium:'来源信号中等',high:'来源信号较高',unknown:'无法判断'}[result.risk]||'无法判断'):refundPdfStatuses[status],summary:copy?.summary||state.error||(status==='failed'?'未获得有效检测结果。':'尚未获得检测结果。'),scope:copy?.scope||'',coverage:result?.coverage,tone:'neutral'};
    if(status==='failed')value.tone='error';
    if(kind==='ai'&&result){if(['medium','high'].includes(result.risk))value.tone='attention';if(Number.isFinite(result.provenance?.generatedScore)&&result.provenance.generatedScore>=0&&result.provenance.generatedScore<=1)value.signal=result.provenance.generatedScore;}
    if(kind==='comparison'&&result){
      value.checks=[...result.checks].sort((a,b)=>Object.keys(refundPdfDimensions).indexOf(a.dimension)-Object.keys(refundPdfDimensions).indexOf(b.dimension)).map(check=>({dimension:refundPdfDimensions[check.dimension],outcome:refundPdfOutcomes[check.outcome],outcomeCode:check.outcome,observed:check.observed,evidence:check.evidence}));
      const outcomes=value.checks.map(check=>check.outcomeCode);
      value.label=outcomes.includes('mismatch')?'存在不一致':outcomes.every(v=>v==='unknown')?'无法判断':outcomes.includes('unknown')?'部分无法判断':'资料核对一致';
      value.tone=outcomes.includes('mismatch')?'attention':outcomes.includes('unknown')?'neutral':'consistent';
    }
    if(kind==='tamper'&&result?.localization){value.localizationStatus=result.localization.status;if(result.localization.markedPixels){value.mask={...result.localization.mask};value.tone='attention';}}
    return [kind,value];
  }))}))};
}

export function summarizeRefundAnalysis(report) {
  const total=report.images.length;
  const processing=Object.entries(refundPdfKinds).map(([kind,title])=>{
    const states=report.images.map(image=>image.states[kind]);
    const returned=states.filter(state=>state.status==='succeeded').length;
    const failed=states.filter(state=>['failed','cancelled'].includes(state.status)).length;
    return {kind,title,returned,failed,pending:total-returned-failed,partial:states.filter(state=>state.status==='succeeded'&&state.coverage==='partial').length};
  });
  const comparisons=Object.values(refundPdfDimensions).map(dimension=>{
    const counts={dimension,match:0,mismatch:0,unknown:0,unavailable:0};
    for(const image of report.images){const state=image.states.comparison,check=state.status==='succeeded'?state.checks?.find(item=>item.dimension===dimension):null;counts[check?.outcomeCode||'unavailable']++;}
    return counts;
  });
  const returned=processing.reduce((n,row)=>n+row.returned,0);
  return {total,resultSlots:total*3,returned,outstanding:total*3-returned,processing,comparisons};
}

export function wrapRefundPdfText(text,font,size,width) {
  const lines=[];
  for(const paragraph of String(text??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/\r\n?|\u2028|\u2029/g,'\n').replace(/\t/g,'    ').split('\n')){
    let line='';
    for(const token of paragraph.match(/[A-Za-z0-9][A-Za-z0-9._%/@+\/-]*|\s+|[^\s]/gu)||['']){
      if(font.widthOfTextAtSize(line+token,size)<=width){line+=token;continue;}
      // Keep Chinese closing punctuation with its preceding character.
      if(/^[，。！？、；：）】》」』〕％%]$/.test(token)&&line){const chars=Array.from(line),last=chars.pop();if(chars.length)lines.push(chars.join('').trimEnd());line=last+token;continue;}
      let opening='';if(/[（【《「『〔]$/.test(line)){opening=Array.from(line).pop();line=Array.from(line).slice(0,-1).join('');}
      if(line.trim()){lines.push(line.trimEnd());line='';}
      const next=opening+token.trimStart();
      if(font.widthOfTextAtSize(next,size)<=width){line=next;continue;}
      for(const ch of next){if(font.widthOfTextAtSize(line+ch,size)>width&&line){lines.push(line);line='';}line+=ch;}
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function formatRefundPdfTime(value,{filename=false}={}) {
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return filename?'current':'未记录';
  const parts=Object.fromEntries(new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  return filename?`${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`:`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export async function createCurrentRefundPdf(report,{PDFLib,fontkit,fontBytes,prepareImage,signal,onProgress=()=>{},onLayout=()=>{}}={}) {
  const check=()=>signal?.throwIfAborted();check();onProgress({phase:'preparing',completed:0,total:report.images.length});
  const {PDFDocument,StandardFonts,rgb}=PDFLib,doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  // Full TrueType embedding preserves Chinese glyphs across PDF readers.
  const cjk=await doc.embedFont(fontBytes,{subset:false}),latin=await doc.embedFont(StandardFonts.Helvetica),latinBold=await doc.embedFont(StandardFonts.HelveticaBold);check();
  doc.setTitle(report.title);doc.setAuthor('VERITAS 智鉴');doc.setCreator('VERITAS');doc.setProducer('VERITAS');doc.setLanguage('zh-CN');
  const created=new Date(report.generatedAt);if(Number.isFinite(created.getTime())){doc.setCreationDate(created);doc.setModificationDate(created);}
  const W=595.28,H=841.89,M=40,CW=W-2*M,BOTTOM=58,TOP=H-62;
  const single=report.images.length===1,cardHeight=single?50:58,comparisonLeading=single?12:13.5,comparisonPad=single?4:6;
  const colors={ink:rgb(.12,.19,.27),muted:rgb(.43,.49,.56),accent:rgb(.39,.31,.61),line:rgb(.86,.89,.92),wash:rgb(.96,.97,.985),white:rgb(1,1,1)};
  const tones={neutral:{ink:rgb(.32,.39,.50),fill:rgb(.95,.965,.985)},attention:{ink:rgb(.60,.36,.11),fill:rgb(1,.97,.92)},consistent:{ink:rgb(.16,.43,.32),fill:rgb(.94,.975,.95)},error:{ink:rgb(.67,.24,.25),fill:rgb(1,.95,.95)}};
  let page,y,pageIndex=0,context='',pageContext=[],imagePageStarts=[];
  const runs=(text,strong=false)=>{const result=[];for(const ch of String(text)){const f=/^[\x20-\x7e]$/.test(ch)?strong?latinBold:latin:cjk;const last=result.at(-1);if(last?.font===f)last.text+=ch;else result.push({font:f,text:ch});}return result;};
  const measure=(text,size,strong=false)=>runs(text,strong).reduce((w,run)=>w+run.font.widthOfTextAtSize(run.text,size),0);
  const metric={widthOfTextAtSize:(text,size)=>measure(text,size)};
  const wrap=(text,size,width)=>wrapRefundPdfText(text,metric,size,width);
  const short=(text,size,width)=>{text=String(text).replace(/\s+/g,' ').trim();const chars=Array.from(text);while(chars.length&&measure(chars.join('')+'…',size)>width)chars.pop();return chars.length===Array.from(String(text)).length?String(text):chars.join('')+'…';};
  function text(value,x,top,{size=10,color=colors.ink,strong=false,role='body'}={}){
    const line=String(value);let cursor=x;
    for(const run of runs(line,strong)){page.drawText(run.text,{x:cursor,y:top-size,font:run.font,size,color});cursor+=run.font.widthOfTextAtSize(run.text,size);}
    onLayout({kind:'text',role,page:pageIndex,context,text:line,x,top,width:cursor-x,height:size});
  }
  function rect(x,top,width,height,{fill=colors.white,border=colors.line,lineWidth=.5}={}){page.drawRectangle({x,y:top-height,width,height,color:fill,borderColor:border,borderWidth:lineWidth});}
  function rounded(x,top,width,height,{fill=colors.wash,border=fill,radius=6}={}){
    const r=Math.min(radius,height/2,width/2);
    page.drawSvgPath(`M${r} 0H${width-r}Q${width} 0 ${width} ${r}V${height-r}Q${width} ${height} ${width-r} ${height}H${r}Q0 ${height} 0 ${height-r}V${r}Q0 0 ${r} 0Z`,{x,y:top,color:fill,borderColor:border,borderWidth:.5});
  }
  function centerText(value,x,top,options={}){text(value,x-measure(value,options.size||10,options.strong)/2,top,options);}
  function newPage(nextContext=context){
    context=nextContext;page=doc.addPage([W,H]);pageIndex=doc.getPageCount();pageContext.push(context);y=TOP;
    text('VERITAS',M,H-24,{size:9.5,strong:true,color:colors.accent,role:'header'});
    text(short(context||'当前材料分析',8,CW-150),M+102,H-25,{size:8,color:colors.muted,role:'header'});
    rounded(W-M-30,H-25,30,3,{fill:colors.accent,radius:1.5});
    page.drawLine({start:{x:M,y:H-42},end:{x:W-M,y:H-42},thickness:.55,color:colors.line});
  }
  function ensure(height){if(y-height<BOTTOM)newPage();}
  function paragraph(value,{size=9.6,leading=14.5,color=colors.ink,gap=7}={}){for(const line of wrap(value,size,CW)){check();ensure(leading);text(line,M,y,{size,color});y-=leading;}y-=gap;}
  function section(title,{compact=false}={}){ensure(36);rect(M,y-2,2,11,{fill:colors.accent,border:colors.accent,lineWidth:0});text(title,M+9,y,{size:11.5,color:colors.ink});y-=compact?18:22;}
  function table(columns,rows,{headers=true,size=9.2,leading=14,pad=7,keepRow=180,kind='table'}={}){
    const headerHeight=25;let shown=false;
    function header(){if(!headers){shown=true;return;}ensure(headerHeight+leading+pad*2);rect(M,y,CW,headerHeight,{fill:colors.wash});let x=M;for(const col of columns){text(col.title,x+pad,y-6,{size:9,color:colors.muted,strong:true});x+=col.width;}y-=headerHeight;shown=true;}
    header();
    for(const row of rows){
      const cells=row.cells.map((cell,i)=>wrap(cell,size,columns[i].width-pad*2));let offset=0,total=Math.max(...cells.map(c=>c.length),1);
      while(offset<total){
        check();let available=y-BOTTOM;
        const remaining=(total-offset)*leading+pad*2;
        if(remaining<=keepRow&&remaining>available || available<leading*2+pad*2){newPage();shown=false;}
        if(!shown)header();
        available=y-BOTTOM;const count=Math.min(total-offset,Math.floor((available-pad*2)/leading));
        if(count<1){newPage();shown=false;continue;}
        const height=count*leading+pad*2,top=y;rect(M,top,CW,height,{fill:row.fill||colors.white});let x=M;
        for(let col=0;col<columns.length;col++){
          if(col)page.drawLine({start:{x,y:top},end:{x,y:top-height},thickness:.4,color:colors.line});
          const lines=cells[col].slice(offset,offset+count);
          if(col===0&&offset>0&&row.repeatLabel){lines.splice(0,Math.min(lines.length,2),...wrap(row.repeatLabel+'（续）',size,columns[col].width-pad*2).slice(0,count));}
          for(let n=0;n<lines.length;n++)text(lines[n],x+pad,top-pad-n*leading,{size,color:col===0&&row.tone?(tones[row.tone]||tones.neutral).ink:colors.ink});
          x+=columns[col].width;
        }
        onLayout({kind,page:doc.getPageCount(),context,row:row.id,x:M,top,width:CW,height,lineOffset:offset,lineCount:count,totalLines:total});
        y-=height;offset+=count;
        if(offset<total){newPage();shown=false;}
      }
    }
    y-=10;
  }
  const estimateTable=(rows,columns,size=9.2,leading=14,pad=7)=>25+rows.reduce((h,row)=>h+Math.max(...row.cells.map((s,i)=>wrap(s,size,columns[i].width-pad*2).length))*leading+pad*2,0)+10;
  function metadata(){
    section('案件资料',{compact:single});
    const pair=[`商品名称：${report.fields.productName||'未提供'}`,`商品款式：${report.fields.style||'未提供'}`],lines=pair.map(v=>wrap(v,9.4,CW/2-12)),height=Math.max(...lines.map(v=>v.length))*13.5+10;
    const rows=[];
    if(height<=150){ensure(height);for(let i=0;i<2;i++){rect(M+i*CW/2,y,CW/2,height);for(let n=0;n<lines[i].length;n++)text(lines[i][n],M+i*CW/2+6,y-5-n*13.5,{size:9.4});}y-=height;}
    else rows.push({id:'product',cells:['商品名称',report.fields.productName||'未提供']},{id:'style',cells:['商品款式',report.fields.style||'未提供']});
    rows.push({id:'info',cells:['商品资料',report.fields.productInfo||'未提供']},{id:'claim',cells:['问题描述',report.fields.description||'未提供']});
    table([{width:72},{width:CW-72}],rows.map(row=>({...row,repeatLabel:row.cells[0]})),{headers:false,size:9.4,leading:single?12:13.5,pad:single?4:5,keepRow:100,kind:'metadata'});
  }
  function cards(image){
    const height=cardHeight,gap=10,w=(CW-2*gap)/3;ensure(height+8);
    for(const [i,kind] of Object.keys(refundPdfKinds).entries()){
      const state=image.states[kind],tone=tones[state.tone]||tones.neutral,x=M+i*(w+gap);
      rounded(x,y,w,height,{fill:tone.fill});
      text(state.title,x+10,y-6,{size:8,color:colors.muted});
      const hasSignal=kind==='ai'&&Number.isFinite(state.signal);
      text(state.label,x+10,y-19,{size:hasSignal?9:10.5,color:tone.ink});
      if(kind==='ai'&&Number.isFinite(state.signal)){
        const barWidth=w-20;
        const score=`${(state.signal*100).toFixed(1)}%`;
        text(score,x+w-10-measure(score,11,true),y-17,{size:11,strong:true,color:tone.ink});
        rounded(x+10,y-34,barWidth,3,{fill:colors.line,radius:1.5});
        if(state.signal>0)rounded(x+10,y-34,barWidth*state.signal,3,{fill:tone.ink,radius:1.5});
        page.drawCircle({x:x+10+barWidth*state.signal,y:y-35.5,size:2.7,color:colors.white,borderColor:tone.ink,borderWidth:1.2});
        text('0',x+10,y-41,{size:6.3,color:colors.muted});text('100',x+w-23,y-41,{size:6.3,color:colors.muted});
        if(state.coverage==='partial')centerText('部分覆盖',x+w/2,y-41,{size:6.5,color:colors.muted});
        onLayout({kind:'source-signal-chart',style:'marked-scale',page:pageIndex,context,value:state.signal,x:x+10,top:y-34,width:barWidth,height:3});
      }
      const detail=kind==='tamper'&&state.localizationStatus==='not_triggered'?'本次未执行定位':state.coverage==='partial'?'部分覆盖':state.status==='succeeded'?'已获得分析结果':'尚无完整分析结果';
      if(!hasSignal)text(detail,x+10,y-(single?37:44),{size:8,color:colors.muted});
      onLayout({kind:'result-card',page:doc.getPageCount(),context,capability:kind,x,top:y,width:w,height});
    }
    y-=height+8;
  }
  function analysisCharts(){
    const stats=summarizeRefundAnalysis(report),height=94,leftW=205,gap=12,rightX=M+leftW+gap,rightW=CW-leftW-gap;
    const pending=stats.processing.reduce((n,row)=>n+row.pending,0),failed=stats.processing.reduce((n,row)=>n+row.failed,0);
    ensure(height+22);const top=y;
    rounded(M,top,leftW,height);rounded(rightX,top,rightW,height);
    text('分析状态 · 已返回结果',M+11,top-8,{size:9.3,strong:true});
    const ring={x:M+38,y:top-50,radius:23},totals={returned:stats.returned,pending,failed};
    const palette={returned:colors.accent,pending:colors.line,failed:tones.error.ink};
    let offset=0;
    for(const [key,count] of Object.entries(totals)){
      const fraction=count/stats.resultSlots,steps=Math.ceil(fraction*180);
      if(steps){
        const points=[];
        for(let i=0;i<=steps;i++){const angle=-Math.PI/2+2*Math.PI*(offset+fraction*i/steps);points.push([Math.cos(angle)*(ring.radius+2.5),Math.sin(angle)*(ring.radius+2.5)]);}
        for(let i=steps;i>=0;i--){const angle=-Math.PI/2+2*Math.PI*(offset+fraction*i/steps);points.push([Math.cos(angle)*(ring.radius-2.5),Math.sin(angle)*(ring.radius-2.5)]);}
        page.drawSvgPath(points.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(4)} ${y.toFixed(4)}`).join('')+'Z',{x:ring.x,y:ring.y,color:palette[key],borderWidth:0});
      }
      offset+=fraction;
    }
    centerText(String(stats.returned),ring.x,ring.y+11,{size:17,strong:true,color:colors.accent});
    centerText(`/ ${stats.resultSlots} 项`,ring.x,ring.y-9,{size:7.2,color:colors.muted});
    onLayout({kind:'result-return-ring',page:pageIndex,context,counts:totals,total:stats.resultSlots,unit:'结果项',x:ring.x-ring.radius,top:ring.y+ring.radius,width:ring.radius*2,height:ring.radius*2});
    for(const [i,row] of stats.processing.entries()){
      text({ai:'图片来源',tamper:'局部定位',comparison:'商品核对'}[row.kind],M+77,top-29-i*15,{size:8.3,color:colors.muted});
      text(`${row.returned} / ${stats.total}`,M+157,top-29-i*15,{size:8.8,strong:true});
      onLayout({kind:'processing-status',page:pageIndex,context,row:row.kind,counts:{returned:row.returned,pending:row.pending,failed:row.failed},total:stats.total});
    }
    let lx=M+11;
    for(const [key,label] of [['returned','返回'],['pending','待完成'],['failed','失败/取消']]){
      page.drawCircle({x:lx+2,y:top-84,size:2,color:palette[key]});const value=`${label} ${totals[key]}`;text(value,lx+8,top-80,{size:6.6,color:colors.muted});lx+=measure(value,6.6)+17;
    }
    text('商品核对矩阵 · 图片张数',rightX+11,top-8,{size:9.3,strong:true});
    const labelW=56,cellGap=6,cellW=(rightW-labelW-22-cellGap*2)/3;
    for(const [i,row] of stats.comparisons.entries())centerText(row.dimension,rightX+11+labelW+i*(cellW+cellGap)+cellW/2,top-24,{size:7.7,color:colors.muted});
    for(const [i,[key,label,tone]] of [['match','一致','consistent'],['mismatch','不一致','attention'],['unknown','无法判断','neutral'],['unavailable','无结果','neutral']].entries()){
      const rowTop=top-36-i*13;
      text(label,rightX+11,rowTop-1,{size:7.6,color:colors.muted});
      for(const [j,row] of stats.comparisons.entries()){
        const x=rightX+11+labelW+j*(cellW+cellGap),count=row[key],color=tones[tone];
        rounded(x,rowTop,cellW,11,{fill:count?color.fill:colors.white,radius:2});
        if(count)centerText(String(count),x+cellW/2,rowTop-1,{size:8,strong:true,color:color.ink});
        onLayout({kind:'comparison-matrix-cell',page:pageIndex,context,dimension:row.dimension,outcome:key,count,total:stats.total,x,top:rowTop,width:cellW,height:11});
      }
    }
    y-=height+5;
    paragraph('空白格为 0 张；局部未触发计入已返回，执行范围见逐图结果。',{size:7.3,leading:10,gap:single?3:7,color:colors.muted});
  }
  function imagePanel(embedded,x,top,w,height,label,overlay){
    rounded(x,top,w,height,{fill:colors.wash});text(label,x+10,top-6,{size:8.5,color:colors.muted});
    const availableW=w-10,availableH=height-24,scale=Math.min(availableW/embedded.width,availableH/embedded.height),dw=embedded.width*scale,dh=embedded.height*scale;
    const px=x+(w-dw)/2,py=top-19-(availableH-dh)/2;
    page.drawImage(embedded,{x:px,y:py-dh,width:dw,height:dh});if(overlay)page.drawImage(overlay,{x:px,y:py-dh,width:dw,height:dh});onLayout({kind:'image',page:doc.getPageCount(),context,label,marked:Boolean(overlay),x:px,top:py,width:dw,height:dh});
  }
  const comparisonColumns=[{title:'核对项 / 结论',width:85},{title:'图片观察',width:205},{title:'核对依据',width:CW-290}];
  const comparisonRows=image=>(image.states.comparison.checks||[]).map(checkItem=>({id:checkItem.dimension,cells:[checkItem.dimension+'\n'+checkItem.outcome,checkItem.observed,checkItem.evidence],repeatLabel:checkItem.dimension+' · '+checkItem.outcome,tone:checkItem.outcomeCode==='match'?'consistent':checkItem.outcomeCode==='mismatch'?'attention':'neutral'}));
  function comparison(image){
    const state=image.states.comparison,rows=comparisonRows(image);
    const scope=(state.coverage==='partial'?'部分覆盖 · ':'')+state.scope,inline=measure(scope,8.1)<=CW-150;
    const estimate=22+wrap(state.summary,9.4,CW).length*14+7+(rows.length?estimateTable(rows,comparisonColumns,9.2,comparisonLeading,comparisonPad):0)+(state.scope&&!inline?wrap(scope,8.4,CW).length*12.5+6:0);
    if(estimate<=440&&estimate>y-BOTTOM)newPage();
    section('商品与描述核对');if(state.scope&&inline)text(scope,W-M-measure(scope,8.1),y+19,{size:8.1,color:colors.muted});paragraph(state.summary,{size:9.4,leading:14});
    if(rows.length)table(comparisonColumns,rows,{kind:'comparison-row',leading:comparisonLeading,pad:comparisonPad});
    if(state.scope&&!inline)paragraph(scope,{size:8.4,leading:12.5,color:colors.muted,gap:6});
  }
  newPage('当前材料分析');
  text(report.title,M,y,{size:21});y-=single?28:34;
  const compactMeta=`案件编号：${report.fields.caseNumber||'未提供'}  |  ${formatRefundPdfTime(report.generatedAt)} (UTC+08:00)  |  凭证 ${report.images.length} 张`;
  if(single&&measure(compactMeta,8.5)<=CW)paragraph(compactMeta,{size:8.5,leading:13,color:colors.muted,gap:6});
  else{
    paragraph('案件编号：'+(report.fields.caseNumber||'未提供'),{size:9.5,leading:14,gap:3});
    paragraph('生成时间：'+formatRefundPdfTime(report.generatedAt)+' (UTC+08:00)  |  凭证 '+report.images.length+' 张',{size:8.5,leading:13,color:colors.muted,gap:single?6:12});
  }
  context='本次资料';metadata();
  analysisCharts();
  if(report.images.length>1){
    section('逐图结果概览');
    table([{title:'凭证',width:150},{title:'图片来源',width:120},{title:'局部定位',width:120},{title:'商品核对',width:CW-390}],report.images.map((im,i)=>({id:im.id,cells:[`${String(i+1).padStart(2,'0')} · ${short(im.name,9.2,136)}`,im.states.ai.label,im.states.tamper.label,im.states.comparison.label]})),{kind:'overview'});
  }
  for(const [index,image] of report.images.entries()){
    check();onProgress({phase:'images',completed:index,total:report.images.length});
    const photo=await prepareImage(image,{signal});check();
    if(!photo || !Number.isFinite(photo.width)||!Number.isFinite(photo.height)||photo.width<=0||photo.height<=0)throw new Error('报告图片尺寸无效。');
    if(image.states.tamper.mask&&(!photo.overlay||photo.overlay.type!=='image/png'||photo.overlay.width!==image.states.tamper.mask.width||photo.overlay.height!==image.states.tamper.mask.height))throw new Error('局部标记图片与上传凭证不一致，无法导出。');
    const embed=async p=>p.type==='image/png'?doc.embedPng(p.bytes):doc.embedJpg(p.bytes);
    const original=await embed(photo),overlay=image.states.tamper.mask?await embed(photo.overlay):null;
    if(original.width!==photo.width||original.height!==photo.height||overlay&&(overlay.width!==image.states.tamper.mask.width||overlay.height!==image.states.tamper.mask.height))throw new Error('报告图片与标记尺寸不一致，无法导出。');
    context=`凭证 ${String(index+1).padStart(2,'0')} · ${image.name}`;
    if(report.images.length>1)newPage(context);
    const rows=comparisonRows(image),summaryLines=wrap(image.states.comparison.summary,9.4,CW).length;
    const comparisonScope=(image.states.comparison.coverage==='partial'?'部分覆盖 · ':'')+image.states.comparison.scope;
    const comparisonHeight=22+summaryLines*14+7+(rows.length?estimateTable(rows,comparisonColumns,9.2,comparisonLeading,comparisonPad):0)+(image.states.comparison.scope&&measure(comparisonScope,8.1)>CW-150?wrap(comparisonScope,8.4,CW).length*12.5+6:0);
    const titleLines=wrap(context,12,CW).length;
    let imageHeight=250;
    const legend=overlay?'左右为同一图片；红色填充及加深边缘为候选标记，供人工复核。':'图片按原始比例展示。';
    const notesHeight=['ai','tamper'].reduce((height,kind)=>{const state=image.states[kind];const note=state.status!=='succeeded'?state.title+' · '+state.label+'：'+state.summary:kind==='tamper'&&!state.mask?state.summary:'';return height+(note?wrap(note,9.1,CW).length*13.5+7:0);},0);
    const afterImage=7+wrap(legend,8.3,CW).length*12+8+4+2;
    if(single){const compact=y-BOTTOM-titleLines*16-4-(cardHeight+8)-comparisonHeight-notesHeight-afterImage;if(compact>=170)imageHeight=Math.min(270,compact);}
    onLayout({kind:'evidence-plan',context,y,comparisonHeight,imageHeight});
    ensure(titleLines*(single?16:18)+(single?4:8)+(cardHeight+8)+imageHeight+22);imagePageStarts.push(doc.getPageCount());
    for(const line of wrap(context,12,CW)){text(line,M,y,{size:12,color:colors.accent});y-=single?16:18;}y-=single?4:8;cards(image);
    if(overlay){const panelW=(CW-12)/2;imagePanel(original,M,y,panelW,imageHeight,'上传凭证');imagePanel(original,M+panelW+12,y,panelW,imageHeight,'候选标记',overlay);}
    else imagePanel(original,M,y,CW,imageHeight,'上传凭证');
    y-=imageHeight+7;
    paragraph(legend,{size:8.3,leading:12,color:colors.muted,gap:8});
    for(const kind of ['ai','tamper']){
      const state=image.states[kind];
      if(state.status!=='succeeded')paragraph(state.title+' · '+state.label+'：'+state.summary,{size:9.1,leading:13.5});
      else if(kind==='tamper'&&!state.mask)paragraph(state.summary,{size:9.1,leading:13.5});
    }
    comparison(image);y-=4;
    onProgress({phase:'images',completed:index+1,total:report.images.length});
  }
  const pages=doc.getPages();
  for(let i=0;i<pages.length;i++){
    page=pages[i];pageIndex=i+1;page.drawLine({start:{x:M,y:53},end:{x:W-M,y:53},thickness:.5,color:colors.line});
    text('来源信号并非欺诈概率；标记与核对结果用于辅助复核。',M,44,{size:7.4,color:colors.muted,role:'footer'});
    text(short(report.fields.caseNumber||'当前分析',7.8,CW-125),M,24,{size:7.8,color:colors.muted,role:'footer'});const label=`${i+1} / ${pages.length}`;text(label,W-M-measure(label,8),24,{size:8,color:colors.muted,role:'footer'});
  }
  check();onProgress({phase:'saving',completed:report.images.length,total:report.images.length});
  await new Promise(resolve=>setTimeout(resolve,0));check();
  const bytes=await doc.save();check();onLayout({kind:'document',pages:pages.length,imagePageStarts,pageContexts:pageContext});return bytes;
}
