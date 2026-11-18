#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""训练屏幕翻拍分类器（openspec refine-image-documents-workflow T13）。

数据来源（真实翻拍，非合成）：
  iamthejahid/recaptured-image-recognition 的 `recapture_dataset/`
  - original/   543 张直接拍摄/扫描的原件
  - recapture/   90 张对着屏幕拍摄的翻拍件
  仓库无 LICENSE 文件 → 仅限内部研究使用，不随代码分发；模型权重放 weights/（git 忽略），
  仓库只保留本脚本与来源/哈希记录，便于复现。

方法：26 维可解释特征（摩尔纹窄峰、LCD 子像素条纹、屏幕光照梯度、二次采样/压缩痕迹等，
见 src/modules/image/documents/python/document_recapture.py）+ 标准化 + 逻辑回归/小 MLP。
推理侧纯 numpy，不依赖 torch / sklearn。

输出：<weights>/recapture/recapture_v1.json（推理权重）
     runtime/logs/recapture-training.json（切分、指标、来源记录）
"""

import argparse
import glob
import hashlib
import json
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src/modules/image/documents/python"))
from document_recapture import FEATURE_NAMES, extract_features  # noqa: E402


def sha256_file(path, limit=8 * 1024 * 1024):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def collect(dataset_root):
    originals = sorted(glob.glob(str(Path(dataset_root) / "original" / "*")))
    recaptured = sorted(glob.glob(str(Path(dataset_root) / "recapture *" / "*")))
    if not recaptured:
        recaptured = sorted(glob.glob(str(Path(dataset_root) / "recapture" / "*")))
    keep = (".jpg", ".jpeg", ".png")
    originals = [p for p in originals if p.lower().endswith(keep)]
    recaptured = [p for p in recaptured if p.lower().endswith(keep)]
    return originals, recaptured


def variants(image, rng, count):
    """轻度增强（仅亮度/对比度，不制造翻拍痕迹），提高小样本稳定性。"""
    outputs = [image]
    for _ in range(count - 1):
        img = image
        if rng.random() < 0.6:
            img = ImageEnhance.Brightness(img).enhance(rng.uniform(0.9, 1.1))
        if rng.random() < 0.6:
            img = ImageEnhance.Contrast(img).enhance(rng.uniform(0.9, 1.1))
        outputs.append(img)
    return outputs


def load_rgb(path, max_side=1400):
    image = Image.open(path).convert("RGB")
    if max(image.size) > max_side:
        r = max_side / max(image.size)
        image = image.resize((int(image.width * r), int(image.height * r)), Image.BICUBIC)
    return image


def build_matrix(files, label, per_image, seed):
    rng = random.Random(seed)
    X, y = [], []
    used = 0
    for path in files:
        try:
            image = load_rgb(path)
        except Exception:
            continue
        if min(image.size) < 160:
            continue
        used += 1
        for img in variants(image, rng, per_image):
            X.append(list(extract_features(img).values()))
            y.append(label)
    return np.array(X, dtype=np.float64), np.array(y), used


def metrics_at(probs, labels, threshold):
    pred = probs >= threshold
    tp = float(np.sum(pred & (labels == 1)))
    fp = float(np.sum(pred & (labels == 0)))
    fn = float(np.sum(~pred & (labels == 1)))
    tn = float(np.sum(~pred & (labels == 0)))
    return {"tpr": tp / max(1.0, tp + fn), "fpr": fp / max(1.0, fp + tn),
            "accuracy": (tp + tn) / max(1.0, tp + tn + fp + fn)}


def pick_threshold(probs, labels, max_fpr=0.05):
    """在验证集上选阈值：FPR ≤ max_fpr 前提下最大化 TPR（宁可漏报，不误报）。"""
    best = (0.5, 0.0, 1.0)
    for t in np.arange(0.30, 0.96, 0.01):
        m = metrics_at(probs, labels, t)
        if m["fpr"] <= max_fpr and m["tpr"] > best[1]:
            best = (float(t), m["tpr"], m["fpr"])
    return best


def main():
    parser = argparse.ArgumentParser(description="训练屏幕翻拍分类器（真实数据集）")
    parser.add_argument("--dataset", type=Path, required=True, help="recapture_dataset 目录")
    parser.add_argument("--weights-dir", type=Path, required=True, help="输出目录（weights/recapture）")
    parser.add_argument("--metrics", type=Path, default=Path("runtime/logs/recapture-training.json"))
    parser.add_argument("--per-image", type=int, default=3)
    parser.add_argument("--domain-docs", default="", help="逗号分隔的自有文档图片，用于额外误报检查")
    parser.add_argument("--extra-negatives-json", type=Path, default=None,
                        help="自有文档域负样本特征 JSON（由 extract_doc_features 产出），用于修正域偏移")
    args = parser.parse_args()

    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import roc_auc_score
    from sklearn.model_selection import train_test_split
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler

    originals, recaptured = collect(args.dataset)
    print(f"original={len(originals)} recapture={len(recaptured)}", flush=True)
    if len(recaptured) < 30 or len(originals) < 100:
        raise SystemExit("数据不足，终止训练")

    # 先按文件切分（训练/验证/测试互不重叠），再做增强，避免同图泄漏
    tr_o, tmp_o = train_test_split(originals, test_size=0.3, random_state=20261117)
    va_o, te_o = train_test_split(tmp_o, test_size=0.5, random_state=20261117)
    tr_r, tmp_r = train_test_split(recaptured, test_size=0.3, random_state=20261117)
    va_r, te_r = train_test_split(tmp_r, test_size=0.5, random_state=20261117)

    Xtr_a, ytr_a, _ = build_matrix(tr_o, 0, args.per_image, 11)
    Xtr_b, ytr_b, _ = build_matrix(tr_r, 1, args.per_image, 12)
    Xva_a, yva_a, _ = build_matrix(va_o, 0, 1, 21)
    Xva_b, yva_b, _ = build_matrix(va_r, 1, 1, 22)
    Xte_a, yte_a, _ = build_matrix(te_o, 0, 1, 31)
    Xte_b, yte_b, _ = build_matrix(te_r, 1, 1, 32)

    # 自有文档域负样本（关键）：训练集"原件"是普通照片，我们的业务"原件"是电子发票/扫描件，
    # 若不加入文档负样本，模型会把屏幕观感强的合法文档误判为翻拍（实测 CrossCred 误报 35–40%）。
    if args.extra_negatives_json:
        payload_neg = json.loads(args.extra_negatives_json.read_text())
        doc_neg = []
        for key, rows in payload_neg.items():
            if key in ("features", "meta"):
                continue
            for row in rows:
                doc_neg.append(row if isinstance(row, list) else row.get("features"))
        doc_neg = np.array([r for r in doc_neg if r is not None and len(r) == len(FEATURE_NAMES)], dtype=np.float64)
        if len(doc_neg):
            n_hold = max(1, int(len(doc_neg) * 0.25))
            doc_tr, doc_te = train_test_split(doc_neg, test_size=n_hold, random_state=20261117)
            Xtr_a = np.vstack([Xtr_a, doc_tr]); ytr_a = np.concatenate([ytr_a, np.zeros(len(doc_tr))])
            Xte_a = np.vstack([Xte_a, doc_te]); yte_a = np.concatenate([yte_a, np.zeros(len(doc_te))])
            print(f"文档域负样本 {len(doc_neg)}（训练 {len(doc_tr)} / 测试 {len(doc_te)}）", flush=True)

    Xtr = np.vstack([Xtr_a, Xtr_b]); ytr = np.concatenate([ytr_a, ytr_b])
    Xva = np.vstack([Xva_a, Xva_b]); yva = np.concatenate([yva_a, yva_b])
    Xte = np.vstack([Xte_a, Xte_b]); yte = np.concatenate([yte_a, yte_b])
    print(f"训练 {len(ytr)}（原件 {int((ytr == 0).sum())} / 翻拍 {int((ytr == 1).sum())}）| "
          f"验证 {len(yva)} | 测试 {len(yte)}", flush=True)

    scaler = StandardScaler().fit(Xtr)
    Xtr_s, Xva_s, Xte_s = scaler.transform(Xtr), scaler.transform(Xva), scaler.transform(Xte)

    candidates = {
        "logistic": LogisticRegression(max_iter=4000, C=0.7, class_weight="balanced"),
        "mlp": MLPClassifier(hidden_layer_sizes=(32,), alpha=1e-3, max_iter=1200,
                             random_state=7, early_stopping=True, n_iter_no_change=40),
    }
    results, best_name, best_auc, best_model = {}, None, -1.0, None
    for name, model in candidates.items():
        model.fit(Xtr_s, ytr)
        p_val = model.predict_proba(Xva_s)[:, 1]
        auc = roc_auc_score(yva, p_val)
        results[name] = {"valAuc": round(float(auc), 4)}
        print(f"{name}: valAUC={auc:.4f}", flush=True)
        if auc > best_auc:
            best_name, best_auc, best_model = name, auc, model

    p_val = best_model.predict_proba(Xva_s)[:, 1]
    threshold, val_tpr, val_fpr = pick_threshold(p_val, yva, max_fpr=0.05)
    p_te = best_model.predict_proba(Xte_s)[:, 1]
    doc_te_mask = yte == 0
    test_auc = roc_auc_score(yte, p_te)
    m_test = metrics_at(p_te, yte, threshold)
    print(f"选用 {best_name} | 阈值 {threshold:.2f}（val TPR {val_tpr:.3f} / FPR {val_fpr:.3f}）| "
          f"test AUC {test_auc:.4f} TPR {m_test['tpr']:.3f} FPR {m_test['fpr']:.3f}", flush=True)

    # 自有文档域误报检查（关键：真实业务材料不应被判翻拍）
    domain = {}
    docs = [p for p in args.domain_docs.split(",") if p.strip()]
    for path in docs:
        try:
            feats = list(extract_features(load_rgb(path)).values())
            prob = float(best_model.predict_proba(scaler.transform([feats]))[0][1])
            domain[Path(path).name] = round(prob, 4)
        except Exception:
            continue
    if domain:
        print("自有文档概率:", domain, flush=True)

    payload = {
        "version": "recapture-v1.0-" + best_name,
        "kind": "mlp" if best_name == "mlp" else "logistic",
        "features": FEATURE_NAMES,
        "mean": [float(v) for v in scaler.mean_],
        "scale": [float(v) for v in scaler.scale_],
        "thresholds": {"medium": round(threshold, 3), "high": round(min(0.95, threshold + 0.15), 3)},
        "provenance": {
            "dataset": "iamthejahid/recaptured-image-recognition:recapture_dataset",
            "originals": len(originals), "recaptured": len(recaptured),
            "license": "repository has no LICENSE file; internal research use only, do not redistribute",
            "trainedAt": "2026-11-17",
        },
    }
    if best_name == "mlp":
        payload["w1"] = [[float(v) for v in row] for row in best_model.coefs_[0]]
        payload["b1"] = [float(v) for v in best_model.intercepts_[0]]
        payload["w2"] = [float(v) for v in best_model.coefs_[1][:, 0]]
        payload["b2"] = float(best_model.intercepts_[1][0])
    else:
        payload["coef"] = [float(v) for v in best_model.coef_[0]]
        payload["intercept"] = float(best_model.intercept_[0])

    args.weights_dir.mkdir(parents=True, exist_ok=True)
    model_path = args.weights_dir / "recapture_v1.json"
    model_path.write_text(json.dumps(payload, ensure_ascii=False))
    args.metrics.parent.mkdir(parents=True, exist_ok=True)
    args.metrics.write_text(json.dumps({
        "dataset": {"originals": len(originals), "recaptured": len(recaptured),
                    "sampleSha256": [sha256_file(p) for p in (originals[:2] + recaptured[:2])]},
        "split": {"trainImages": [len(tr_o), len(tr_r)], "valImages": [len(va_o), len(va_r)],
                  "testImages": [len(te_o), len(te_r)],
                  "matrix": {"train": int(len(ytr)), "val": int(len(yva)), "test": int(len(yte))}},
        "candidates": results, "chosen": best_name,
        "threshold": round(threshold, 3),
        "validation": {"tpr": round(val_tpr, 4), "fpr": round(val_fpr, 4)},
        "test": {"auc": round(float(test_auc), 4), **{k: round(v, 4) for k, v in m_test.items()}},
        "domainDocsProbability": domain,
        "modelSha256": sha256_file(model_path),
        "caveat": "数据集无 LICENSE，仅内部研究；测试集为同分布随机切分，跨设备/跨屏幕泛化未验证。",
    }, ensure_ascii=False, indent=1))
    print("模型 →", model_path)


if __name__ == "__main__":
    main()
