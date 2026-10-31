// 模块与场景定义。业务实现维护在本模块目录。
export const audioModule = {
  "id": "audio",
  "title": "AI音频检测",
  "kicker": "AUDIO INTELLIGENCE",
  "description": "判断上传音频是否为 AI 合成或克隆语音。",
  "index": "04",
  "accent": "#bf7a29",
  "tint": "#faf1e4",
  "path": "/audio",
  "scenarios": [
    {
      "id": "forgery",
      "moduleId": "audio",
      "code": "4.1",
      "title": "AI音频伪造检测",
      "audience": [
        "音频平台",
        "语音核查"
      ],
      "sourcePage": 12,
      "path": "/audio/forgery",
      "api": {
        "method": "POST",
        "path": "/api/v1/audio/forgery",
        "operationId": "audio_forgery",
        "implemented": false
      }
    }
  ]
};
