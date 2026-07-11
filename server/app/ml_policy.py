from __future__ import annotations

from pathlib import Path
from typing import Any


PLAYERS = ("red", "blue")
ACTION_TYPES = ("place", "move", "forceMove", "pass")
WORLDS = {"upper": 4, "lower": 3}
POSITIONS = [f"{world}-{row}-{col}" for world, size in WORLDS.items() for row in range(size) for col in range(size)]
POSITION_INDEX = {position_id: index for index, position_id in enumerate(POSITIONS)}

STATE_FEATURE_SIZE = len(POSITIONS) * 5 + 7
ACTION_FEATURE_SIZE = len(ACTION_TYPES) + len(POSITIONS) * 2 + 4


def encode_state(state: dict[str, Any], player: str) -> list[float]:
    board = state.get("board") or {}
    stacks = state.get("stacks") or {}
    opponent = "blue" if player == "red" else "red"
    features: list[float] = []

    for position_id in POSITIONS:
        stack = stacks.get(position_id) or []
        top_piece = stack[-1] if stack else None
        owner = top_piece.get("owner") if isinstance(top_piece, dict) else board.get(position_id)
        size = float(top_piece.get("size", 1)) if isinstance(top_piece, dict) else (1.0 if owner in PLAYERS else 0.0)
        stack_depth = min(len(stack), 4) / 4 if stack else (1 / 4 if owner in PLAYERS else 0.0)
        features.extend([
            1.0 if owner == player else 0.0,
            1.0 if owner == opponent else 0.0,
            1.0 if owner in PLAYERS else 0.0,
            size / 3,
            stack_depth,
        ])

    current_player = state.get("currentPlayer")
    phase = state.get("phase")
    pending_forced_move = state.get("pendingForcedMove")
    turn_number = min(int(state.get("turnNumber", 0) or 0), 200) / 200
    placed_count = state.get("placedCount") or {}
    features.extend([
        1.0 if current_player == player else 0.0,
        1.0 if current_player == opponent else 0.0,
        1.0 if phase == "placement" else 0.0,
        1.0 if phase == "movement" else 0.0,
        1.0 if pending_forced_move else 0.0,
        turn_number,
        (int(placed_count.get(player, 0) or 0) - int(placed_count.get(opponent, 0) or 0)) / 4,
    ])
    return features


def encode_action(action: dict[str, Any]) -> list[float]:
    features = [1.0 if action.get("type") == action_type else 0.0 for action_type in ACTION_TYPES]
    features.extend(one_hot_position(action.get("from")))
    features.extend(one_hot_position(action.get("to")))
    piece_id = str(action.get("pieceId") or "")
    size_hint = 0.0
    if "BIG" in piece_id:
        size_hint = 1.0
    elif "MID" in piece_id:
        size_hint = 2 / 3
    elif "SMALL" in piece_id:
        size_hint = 1 / 3
    features.extend([
        size_hint,
        1.0 if piece_id.startswith("red-") else 0.0,
        1.0 if piece_id.startswith("blue-") else 0.0,
        1.0 if piece_id else 0.0,
    ])
    return features


def one_hot_position(position_id: Any) -> list[float]:
    features = [0.0] * len(POSITIONS)
    index = POSITION_INDEX.get(position_id)
    if index is not None:
        features[index] = 1.0
    return features


class PolicyValueModel:
    def __init__(self, model_path: Path):
        import torch

        checkpoint = torch.load(model_path, map_location="cpu")
        self.torch = torch
        self.model = PolicyValueNet()
        self.model.load_state_dict(checkpoint["model_state"])
        self.model.eval()

    def score_actions(self, state: dict[str, Any], legal_actions: list[dict[str, Any]], player: str) -> tuple[list[float], float]:
        state_features = encode_state(state, player)
        action_features = [encode_action(action) for action in legal_actions]
        with self.torch.no_grad():
            state_tensor = self.torch.tensor(state_features, dtype=self.torch.float32).unsqueeze(0)
            action_tensor = self.torch.tensor(action_features, dtype=self.torch.float32).unsqueeze(0)
            logits, value = self.model(state_tensor, action_tensor)
        return logits.squeeze(0).tolist(), float(value.squeeze().item())


def load_policy_model(model_path: str | Path | None) -> PolicyValueModel | None:
    if not model_path:
        return None

    path = Path(model_path)
    if not path.exists():
        return None

    try:
        return PolicyValueModel(path)
    except Exception:
        return None


def create_policy_value_net():
    if PolicyValueNet is None:
        return None
    return PolicyValueNet()


try:
    import torch
    from torch import nn

    class PolicyValueNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.state_encoder = nn.Sequential(
                nn.Linear(STATE_FEATURE_SIZE, 128),
                nn.ReLU(),
                nn.Linear(128, 128),
                nn.ReLU(),
            )
            self.policy_head = nn.Sequential(
                nn.Linear(128 + ACTION_FEATURE_SIZE, 128),
                nn.ReLU(),
                nn.Linear(128, 1),
            )
            self.value_head = nn.Sequential(
                nn.Linear(128, 64),
                nn.ReLU(),
                nn.Linear(64, 1),
                nn.Tanh(),
            )

        def forward(self, state_features, action_features):
            encoded_state = self.state_encoder(state_features)
            expanded_state = encoded_state.unsqueeze(1).expand(-1, action_features.shape[1], -1)
            policy_input = torch.cat([expanded_state, action_features], dim=-1)
            logits = self.policy_head(policy_input).squeeze(-1)
            value = self.value_head(encoded_state).squeeze(-1)
            return logits, value

except Exception:
    PolicyValueNet = None
