import { normalizeDeepfakeResult } from './model.js';
import { faceArt } from './face-art.js';

// 明确标注的界面样例：人物为程序生成的抽象示意，结论为虚构数据，不代表真实检测。
function frame(id, personKey, time, risk, quality, caption) {
  return {
    id,
    time,
    risk,
    quality,
    caption,
    image: faceArt(personKey, risk === 'high' ? 'high' : risk === 'medium' ? 'medium' : ''),
  };
}

const interview = {
  risk: 'high',
  summary: '两位人物中，人物 A 在 2 个时间段出现面部合成线索，其中 00:18.6–00:27.4 的下颌与发际线边缘重复纹理最明显；人物 B 的采样人脸画面未发现明显异常。',
  coverage: 'full',
  scope: '全片 128 秒，按 2 秒间隔采样 64 帧，识别到 2 位人物、73 帧可用人脸画面；逐人完成换脸与面部合成检测。',
  duration: 128,
  sampledFrames: 64,
  faceFrames: 73,
  aiProbability: 0.968,
  findings: [
    '人物 A 的近景人脸在转头时出现边缘重复纹理和跨帧轮廓漂移。',
    '人物 A 的口型节奏与画面动作存在轻微错位，鼻翼局部细节分辨率异常。',
    '人物 B 的面部轮廓、光影与噪点分布在采样画面间保持连续。',
  ],
  persons: [
    {
      id: 'person-interview-a',
      label: '人物 A · 左侧受访者',
      risk: 'high',
      coverage: 'full',
      summary: '人物 A 的面部区域在 2 个时间段出现合成线索，建议优先复核 00:18.6–00:27.4 的转头近景。',
      firstSeen: 2.0,
      lastSeen: 126.4,
      faceFrames: 42,
      findings: [
        '发际线与下颌边缘存在周期性重复纹理。',
        '面部光影方向与颈部、背景不一致。',
        '跨帧轮廓出现轻微漂移，口型节拍存在错位。',
      ],
      segments: [
        {
          id: 'segment-interview-a1',
          start: 18.6,
          end: 27.4,
          risk: 'high',
          summary: '近景转头时，下颌与发际线边缘出现重复纹理，面部轮廓跨帧漂移，光影方向与颈部不一致。',
          signals: ['边缘重复纹理', '跨帧轮廓漂移', '光影方向不一致'],
          frameId: 'frame-interview-a2',
        },
        {
          id: 'segment-interview-a2',
          start: 66.2,
          end: 74.8,
          risk: 'medium',
          summary: '口型与画面动作存在轻微错位，鼻翼边缘细节分辨率低于同画面其他区域。',
          signals: ['口型节拍错位', '局部细节异常'],
          frameId: 'frame-interview-a4',
        },
      ],
      frames: [
        frame('frame-interview-a1', 'a', 6.4, 'low', 94, '正面近景，面部纹理与光影连续。'),
        frame('frame-interview-a2', 'a', 22.8, 'high', 89, '转头近景，下颌边缘出现重复纹理。'),
        frame('frame-interview-a3', 'a', 44.0, 'low', 92, '中景访谈，发丝与背景交界自然。'),
        frame('frame-interview-a4', 'a', 70.5, 'medium', 84, '口型变化处，鼻翼局部细节异常。'),
        frame('frame-interview-a5', 'a', 98.2, 'low', 90, '侧脸近景，轮廓在连续帧间稳定。'),
        frame('frame-interview-a6', 'a', 121.0, 'low', 88, '收尾近景，面部噪点分布均匀。'),
      ],
    },
    {
      id: 'person-interview-b',
      label: '人物 B · 右侧提问者',
      risk: 'low',
      coverage: 'full',
      summary: '人物 B 的采样人脸画面未发现明显换脸或面部合成线索，轮廓与光影在连续帧间保持一致。',
      firstSeen: 4.2,
      lastSeen: 127.8,
      faceFrames: 31,
      findings: [
        '面部轮廓和光影在采样帧间保持连续。',
        '未见周期性纹理或边缘断裂。',
      ],
      segments: [],
      frames: [
        frame('frame-interview-b1', 'b', 10.8, 'low', 93, '正面中景，五官边缘清晰。'),
        frame('frame-interview-b2', 'b', 47.2, 'low', 91, '侧脸说话，发丝细节自然。'),
        frame('frame-interview-b3', 'b', 83.6, 'low', 90, '低头上看，面部光照方向一致。'),
        frame('frame-interview-b4', 'b', 117.4, 'low', 87, '收尾画面，噪点分布均匀。'),
      ],
    },
  ],
};

const meeting = {
  risk: 'medium',
  summary: '画面中共识别到 3 位人物。人物 C 在 00:42.0–00:49.6 的口鼻区域出现局部细节异常，需人工复核；人物 D、E 的采样画面未发现明显合成线索，人物 E 仅在前段出现。',
  coverage: 'partial',
  scope: '全片 186.5 秒，按 2.4 秒间隔采样 78 帧，识别到 3 位人物、74 帧可用人脸画面。人物 E 在 01:00 后离开画面，其结论仅覆盖出现区间。',
  duration: 186.5,
  sampledFrames: 78,
  faceFrames: 74,
  aiProbability: 0.612,
  findings: [
    '人物 C 的口鼻区域在 1 个时间段出现局部细节异常，面部边缘未见明显漂移。',
    '人物 D 的采样画面未见重复纹理或轮廓断裂。',
    '人物 E 仅在前 58.4 秒出现，后段未检测，不能视为后段安全。',
  ],
  persons: [
    {
      id: 'person-meeting-c',
      label: '人物 C · 主讲人',
      risk: 'medium',
      coverage: 'full',
      summary: '主讲人的口鼻区域在 00:42.0–00:49.6 出现局部细节异常，建议结合原视频复核该片段。',
      firstSeen: 2.0,
      lastSeen: 184.8,
      faceFrames: 38,
      findings: ['口鼻区域出现局部细节异常。', '面部外轮廓未发现明显漂移。'],
      segments: [
        {
          id: 'segment-meeting-c1',
          start: 42.0,
          end: 49.6,
          risk: 'medium',
          summary: '口鼻区域细节分辨率异常，唇部边缘与周围皮肤过渡不自然；未发现明显轮廓漂移。',
          signals: ['口鼻细节异常', '唇部过渡不自然'],
          frameId: 'frame-meeting-c2',
        },
      ],
      frames: [
        frame('frame-meeting-c1', 'c', 7.4, 'low', 92, '开场正面，面部纹理连续。'),
        frame('frame-meeting-c2', 'c', 45.8, 'medium', 86, '说话近景，口鼻区域细节异常。'),
        frame('frame-meeting-c3', 'c', 92.0, 'low', 90, '中景讲解，轮廓与光影一致。'),
        frame('frame-meeting-c4', 'c', 140.6, 'low', 89, '侧身讲解，发丝边缘自然。'),
      ],
    },
    {
      id: 'person-meeting-d',
      label: '人物 D · 参会者 1',
      risk: 'low',
      coverage: 'full',
      summary: '参会者 1 的采样人脸画面未发现明显换脸或面部合成线索。',
      firstSeen: 5.0,
      lastSeen: 182.4,
      faceFrames: 24,
      findings: ['采样画面中轮廓、光影与噪点分布连续。'],
      segments: [],
      frames: [
        frame('frame-meeting-d1', 'd', 14.0, 'low', 88, '听讲近景，五官边缘清晰。'),
        frame('frame-meeting-d2', 'd', 78.5, 'low', 90, '转头画面，轮廓稳定。'),
        frame('frame-meeting-d3', 'd', 149.2, 'low', 86, '后段中景，噪点分布一致。'),
      ],
    },
    {
      id: 'person-meeting-e',
      label: '人物 E · 参会者 2',
      risk: 'low',
      coverage: 'partial',
      summary: '参会者 2 仅在前段出现，已处理区间内未发现明显合成线索；01:00 后离开画面，未检测部分不能视为安全。',
      firstSeen: 3.0,
      lastSeen: 58.4,
      faceFrames: 12,
      findings: ['出现区间内的面部轮廓与光影保持连续。'],
      segments: [],
      frames: [
        frame('frame-meeting-e1', 'e', 9.2, 'low', 85, '前段近景，面部纹理自然。'),
        frame('frame-meeting-e2', 'e', 52.6, 'low', 83, '离开画面前的中景，轮廓连续。'),
      ],
    },
  ],
};

export function createVideoDeepfakeSamples() {
  return [
    {
      id: 'sample-interview-duo',
      sample: true,
      name: '访谈_双人对话.mp4',
      createdAt: '2026-10-20 16:40',
      completedAt: '2026-10-20 16:43',
      status: 'succeeded',
      meta: { size: 156 * 1024 * 1024, duration: 128, width: 1920, height: 1080, type: 'video/mp4' },
      material: { name: '访谈_双人对话.mp4', size: 156 * 1024 * 1024, lastModified: 0, version: 'SAMPLE-01' },
      media: null,
      result: normalizeDeepfakeResult(interview),
      progress: null,
      error: null,
      controller: null,
      savedAt: null,
    },
    {
      id: 'sample-meeting-group',
      sample: true,
      name: '会议_多人画面.mp4',
      createdAt: '2026-10-19 11:08',
      completedAt: '2026-10-19 11:11',
      status: 'succeeded',
      meta: { size: 98 * 1024 * 1024, duration: 186.5, width: 1280, height: 720, type: 'video/mp4' },
      material: { name: '会议_多人画面.mp4', size: 98 * 1024 * 1024, lastModified: 0, version: 'SAMPLE-02' },
      media: null,
      result: normalizeDeepfakeResult(meeting),
      progress: null,
      error: null,
      controller: null,
      savedAt: null,
    },
  ];
}
