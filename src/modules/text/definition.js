// 模块与场景定义。业务实现维护在本模块目录。
export const textModule = {
  "id": "text",
  "title": "AI文本检测",
  "kicker": "TEXT INTELLIGENCE",
  "description": "论文、新闻稿与文学内容的AI生成线索检测。",
  "index": "01",
  "accent": "#0875e8",
  "tint": "#e8f1ff",
  "path": "/text",
  "scenarios": [
    {
      "id": "academic",
      "moduleId": "text",
      "code": "1.1",
      "title": "AI论文与学术稿件检测",
      "audience": [
        "论文作者",
        "学术编辑"
      ],
      "sourcePage": 3,
      "path": "/text/academic",
      "api": {
        "method": "POST",
        "path": "/api/v1/text/academic",
        "operationId": "text_academic",
        "implemented": false
      }
    },
    {
      "id": "news",
      "moduleId": "text",
      "code": "1.2",
      "title": "AI新闻稿与投稿内容检测",
      "audience": [
        "新闻编辑",
        "内容审核"
      ],
      "sourcePage": 4,
      "path": "/text/news",
      "api": {
        "method": "POST",
        "path": "/api/v1/text/news",
        "operationId": "text_news",
        "implemented": false
      }
    },
    {
      "id": "novel",
      "moduleId": "text",
      "code": "1.3",
      "title": "AI网文与小说内容检测",
      "audience": [
        "网文平台",
        "作品编辑"
      ],
      "sourcePage": 5,
      "path": "/text/novel",
      "api": {
        "method": "POST",
        "path": "/api/v1/text/novel",
        "operationId": "text_novel",
        "implemented": false
      }
    }
  ]
};
