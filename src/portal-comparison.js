import { modules, scenarios } from './catalog.js';
import { icon } from './icons.js';

const products = [
  { name: 'VERITAS 智鉴', own: true },
  { name: '腾讯朱雀', href: 'https://matrix.tencent.com/ai-detect/' },
  { name: '中科睿鉴', href: 'https://agent.ruijianai.com/' },
  { name: '知网 AIGC', href: 'https://co2.cnki.net/User/AIGCAgreement.html' },
  { name: '万方文察', href: 'https://wencha.wanfangdata.com.cn/' },
];

// Platform descriptions reflect public entry points as reviewed on 2026-11-18.
const rows = [
  ['产品定位', 'AI 内容核验与业务审校', '通用 AI 生成内容识别', '多模态鉴伪与行业安全', '学术论文 AIGC 检测', '科研诚信与论文质量检查'],
  ['内容模态', '文本、图片、视频、音频', '文本、图片、视频', '文本、图片、视频、音频', '学术文本', '学术文本、科研图像'],
  ['典型场景', '论文、新闻、网文、媒体及交易材料', '学术、创作与媒体素材', '公共安全、媒体、教育与金融', '毕业论文与学术写作', '高校、期刊与科研机构'],
  ['场景组织', `${scenarios.length} 个场景，包括售后凭证、证件票据、专业审校`, '按文本、图像和视频组织检测入口', '按鉴伪任务与行业组织产品', '围绕论文送检和自检', '论文多要素综合察验与单项检测'],
  ['结果与复核', '原句、局部区域或时间段定位，支持场景化报告', '文本分段标签和占比、图像检测置信度', '风险线索、鉴伪报告与溯源分析', 'AIGC 值与论文检测结果', '多要素报告与图像风险线索'],
  ['使用方式', '统一 Web 工作台、API 接入申请', '网页体验、文本与图像 API', '网页体验、企业合作接入', '机构送检、个人自检', '在线单篇或批量送检、接口服务'],
  ['适合的任务', '在一套工作台完成检测、证据复核和报告', '判断通用素材是否由 AI 生成', '专业鉴伪与行业安全方案', '学术文本 AI 生成风险评估', '论文诚信与科研图像综合察验'],
];

export function renderPlatformComparison() {
  return `<section class="portal-comparison" id="portal-comparison" tabindex="-1" aria-labelledby="portal-comparison-title">
    <div class="portal-wrap">
      <header class="portal-section-heading" data-reveal>
        <div><h2 id="portal-comparison-title">平台能力对比</h2><p>同一套工作台，覆盖内容检测、业务核验与证据复核。</p></div>
        <a href="#/" class="portal-text-link">体验智鉴工作台 ${icon('arrow')}</a>
      </header>
      <div class="portal-market-panel" data-reveal>
        <div class="portal-market-top"><strong>VERITAS 智鉴</strong><span>${modules.length} 类内容 <i></i> ${scenarios.length} 个业务场景</span></div>
        <div class="portal-market-scroll" tabindex="0" role="region" aria-label="平台能力对比表">
          <table aria-label="平台能力对比表">
            <thead><tr><th scope="col">对比维度</th>${products.map(product => `<th scope="col" ${product.own ? 'class="portal-market-ours"' : ''}>${product.href ? `<a href="${product.href}" target="_blank" rel="noopener">${product.name} ${icon('arrow')}</a>` : product.name}</th>`).join('')}</tr></thead>
            <tbody>${rows.map(([label, ...cells]) => `<tr><th scope="row">${label}</th>${cells.map((cell, index) => `<td ${index === 0 ? 'class="portal-market-ours"' : ''}>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
        <p class="portal-market-note"><span>可横向滑动查看全部平台。</span> 对比整理自各平台公开页面，表头可打开原始资料。核对日期 2026-11-18。</p>
      </div>
    </div>
  </section>`;
}
