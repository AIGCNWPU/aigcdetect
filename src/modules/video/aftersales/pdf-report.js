import { validateAftersalesVideoResult } from './detection.js';
import { validateFrameLocalization } from './frame-localization.js';
import { createCurrentRefundPdf } from '../../image/refund/pdf-report.js';

const videoPdfStatuses={idle:'未检测',queued:'排队中',running:'检测中',succeeded:'已完成',failed:'失败',cancelled:'已取消',unavailable:'不可用'};
const videoPdfDimensions={appearance:'商品外观',style:'商品款式',issue:'问题现象'};
const videoPdfOutcomes={match:'一致',mismatch:'不一致',unknown:'无法判断'};
const videoPdfTitles={ai:'视频来源检测',tamper:'关键帧局部检测',comparison:'商品与问题核对'};
const videoPdfCopy=text=>String(text||'').replace(/\b(?:Native-Scale|MIRROR|FLAME|DeepSeek|CO-SPY)\b/gi,'分析服务');
export function formatVideoPdfPosition(seconds){return `${Math.floor(seconds/60)}:${(seconds%60).toFixed(3).padStart(6,'0')}`;}
function videoPdfState(kind,state={status:'idle'}){
  const status=Object.hasOwn(videoPdfStatuses,state.status)?state.status:'idle';
  return {title:videoPdfTitles[kind],status,label:videoPdfStatuses[status],tone:['failed','cancelled'].includes(status)?'error':'neutral',summary:videoPdfCopy(state.error)||(status==='idle'?'尚未检测。':'本项尚未取得有效结果。'),scope:''};
}
export function buildCurrentVideoReport(fields,entries,{generatedAt=new Date().toISOString()}={}){
  if(!Array.isArray(entries)||!entries.length||entries.length>5)throw new Error('请先添加当前需要分析的视频。');
  const input=Object.fromEntries(['caseNumber','productName','style','productInfo','description'].map(key=>[key,String(fields[key]||'').trim()]));
  const seen=new Set();
  const videos=entries.map(entry=>{
    if(!entry.id||seen.has(entry.id)||!entry.file||!Number.isInteger(entry.version)||!Number.isFinite(entry.duration)||entry.duration<=0||!Number.isInteger(entry.width)||!Number.isInteger(entry.height)||Math.min(entry.width,entry.height)<=0)throw new Error('当前视频资料不完整，无法生成报告。');
    seen.add(entry.id);
    const states={ai:videoPdfState('ai',entry.ai),tamper:videoPdfState('tamper'),comparison:videoPdfState('comparison',entry.comparison)};
    let source,localization;const channels=[],frames=[];
    if(entry.ai?.status==='succeeded'){
      try{
        const {frameLocalization,...raw}=entry.ai.result;
        source=validateAftersalesVideoResult(raw,entry,'ai',input);
        const analysis=source.sourceAnalysis,decision=analysis?.policies.complementary;
        states.ai={...states.ai,status:'succeeded',label:analysis?{review:'建议人工复核',not_triggered:'未触发来源复核',incomplete:'来源结果不完整'}[decision]:['high','medium'].includes(source.risk)?'建议人工复核':'来源结果已返回',tone:decision==='review'?'attention':'neutral',summary:videoPdfCopy(source.summary),scope:videoPdfCopy(source.scope),coverage:source.coverage,incomplete:analysis?.complete===false,detail:analysis?.complete===false?'部分完成':'抽样覆盖'};
        if(analysis){
          for(const [id,label] of [['video','视频片段来源'],['keyframes','关键画面来源']])channels.push({id,label,...analysis.channels[id],error:videoPdfCopy(analysis.channels[id].error)});
          if(analysis.detail){const d=analysis.detail,reasons={baseline_triggered:'已有来源线索，无需追加',frame_triggered:'关键画面已触发，无需追加',context_below_guard:'关键画面支持不足',context_unavailable:'所需来源依据不完整',prerequisite_unavailable:'所需来源依据不完整'};channels.push({id:'detail',label:'画面细节复核',status:d.status,score:d.status==='succeeded'?d.score:undefined,threshold:d.status==='succeeded'?d.threshold:undefined,triggered:d.triggered,error:videoPdfCopy(d.error),reason:reasons[d.reason]||'本次未追加细节检查'});}
        }
        if(frameLocalization){
          try{localization=validateFrameLocalization(frameLocalization,entry,analysis);}catch{states.tamper=videoPdfState('tamper',{status:'failed',error:'局部结果与当前视频不一致，未采纳标记。'});}
        }
      }catch{states.ai=videoPdfState('ai',{status:'failed',error:'来源结果与当前视频不一致，未采纳本项结果。'});}
    }
    if(localization){
      const status=localization.status,successful=localization.frames.filter(f=>f.status==='succeeded'),marked=successful.some(f=>f.markedPixels>0);
      const labels={localized:marked?'发现候选区域':'未返回候选区域',partial:'局部结果部分完成',not_triggered:'未触发定位',source_incomplete:'来源依据不足',unavailable:'服务不可用',failed:'定位失败'};
      const messages={localized:'仅检查以下抽样画面，候选区域用于辅助人工复核。',partial:'部分画面未获得有效结果，已保留完成画面的标记。',not_triggered:'来源未触发复核条件，本次未执行关键帧局部定位。',source_incomplete:'来源依据不足，本次未执行关键帧局部定位。',unavailable:'本次未执行局部定位。',failed:'未取得有效局部定位结果。'};
      const notExecuted=['not_triggered','source_incomplete','unavailable'].includes(status);
      states.tamper={title:videoPdfTitles.tamper,status:['localized','partial','not_triggered'].includes(status)?'succeeded':status==='unavailable'?'unavailable':status==='failed'?'failed':'idle',label:labels[status],tone:['failed','partial'].includes(status)?'error':marked?'attention':'neutral',summary:videoPdfCopy(localization.error)||messages[status],scope:notExecuted?'本次未执行局部定位，不能据此排除修改。':'仅覆盖实际采样画面，不能视为整段视频定位或破损原因。',coverage:notExecuted?undefined:'partial',localizationStatus:status,incomplete:status==='partial',detail:notExecuted?'本次未执行定位':status==='failed'?'未取得有效定位':status==='partial'?'部分画面未完成':'抽样覆盖'};
      for(const frame of localization.frames){const {pngSha256,frameIndex,markedPixels,...visible}=frame;frames.push({...visible,hasMark:frame.status==='succeeded'&&markedPixels>0});}
    }else if(states.tamper.status!=='failed')states.tamper.summary='尚无关键帧局部检测结果。';
    if(entry.comparison?.status==='succeeded'){
      try{
        const result=validateAftersalesVideoResult(entry.comparison.result,entry,'comparison',input);
        const checks=Object.keys(videoPdfDimensions).map(dimension=>{
          const c=result.checks.find(check=>check.dimension===dimension),positions=c.segments.map(s=>`${formatVideoPdfPosition(s.start)}${s.point?'':`-${formatVideoPdfPosition(s.end)}`}`).join('、');
          return {dimension:videoPdfDimensions[dimension],outcome:videoPdfOutcomes[c.outcome],outcomeCode:c.outcome,observed:videoPdfCopy(c.observed)+(positions?`\n依据时刻：${positions}`:''),evidence:videoPdfCopy(c.evidence)};
        });
        const outcomes=checks.map(c=>c.outcomeCode);
        states.comparison={...states.comparison,status:'succeeded',label:outcomes.includes('mismatch')?'存在不一致':outcomes.every(o=>o==='unknown')?'无法判断':outcomes.includes('unknown')?'部分无法判断':'资料核对一致',summary:videoPdfCopy(result.summary),scope:videoPdfCopy(result.scope),coverage:result.coverage,checks,tone:outcomes.includes('mismatch')?'attention':outcomes.includes('unknown')?'neutral':'consistent'};
      }catch{states.comparison=videoPdfState('comparison',{status:'failed',error:'核对结果与当前视频或资料不一致，未采纳本项结果。'});}
    }
    const sampleTimes=[...new Set((frames.length?frames:source?.frames||[]).map(f=>f.time))].sort((a,b)=>a-b);
    return {id:entry.id,version:entry.version,name:String(entry.file.name||'当前视频'),file:entry.file,width:entry.width,height:entry.height,duration:entry.duration,size:entry.file.size||0,states,channels,frames,sampleTimes};
  });
  const report={title:'售后视频凭证分析报告',mediaType:'video',generatedAt,fields:input,videos,labels:{source:'视频来源',matrixTitle:'商品核对矩阵 · 视频段数',statisticsNote:'空白格为 0 段；局部未触发仅表示状态已返回，本次未执行定位。',comparison:'商品与问题核对'},footer:'来源信号并非欺诈概率；采样画面、候选标记与核对依据供人工复核。'};
  report.statistics=summarizeVideoAnalysis(report);return report;
}
export function summarizeVideoAnalysis(report){
  const total=report.videos.length,processing=Object.entries(videoPdfTitles).map(([kind,title])=>{
    const states=report.videos.map(v=>v.states[kind]),returned=states.filter(s=>s.status==='succeeded').length,failed=states.filter(s=>['failed','cancelled'].includes(s.status)).length;
    return {kind,title,returned,failed,pending:total-returned-failed,partial:states.filter(s=>s.incomplete).length};
  });
  const comparisons=Object.values(videoPdfDimensions).map(dimension=>{
    const counts={dimension,match:0,mismatch:0,unknown:0,unavailable:0};
    for(const video of report.videos){const s=video.states.comparison,c=s.status==='succeeded'?s.checks.find(c=>c.dimension===dimension):null;counts[c?.outcomeCode||'unavailable']++;}return counts;
  });
  const returned=processing.reduce((sum,p)=>sum+p.returned,0);
  return {total,resultSlots:total*3,returned,outstanding:total*3-returned,processing,comparisons};
}

export async function createCurrentVideoPdf(report,{prepareFrame,preparePreview,onProgress=()=>{},...options}={}){
  return createCurrentRefundPdf(report,{...options,onProgress,renderReport:async painter=>{
    const p=painter,{M,CW,colors,tones,doc}=p;
    p.newPage('当前视频分析');p.text(report.title,M,p.y,{size:21});p.y-=32;
    p.paragraph(`案件编号：${report.fields.caseNumber||'未提供'}  |  生成时间：${p.formatTime(report.generatedAt)} (UTC+08:00)  |  视频 ${report.videos.length} 段`,{size:8.5,leading:13,color:colors.muted,gap:8});
    p.metadata();p.analysisCharts();
    if(report.videos.length>1){p.section('视频结果概览');p.table([{title:'视频',width:150},{title:'来源检测',width:120},{title:'局部检测',width:120},{title:'商品核对',width:CW-390}],report.videos.map(v=>({id:v.id,cells:[v.name,v.states.ai.label,v.states.tamper.label,v.states.comparison.label]})),{kind:'video-overview'});}
    for(const [index,video] of report.videos.entries()){
      p.check();onProgress({phase:'videos',completed:index,total:report.videos.length});
      p.context=`视频 ${String(index+1).padStart(2,'0')} · ${video.name}`;
      if(index>0)p.newPage();
      p.ensure(110);p.markEvidenceStart();
      p.paragraph(p.context,{size:12,leading:17,color:colors.accent,gap:5});
      p.paragraph(`时长 ${video.duration.toFixed(3)} 秒  |  ${video.width} × ${video.height}  |  ${(video.size/1024/1024).toFixed(2)} MiB`,{size:8.5,leading:13,color:colors.muted,gap:7});
      p.cards(video);
      if(!['succeeded','idle'].includes(video.states.comparison.status))p.paragraph(`${video.states.comparison.title} · ${video.states.comparison.label}：${video.states.comparison.summary}`,{size:8.4,leading:12.5,color:colors.muted,gap:7});
      p.ensure(36+Math.max(1,video.channels.length)*45);p.section('独立来源信号');
      if(!video.channels.length)p.paragraph(video.states.ai.summary,{size:9.2,leading:14});
      for(const channel of video.channels){
        p.check();p.ensure(46);const top=p.y;p.text(channel.label,M,top,{size:9.4});
        if(channel.status==='succeeded'){
          const x=M+123,w=CW-205,score=channel.score,threshold=channel.threshold;
          p.rounded(x,top-4,w,5,{fill:colors.line,radius:2});
          if(score>0)p.rounded(x,top-4,w*score,5,{fill:colors.accent,radius:2});
          p.line(x+w*threshold,top,x+w*threshold,top-14,colors.ink,.7);
          p.text(`${(score*100).toFixed(1)}%`,M+CW-62,top+1,{size:11,strong:true,color:colors.accent});
          p.text(`参考门槛 ${(threshold*100).toFixed(1)}% · ${channel.id==='detail'?'补充来源依据':channel.triggered?'达到本路参考门槛':'未达到本路参考门槛'}`,x,top-18,{size:7.8,color:colors.muted});
          p.onLayout({kind:'video-source-channel',channel:channel.id,score,threshold,page:p.pageIndex});
        }else{
          p.text(channel.status==='skipped'?'未执行':'未取得结果',M+123,top,{size:9.1,color:channel.status==='failed'?tones.error.ink:colors.muted});
          p.y=top-18;
          p.paragraph(channel.error||channel.reason||'本路暂无有效分数。',{size:8.3,leading:12,color:colors.muted,gap:2});
        }
        p.y=Math.min(p.y,top-42);
      }
      p.paragraph('各路分数独立展示，参考门槛含义不同；综合复核提示见摘要，不计算合成造假概率。',{size:8,leading:12,color:colors.muted,gap:8});
      if(video.sampleTimes.length){
        p.ensure(78);p.section('实际采样时间');const top=p.y;p.line(M,top-7,M+CW,top-7,colors.line,2);
        for(const time of video.sampleTimes)p.circle(M+CW*time/video.duration,top-7,2.4,colors.accent);
        p.text('0 秒',M,top-16,{size:7.5,color:colors.muted});p.text(`${video.duration.toFixed(3)} 秒`,M+CW-58,top-16,{size:7.5,color:colors.muted});p.y-=34;
        p.paragraph(video.sampleTimes.map(formatVideoPdfPosition).join('、'),{size:8.1,leading:12,color:colors.muted,gap:4});
        p.paragraph('采样点不代表连续覆盖整段视频。',{size:8,leading:12,color:colors.muted,gap:7});
      }
      p.paragraph(video.states.ai.scope||'尚无有效来源分析；以下画面不代表已经完成检测。',{size:8.3,leading:12,color:colors.muted,gap:7});
      const evidence=video.frames;
      const detailedComparison=video.states.comparison.status==='succeeded',portrait=evidence.some(f=>f.status==='succeeded'&&f.height>f.width*1.2);
      const comparisonSpace=detailedComparison?p.comparisonHeight(video):0;
      const portraitCap=detailedComparison?Math.max(130,Math.min(210,Math.floor((p.TOP-p.BOTTOM-40-Math.min(320,comparisonSpace))/2-26))):Math.min(154,Math.floor((p.TOP-p.BOTTOM-62)/Math.min(4,Math.ceil(evidence.length/2)||1)-26));
      if(evidence.length){
        p.ensure(200);p.section('关键帧原画面与候选标记');
        p.paragraph(video.states.tamper.summary+' 仅展示实际返回的候选标记，不代表已确认的篡改或破损原因。',{size:8.5,leading:12.5,gap:6,color:colors.muted});
        for(let offset=0;offset<evidence.length;offset+=2){
          const row=evidence.slice(offset,offset+2),prepared=[];
          for(const frame of row){p.check();onProgress({phase:'frames',video:index+1,completed:offset+prepared.length,total:evidence.length});
            if(frame.status==='failed'){prepared.push(null);continue;}
            const photo=await prepareFrame(frame,{signal:options.signal});p.check();
            const original=photo?.type==='image/png'?await doc.embedPng(photo.bytes):photo?.type==='image/jpeg'?await doc.embedJpg(photo.bytes):null;
            if(!original||original.width!==photo.width||original.height!==photo.height||frame.hasMark&&(!photo.overlay||photo.overlay.type!=='image/png'||photo.overlay.width!==frame.mask.width||photo.overlay.height!==frame.mask.height))throw new Error('关键帧或候选标记无法正确导出，请重试。');
            const overlay=frame.hasMark?await doc.embedPng(photo.overlay.bytes):null;
            if(overlay&&(overlay.width!==frame.mask.width||overlay.height!==frame.mask.height))throw new Error('关键帧掩码尺寸不一致，无法导出。');
            prepared.push({original,overlay});
          }
          const gap=14,pairW=(CW-gap)/2,panelGap=5,panelW=(pairW-panelGap)/2;
          const height=Math.min(portrait?portraitCap:154,Math.max(92,...row.map(f=>f.status==='succeeded'?24+(panelW-10)*f.height/f.width:92))),rowHeight=height+26;
          if(p.y-rowHeight<p.BOTTOM||portrait&&detailedComparison&&offset>0&&offset%4===0){p.newPage();p.section('关键帧原画面与候选标记（续）');}
          for(const [i,frame] of row.entries()){
            const x=M+i*(pairW+gap),top=p.y;p.text(`原视频 ${formatVideoPdfPosition(frame.time)}`,x,top,{size:8.5,color:colors.accent});
            const image=prepared[i];
            if(image){p.imagePanel(image.original,x,top-15,panelW,height,'原画面',null,frame);p.imagePanel(image.original,x+panelW+panelGap,top-15,panelW,height,frame.hasMark?'候选标记':'未返回候选区域',image.overlay,frame);}
            else{p.rect(x,top-15,pairW,height,{fill:tones.error.fill});p.text('本画面定位失败',x+8,top-24,{size:9,color:tones.error.ink});p.text('未获得有效掩码，可重试检测。',x+8,top-41,{size:8,color:colors.muted});}
            p.onLayout({kind:'video-frame-pair',videoId:video.id,time:frame.time,status:frame.status,page:p.pageIndex,x,top,width:pairW,height:rowHeight,marked:Boolean(image?.overlay)});
          }
          p.y-=rowHeight;
        }
      }else{
        p.paragraph(video.states.tamper.summary,{size:9.2,leading:14});
        const preview=await preparePreview(video,{signal:options.signal});p.check();
        const picture=await doc.embedJpg(preview.bytes);p.ensure(174);p.imagePanel(picture,M,p.y,CW,150,`原视频预览 · 约 ${formatVideoPdfPosition(preview.time)}（非检测依据）`,null,video);p.y-=159;
        p.paragraph('此图为导出时从当前视频截取的代表画面，不是新增检测结果。',{size:8,leading:12,color:colors.muted,gap:7});
      }
      if(detailedComparison)p.comparison(video);onProgress({phase:'videos',completed:index+1,total:report.videos.length});
    }
  }});
}
