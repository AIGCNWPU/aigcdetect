// 3.2 样例人物画面：程序生成的抽象肖像与面部网格，仅用于界面演示，不对应真实人物。
const FACES = {
  a: {
    skin: '#d8a583', shade: '#b77e60', hair: '#2c2830', shirt: '#2e555d',
    bgTop: '#dfeceb', bgBottom: '#93b2b0', accent: '#2c8b87', style: 'short',
  },
  b: {
    skin: '#e4bd9f', shade: '#c59475', hair: '#4b3628', shirt: '#625273',
    bgTop: '#e9e3ef', bgBottom: '#a99cbb', accent: '#8060cd', style: 'long',
  },
  c: {
    skin: '#c78f6d', shade: '#a56f52', hair: '#20262f', shirt: '#4f5f4b',
    bgTop: '#e3eadf', bgBottom: '#9bae97', accent: '#5d8a63', style: 'bun',
  },
  d: {
    skin: '#e2b08f', shade: '#bf8a6b', hair: '#66472f', shirt: '#485a70',
    bgTop: '#e1e8f1', bgBottom: '#98a9bd', accent: '#5a7fa3', style: 'short',
  },
  e: {
    skin: '#d3a083', shade: '#b27d63', hair: '#2d2429', shirt: '#715246',
    bgTop: '#ede3dc', bgBottom: '#b59f93', accent: '#a06b55', style: 'long',
  },
};

const MESH_LINES = [
  'M244 128 286 118 320 126 356 116 396 130',
  'M232 168 280 158 320 166 362 156 408 170',
  'M236 210 282 200 320 208 360 198 404 212',
  'M248 252 284 244 320 252 358 242 392 254',
  'M270 100 276 146 266 190 278 236 270 282',
  'M300 92 304 142 296 192 308 240 300 292',
  'M340 92 336 142 346 192 334 240 342 292',
  'M374 100 366 146 378 190 364 236 374 282',
];

function hairBack(style, color) {
  if (style === 'long') {
    return `<path d="M230 192c-8-88 32-142 90-142s98 54 90 142c-2 42-10 74-23 100h-34c13-44 15-86 9-120-18 8-38 12-42 12s-24-4-42-12c-6 34-4 76 9 120h-34c-13-26-21-58-23-100Z" fill="${color}"/>`;
  }
  if (style === 'bun') {
    return `<circle cx="320" cy="52" r="23" fill="${color}"/>`;
  }
  return '';
}

function hairFront(style, color) {
  if (style === 'long') {
    return `<path d="M234 172c14-58 46-90 86-90s72 32 86 90c-26-26-56-38-86-38s-60 12-86 38Z" fill="${color}"/>
      <path d="M238 156c20-48 50-66 82-66s62 18 82 66c-26-18-54-26-82-26s-56 8-82 26Z" fill="${color}" opacity=".92"/>`;
  }
  if (style === 'bun') {
    return `<path d="M236 178c-2-62 34-104 84-104s86 42 84 104c-10-30-26-46-44-54-22 10-56 14-80 6-20 8-34 26-44 48Z" fill="${color}"/>
      <path d="M248 118c20-24 46-34 72-34 30 0 56 12 76 38-30-14-60-18-78-14-24 4-48 6-70 10Z" fill="${color}" opacity=".86"/>`;
  }
  return `<path d="M234 178c-6-68 32-110 86-110s92 42 86 110c-10-32-24-50-42-60-24 14-70 18-96 8-18 10-30 28-34 52Z" fill="${color}"/>
    <path d="M246 118c22-26 48-38 74-38 30 0 58 14 78 42-32-16-64-20-82-14-24 6-48 6-70 10Z" fill="${color}" opacity=".86"/>`;
}

function callouts(artifact, accent) {
  if (artifact === 'high') {
    return `<g stroke="${accent}" fill="${accent}" opacity=".82">
      <path d="M412 186h34" stroke-width="1.1"/>
      <text x="452" y="190" font-family="'PingFang SC','Microsoft YaHei',sans-serif" font-size="10" letter-spacing=".5">边缘重复</text>
      <path d="M412 212h24" stroke-width="1.1"/>
      <text x="442" y="216" font-family="'PingFang SC','Microsoft YaHei',sans-serif" font-size="10" letter-spacing=".5">轮廓漂移</text>
    </g>`;
  }
  if (artifact === 'medium') {
    return `<g stroke="${accent}" fill="${accent}" opacity=".78">
      <path d="M412 204h30" stroke-width="1.1"/>
      <text x="448" y="208" font-family="'PingFang SC','Microsoft YaHei',sans-serif" font-size="10" letter-spacing=".5">局部细节异常</text>
    </g>`;
  }
  return '';
}

export function faceArt(key, artifact) {
  const face = FACES[key] || FACES.a;
  const ghost = artifact === 'high'
    ? `<ellipse cx="326" cy="182" rx="86" ry="108" fill="none" stroke="${face.accent}" stroke-width="2" stroke-dasharray="8 7" opacity=".55"/>
      <path d="M252 262c16 24 40 38 68 38 26 0 50-12 68-34" fill="none" stroke="${face.accent}" stroke-width="1.8" opacity=".38"/>
      <path d="M226 92V70h26M414 92V70h-26" stroke="${face.accent}" stroke-width="2.4" opacity=".72"/>
      <path d="M226 288v22h26M414 288v22h-26" stroke="${face.accent}" stroke-width="2.4" opacity=".72"/>`
    : artifact === 'medium'
      ? `<ellipse cx="324" cy="182" rx="84" ry="106" fill="none" stroke="${face.accent}" stroke-width="1.6" stroke-dasharray="6 8" opacity=".42"/>`
      : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${face.bgTop}"/><stop offset="1" stop-color="${face.bgBottom}"/>
      </linearGradient>
      <radialGradient id="halo" cx="50%" cy="42%" r="54%">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".34"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="vignette" cx="50%" cy="44%" r="70%">
        <stop offset="56%" stop-color="#000000" stop-opacity="0"/><stop offset="100%" stop-color="#000000" stop-opacity=".26"/>
      </radialGradient>
      <radialGradient id="skinLight" cx="38%" cy="30%" r="64%">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".24"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#071215" stop-opacity="0"/><stop offset="1" stop-color="#071215" stop-opacity=".24"/>
      </linearGradient>
      <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
    </defs>
    <rect width="640" height="360" fill="url(#bg)"/>
    <circle cx="320" cy="148" r="228" fill="url(#halo)"/>
    <g opacity=".14" stroke="#ffffff" stroke-width="1">
      <path d="M0 72h640M0 144h640M0 216h640M0 288h640M80 0v360M160 0v360M240 0v360M320 0v360M400 0v360M480 0v360M560 0v360"/>
    </g>
    <g opacity=".2" fill="#ffffff">
      <circle cx="82" cy="64" r="34"/><circle cx="566" cy="284" r="46"/><circle cx="510" cy="56" r="18"/>
    </g>
    <rect y="264" width="640" height="96" fill="url(#fade)"/>
    <path d="M118 360c10-62 74-96 202-96s192 34 202 96Z" fill="${face.shirt}"/>
    <path d="M292 300c10 10 46 10 56 0l8 20c-18 12-54 12-72 0Z" fill="#ffffff" opacity=".07"/>
    <path d="M292 258c2 28 12 44 28 44s26-16 28-44Z" fill="${face.shade}" opacity=".92"/>
    <ellipse cx="238" cy="190" rx="14" ry="24" fill="${face.skin}"/>
    <ellipse cx="402" cy="190" rx="14" ry="24" fill="${face.skin}"/>
    <path d="M238 190c5 2 7 9 6 16M402 190c-5 2-7 9-6 16" fill="none" stroke="${face.shade}" stroke-width="1.6" opacity=".45"/>
    <ellipse cx="320" cy="182" rx="82" ry="104" fill="${face.skin}"/>
    <ellipse cx="320" cy="182" rx="82" ry="104" fill="url(#skinLight)"/>
    <ellipse cx="266" cy="218" rx="25" ry="15" fill="${face.shade}" opacity=".1"/>
    <ellipse cx="374" cy="218" rx="25" ry="15" fill="${face.shade}" opacity=".1"/>
    ${hairBack(face.style, face.hair)}
    ${hairFront(face.style, face.hair)}
    <path d="M256 162c10-6 22-6 31-1M353 161c9-5 21-5 31 1" stroke="${face.hair}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".72"/>
    <path d="M258 178c8-4 20-4 28 0-8 5-20 5-28 0Z" fill="#f8f1ec" opacity=".86"/>
    <path d="M354 178c8-4 20-4 28 0-8 5-20 5-28 0Z" fill="#f8f1ec" opacity=".86"/>
    <circle cx="272" cy="179" r="3.6" fill="#332a26"/>
    <circle cx="368" cy="179" r="3.6" fill="#332a26"/>
    <circle cx="273.2" cy="177.6" r="1.1" fill="#ffffff" opacity=".78"/>
    <circle cx="369.2" cy="177.6" r="1.1" fill="#ffffff" opacity=".78"/>
    <path d="M258 178c8-5 20-5 28 0M354 178c8-5 20-5 28 0" stroke="${face.hair}" stroke-width="1.5" fill="none" opacity=".6"/>
    <path d="M320 182c-2 18-6 28 2 31 4 1 7 0 10-2" fill="none" stroke="${face.shade}" stroke-width="2.2" stroke-linecap="round" opacity=".6"/>
    <path d="M300 244c12 6 28 6 40 0" fill="none" stroke="#985a54" stroke-width="3" stroke-linecap="round" opacity=".78"/>
    <path d="M302 245c10 4 26 4 36 0" fill="none" stroke="#ca8a82" stroke-width="1.4" stroke-linecap="round" opacity=".55"/>
    ${MESH_LINES.map(line => `<path d="${line}" fill="none" stroke="${face.accent}" stroke-width=".9" opacity="${artifact === 'high' ? '.26' : '.16'}"/>`).join('')}
    <g fill="none" stroke="${face.accent}" opacity=".38">
      <rect x="226" y="70" width="188" height="242" rx="26" stroke-width="1" stroke-dasharray="3 7"/>
      <path d="M226 102V70h32M414 102V70h-32M226 280v32h32M414 280v32h-32" stroke-width="2.2" opacity=".8"/>
    </g>
    ${ghost}
    ${callouts(artifact, face.accent)}
    <g font-family="'PingFang SC','Microsoft YaHei',sans-serif">
      <rect x="276" y="324" width="88" height="24" rx="5" fill="#071215" opacity=".34"/>
      <text x="320" y="340" fill="#ffffff" opacity=".8" font-size="9.5" text-anchor="middle" letter-spacing="2">样例人脸</text>
    </g>
    <rect width="640" height="360" filter="url(#grain)" opacity=".045"/>
    <rect width="640" height="360" fill="url(#vignette)"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
