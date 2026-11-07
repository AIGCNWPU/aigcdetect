"""Extract the frozen HF-format backbone from the complete MIRROR checkpoint."""
import argparse
import importlib.metadata
import json
import re
from pathlib import Path

from mirror_service import digest_file as sha256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    ledger = json.loads(args.ledger.read_text())
    if (Path(ledger["target"]).resolve() != args.checkpoint.resolve()
            or ledger["sha256"] != sha256(args.checkpoint)):
        raise ValueError("Checkpoint differs from its download ledger")
    if args.output.exists():
        raise FileExistsError("Use a new directory; existing model assets are not overwritten")
    if importlib.metadata.version("transformers") != "4.57.1":
        raise RuntimeError("Use MIRROR's pinned transformers 4.57.1 environment")
    import torch
    from transformers import DINOv3ViTConfig, DINOv3ViTModel

    # Upstream stores an argparse.Namespace alongside tensor state. Allow only
    # that known metadata type, never fallback to unrestricted pickle loading.
    with torch.serialization.safe_globals([argparse.Namespace]):
        checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=True, mmap=True)
    state = checkpoint["model"]
    if not any(key.startswith("memory_bank.") for key in state):
        raise ValueError("Expected a complete detector checkpoint with memory parameters")
    backbone = {}
    for key, tensor in state.items():
        if not key.startswith("backbone.dino.") or ".lora_" in key:
            continue
        key = key.removeprefix("backbone.dino.")
        key = re.sub(r"^(layer\.\d+)\.base_model\.model\.", r"\1.", key)
        key = key.replace(".base_layer.", ".")
        if key in backbone:
            raise ValueError(f"Duplicate converted parameter: {key}")
        backbone[key] = tensor
    # H+ architecture: publisher DINOv3 vith16plus definition and checkpoint
    # tensor shapes. No tensor is initialized or silently omitted on mismatch.
    config = DINOv3ViTConfig(
        hidden_size=1280, intermediate_size=5120, num_hidden_layers=32,
        num_attention_heads=20, patch_size=16, image_size=224,
        hidden_act="silu", use_gated_mlp=True, num_register_tokens=4,
        query_bias=True, key_bias=False, value_bias=True, proj_bias=True,
        mlp_bias=True, layer_norm_eps=1e-5, rope_theta=100.0,
        layerscale_value=1e-5,
    )
    with torch.device("meta"):
        model = DINOv3ViTModel(config)
    result = model.load_state_dict(backbone, strict=True, assign=True)
    # Nonpersistent RoPE frequencies are reconstructed by from_pretrained.
    args.output.mkdir(parents=True)
    model.save_pretrained(args.output, safe_serialization=True, max_shard_size="4GB")
    report = {
        "source": "complete_MIRROR_phase2_checkpoint", "source_sha256": ledger["sha256"],
        "backbone_tensor_count": len(backbone), "strict_parameter_load": True,
        "missing_keys": result.missing_keys, "unexpected_keys": result.unexpected_keys,
        "lora_handling": "excluded_from_initializer_loaded_by_complete_detector_later",
        "not_an_original_DINO_pretrain_release": True,
        "files": [{"path": p.name, "sha256": sha256(p), "bytes": p.stat().st_size}
                  for p in sorted(args.output.iterdir()) if p.is_file()],
        "loaded_for_inference": False,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"strict_parameter_load": True, "backbone_tensors": len(backbone)}))


if __name__ == "__main__":
    main()
