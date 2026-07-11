from __future__ import annotations

import argparse
import json
from pathlib import Path

from server.app.ml_policy import PolicyValueModel


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate policy top-1 accuracy against exported CPU move data.")
    parser.add_argument("--dataset", default="server/data/ml/policy_value.jsonl")
    parser.add_argument("--model", default="server/models/simpei_policy_value.pt")
    args = parser.parse_args()

    accuracy = evaluate(Path(args.dataset), Path(args.model))
    print(f"top1_accuracy={accuracy:.4f}")


def evaluate(dataset_path: Path, model_path: Path) -> float:
    samples = load_samples(dataset_path)
    if not samples:
        raise SystemExit(f"no samples found in {dataset_path}")

    model = PolicyValueModel(model_path)
    correct = 0
    for sample in samples:
        state = sample["game_state"]
        legal_actions = sample["legal_actions"]
        logits, _value = model.score_actions(state, legal_actions, sample["player"])
        predicted_index = max(range(len(logits)), key=lambda index: logits[index])
        correct += 1 if predicted_index == sample["chosen_index"] else 0
    return correct / len(samples)


def load_samples(dataset_path: Path) -> list[dict]:
    with dataset_path.open("r", encoding="utf-8") as dataset:
        return [json.loads(line) for line in dataset if line.strip()]


if __name__ == "__main__":
    main()
