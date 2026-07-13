from __future__ import annotations

import argparse
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from server.app.ml_policy import ACTION_FEATURE_SIZE, STATE_FEATURE_SIZE, create_policy_value_net

DEFAULT_OUTPUT = "server/models/simpei_policy_value.pt"


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a Simpei policy/value network from exported JSONL.")
    parser.add_argument("--dataset", default="server/data/ml/policy_value.jsonl")
    parser.add_argument(
        "--output",
        default=None,
        help=(
            "Model output path template. A timestamp and UUID are appended before the suffix. "
            "If omitted, writes a timestamped UUID file under server/models. "
            f"Default template: {DEFAULT_OUTPUT}"
        ),
    )
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda", "mps"], default="auto")
    args = parser.parse_args()

    output_path = unique_output_path(Path(args.output or DEFAULT_OUTPUT))
    train(Path(args.dataset), output_path, args.epochs, args.lr, args.device)


def train(dataset_path: Path, output_path: Path, epochs: int, lr: float, device_name: str = "auto") -> None:
    import torch
    from torch import nn

    samples = load_samples(dataset_path)
    if not samples:
        raise SystemExit(f"no samples found in {dataset_path}")

    model = create_policy_value_net()
    if model is None:
        raise SystemExit("PyTorch is required to train the policy/value model.")

    device = resolve_device(torch, device_name)
    model = model.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    policy_loss_fn = nn.CrossEntropyLoss()
    value_loss_fn = nn.MSELoss()
    print(f"training on device={device}")

    for epoch in range(1, epochs + 1):
        total_loss = 0.0
        for sample in samples:
            state = torch.tensor(sample["state_features"], dtype=torch.float32, device=device).unsqueeze(0)
            actions = torch.tensor(sample["action_features"], dtype=torch.float32, device=device).unsqueeze(0)
            target_policy = torch.tensor([sample["chosen_index"]], dtype=torch.long, device=device)
            target_value = torch.tensor([sample["value"]], dtype=torch.float32, device=device)

            logits, value = model(state, actions)
            loss = policy_loss_fn(logits, target_policy) + value_loss_fn(value, target_value)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += float(loss.item())

        print(f"epoch={epoch} loss={total_loss / len(samples):.4f}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model_state": {key: value.detach().cpu() for key, value in model.state_dict().items()},
            "state_feature_size": STATE_FEATURE_SIZE,
            "action_feature_size": ACTION_FEATURE_SIZE,
        },
        output_path,
    )
    print(f"saved model to {output_path}")


def resolve_device(torch, device_name: str):
    if device_name == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return torch.device("mps")
        return torch.device("cpu")

    if device_name == "cuda" and not torch.cuda.is_available():
        raise SystemExit("CUDA is not available. Use --device cpu or install a CUDA-enabled PyTorch build.")

    if device_name == "mps" and not (hasattr(torch.backends, "mps") and torch.backends.mps.is_available()):
        raise SystemExit("MPS is not available. Use --device cpu or --device auto.")

    return torch.device(device_name)


def unique_output_path(template_path: str | Path) -> Path:
    template_path = Path(template_path)
    created_at = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    suffix = template_path.suffix or ".pt"
    stem = template_path.stem
    return template_path.with_name(f"{stem}_{created_at}_{uuid.uuid4().hex}{suffix}")


def load_samples(dataset_path: Path) -> list[dict]:
    with dataset_path.open("r", encoding="utf-8") as dataset:
        return [json.loads(line) for line in dataset if line.strip()]


if __name__ == "__main__":
    main()
