export const aftersalesVideoPresets=Object.freeze([
  {
    "id": "pottery-simulation",
    "label": "AI 模拟：陶罐破碎",
    "group": "明确标注为 AI 生成的研究样本",
    "fields": {
      "caseNumber": "VIDEO-DEMO-POTTERY",
      "productName": "陶罐",
      "style": "",
      "productInfo": "棕色陶制罐体",
      "description": "陶罐掉落后破碎，地面出现碎片。"
    },
    "file": {
      "url": "/public/video-aftersales-demos/pottery-simulation.mp4",
      "name": "AI 模拟_陶罐破碎.mp4",
      "sha256": "0c40b07fd9d5d2d636425f1a892050fbeafa373ea9de7db0572d907ae3b11da1"
    },
    "source": "https://huggingface.co/datasets/videophysics/videophy2_test"
  },
  {
    "id": "teapot-reported",
    "label": "报道案例：紫砂壶开裂",
    "group": "报道中被指为 AI 的凭证片段，尚未取得原始生成记录",
    "fields": {
      "caseNumber": "VIDEO-DEMO-TEAPOT",
      "productName": "紫砂壶",
      "style": "",
      "productInfo": "棕色紫砂壶",
      "description": "壶体底部出现裂纹。"
    },
    "file": {
      "url": "/public/video-aftersales-demos/teapot-reported.mp4",
      "name": "报道案例_紫砂壶开裂.mp4",
      "sha256": "8905e7c32f773b34cead602e9af338d5256c381d76433cf34caa9f8fe769a66f"
    },
    "source": "https://www.shobserver.com/wx/detail.do?id=1020808"
  }
]);
