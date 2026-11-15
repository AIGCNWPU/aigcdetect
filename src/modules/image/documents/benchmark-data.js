// Generated from frozen, reviewed paired results.
export const documentBenchmark={
  "published": true,
  "datasetLabel": "公开合成票据 · 8份试测",
  "samples": 8,
  "positive": 4,
  "negative": 4,
  "date": "2026-11-06",
  "scope": "英文合成PDF经渲染和OCR后核验；单文件金额一致性小样本，不包括跨文件核对或视觉篡改定位。采用同一输入比较规则与语义处理流程。",
  "methods": [
    {
      "id": "agent",
      "title": "智鉴智能核验"
    },
    {
      "id": "direct",
      "title": "直接语义核验"
    },
    {
      "id": "rules",
      "title": "本地规则"
    }
  ],
  "rows": [
    {
      "title": "基础金额",
      "total": 2,
      "correct": {
        "agent": 2,
        "direct": 2,
        "rules": 0
      }
    },
    {
      "title": "运费与明细",
      "total": 2,
      "correct": {
        "agent": 2,
        "direct": 2,
        "rules": 0
      }
    },
    {
      "title": "折扣与尾差",
      "total": 2,
      "correct": {
        "agent": 2,
        "direct": 1,
        "rules": 0
      }
    },
    {
      "title": "含税与税额",
      "total": 2,
      "correct": {
        "agent": 2,
        "direct": 1,
        "rules": 0
      }
    }
  ],
  "summary": {
    "agent": {
      "detected": 4,
      "normal": 4,
      "abstained": 0,
      "correct": 8,
      "falseAlarms": 0,
      "averageSeconds": 20.597749999999998
    },
    "direct": {
      "detected": 4,
      "normal": 2,
      "abstained": 1,
      "correct": 6,
      "falseAlarms": 1,
      "averageSeconds": 4.2158750000000005
    },
    "rules": {
      "detected": 0,
      "normal": 0,
      "abstained": 8,
      "correct": 0,
      "falseAlarms": 0
    }
  }
};
