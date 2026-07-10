from __future__ import annotations

import json
import os
import sqlite3
import time
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
    cpu_player: str = "blue"
    difficulty: str = "normal"
    move_history: list[dict[str, Any]] = Field(default_factory=list)


class CpuMoveResponse(BaseModel):
    selected_action: dict[str, Any]
    reason: str
    model: str
    latency_ms: int
    fallback: bool = False


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
    selected_action = request.legal_actions[0]
    reason = "Fallback: selected the first legal action."
    fallback = True

    try:
        llm_action, llm_reason = await ask_ollama(request)
        if is_legal_action(llm_action, request.legal_actions):
            selected_action = llm_action
            reason = llm_reason or "Selected by local LLM."
            fallback = False
        else:
            reason = "Fallback: local LLM returned an illegal action."
    except Exception as exc:
        reason = f"Fallback: local LLM request failed ({type(exc).__name__})."

    latency_ms = round((time.perf_counter() - started_at) * 1000)
    response = CpuMoveResponse(
        selected_action=selected_action,
        reason=reason,
        model=OLLAMA_MODEL,
        latency_ms=latency_ms,
        fallback=fallback,
    )

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
        )

    return response


@app.patch("/matches/{match_id}/result")
def record_result(match_id: str, request: ResultRequest) -> dict[str, str]:
    ensure_match(match_id)
    with connect() as db:
        db.execute(
            """
            UPDATE matches
            SET ended_at = datetime('now'), winner = ?, result_reason = ?, final_state_json = ?
            WHERE id = ?
            """,
            (request.winner, request.reason, dumps(request.final_state), match_id),
        )
    return {"status": "recorded"}


async def ask_ollama(request: CpuMoveRequest) -> tuple[dict[str, Any], str]:
    prompt = build_prompt(request)
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "format": "json",
            },
        )
        response.raise_for_status()

    payload = response.json()
    content = json.loads(payload.get("response", "{}"))
    return content.get("selected_action") or {}, content.get("reason") or ""


def build_prompt(request: CpuMoveRequest) -> str:
    return "\n".join(
        [
            "You are choosing a move for the board game Simpei.",
            "Return JSON only with keys selected_action and reason.",
            "selected_action must exactly equal one object from legal_actions.",
            f"difficulty: {request.difficulty}",
            f"cpu_player: {request.cpu_player}",
            f"game_state: {dumps(request.game_state)}",
            f"legal_actions: {dumps(request.legal_actions)}",
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
              latency_ms INTEGER
            );
            """
        )


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
) -> None:
    with connect() as db:
        db.execute(
            """
            INSERT INTO moves (
              match_id, actor, player, turn_number, action_json, legal_actions_json,
              game_state_json, game_state_after_json, reason, model, latency_ms
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            ),
        )


def is_legal_action(action: dict[str, Any], legal_actions: list[dict[str, Any]]) -> bool:
    return any(action_key(action) == action_key(legal_action) for legal_action in legal_actions)


def action_key(action: dict[str, Any]) -> tuple[str | None, str | None, str | None]:
    return action.get("type"), action.get("from"), action.get("to")


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
