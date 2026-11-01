"""训练 ReStraV MLP 分类器（与论文协议一致）。

- 类别均衡（等先验采样）、Z-score 归一化、分层 50/50 训练/测试划分
- 训练集上按 F1 优选阈值 τ*
- 产物写入 artifacts/：model.pt、mean.npy、std.npy、best_tau.npy、metrics.json

用法：python train/train_mlp.py --features training_features.h5 --out artifacts
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import h5py
import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support, roc_auc_score
from sklearn.model_selection import train_test_split
from torch.utils.data import DataLoader, TensorDataset
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from restrav_core import MLP  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", default="training_features.h5")
    parser.add_argument("--out", default=Path(__file__).resolve().parent.parent / "artifacts")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--device", default="cuda:0" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()
    device = torch.device(args.device)

    with h5py.File(args.features, "r") as f:
        x = f["features"][:].astype(np.float32)
        y = f["label"][:].astype(np.int64)
        paths = f["path"][:].astype(str)
    print(f"载入 {len(x)} 个样本")

    idx_real, idx_fake = np.where(y == 1)[0], np.where(y == 0)[0]
    n = min(len(idx_real), len(idx_fake))
    rng = np.random.default_rng(seed=42)
    balanced = np.concatenate([
        rng.choice(idx_real, n, replace=False),
        rng.choice(idx_fake, n, replace=False),
    ])
    rng.shuffle(balanced)
    x_bal, y_bal, paths_bal = x[balanced], y[balanced], paths[balanced]
    print(f"均衡后 {len(x_bal)}（real={n} fake={n}）")

    mean = x_bal.mean(axis=0, keepdims=True)
    std = x_bal.std(axis=0, keepdims=True) + 1e-8
    x_norm = (x_bal - mean) / std

    x_train, x_test, y_train, y_test, paths_train, paths_test = train_test_split(
        x_norm, y_bal, paths_bal, test_size=0.5, stratify=y_bal, random_state=42
    )
    loader = DataLoader(
        TensorDataset(torch.from_numpy(x_train), torch.from_numpy(y_train)),
        batch_size=32, shuffle=True,
    )

    model = MLP().to(device)
    criterion = nn.BCEWithLogitsLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    for epoch in range(args.epochs):
        model.train()
        running = 0.0
        for xb, yb in tqdm(loader, desc=f"Epoch {epoch + 1}/{args.epochs}", leave=False):
            xb, yb = xb.to(device), yb.float().unsqueeze(1).to(device)
            optimizer.zero_grad()
            loss = criterion(model(xb), yb)
            loss.backward()
            optimizer.step()
            running += loss.item() * xb.size(0)
        print(f"Epoch {epoch + 1} Loss {running / len(loader.dataset):.4f}")

    model.eval()

    def predict(feat: np.ndarray) -> np.ndarray:
        with torch.no_grad():
            return torch.sigmoid(model(torch.from_numpy(feat.astype(np.float32)).to(device))).cpu().numpy().ravel()

    train_prob = predict(x_train)
    thresholds = np.linspace(0.1, 0.9, 81)
    best_f1, best_tau = 0.0, 0.5
    for t in thresholds:
        f1 = f1_score(y_train, (train_prob >= t).astype(int))
        if f1 > best_f1:
            best_f1, best_tau = f1, float(t)
    print(f"训练集最优 τ*={best_tau:.3f}（F1={best_f1:.3f}）")

    test_prob = predict(x_test)
    test_pred = (test_prob >= best_tau).astype(int)
    precision, recall, f1, _ = precision_recall_fscore_support(y_test, test_pred, average="binary")
    metrics = {
        "nTotal": int(len(y_bal)),
        "nTrain": int(len(y_train)),
        "nTest": int(len(y_test)),
        "accuracy": float(accuracy_score(y_test, test_pred)),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "auc": float(roc_auc_score(y_test, test_prob)),
        "bestTau": best_tau,
        "confusionMatrix": confusion_matrix(y_test, test_pred).tolist(),
        "thresholds": {"high": 0.65, "medium": 0.35, "suspiciousWindow": 0.5},
    }
    print("=== 测试集表现 ===")
    print(json.dumps(metrics, indent=2, ensure_ascii=False))

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out / "model.pt")
    np.save(out / "mean.npy", mean)
    np.save(out / "std.npy", std)
    np.save(out / "best_tau.npy", np.array(best_tau))
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8")
    np.savetxt(out / "test_predictions_all.csv",
               np.column_stack([paths_test, y_test, test_pred, test_prob]),
               fmt="%s", delimiter=",", header="path,true_label,pred_label,prob_real", comments="")
    print(f"产物已写入 {out.resolve()}")


if __name__ == "__main__":
    main()
