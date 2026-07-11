import importlib
import json

from fastapi.testclient import TestClient


def load_app(tmp_path, monkeypatch):
    monkeypatch.setenv("SIMPEI_DATABASE_PATH", str(tmp_path / "simpei.sqlite3"))
    module = importlib.import_module("server.app.main")
    module = importlib.reload(module)
    module.init_database()
    return module


def test_health_reports_server_status(tmp_path, monkeypatch):
    module = load_app(tmp_path, monkeypatch)
    client = TestClient(module.app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_cors_preflight_allows_local_and_private_network_origins(tmp_path, monkeypatch):
    module = load_app(tmp_path, monkeypatch)
    client = TestClient(module.app)

    for origin in ["http://localhost:5173", "http://127.0.0.1:5173", "http://192.168.1.10:5173", "http://100.64.0.10:5173"]:
        response = client.options(
            "/matches",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )

        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin


def test_cpu_move_falls_back_to_first_legal_action_and_records_move(tmp_path, monkeypatch):
    module = load_app(tmp_path, monkeypatch)
    client = TestClient(module.app)
    match_id = client.post("/matches", json={"human_player": "red", "cpu_player": "blue"}).json()["match_id"]
    legal_actions = [
        {"type": "place", "to": "upper-1-1"},
        {"type": "place", "to": "upper-1-2"},
    ]

    response = client.post(
        "/cpu/move",
        json={
            "match_id": match_id,
            "game_state": {"turnNumber": 1, "board": {}, "currentPlayer": "blue"},
            "legal_actions": legal_actions,
            "cpu_player": "blue",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["selected_action"] == legal_actions[0]
    assert body["fallback"] is True

    with module.connect() as db:
        rows = db.execute("SELECT actor, action_json FROM moves WHERE match_id = ?", (match_id,)).fetchall()

    assert len(rows) == 1
    assert rows[0]["actor"] == "cpu"
    assert "upper-1-1" in rows[0]["action_json"]


def test_cpu_move_uses_heuristic_immediate_win_without_llm(tmp_path, monkeypatch):
    module = load_app(tmp_path, monkeypatch)

    async def fail_if_called(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for an immediate win")

    monkeypatch.setattr(module, "ask_ollama", fail_if_called)
    client = TestClient(module.app)
    match_id = client.post("/matches", json={"human_player": "red", "cpu_player": "blue"}).json()["match_id"]
    legal_actions = [
        {"type": "place", "to": "upper-1-1"},
        {"type": "place", "to": "upper-2-2"},
    ]

    response = client.post(
        "/cpu/move",
        json={
            "match_id": match_id,
            "game_state": {"turnNumber": 5, "board": {}, "currentPlayer": "blue"},
            "legal_actions": legal_actions,
            "candidate_actions": [
                {
                    "action": legal_actions[0],
                    "next_state": {"winner": "blue", "board": {"upper-1-1": "blue"}},
                },
                {
                    "action": legal_actions[1],
                    "next_state": {"winner": None, "board": {"upper-2-2": "blue"}},
                },
            ],
            "cpu_player": "blue",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["selected_action"] == legal_actions[0]
    assert body["source"] == "heuristic"
    assert body["cache_hit"] is False
    assert "immediate winning" in body["reason"]

    with module.connect() as db:
        row = db.execute(
            "SELECT candidate_evaluations_json, game_state_after_json, source FROM moves WHERE match_id = ?",
            (match_id,),
        ).fetchone()

    assert row["source"] == "heuristic"
    assert "immediate_win" in row["candidate_evaluations_json"]
    assert '"winner":"blue"' in row["game_state_after_json"]


def test_cpu_move_falls_back_when_ml_model_is_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("SIMPEI_CPU_POLICY", "ml")
    monkeypatch.setenv("SIMPEI_POLICY_MODEL_PATH", str(tmp_path / "missing.pt"))
    module = load_app(tmp_path, monkeypatch)
    client = TestClient(module.app)
    legal_actions = [{"type": "place", "to": "upper-1-1"}]

    response = client.post(
        "/cpu/move",
        json={
            "game_state": {"turnNumber": 1, "board": {}, "currentPlayer": "blue"},
            "legal_actions": legal_actions,
            "candidate_actions": [
                {
                    "action": legal_actions[0],
                    "next_state": {"winner": None, "board": {"upper-1-1": "blue"}},
                }
            ],
            "cpu_player": "blue",
        },
    )

    assert response.status_code == 200
    assert response.json()["selected_action"] == legal_actions[0]
    assert response.json()["source"] == "heuristic"


def test_place_action_matching_includes_piece_id(tmp_path, monkeypatch):
    module = load_app(tmp_path, monkeypatch)

    assert module.is_legal_action(
        {"type": "place", "pieceId": "red-BIG", "to": "upper-1-1"},
        [{"type": "place", "pieceId": "red-SMALL_1", "to": "upper-1-1"}],
    ) is False
    assert module.is_legal_action(
        {"type": "forceMove", "from": "upper-1-1", "to": "lower-0-0"},
        [{"type": "forceMove", "pieceId": "red-BIG", "from": "upper-1-1", "to": "lower-0-0"}],
    ) is True


def test_cpu_move_avoids_allowing_opponent_immediate_fork(tmp_path, monkeypatch):
    module = load_app(tmp_path, monkeypatch)

    async def fail_if_called(*_args, **_kwargs):
        raise AssertionError("LLM should not be called when tactical safety is decisive")

    monkeypatch.setattr(module, "ask_ollama", fail_if_called)
    client = TestClient(module.app)
    match_id = client.post("/matches", json={"human_player": "none", "cpu_player": "both"}).json()["match_id"]

    board = {position_id: None for position_id in module.POSITIONS}
    board.update({
        "upper-1-1": "red",
        "upper-2-1": "red",
        "upper-1-2": "blue",
    })
    safe_board = {**board, "upper-1-0": "blue"}
    dangerous_board = {**board, "upper-2-2": "blue"}
    legal_actions = [
        {"type": "place", "to": "upper-2-2"},
        {"type": "place", "to": "upper-1-0"},
    ]

    response = client.post(
        "/cpu/move",
        json={
            "match_id": match_id,
            "game_state": {
                "turnNumber": 4,
                "currentPlayer": "blue",
                "phase": "placement",
                "placedCount": {"red": 2, "blue": 1},
                "pendingForcedMove": None,
                "winner": None,
                "board": board,
            },
            "legal_actions": legal_actions,
            "candidate_actions": [
                {
                    "action": legal_actions[0],
                    "next_state": {
                        "turnNumber": 5,
                        "currentPlayer": "red",
                        "phase": "placement",
                        "placedCount": {"red": 2, "blue": 2},
                        "pendingForcedMove": None,
                        "winner": None,
                        "board": dangerous_board,
                    },
                },
                {
                    "action": legal_actions[1],
                    "next_state": {
                        "turnNumber": 4,
                        "currentPlayer": "blue",
                        "phase": "placement",
                        "placedCount": {"red": 2, "blue": 2},
                        "pendingForcedMove": {
                            "player": "blue",
                            "pieces": [{"from": "upper-1-1", "player": "red"}],
                        },
                        "winner": None,
                        "board": safe_board,
                    },
                },
            ],
            "cpu_player": "blue",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["selected_action"] == legal_actions[1]
    assert body["source"] == "heuristic"
    assert "avoids immediate opponent wins" in body["reason"]

    with module.connect() as db:
        row = db.execute(
            "SELECT candidate_evaluations_json FROM moves WHERE match_id = ?",
            (match_id,),
        ).fetchone()

    assert '"opponent_fork":true' in row["candidate_evaluations_json"]
    assert '"blocked_opponent_immediate_win":true' in row["candidate_evaluations_json"]


def test_cpu_move_accepts_candidate_with_null_pending_forced_move(tmp_path, monkeypatch):
    module = load_app(tmp_path, monkeypatch)
    client = TestClient(module.app)
    legal_actions = [{"type": "place", "to": "upper-1-1"}]

    response = client.post(
        "/cpu/move",
        json={
            "game_state": {"turnNumber": 1, "board": {}, "currentPlayer": "blue"},
            "legal_actions": legal_actions,
            "candidate_actions": [
                {
                    "action": legal_actions[0],
                    "next_state": {
                        "winner": None,
                        "pendingForcedMove": None,
                        "board": {"upper-1-1": "blue"},
                    },
                }
            ],
            "cpu_player": "blue",
        },
    )

    assert response.status_code == 200
    assert response.json()["selected_action"] == legal_actions[0]


def test_cpu_move_reuses_cached_decision(tmp_path, monkeypatch):
    module = load_app(tmp_path, monkeypatch)
    client = TestClient(module.app)
    payload = {
        "game_state": {"turnNumber": 5, "board": {}, "currentPlayer": "blue"},
        "legal_actions": [{"type": "place", "to": "upper-1-1"}],
        "candidate_actions": [
            {
                "action": {"type": "place", "to": "upper-1-1"},
                "next_state": {"winner": "blue", "board": {"upper-1-1": "blue"}},
            }
        ],
        "cpu_player": "blue",
    }

    first = client.post("/cpu/move", json=payload)
    second = client.post("/cpu/move", json=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["cache_hit"] is False
    assert second.json()["cache_hit"] is True
    assert second.json()["source"] == "cache"


def test_losing_cached_move_is_invalidated_and_penalized(tmp_path, monkeypatch):
    module = load_app(tmp_path, monkeypatch)
    client = TestClient(module.app)
    match_id = client.post("/matches", json={"human_player": "red", "cpu_player": "blue"}).json()["match_id"]
    legal_actions = [
        {"type": "place", "to": "upper-1-1"},
        {"type": "place", "to": "upper-1-2"},
    ]
    payload = {
        "match_id": match_id,
        "game_state": {"turnNumber": 1, "board": {}, "currentPlayer": "blue"},
        "legal_actions": legal_actions,
        "candidate_actions": [
            {
                "action": legal_actions[0],
                "next_state": {"winner": None, "pendingForcedMove": None, "board": {"upper-1-1": "blue"}},
            },
            {
                "action": legal_actions[1],
                "next_state": {"winner": None, "pendingForcedMove": None, "board": {"upper-1-2": "blue"}},
            },
        ],
        "cpu_player": "blue",
    }

    first = client.post("/cpu/move", json=payload)
    result = client.patch(
        f"/matches/{match_id}/result",
        json={"winner": "red", "reason": "winner", "final_state": {"winner": "red"}},
    )
    second_payload = {**payload, "match_id": None}
    second = client.post("/cpu/move", json=second_payload)

    assert first.status_code == 200
    assert result.status_code == 200
    assert second.status_code == 200
    assert first.json()["selected_action"] == legal_actions[0]
    assert second.json()["cache_hit"] is False
    assert second.json()["selected_action"] == legal_actions[1]

    with module.connect() as db:
        feedback = db.execute("SELECT losses FROM move_feedback").fetchone()
        cache_count = db.execute("SELECT COUNT(*) AS count FROM move_cache").fetchone()

    assert feedback["losses"] == 1
    assert cache_count["count"] == 1


def test_draw_cached_move_is_invalidated_and_penalized(tmp_path, monkeypatch):
    module = load_app(tmp_path, monkeypatch)
    client = TestClient(module.app)
    match_id = client.post("/matches", json={"human_player": "none", "cpu_player": "both"}).json()["match_id"]
    legal_actions = [
        {"type": "place", "to": "upper-1-1"},
        {"type": "place", "to": "upper-1-2"},
    ]
    payload = {
        "match_id": match_id,
        "game_state": {"turnNumber": 1, "board": {}, "currentPlayer": "red"},
        "legal_actions": legal_actions,
        "candidate_actions": [
            {
                "action": legal_actions[0],
                "next_state": {"winner": None, "pendingForcedMove": None, "board": {"upper-1-1": "red"}},
            },
            {
                "action": legal_actions[1],
                "next_state": {"winner": None, "pendingForcedMove": None, "board": {"upper-1-2": "red"}},
            },
        ],
        "cpu_player": "red",
    }

    first = client.post("/cpu/move", json=payload)
    result = client.patch(
        f"/matches/{match_id}/result",
        json={"winner": None, "reason": "draw:repetition", "final_state": {"drawReason": "repetition"}},
    )
    second_payload = {**payload, "match_id": None}
    second = client.post("/cpu/move", json=second_payload)

    assert first.status_code == 200
    assert result.status_code == 200
    assert second.status_code == 200
    assert first.json()["selected_action"] == legal_actions[0]
    assert second.json()["cache_hit"] is False
    assert second.json()["selected_action"] == legal_actions[1]

    with module.connect() as db:
        feedback = db.execute("SELECT draws FROM move_feedback").fetchone()
        cache_count = db.execute("SELECT COUNT(*) AS count FROM move_cache").fetchone()

    assert feedback["draws"] == 1
    assert cache_count["count"] == 1


def test_records_human_move_and_result(tmp_path, monkeypatch):
    module = load_app(tmp_path, monkeypatch)
    client = TestClient(module.app)
    match_id = client.post("/matches", json={"human_player": "red", "cpu_player": "blue"}).json()["match_id"]

    move_response = client.post(
        f"/matches/{match_id}/moves",
        json={
            "actor": "human",
            "player": "red",
            "turn_number": 1,
            "action": {"type": "place", "to": "upper-1-1"},
            "game_state_before": {"turnNumber": 1},
            "game_state_after": {"turnNumber": 2},
            "legal_actions": [{"type": "place", "to": "upper-1-1"}],
        },
    )
    cpu_response = client.post(
        f"/matches/{match_id}/moves",
        json={
            "actor": "cpu",
            "player": "blue",
            "turn_number": 2,
            "action": {"type": "place", "to": "upper-1-2"},
            "game_state_before": {"turnNumber": 2},
            "game_state_after": {"turnNumber": 3},
            "legal_actions": [{"type": "place", "to": "upper-1-2"}],
        },
    )
    result_response = client.patch(
        f"/matches/{match_id}/result",
        json={"winner": "red", "reason": "winner", "final_state": {"winner": "red"}},
    )

    assert move_response.status_code == 200
    assert cpu_response.status_code == 200
    assert result_response.status_code == 200

    with module.connect() as db:
        match = db.execute("SELECT winner, result_reason FROM matches WHERE id = ?", (match_id,)).fetchone()
        move_count = db.execute("SELECT COUNT(*) AS count FROM moves WHERE match_id = ?", (match_id,)).fetchone()
        cpu_move = db.execute("SELECT outcome FROM moves WHERE match_id = ? AND actor = 'cpu'", (match_id,)).fetchone()

    assert match["winner"] == "red"
    assert match["result_reason"] == "winner"
    assert move_count["count"] == 2
    assert cpu_move["outcome"] == "loss"


def test_records_color_specific_outcomes_for_auto_learning_match(tmp_path, monkeypatch):
    module = load_app(tmp_path, monkeypatch)
    client = TestClient(module.app)
    match_id = client.post("/matches", json={"human_player": "none", "cpu_player": "both"}).json()["match_id"]

    for player, turn_number, to in [("red", 1, "upper-1-1"), ("blue", 2, "upper-1-2")]:
        response = client.post(
            f"/matches/{match_id}/moves",
            json={
                "actor": "cpu",
                "player": player,
                "turn_number": turn_number,
                "action": {"type": "place", "to": to},
                "game_state_before": {"turnNumber": turn_number},
                "game_state_after": {"turnNumber": turn_number + 1},
                "legal_actions": [{"type": "place", "to": to}],
            },
        )
        assert response.status_code == 200

    result_response = client.patch(
        f"/matches/{match_id}/result",
        json={"winner": "red", "reason": "winner", "final_state": {"winner": "red"}},
    )

    assert result_response.status_code == 200

    with module.connect() as db:
        rows = db.execute(
            "SELECT player, outcome FROM moves WHERE match_id = ? AND actor = 'cpu' ORDER BY turn_number",
            (match_id,),
        ).fetchall()

    assert [(row["player"], row["outcome"]) for row in rows] == [("red", "win"), ("blue", "loss")]


def test_exports_completed_cpu_moves_for_ml_training(tmp_path, monkeypatch):
    module = load_app(tmp_path, monkeypatch)
    from server.ml.export_dataset import export_dataset

    client = TestClient(module.app)
    match_id = client.post("/matches", json={"human_player": "none", "cpu_player": "both"}).json()["match_id"]
    legal_actions = [{"type": "place", "pieceId": "red-BIG", "to": "upper-1-1"}]
    move_response = client.post(
        "/cpu/move",
        json={
            "match_id": match_id,
            "game_state": {"turnNumber": 1, "board": {}, "currentPlayer": "red"},
            "legal_actions": legal_actions,
            "candidate_actions": [
                {
                    "action": legal_actions[0],
                    "next_state": {"winner": "red", "board": {"upper-1-1": "red"}},
                }
            ],
            "cpu_player": "red",
        },
    )
    result_response = client.patch(
        f"/matches/{match_id}/result",
        json={"winner": "red", "reason": "winner", "final_state": {"winner": "red"}},
    )

    assert move_response.status_code == 200
    assert result_response.status_code == 200

    output_path = tmp_path / "policy_value.jsonl"
    count = export_dataset(module.DATABASE_PATH, output_path)
    sample = json.loads(output_path.read_text(encoding="utf-8"))

    assert count == 1
    assert sample["value"] == 1.0
    assert sample["chosen_index"] == 0
    assert sample["selected_action"] == legal_actions[0]
    assert sample["state_features"]
    assert sample["action_features"]
