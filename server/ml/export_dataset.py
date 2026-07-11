from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any

from server.app.ml_policy import encode_action, encode_state


def main() -> None:
    parser = argparse.ArgumentParser(description="Export Simpei CPU moves to a policy/value JSONL dataset.")
    parser.add_argument("--database", default="server/data/simpei_cpu_stacks_cover.sqlite3")
    parser.add_argument("--output", default="server/data/ml/policy_value.jsonl")
    args = parser.parse_args()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    count = export_dataset(Path(args.database), output_path)
    print(f"exported {count} samples to {output_path}")


def export_dataset(database_path: Path, output_path: Path) -> int:
    with sqlite3.connect(database_path) as db, output_path.open("w", encoding="utf-8") as output:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            """
            SELECT m.id, m.match_id, m.player, m.turn_number, m.action_json, m.legal_actions_json,
                   m.game_state_json, m.game_state_after_json, m.outcome, mt.winner
            FROM moves m
            JOIN matches mt ON mt.id = m.match_id
            WHERE m.actor = 'cpu' AND m.outcome IS NOT NULL
            ORDER BY m.match_id, m.turn_number, m.id
            """
        ).fetchall()

        sample_count = 0
        for row in rows:
            sample = build_sample(row)
            if not sample:
                continue
            output.write(json.dumps(sample, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
            sample_count += 1
        return sample_count


def build_sample(row: sqlite3.Row) -> dict[str, Any] | None:
    player = row["player"]
    state = json.loads(row["game_state_json"])
    action = json.loads(row["action_json"])
    legal_actions = json.loads(row["legal_actions_json"])
    chosen_index = find_action_index(action, legal_actions)
    if chosen_index is None:
        return None

    return {
        "move_id": row["id"],
        "match_id": row["match_id"],
        "turn_number": row["turn_number"],
        "player": player,
        "outcome": row["outcome"],
        "value": outcome_value(row["outcome"]),
        "chosen_index": chosen_index,
        "game_state": state,
        "state_features": encode_state(state, player),
        "action_features": [encode_action(legal_action) for legal_action in legal_actions],
        "legal_actions": legal_actions,
        "selected_action": action,
    }


def find_action_index(action: dict[str, Any], legal_actions: list[dict[str, Any]]) -> int | None:
    key = action_key(action)
    for index, legal_action in enumerate(legal_actions):
        if action_key(legal_action) == key:
            return index
    return None


def action_key(action: dict[str, Any]) -> tuple[Any, Any, Any, Any]:
    piece_id = action.get("pieceId") if action.get("type") == "place" else None
    return action.get("type"), piece_id, action.get("from"), action.get("to")


def outcome_value(outcome: str) -> float:
    if outcome == "win":
        return 1.0
    if outcome == "loss":
        return -1.0
    return 0.0


if __name__ == "__main__":
    main()
