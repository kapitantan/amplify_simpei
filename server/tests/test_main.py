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
    result_response = client.patch(
        f"/matches/{match_id}/result",
        json={"winner": "red", "reason": "winner", "final_state": {"winner": "red"}},
    )

    assert move_response.status_code == 200
    assert result_response.status_code == 200

    with module.connect() as db:
        match = db.execute("SELECT winner, result_reason FROM matches WHERE id = ?", (match_id,)).fetchone()
        move_count = db.execute("SELECT COUNT(*) AS count FROM moves WHERE match_id = ?", (match_id,)).fetchone()

    assert match["winner"] == "red"
    assert match["result_reason"] == "winner"
    assert move_count["count"] == 1
