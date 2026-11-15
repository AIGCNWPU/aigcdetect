from pathlib import Path
import sys, importlib, time, os
import torch

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, os.environ.get("VLAFORGE_SOURCE", str(ROOT / "vendor/VLAForge")))


def resolve_device():
    requested = os.environ.get("VLAFORGE_DEVICE")
    if requested:
        return torch.device(requested)
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


class Engine:
    def __init__(self):
        started = time.time()
        self.device = resolve_device()
        if self.device.type == "cpu":
            torch.set_num_threads(4)
        # mmap仅用于CPU加载；CUDA目标不支持mmap反序列化
        checkpoint = torch.load(
            Path(os.environ.get("VLAFORGE_CHECKPOINT", ROOT / "artifacts/model.pth")),
            map_location="cpu",
            weights_only=True,
            mmap=self.device.type == "cpu",
        )
        if "state_dict" in checkpoint:
            checkpoint = checkpoint["state_dict"]
        checkpoint = {k.removeprefix("module."): v for k, v in checkpoint.items()}
        clip = importlib.import_module("model.clip.clip")
        backbone = {
            k[len("clip_model.") :]: v
            for k, v in checkpoint.items()
            if k.startswith("clip_model.")
        }
        if not backbone:
            raise RuntimeError(
                "Official checkpoint lacks CLIP backbone; separate backbone weights required"
            )
        clip.load = lambda *a, **kw: (
            clip.build_model(dict(backbone)).float().to(self.device),
            None,
        )
        from model.VLAForge import VLAForge

        self.model = (
            VLAForge(
                clip_name="ViT-L/14",
                adapter_vit_name="vit_tiny_patch16_224",
                num_quires=128,
                fusion_map={0: 0, 1: 1, 2: 8, 3: 15},
                mlp_dim=256,
                mlp_out_dim=128,
                head_num=16,
                device=self.device,
            )
            .float()
            .to(self.device)
            .eval()
        )
        self.model.load_state_dict(checkpoint, strict=True)
        self.params = sum(p.numel() for p in self.model.parameters())
        print(
            f"Loaded {self.params:,} parameters on {self.device} in {time.time() - started:.1f}s",
            flush=True,
        )

    def score(self, rgb):
        import cv2
        import numpy as np

        im = (
            cv2.resize(rgb, (256, 256), interpolation=cv2.INTER_CUBIC).astype("float32")
            / 255
        )
        im = (
            im - np.array([0.48145466, 0.4578275, 0.40821073], dtype="float32")
        ) / np.array([0.26862954, 0.26130258, 0.27577711], dtype="float32")
        tensor = torch.from_numpy(im.transpose(2, 0, 1)).unsqueeze(0).to(self.device)
        with torch.no_grad():
            out = self.model(
                {
                    "image": tensor,
                    "name": ["anonymous"],
                    "label": torch.zeros(1, dtype=torch.long, device=self.device),
                },
                inference=True,
            )
        score = float(out["prob"].reshape(-1)[0])
        self.model.prob.clear()
        self.model.label.clear()
        return score
