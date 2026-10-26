// 模块与场景定义。业务实现维护在本模块目录。
export const videoModule = {
  "id": "video",
  "title": "AI视频检测",
  "kicker": "VIDEO INTELLIGENCE",
  "description": "识别生成视频、深度伪造及售后视频风险。",
  "index": "03",
  "accent": "#278a86",
  "tint": "#e4f3f1",
  "path": "/video",
  "scenarios": [
    {
      "id": "general",
      "moduleId": "video",
      "code": "3.1",
      "title": "通用AI生成视频检测",
      "audience": [
        "视频平台",
        "内容审核"
      ],
      "sourcePage": 9,
      "path": "/video/general",
      "api": {
        "method": "POST",
        "path": "/api/v1/video/general",
        "operationId": "video_general",
        "implemented": false
      }
    },
    {
      "id": "deepfake",
      "moduleId": "video",
      "code": "3.2",
      "title": "人物换脸与深度伪造检测",
      "audience": [
        "媒体核查",
        "人像审核"
      ],
      "sourcePage": 10,
      "path": "/video/deepfake",
      "api": {
        "method": "POST",
        "path": "/api/v1/video/deepfake",
        "operationId": "video_deepfake",
        "implemented": true
      }
    },
    {
      "id": "aftersales",
      "moduleId": "video",
      "code": "3.3",
      "title": "售后与退货AI视频凭证检测",
      "audience": [
        "电商客服",
        "退货审核"
      ],
      "sourcePage": 11,
      "path": "/video/aftersales",
      "api": {
        "method": "POST",
        "path": "/api/v1/video/aftersales",
        "operationId": "video_aftersales",
        "implemented": false
      }
    }
  ]
};
