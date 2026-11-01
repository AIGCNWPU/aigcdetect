export const NOVEL_PLATFORMS = Object.freeze([
  Object.freeze({
    id: 'ciweimao',
    name: '刺猬猫',
    hosts: Object.freeze(['ciweimao.com']),
    policy: Object.freeze({
      title: '作者注册投稿协议',
      url: 'https://author.ciweimao.com/inset_view/signup_protocol',
      summary: '官方协议要求作品为署名作者本人创作，并禁止剽窃、抄袭。',
      aiSpecific: false,
      verifiedOn: '2026-10-30',
    }),
  }),
  Object.freeze({
    id: 'faloo',
    name: '飞卢小说网',
    hosts: Object.freeze(['faloo.com']),
    policy: Object.freeze({
      title: 'VIP作者计划与签约要求',
      url: 'https://yanqing.faloo.com/help/vipqianyue.htm',
      summary: '官方签约要求注明作品应为独立创作并通过平台审核。',
      aiSpecific: false,
      verifiedOn: '2026-10-30',
    }),
  }),
  Object.freeze({
    id: 'zongheng',
    name: '纵横中文网',
    hosts: Object.freeze(['zongheng.com']),
    policy: Object.freeze({
      title: '作者福利与创作规则',
      url: 'https://doc.zongheng.com/welfare/zongheng',
      summary: '官方规则禁止以无意义填充、重复内容、贴资料等欺骗手段更新正文。',
      aiSpecific: false,
      verifiedOn: '2026-10-30',
    }),
  }),
  Object.freeze({
    id: 'fanqie',
    name: '番茄小说',
    hosts: Object.freeze(['fanqienovel.com']),
    policy: Object.freeze({
      title: '番茄平台内容发布规范',
      url: 'https://fanqienovel.com/writer/zone/article/7237084151751376957',
      summary: '官方规范禁止批量重复或无意义内容、内容拼凑和恶意水文，并要求保障内容连贯与阅读体验。',
      aiSpecific: false,
      verifiedOn: '2026-10-31',
    }),
    aiPolicy: Object.freeze({
      title: '番茄小说关于加强低质内容治理公告（5月）',
      url: 'https://fanqienovel.com/writer/zone/article/7642544663915675672',
      summary: '官方公告明确治理滥用AI工具批量生成、严重缺乏原创性的低质内容，并列出结构失常和空洞水文等问题。',
      aiSpecific: true,
      verifiedOn: '2026-10-31',
    }),
  }),
  Object.freeze({
    id: 'qidian',
    name: '起点中文网',
    hosts: Object.freeze(['qidian.com']),
    policy: Object.freeze({
      title: '起点中文网作家星计划与创作规则',
      url: 'https://acts.qidian.com/2020/2020_09/index.html',
      summary: '官方规则反对抄袭，并禁止以大量无意义情节填充、重复旧内容或粘贴资料等方式欺骗读者。',
      aiSpecific: false,
      verifiedOn: '2026-10-30',
    }),
  }),
  Object.freeze({ id: 'unknown', name: '未知平台', hosts: Object.freeze([]), policy: null }),
]);

const NOVEL_PLATFORM_BY_ID = new Map(NOVEL_PLATFORMS.map(platform => [platform.id, platform]));

export function normalizeNovelPlatform(value) {
  const id = String(value || '').trim().toLowerCase();
  return NOVEL_PLATFORM_BY_ID.get(id) || NOVEL_PLATFORM_BY_ID.get('unknown');
}

export function matchNovelPlatformUrl(value) {
  let hostname;
  try { hostname = new URL(value).hostname.toLowerCase(); } catch { return normalizeNovelPlatform('unknown'); }
  return NOVEL_PLATFORMS.find(platform => platform.hosts.some(host => hostname === host || hostname.endsWith(`.${host}`))) || normalizeNovelPlatform('unknown');
}

export function novelPlatformPolicies(values, { context = 'quality' } = {}) {
  const selected = new Set((Array.isArray(values) ? values : []).map(value => normalizeNovelPlatform(value).id));
  return NOVEL_PLATFORMS
    .filter(platform => selected.has(platform.id) && platform.policy)
    .map(platform => {
      const policy = context === 'ai' ? platform.aiPolicy || platform.policy : platform.policy;
      return { platformId: platform.id, platformName: platform.name, ...policy };
    });
}
