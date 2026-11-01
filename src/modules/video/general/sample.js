import { normalizeDetectionResult } from './model.js';

// 明确标注的界面样例：画面为程序生成的抽象示意，结论为虚构数据，不代表真实检测。
const PALETTES = {
  dusk: { top: '#f1a66b', bottom: '#554a7d', glow: '#ffe2b0', dark: '#1b223e', light: '#ffd7a1' },
  ocean: { top: '#6db9cf', bottom: '#12485f', glow: '#dff8ff', dark: '#092b3b', light: '#bdeaf2' },
  forest: { top: '#9bc6a4', bottom: '#1b4839', glow: '#e9ffe9', dark: '#0d2a21', light: '#c9e8c7' },
  studio: { top: '#e8dbc9', bottom: '#a0876d', glow: '#fff5e1', dark: '#4d3b2c', light: '#fff2dd' },
  neon: { top: '#413a7c', bottom: '#0b1326', glow: '#a6d9ff', dark: '#060a14', light: '#ff8ac4' },
  night: { top: '#2e3d72', bottom: '#0a1020', glow: '#ffd37d', dark: '#040914', light: '#ffe6a8' },
  interior: { top: '#7f9c9b', bottom: '#2a4044', glow: '#e9f4ef', dark: '#172628', light: '#d4e6df' },
  mist: { top: '#bcc9cc', bottom: '#4a5d64', glow: '#ffffff', dark: '#24353a', light: '#e6eef0' },
};

function sceneArt(scene, palette) {
  const { dark, light, glow } = palette;
  if (scene === 'skyline') {
    return `<circle cx="505" cy="102" r="57" fill="url(#glow)"/>
      <g fill="${dark}" opacity=".78">
        <path d="M0 274h70v-80h52v80h48v-124h64v124h45v-68h62v68h55v-100h60v100h50v-56h70v56h64v86H0Z"/>
      </g>
      <g fill="${light}" opacity=".38">
        <rect x="89" y="211" width="6" height="9"/><rect x="106" y="232" width="6" height="9"/><rect x="141" y="225" width="6" height="9"/>
        <rect x="241" y="184" width="6" height="9"/><rect x="263" y="205" width="6" height="9"/><rect x="241" y="227" width="6" height="9"/>
        <rect x="410" y="197" width="6" height="9"/><rect x="433" y="219" width="6" height="9"/><rect x="486" y="241" width="6" height="9"/>
      </g>
      <path d="M0 300h640v60H0z" fill="${dark}" opacity=".5"/>`;
  }
  if (scene === 'water') {
    return `<circle cx="462" cy="88" r="46" fill="url(#glow)"/>
      <path d="M430 146h64l34 118H396Z" fill="${glow}" opacity=".14"/>
      <g fill="none" stroke="${light}" opacity=".4">
        <path d="M0 208c70-18 140 18 220 0s150-22 230 0 130 20 190 2" stroke-width="2"/>
        <path d="M0 236c78-16 150 16 226 0s154-20 232 0 120 18 182 2" stroke-width="1.5"/>
        <path d="M0 266c66-14 138 14 214 0s160-18 238 0 128 16 188 2" stroke-width="2"/>
        <path d="M0 296c74-12 146 12 222 0s156-14 234 0 124 12 184 2" stroke-width="1.4"/>
      </g>
      <path d="M0 310c110-20 210 14 320 0s210-16 320 0v50H0Z" fill="${dark}" opacity=".42"/>`;
  }
  if (scene === 'forest') {
    return `<g fill="${dark}" opacity=".82">
        <path d="M40 360 132 158 224 360Z"/><path d="M168 360 276 108 384 360Z"/>
        <path d="M342 360 430 176 518 360Z"/><path d="M466 360 566 132 666 360Z"/>
      </g>
      <g fill="${light}" opacity=".16"><rect x="0" y="232" width="640" height="18"/><rect x="0" y="284" width="640" height="12"/></g>`;
  }
  if (scene === 'studio') {
    return `<ellipse cx="320" cy="302" rx="172" ry="25" fill="${dark}" opacity=".3"/>
      <rect x="248" y="144" width="144" height="164" rx="26" fill="${light}" opacity=".9"/>
      <circle cx="320" cy="130" r="32" fill="${light}"/>
      <rect x="274" y="194" width="34" height="86" rx="17" fill="#ffffff" opacity=".28"/>
      <rect x="334" y="194" width="12" height="86" rx="6" fill="${dark}" opacity=".12"/>
      <rect x="116" y="82" width="90" height="120" rx="12" fill="${glow}" opacity=".1"/>`;
  }
  if (scene === 'neon') {
    return `<g fill="none" stroke="${light}" opacity=".5" stroke-width="2">
        <path d="M78 360 218 0"/><path d="M196 360 328 0"/><path d="M326 360 458 0"/><path d="M458 360 598 0"/>
      </g>
      <g fill="${glow}" opacity=".16"><circle cx="118" cy="158" r="104"/><circle cx="522" cy="108" r="132"/></g>
      <rect x="0" y="284" width="640" height="76" fill="${dark}" opacity=".56"/>`;
  }
  if (scene === 'portrait') {
    return `<g fill="${glow}" opacity=".16"><circle cx="146" cy="108" r="72"/><circle cx="502" cy="150" r="96"/><circle cx="390" cy="58" r="44"/></g>
      <circle cx="320" cy="158" r="61" fill="${dark}" opacity=".72"/>
      <path d="M209 360c0-88 48-136 111-136s111 48 111 136Z" fill="${dark}" opacity=".64"/>
      <path d="M258 122c20-28 102-28 124 0-16-48-108-48-124 0Z" fill="${light}" opacity=".2"/>`;
  }
  if (scene === 'interior') {
    return `<rect x="70" y="54" width="232" height="212" rx="10" fill="${glow}" opacity=".16"/>
      <path d="M302 54 542 160v146L302 264Z" fill="${light}" opacity=".11"/>
      <path d="M302 54 542 160M302 264 542 306" stroke="${light}" opacity=".28"/>
      <rect x="70" y="54" width="232" height="212" rx="10" fill="none" stroke="${light}" opacity=".34"/>
      <rect x="0" y="302" width="640" height="58" fill="${dark}" opacity=".4"/>`;
  }
  if (scene === 'night') {
    return `<g fill="${dark}" opacity=".82">
        <path d="M0 264h60v-112h50v112h46v-152h70v152h50v-92h60v92h46v-132h66v132h50v-72h66v72h80v96H0Z"/>
      </g>
      <g fill="${glow}" opacity=".9"><circle cx="118" cy="246" r="4"/><circle cx="221" cy="226" r="3"/><circle cx="300" cy="256" r="4"/><circle cx="410" cy="234" r="3"/><circle cx="520" cy="252" r="4"/></g>
      <path d="M0 292h640" stroke="${light}" opacity=".24"/>`;
  }
  return `<g stroke="${light}" opacity=".22"><path d="M0 88h640M0 178h640M0 268h640M78 0v360M218 0v360M358 0v360M498 0v360M598 0v360"/></g>
    <circle cx="320" cy="180" r="98" fill="${glow}" opacity=".14"/>`;
}

function frameArt(scene, paletteName, timecode) {
  const palette = PALETTES[paletteName] || PALETTES.mist;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${palette.top}"/><stop offset="1" stop-color="${palette.bottom}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="${palette.glow}" stop-opacity=".9"/><stop offset="1" stop-color="${palette.glow}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="vignette" cx="50%" cy="46%" r="72%">
        <stop offset="58%" stop-color="#000000" stop-opacity="0"/><stop offset="100%" stop-color="#000000" stop-opacity=".34"/>
      </radialGradient>
      <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
    </defs>
    <rect width="640" height="360" fill="url(#bg)"/>
    ${sceneArt(scene, palette)}
    <rect width="640" height="360" filter="url(#grain)" opacity=".05"/>
    <rect width="640" height="360" fill="url(#vignette)"/>
    <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">
      <rect x="22" y="312" width="104" height="28" rx="6" fill="#071215" opacity=".48"/>
      <text x="34" y="332" fill="#ffffff" opacity=".88" font-size="13" letter-spacing="1">${timecode}</text>
    </g>
    <g font-family="'PingFang SC','Microsoft YaHei',sans-serif">
      <rect x="504" y="20" width="114" height="26" rx="6" fill="#071215" opacity=".4"/>
      <text x="561" y="38" fill="#ffffff" opacity=".82" font-size="11" text-anchor="middle" letter-spacing="2">样例画面</text>
    </g>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function stamp(seconds) {
  const totalTenths = Math.round(seconds * 10);
  const whole = Math.floor(totalTenths / 10);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}.${totalTenths % 10}`;
}

function frame(id, time, risk, caption, scene, palette) {
  return { id, time, risk, caption, image: frameArt(scene, palette, stamp(time)) };
}

const sampleFrames = [
  frame('frame-a-01', 5.0, 'low', '开场城市远景，天际线与建筑细节连续。', 'skyline', 'dusk'),
  frame('frame-a-02', 14.6, 'high', '人物与背景交界处出现重复纹理，边缘细节不连续。', 'portrait', 'night'),
  frame('frame-a-03', 24.0, 'low', '产品近景转场，高光与阴影方向一致。', 'studio', 'studio'),
  frame('frame-a-04', 34.0, 'medium', '水面反射呈规则条纹，光照方向与场景不一致。', 'water', 'ocean'),
  frame('frame-a-05', 46.5, 'low', '室内中景，噪点分布和运动模糊自然。', 'interior', 'interior'),
  frame('frame-a-06', 71.0, 'medium', '建筑边缘出现轻微扭曲，局部纹理分辨率偏低。', 'neon', 'neon'),
  frame('frame-a-07', 84.0, 'low', '夜景灯光与阴影方向一致，没有重复纹理。', 'night', 'night'),
  frame('frame-a-08', 93.0, 'low', '片尾字幕区域纹理稳定，未发现生成线索。', 'skyline', 'mist'),
];

const travelFrames = [
  frame('frame-b-01', 4.2, 'low', '海岸远景，波纹与光照连续。', 'water', 'ocean'),
  frame('frame-b-02', 12.8, 'low', '林间行走镜头，树叶细节自然。', 'forest', 'forest'),
  frame('frame-b-03', 21.4, 'low', '桌面静物，材质纹理一致。', 'studio', 'studio'),
  frame('frame-b-04', 30.6, 'low', '室内转场，噪点分布均匀。', 'interior', 'interior'),
  frame('frame-b-05', 39.2, 'low', '收尾远景，建筑线条稳定。', 'skyline', 'dusk'),
];

const brandFilm = {
  risk: 'high',
  summary: '在 3 个时间段发现 AI 生成线索，其中 00:12.4–00:18.2 的人物与背景衔接处存在明显纹理重复和边缘不一致，建议优先复核该片段。',
  coverage: 'full',
  scope: '全片 96 秒，按 2 秒间隔采样，实际分析 48 帧，并抽取 8 张代表画面。',
  duration: 96,
  sampledFrames: 48,
  findings: [
    '人物发丝与背景交界处出现周期性纹理重复。',
    '水面高光呈规则条带，与场景光源方向不一致。',
    '建筑边缘局部细节分辨率异常降低。',
  ],
  segments: [
    { id: 'segment-a-01', start: 12.4, end: 18.2, risk: 'high', summary: '人物面部与背景过渡区域出现周期性纹理重复，发丝边缘细节不连续。', frameId: 'frame-a-02' },
    { id: 'segment-a-02', start: 31.2, end: 37.6, risk: 'medium', summary: '水面反射呈规则重复条纹，光源方向与场景阴影不完全一致。', frameId: 'frame-a-04' },
    { id: 'segment-a-03', start: 68.0, end: 75.4, risk: 'medium', summary: '建筑边缘出现轻微扭曲，局部纹理分辨率低于同画面其他区域。', frameId: 'frame-a-06' },
  ],
  frames: sampleFrames,
};

const travelVlog = {
  risk: 'low',
  summary: '已检测的 15 个采样画面未发现明显 AI 生成线索，画面纹理、光影方向和边缘细节整体一致。',
  coverage: 'full',
  scope: '全片 42.5 秒，按 3 秒间隔采样，实际分析 15 帧，并抽取 5 张代表画面。',
  duration: 42.5,
  sampledFrames: 15,
  findings: ['采样画面的噪点分布一致。', '未见周期性纹理或边缘断裂。'],
  segments: [],
  frames: travelFrames,
};

export function createVideoGeneralSamples() {
  return [
    {
      id: 'sample-brand-film',
      sample: true,
      name: '品牌短片_最终版.mp4',
      createdAt: '2026-10-20 18:20',
      completedAt: '2026-10-20 18:22',
      status: 'succeeded',
      meta: { size: 87 * 1024 * 1024, duration: 96, width: 1920, height: 1080, type: 'video/mp4' },
      media: null,
      result: normalizeDetectionResult(brandFilm),
      progress: null,
      error: null,
      controller: null,
      savedAt: null,
    },
    {
      id: 'sample-travel-vlog',
      sample: true,
      name: '旅行vlog_片段03.mp4',
      createdAt: '2026-10-19 09:46',
      completedAt: '2026-10-19 09:47',
      status: 'succeeded',
      meta: { size: 23 * 1024 * 1024, duration: 42.5, width: 1280, height: 720, type: 'video/mp4' },
      media: null,
      result: normalizeDetectionResult(travelVlog),
      progress: null,
      error: null,
      controller: null,
      savedAt: null,
    },
  ];
}
