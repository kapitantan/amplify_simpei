from __future__ import annotations

import argparse
import json
from pathlib import Path

from server.app.ml_policy import ACTION_FEATURE_SIZE, STATE_FEATURE_SIZE, create_policy_value_net


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a Simpei policy/value network from exported JSONL.")
    parser.add_argument("--dataset", default="server/data/ml/policy_value.jsonl")
    parser.add_argument("--output", default="server/models/simpei_policy_value.pt")
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--lr", type=float, default=1e-3)
    args = parser.parse_args()

    train(Path(args.dataset), Path(args.output), args.epochs, args.lr)


def train(dataset_path: Path, output_path: Path, epochs: int, lr: float) -> None:
    import torch
    from torch import nn

    samples = load_samples(dataset_path)
    if not samples:
        raise SystemExit(f"no samples found in {dataset_path}")

    model = create_policy_value_net()
    if model is None:
        raise SystemExit("PyTorch is required to train the policy/value model.")

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    policy_loss_fn = nn.CrossEntropyLoss()
    value_loss_fn = nn.MSELoss()

    for epoch in range(1, epochs + 1):
        total_loss = 0.0
        for sample in samples:
            state = torch.tensor(sample["state_features"], dtype=torch.float32).unsqueeze(0)
            actions = torch.tensor(sample["action_features"], dtype=torch.float32).unsqueeze(0)
            target_policy = torch.tensor([sample["chosen_index"]], dtype=torch.long)
            target_value = torch.tensor([sample["value"]], dtype=torch.float32)

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
            "model_state": model.state_dict(),
            "state_feature_size": STATE_FEATURE_SIZE,
            "action_feature_size": ACTION_FEATURE_SIZE,
        },
        output_path,
    )
    print(f"saved model to {output_path}")


def load_samples(dataset_path: Path) -> list[dict]:
    with dataset_path.open("r", encoding="utf-8") as dataset:
        return [json.loads(line) for line in dataset if line.strip()]


if __name__ == "__main__":
    main()
