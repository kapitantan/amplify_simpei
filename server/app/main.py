from __future__ import annotations

import json
import os
import sqlite3
import time
from hashlib import sha256
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


DATABASE_PATH = Path(os.getenv("SIMPEI_DATABASE_PATH", "server/data/simpei_cpu.sqlite3"))
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gpt-oss:120b")
ALLOWED_ORIGINS_VALUE = os.getenv("SIMPEI_ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = [origin.strip() for origin in ALLOWED_ORIGINS_VALUE.split(",") if origin.strip()]
ALLOW_ALL_ORIGINS = ALLOWED_ORIGINS_VALUE.strip() == "*"
ALLOWED_ORIGIN_REGEX = os.getenv(
    "SIMPEI_ALLOWED_ORIGIN_REGEX",
    r"^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|"
    r"192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|"
    r"100\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$",
)
LLM_TOP_CANDIDATES = int(os.getenv("SIMPEI_LLM_TOP_CANDIDATES", "5"))
HEURISTIC_MARGIN = int(os.getenv("SIMPEI_HEURISTIC_MARGIN", "80"))

PLAYERS = {"red", "blue"}
ACTION_PLACE = "place"
ACTION_MOVE = "move"
ACTION_FORCE_MOVE = "forceMove"
ACTION_PASS = "pass"
WORLDS = {"upper": 4, "lower": 3}
DIRECTIONS = [(0, 1), (1, 0), (1, 1), (1, -1)]
CENTER_POINTS = {
    "upper-1-1",
    "upper-1-2",
    "upper-2-1",
    "upper-2-2",
    "lower-1-1",
}

MOVE_CACHE: dict[str, dict[str, Any]] = {}


class MatchCreateRequest(BaseModel):
    human_player: str = "red"
    cpu_player: str = "blue"
    difficulty: str = "normal"
    model: str | None = None


class MatchCreateResponse(BaseModel):
    match_id: str


class MoveRecordRequest(BaseModel):
    actor: str = "human"
    player: str
    turn_number: int = Field(ge=1)
    action: dict[str, Any]
    game_state_before: dict[str, Any]
    game_state_after: dict[str, Any] | None = None
    legal_actions: list[dict[str, Any]] = Field(default_factory=list)
    reason: str | None = None
    model: str | None = None
    latency_ms: int | None = None


class CpuMoveRequest(BaseModel):
    match_id: str | None = None
    game_state: dict[str, Any]
    legal_actions: list[dict[str, Any]]
    candidate_actions: list["CandidateAction"] = Field(default_factory=list)
    cpu_player: str = "blue"
    difficulty: str = "normal"
    move_history: list[dict[str, Any]] = Field(default_factory=list)


class CandidateAction(BaseModel):
    action: dict[str, Any]
    next_state: dict[str, Any]


class CpuMoveResponse(BaseModel):
    selected_action: dict[str, Any]
    reason: str
    model: str
    latency_ms: int
    fallback: bool = False
    source: str = "llm"
    cache_hit: bool = False


class ResultRequest(BaseModel):
    winner: str | None = None
    reason: str = "finished"
    final_state: dict[str, Any]


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_database()
    yield


app = FastAPI(title="Simpei CPU Server", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if ALLOW_ALL_ORIGINS else ALLOWED_ORIGINS,
    allow_origin_regex=None if ALLOW_ALL_ORIGINS else ALLOWED_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, Any]:
    ollama_ok = False
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            ollama_ok = response.status_code < 500
    except httpx.HTTPError:
        ollama_ok = False

    return {
        "ok": True,
        "ollama_ok": ollama_ok,
        "model": OLLAMA_MODEL,
        "database_path": str(DATABASE_PATH),
    }


@app.post("/matches", response_model=MatchCreateResponse)
def create_match(request: MatchCreateRequest) -> MatchCreateResponse:
    match_id = str(uuid4())
    with connect() as db:
        db.execute(
            """
            INSERT INTO matches (id, human_player, cpu_player, difficulty, model)
            VALUES (?, ?, ?, ?, ?)
            """,
            (match_id, request.human_player, request.cpu_player, request.difficulty, request.model or OLLAMA_MODEL),
        )
    return MatchCreateResponse(match_id=match_id)


@app.post("/matches/{match_id}/moves")
def record_move(match_id: str, request: MoveRecordRequest) -> dict[str, str]:
    ensure_match(match_id)
    insert_move(
        match_id=match_id,
        actor=request.actor,
        player=request.player,
        turn_number=request.turn_number,
        action=request.action,
        legal_actions=request.legal_actions,
        game_state=request.game_state_before,
        game_state_after=request.game_state_after,
        reason=request.reason,
        model=request.model,
        latency_ms=request.latency_ms,
    )
    return {"status": "recorded"}


@app.post("/cpu/move", response_model=CpuMoveResponse)
async def cpu_move(request: CpuMoveRequest) -> CpuMoveResponse:
    if not request.legal_actions:
        raise HTTPException(status_code=400, detail="legal_actions must not be empty")

    started_at = time.perf_counter()
    candidate_evaluations = evaluate_candidates(request)
    ranked_actions = [evaluation["action"] for evaluation in candidate_evaluations] or request.legal_actions
    selected_action = ranked_actions[0]
    reason = "Heuristic fallback: selected the highest-scored legal action."
    fallback = True
    source = "heuristic"
    cache_hit = False
    cache_key = build_cache_key(request)

    cached_action = MOVE_CACHE.get(cache_key) or load_cached_action(cache_key)
    if cached_action and is_legal_action(cached_action["selected_action"], request.legal_actions):
        selected_action = cached_action["selected_action"]
        reason = cached_action["reason"]
        fallback = bool(cached_action["fallback"])
        source = "cache"
        cache_hit = True
    else:
        top_score = candidate_evaluations[0]["score"] if candidate_evaluations else 0
        second_score = candidate_evaluations[1]["score"] if len(candidate_evaluations) > 1 else None
        should_skip_llm = top_score >= 9000 or second_score is None or top_score - second_score >= HEURISTIC_MARGIN

        if not should_skip_llm:
            llm_candidates = ranked_actions[:LLM_TOP_CANDIDATES]
            try:
                llm_action, llm_reason = await ask_ollama(request, llm_candidates)
                if is_legal_action(llm_action, llm_candidates):
                    selected_action = llm_action
                    reason = llm_reason or "Selected by local LLM from top heuristic candidates."
                    fallback = False
                    source = "llm"
                else:
                    reason = "Heuristic fallback: local LLM returned an illegal action."
            except Exception as exc:
                reason = f"Heuristic fallback: local LLM request failed ({type(exc).__name__})."
        else:
            reason = build_heuristic_reason(candidate_evaluations[0] if candidate_evaluations else None)
            fallback = False

    latency_ms = round((time.perf_counter() - started_at) * 1000)
    response = CpuMoveResponse(
        selected_action=selected_action,
        reason=reason,
        model=OLLAMA_MODEL,
        latency_ms=latency_ms,
        fallback=fallback,
        source=source,
        cache_hit=cache_hit,
    )
    if not cache_hit:
        save_cached_action(cache_key, response)

    if request.match_id:
        ensure_match(request.match_id)
        insert_move(
            match_id=request.match_id,
            actor="cpu",
            player=request.cpu_player,
            turn_number=int(request.game_state.get("turnNumber", 0) or 0),
            action=response.selected_action,
            legal_actions=request.legal_actions,
            game_state=request.game_state,
            reason=response.reason,
            model=response.model,
            latency_ms=response.latency_ms,
            candidate_evaluations=candidate_evaluations,
            source=response.source,
            cache_key=cache_key,
        )

    return response


@app.patch("/matches/{match_id}/result")
def record_result(match_id: str, request: ResultRequest) -> dict[str, str]:
    ensure_match(match_id)
    with connect() as db:
        match = db.execute("SELECT cpu_player FROM matches WHERE id = ?", (match_id,)).fetchone()
        cpu_outcome = get_cpu_outcome(request.winner, match["cpu_player"] if match else None)
        db.execute(
            """
            UPDATE matches
            SET ended_at = datetime('now'), winner = ?, result_reason = ?, final_state_json = ?
            WHERE id = ?
            """,
            (request.winner, request.reason, dumps(request.final_state), match_id),
        )
        db.execute(
            "UPDATE moves SET outcome = ? WHERE match_id = ? AND actor = 'cpu'",
            (cpu_outcome, match_id),
        )
    return {"status": "recorded"}


async def ask_ollama(request: CpuMoveRequest, legal_actions: list[dict[str, Any]]) -> tuple[dict[str, Any], str]:
    prompt = build_prompt(request, legal_actions)
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "format": "json",
                "keep_alive": "10m",
                "options": {
                    "num_predict": 96,
                    "temperature": 0.1,
                },
            },
        )
        response.raise_for_status()

    payload = response.json()
    content = json.loads(payload.get("response", "{}"))
    return content.get("selected_action") or {}, content.get("reason") or ""


def build_prompt(request: CpuMoveRequest, legal_actions: list[dict[str, Any]]) -> str:
    return "\n".join(
        [
            "You are choosing a move for the board game Simpei.",
            "Return JSON only with keys selected_action and reason.",
            "selected_action must exactly equal one object from legal_actions.",
            "Prefer immediate wins and avoid moves that create obvious threats for the opponent.",
            f"difficulty: {request.difficulty}",
            f"cpu_player: {request.cpu_player}",
            f"game_state: {dumps(request.game_state)}",
            f"legal_actions: {dumps(legal_actions)}",
            f"recent_move_history: {dumps(request.move_history[-12:])}",
        ]
    )


def init_database() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS matches (
              id TEXT PRIMARY KEY,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              ended_at TEXT,
              human_player TEXT NOT NULL,
              cpu_player TEXT NOT NULL,
              difficulty TEXT NOT NULL,
              model TEXT NOT NULL,
              winner TEXT,
              result_reason TEXT,
              final_state_json TEXT
            );

            CREATE TABLE IF NOT EXISTS moves (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              match_id TEXT NOT NULL REFERENCES matches(id),
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              actor TEXT NOT NULL,
              player TEXT NOT NULL,
              turn_number INTEGER NOT NULL,
              action_json TEXT NOT NULL,
              legal_actions_json TEXT NOT NULL,
              game_state_json TEXT NOT NULL,
              game_state_after_json TEXT,
              reason TEXT,
              model TEXT,
              latency_ms INTEGER,
              candidate_evaluations_json TEXT,
              source TEXT,
              cache_key TEXT,
              outcome TEXT
            );

            CREATE TABLE IF NOT EXISTS move_cache (
              cache_key TEXT PRIMARY KEY,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              model TEXT NOT NULL,
              selected_action_json TEXT NOT NULL,
              reason TEXT NOT NULL,
              fallback INTEGER NOT NULL,
              source TEXT NOT NULL
            );
            """
        )
        ensure_column(db, "moves", "candidate_evaluations_json", "TEXT")
        ensure_column(db, "moves", "source", "TEXT")
        ensure_column(db, "moves", "cache_key", "TEXT")
        ensure_column(db, "moves", "outcome", "TEXT")


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def ensure_match(match_id: str) -> None:
    with connect() as db:
        row = db.execute("SELECT id FROM matches WHERE id = ?", (match_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="match not found")


def insert_move(
    *,
    match_id: str,
    actor: str,
    player: str,
    turn_number: int,
    action: dict[str, Any],
    legal_actions: list[dict[str, Any]],
    game_state: dict[str, Any],
    game_state_after: dict[str, Any] | None = None,
    reason: str | None = None,
    model: str | None = None,
    latency_ms: int | None = None,
    candidate_evaluations: list[dict[str, Any]] | None = None,
    source: str | None = None,
    cache_key: str | None = None,
) -> None:
    with connect() as db:
        db.execute(
            """
            INSERT INTO moves (
              match_id, actor, player, turn_number, action_json, legal_actions_json,
              game_state_json, game_state_after_json, reason, model, latency_ms,
              candidate_evaluations_json, source, cache_key
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                match_id,
                actor,
                player,
                turn_number,
                dumps(action),
                dumps(legal_actions),
                dumps(game_state),
                dumps(game_state_after) if game_state_after is not None else None,
                reason,
                model,
                latency_ms,
                dumps(candidate_evaluations) if candidate_evaluations is not None else None,
                source,
                cache_key,
            ),
        )


def is_legal_action(action: dict[str, Any], legal_actions: list[dict[str, Any]]) -> bool:
    return any(action_key(action) == action_key(legal_action) for legal_action in legal_actions)


def action_key(action: dict[str, Any]) -> tuple[str | None, str | None, str | None]:
    return action.get("type"), action.get("from"), action.get("to")


def evaluate_candidates(request: CpuMoveRequest) -> list[dict[str, Any]]:
    candidates = request.candidate_actions or [
        CandidateAction(action=action, next_state={})
        for action in request.legal_actions
    ]
    opponent = get_opponent(request.cpu_player)
    evaluations = []

    for index, candidate in enumerate(candidates):
        next_state = candidate.next_state or {}
        score, features = evaluate_state_after_action(
            action=candidate.action,
            next_state=next_state,
            cpu_player=request.cpu_player,
            opponent=opponent,
        )
        evaluations.append({
            "action": candidate.action,
            "score": score,
            "features": features,
            "index": index,
        })

    evaluations.sort(key=lambda item: item["score"], reverse=True)
    return evaluations


def evaluate_state_after_action(
    *,
    action: dict[str, Any],
    next_state: dict[str, Any],
    cpu_player: str,
    opponent: str,
) -> tuple[int, dict[str, Any]]:
    board = next_state.get("board") or {}
    features: dict[str, Any] = {}
    score = 0

    winner = next_state.get("winner")
    if winner == cpu_player:
        features["immediate_win"] = True
        score += 10000
    elif winner == opponent:
        features["opponent_win"] = True
        score -= 10000

    cpu_threats = count_open_two_lines(board, cpu_player)
    opponent_threats = count_open_two_lines(board, opponent)
    cpu_lines = count_single_lines(board, cpu_player)
    opponent_lines = count_single_lines(board, opponent)
    center_control = count_center_control(board, cpu_player) - count_center_control(board, opponent)
    mobility_hint = estimate_mobility(board, cpu_player) - estimate_mobility(board, opponent)

    score += cpu_threats * 85
    score -= opponent_threats * 95
    score += cpu_lines * 8
    score -= opponent_lines * 9
    score += center_control * 12
    score += mobility_hint * 2

    if action.get("type") == ACTION_FORCE_MOVE:
        score += 30
    elif action.get("type") == ACTION_MOVE:
        score += 4
    elif action.get("type") == ACTION_PASS:
        score -= 40

    if next_state.get("pendingForcedMove", {}).get("player") == cpu_player:
        pending_count = len(next_state.get("pendingForcedMove", {}).get("pieces", []))
        score += 45 + pending_count * 25
        features["created_forced_move"] = pending_count

    features.update({
        "cpu_open_twos": cpu_threats,
        "opponent_open_twos": opponent_threats,
        "cpu_single_lines": cpu_lines,
        "opponent_single_lines": opponent_lines,
        "center_control_delta": center_control,
        "mobility_delta": mobility_hint,
    })
    return score, features


def count_open_two_lines(board: dict[str, Any], player: str) -> int:
    count = 0
    for line in winning_lines():
        values = [board.get(position_id) for position_id in line]
        if values.count(player) == 2 and values.count(None) == 1:
            count += 1
    return count


def count_single_lines(board: dict[str, Any], player: str) -> int:
    count = 0
    for line in winning_lines():
        values = [board.get(position_id) for position_id in line]
        if values.count(player) == 1 and values.count(None) == 2:
            count += 1
    return count


def winning_lines() -> list[list[str]]:
    lines = []
    for world, size in WORLDS.items():
        for row in range(size):
            for col in range(size):
                for row_delta, col_delta in DIRECTIONS:
                    line = [
                        (row, col),
                        (row + row_delta, col + col_delta),
                        (row + row_delta * 2, col + col_delta * 2),
                    ]
                    if all(0 <= line_row < size and 0 <= line_col < size for line_row, line_col in line):
                        lines.append([f"{world}-{line_row}-{line_col}" for line_row, line_col in line])
    unique = {}
    for line in lines:
        unique["|".join(line)] = line
    return list(unique.values())


def count_center_control(board: dict[str, Any], player: str) -> int:
    return sum(1 for position_id in CENTER_POINTS if board.get(position_id) == player)


def estimate_mobility(board: dict[str, Any], player: str) -> int:
    return sum(1 for position_id, occupant in board.items() if occupant == player and adjacent_empty_count(board, position_id) > 0)


def adjacent_empty_count(board: dict[str, Any], position_id: str) -> int:
    position = parse_position(position_id)
    if not position:
        return 0
    world, row, col = position
    adjacent = []
    if world == "upper":
        adjacent = [
            ("lower", row - 1, col - 1),
            ("lower", row - 1, col),
            ("lower", row, col - 1),
            ("lower", row, col),
        ]
    else:
        adjacent = [
            ("upper", row, col),
            ("upper", row + 1, col),
            ("upper", row, col + 1),
            ("upper", row + 1, col + 1),
        ]
    return sum(
        1
        for adjacent_world, adjacent_row, adjacent_col in adjacent
        if is_inside(adjacent_world, adjacent_row, adjacent_col)
        and board.get(f"{adjacent_world}-{adjacent_row}-{adjacent_col}") is None
    )


def parse_position(position_id: str) -> tuple[str, int, int] | None:
    parts = position_id.split("-")
    if len(parts) != 3 or parts[0] not in WORLDS:
        return None
    try:
        return parts[0], int(parts[1]), int(parts[2])
    except ValueError:
        return None


def is_inside(world: str, row: int, col: int) -> bool:
    size = WORLDS[world]
    return 0 <= row < size and 0 <= col < size


def get_opponent(player: str) -> str:
    return "blue" if player == "red" else "red"


def get_cpu_outcome(winner: str | None, cpu_player: str | None) -> str:
    if not winner:
        return "draw"
    if winner == cpu_player:
        return "win"
    return "loss"


def action_sort_key(action: dict[str, Any]) -> str:
    return ":".join(str(part or "") for part in action_key(action))


def build_heuristic_reason(evaluation: dict[str, Any] | None) -> str:
    if not evaluation:
        return "Heuristic fallback: selected the first legal action."
    features = evaluation["features"]
    if features.get("immediate_win"):
        return "Heuristic: selected an immediate winning move."
    if features.get("created_forced_move"):
        return "Heuristic: selected a move that creates a forced relocation."
    return f"Heuristic: selected the top-scored move ({evaluation['score']})."


def build_cache_key(request: CpuMoveRequest) -> str:
    payload = {
        "model": OLLAMA_MODEL,
        "difficulty": request.difficulty,
        "cpu_player": request.cpu_player,
        "game_state": request.game_state,
        "legal_actions": sorted([action_sort_key(action) for action in request.legal_actions]),
        "candidate_states": [
            {
                "action": candidate.action,
                "next_state": candidate.next_state,
            }
            for candidate in request.candidate_actions
        ],
    }
    return sha256(dumps(payload).encode("utf-8")).hexdigest()


def load_cached_action(cache_key: str) -> dict[str, Any] | None:
    with connect() as db:
        row = db.execute(
            "SELECT selected_action_json, reason, fallback, source FROM move_cache WHERE cache_key = ?",
            (cache_key,),
        ).fetchone()
    if not row:
        return None
    return {
        "selected_action": json.loads(row["selected_action_json"]),
        "reason": row["reason"],
        "fallback": bool(row["fallback"]),
        "source": row["source"],
    }


def save_cached_action(cache_key: str, response: CpuMoveResponse) -> None:
    MOVE_CACHE[cache_key] = {
        "selected_action": response.selected_action,
        "reason": response.reason,
        "fallback": response.fallback,
        "source": response.source,
    }
    with connect() as db:
        db.execute(
            """
            INSERT OR REPLACE INTO move_cache (
              cache_key, model, selected_action_json, reason, fallback, source
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                cache_key,
                response.model,
                dumps(response.selected_action),
                response.reason,
                1 if response.fallback else 0,
                response.source,
            ),
        )


def ensure_column(db: sqlite3.Connection, table: str, column: str, column_type: str) -> None:
    columns = {row["name"] for row in db.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
