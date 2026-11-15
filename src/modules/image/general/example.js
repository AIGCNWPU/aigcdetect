// Measured user-supplied examples. Rebuild with build-user-image-showcase.mjs.
export const generalShowcase={
  "title": "林间暖阳 · 豆包2",
  "score": 0.9846780300140381,
  "verdict": "likely_ai",
  "diagnostics": {
    "providerChecks": {
      "checks": [
        {
          "provider": "doubao",
          "name": "豆包",
          "status": "evidence_found",
          "declarations": [
            {
              "role": "producer",
              "value": "doubao",
              "location": "xmp",
              "verification": "unsigned_declaration"
            }
          ],
          "c2pa": null,
          "sourceConfirmed": false,
          "loginRequired": false,
          "watermarkStatus": "not_checked"
        },
        {
          "provider": "qwen",
          "name": "千问 / Qwen",
          "status": "not_found",
          "declarations": [],
          "c2pa": null,
          "sourceConfirmed": false,
          "loginRequired": false,
          "watermarkStatus": "not_checked"
        },
        {
          "provider": "openai",
          "name": "OpenAI / ChatGPT",
          "status": "not_found",
          "declarations": [],
          "c2pa": null,
          "sourceConfirmed": false,
          "loginRequired": false,
          "watermarkStatus": "not_checked"
        }
      ],
      "network": "disabled",
      "unmappedProducers": [],
      "identityPolicy": "Exact product aliases only; unsigned declarations are not authenticated identities",
      "openaiOnlineCheck": "not_configured"
    },
    "metadata": {},
    "sourceDeclarations": {
      "status": "found",
      "records": [
        {
          "location": "xmp",
          "fields": {
            "Label": "1",
            "ContentProducer": "doubao",
            "ProduceID": "2796d867252f41b4bd002f5b9449be03",
            "ReservedCode1": "",
            "ContentPropagator": "",
            "PropagateID": "",
            "ReservedCode2": ""
          },
          "verification": "unsigned_declaration",
          "labelMeaning": "declared_ai"
        }
      ],
      "conflictingProducers": false,
      "issues": [],
      "network": "disabled",
      "sourceVerdict": null,
      "scope": "AIGC JSON and TC260 XMP in PNG/JPEG/WebP metadata",
      "watermarkStatus": "not_checked",
      "summary": "文件包含来源声明，尚未验证声明者身份。"
    },
    "dimensions": [
      1773,
      2364
    ],
    "format": "JPEG",
    "orientation": 1,
    "sha256": "5c4b8127806164c127c8b20e7d12a9a57d1c63b6ba4deeeae0f0376dcd58417d",
    "credentials": {
      "status": "absent",
      "network": "disabled"
    },
    "layers": {
      "original": "/public/image-examples/doubao/original.jpg",
      "residual": "/public/image-examples/doubao/residual.png",
      "compression": "/public/image-examples/doubao/compression.png",
      "sensitivity": "/public/image-examples/doubao/sensitivity.png",
      "aiFeatures": "/public/image-examples/doubao/aiFeatures.png"
    },
    "statistics": {
      "residualMean": 4.937,
      "compressionMean": 2.647,
      "sharpness": 867.87
    },
    "compressionApplicable": true
  },
  "forensics": {
    "schemaVersion": 1,
    "face": {
      "status": "completed",
      "reason": null,
      "model": "VLAForge",
      "faces": [
        {
          "box": [
            150,
            87,
            255,
            314
          ],
          "score": 0.9999899864196777,
          "signal": "suspicious"
        }
      ],
      "detectedFaceCount": 1,
      "analyzedFaceCount": 1,
      "truncated": false,
      "threshold": 0.5,
      "imageSize": [
        512,
        512
      ],
      "coordinates": "exif_oriented_xywh",
      "preview": "/public/image-examples/doubao/face-preview.png",
      "preprocess": "YuNet score>=0.8, >=50px; square crop 1.4; RGB256; CLIP normalization",
      "calibration": "uncalibrated",
      "localization": "face_boxes_not_tamper_masks",
      "summary": "已分析 1 张人脸，可点击人脸对照伪造线索。",
      "exampleTitle": "伪造人像示例"
    },
    "source": {
      "status": "completed",
      "model": "RPA OpenFake27",
      "weightsSha256": "bb6a7b3cb50368f0f8ebabb6910a12bfc9afe4a4ef0ab034ff07c70a61f605a3",
      "calibration": "uncalibrated_closed_set",
      "sourceVerdict": null,
      "patchSize": 64,
      "patchCount": 1036,
      "supportedSources": [
        "chroma",
        "dalle-3",
        "flux-1-1-pro",
        "flux-1-dev",
        "flux-1-schnell",
        "flux-amateursnapshotphotos",
        "flux-mvc5000",
        "flux-realism",
        "gpt-image-1",
        "grok-2-image-1212",
        "hidream-i1-full",
        "ideogram-3-0",
        "imagen-3-0-002",
        "imagen-4-0",
        "midjourney-6",
        "midjourney-7",
        "mystic",
        "sd-1-5",
        "sd-1-5-dreamshaper",
        "sd-1-5-epicdream",
        "sd-2-1",
        "sd-3-5",
        "sdxl",
        "sdxl-epic-realism",
        "sdxl-juggernaut",
        "sdxl-realvis-v5",
        "sdxl-touchofrealism"
      ],
      "aggregation": "logit_avg",
      "candidates": [
        {
          "source": "midjourney-6",
          "score": 0.4766470789909363
        },
        {
          "source": "gpt-image-1",
          "score": 0.3131767511367798
        },
        {
          "source": "dalle-3",
          "score": 0.1534004807472229
        }
      ],
      "summary": "已完成已知生成器候选分析；未知来源和混合编辑暂不能确定归属。",
      "seconds": 0.258,
      "applicability": "whole_image_signal_present",
      "inputEncoding": "JPEG",
      "encodingSensitive": true
    },
    "tamper": {
      "status": "completed",
      "model": "TruFor",
      "weightsSha256": "ac1d90e329a72e0d66e8665e123a19e94bfae3209c3ef8a4f9ca3b91578c7844",
      "score": 0.07997633516788483,
      "threshold": 0.3,
      "calibration": "uncalibrated",
      "signal": "no_obvious_signal",
      "imageSize": [
        1773,
        2364
      ],
      "inferenceSize": [
        768,
        1024
      ],
      "resized": true,
      "coordinates": "exif_oriented_full_image",
      "preprocess": "RGB /256; official phase3; long edge limited to 1024 for serving",
      "localization": "predicted_anomaly_not_ground_truth",
      "preview": "/public/image-examples/doubao/tamper-preview.png",
      "overlay": "/public/image-examples/doubao/tamper-overlay.png",
      "anomalyMap": "/public/image-examples/doubao/tamper-anomalyMap.png",
      "confidenceMap": "/public/image-examples/doubao/tamper-confidenceMap.png",
      "overlayMethod": "red alpha=anomaly*confidence*190",
      "mapRange": [
        0,
        1
      ],
      "meanConfidence": 0.9609431624412537,
      "summary": "本次未发现明显局部篡改线索。",
      "seconds": 2.591
    }
  },
  "spatial": {
    "status": "completed",
    "windowCount": 24
  },
  "sensitivity": {
    "status": "completed",
    "markedCount": 0
  }
};
