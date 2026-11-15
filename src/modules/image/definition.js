// 模块与场景定义。业务实现维护在本模块目录。
export const imageModule = {
  "id": "image",
  "title": "AI图片检测",
  "kicker": "IMAGE INTELLIGENCE",
  "description": "从通用图片到售后凭证，核查图像内容真实性。",
  "index": "02",
  "accent": "#8060cd",
  "tint": "#f0ebfb",
  "path": "/image",
  "scenarios": [
    {
      "id": "general",
      "moduleId": "image",
      "code": "2.1",
      "title": "通用AI生成图片检测",
      "audience": [
        "内容平台",
        "图片审核"
      ],
      "sourcePage": 6,
      "path": "/image/general",
      "api": {
        "method": "POST",
        "path": "/api/v1/image/general",
        "operationId": "image_general",
        "implemented": true,
        "maturity": "local-development"
      }
    },
    {
      "id": "refund",
      "moduleId": "image",
      "code": "2.2",
      "title": "仅退款与售后AI凭证检测",
      "audience": [
        "电商客服",
        "售后审核"
      ],
      "sourcePage": 7,
      "path": "/image/refund",
      "api": {
        "method": "POST",
        "path": "/api/v1/image/refund",
        "operationId": "image_refund",
        "implemented": true
      }
    },
    {
      "id": "documents",
      "moduleId": "image",
      "code": "2.3",
      "title": "AI证件与票据图片检测",
      "audience": [
        "材料审核",
        "票据核验"
      ],
      "sourcePage": 8,
      "path": "/image/documents",
      "api": {
        "method": "POST",
        "path": "/api/v1/image/documents",
        "operationId": "image_documents",
        "implemented": true,
        "maturity": "local-development"
      }
    }
  ]
};
