import importlib

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
            "SELECT candidate_evaluations_json, source FROM moves WHERE match_id = ?",
            (match_id,),
        ).fetchone()

    assert row["source"] == "heuristic"
    assert "immediate_win" in row["candidate_evaluations_json"]


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
