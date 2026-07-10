const CPU_API_BASE = import.meta.env.VITE_CPU_API_BASE ?? "http://localhost:8000";

async function request(path, options = {}) {
  const response = await fetch(`${CPU_API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`CPU API request failed: ${response.status}`);
  }

  return response.json();
}

export function createCpuMatch({ humanPlayer, cpuPlayer, difficulty }) {
  return request("/matches", {
    method: "POST",
    body: JSON.stringify({
      human_player: humanPlayer,
      cpu_player: cpuPlayer,
      difficulty,
    }),
  });
}

export function requestCpuMove({ matchId, gameState, legalActions, candidateActions, cpuPlayer, difficulty, moveHistory }) {
  return request("/cpu/move", {
    method: "POST",
    body: JSON.stringify({
      match_id: matchId,
      game_state: gameState,
      legal_actions: legalActions,
      candidate_actions: candidateActions,
      cpu_player: cpuPlayer,
      difficulty,
      move_history: moveHistory,
    }),
  });
}

export function recordHumanMove({ matchId, player, turnNumber, action, gameStateBefore, gameStateAfter, legalActions }) {
  return request(`/matches/${matchId}/moves`, {
    method: "POST",
    body: JSON.stringify({
      actor: "human",
      player,
      turn_number: turnNumber,
      action,
      game_state_before: gameStateBefore,
      game_state_after: gameStateAfter,
      legal_actions: legalActions,
    }),
  });
}

export function recordMatchResult({ matchId, winner, finalState, reason = "winner" }) {
  return request(`/matches/${matchId}/result`, {
    method: "PATCH",
    body: JSON.stringify({
      winner,
      reason,
      final_state: finalState,
    }),
  });
}
