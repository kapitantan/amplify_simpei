export const PLAYERS = {
  RED: "red",
  BLUE: "blue",
};

export const WORLDS = {
  UPPER: "upper",
  LOWER: "lower",
};

const WORLD_SIZES = {
  [WORLDS.UPPER]: 4,
  [WORLDS.LOWER]: 3,
};

const PIECES_PER_PLAYER = 4;

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export const POSITIONS = Object.values(WORLDS).flatMap((world) => {
  const size = WORLD_SIZES[world];
  return Array.from({ length: size * size }, (_, index) => {
    const row = Math.floor(index / size);
    const col = index % size;
    return {
      id: getPositionId(world, row, col),
      world,
      row,
      col,
    };
  });
});

const POSITION_BY_ID = new Map(POSITIONS.map((position) => [position.id, position]));

export function getPositionId(world, row, col) {
  return `${world}-${row}-${col}`;
}

export function getPosition(id) {
  return POSITION_BY_ID.get(id);
}

export function createInitialGame() {
  return {
    board: Object.fromEntries(POSITIONS.map(({ id }) => [id, null])),
    currentPlayer: PLAYERS.RED,
    turnNumber: 1,
    placedCount: {
      [PLAYERS.RED]: 0,
      [PLAYERS.BLUE]: 0,
    },
    phase: "placement",
    pendingForcedMove: null,
    winner: null,
    message: "赤の1手目です。上の世界の中央4か所に置いてください。",
  };
}

export function getOpponent(player) {
  return player === PLAYERS.RED ? PLAYERS.BLUE : PLAYERS.RED;
}

export function getPlayerLabel(player) {
  return player === PLAYERS.RED ? "赤" : "青";
}

export function getLegalPlacementTargets(state) {
  if (state.phase !== "placement" || state.winner || state.pendingForcedMove) {
    return [];
  }

  return POSITIONS.filter(({ id, world, row, col }) => {
    if (state.board[id]) {
      return false;
    }

    if (state.turnNumber !== 1) {
      return true;
    }

    return world === WORLDS.UPPER && row >= 1 && row <= 2 && col >= 1 && col <= 2;
  }).map(({ id }) => id);
}

export function getAdjacentPositions(id) {
  const position = getPosition(id);
  if (!position) {
    return [];
  }

  if (position.world === WORLDS.UPPER) {
    return [
      [position.row - 1, position.col - 1],
      [position.row - 1, position.col],
      [position.row, position.col - 1],
      [position.row, position.col],
    ]
      .filter(([row, col]) => isInside(WORLDS.LOWER, row, col))
      .map(([row, col]) => getPositionId(WORLDS.LOWER, row, col));
  }

  return [
    [position.row, position.col],
    [position.row + 1, position.col],
    [position.row, position.col + 1],
    [position.row + 1, position.col + 1],
  ].map(([row, col]) => getPositionId(WORLDS.UPPER, row, col));
}

export function getLegalMoveTargets(state, fromId) {
  if (state.phase !== "movement" || state.winner || state.pendingForcedMove) {
    return [];
  }

  if (state.board[fromId] !== state.currentPlayer) {
    return [];
  }

  return getAdjacentPositions(fromId).filter((toId) => !state.board[toId]);
}

export function getMovablePieces(state, player = state.currentPlayer) {
  if (state.phase !== "movement" || state.winner || state.pendingForcedMove) {
    return [];
  }

  return POSITIONS.filter(({ id }) => state.board[id] === player)
    .map(({ id }) => id)
    .filter((id) => getLegalMoveTargets({ ...state, currentPlayer: player }, id).length > 0);
}

export function getForcedMoveTargets(state) {
  const forcedPiece = state.pendingForcedMove?.pieces[0];
  if (!forcedPiece || state.winner) {
    return [];
  }

  return POSITIONS.filter(({ id }) => id !== forcedPiece.from && !state.board[id]).map(({ id }) => id);
}

export function placePiece(state, toId) {
  if (!getLegalPlacementTargets(state).includes(toId)) {
    return withMessage(state, "そこには配置できません。");
  }

  const player = state.currentPlayer;
  const board = {
    ...state.board,
    [toId]: player,
  };

  const nextState = {
    ...state,
    board,
    placedCount: {
      ...state.placedCount,
      [player]: state.placedCount[player] + 1,
    },
  };

  return finishTurnAction(nextState, player, toId);
}

export function movePiece(state, fromId, toId) {
  if (!getLegalMoveTargets(state, fromId).includes(toId)) {
    return withMessage(state, "その移動はできません。");
  }

  const player = state.currentPlayer;
  const board = {
    ...state.board,
    [fromId]: null,
    [toId]: player,
  };

  return finishTurnAction({ ...state, board }, player, toId);
}

export function passTurn(state) {
  if (state.phase !== "movement" || state.winner || state.pendingForcedMove) {
    return withMessage(state, "今はパスできません。");
  }

  if (getMovablePieces(state).length > 0) {
    return withMessage(state, "合法手があるためパスできません。");
  }

  return switchTurn(state, `${getPlayerLabel(state.currentPlayer)}は移動できないためパスしました。`);
}

export function forceMovePiece(state, toId) {
  const forcedPiece = state.pendingForcedMove?.pieces[0];
  if (!forcedPiece) {
    return withMessage(state, "飛ばす駒がありません。");
  }

  if (!getForcedMoveTargets(state).includes(toId)) {
    return withMessage(state, "その場所には飛ばせません。");
  }

  const board = {
    ...state.board,
    [forcedPiece.from]: null,
    [toId]: forcedPiece.player,
  };
  const remainingPieces = state.pendingForcedMove.pieces.slice(1);

  if (remainingPieces.length > 0) {
    return {
      ...state,
      board,
      pendingForcedMove: {
        ...state.pendingForcedMove,
        pieces: remainingPieces,
      },
      message: `${getPlayerLabel(forcedPiece.player)}の挟まれた駒を続けて飛ばしてください。`,
    };
  }

  return switchTurn(
    {
      ...state,
      board,
      pendingForcedMove: null,
    },
    `${getPlayerLabel(forcedPiece.player)}の駒を飛ばしました。`
  );
}

export function hasExactWinningLine(board, player, world) {
  return getWinningLines(world).some(({ ids, extensions }) => {
    return ids.every((id) => board[id] === player) && extensions.every((id) => board[id] !== player);
  });
}

export function findSandwichedPieces(board, player, causedById = null) {
  const opponent = getOpponent(player);
  const sandwiched = new Set();

  for (const { world, row, col, id } of POSITIONS) {
    if (board[id] !== opponent) {
      continue;
    }

    for (const [rowDelta, colDelta] of DIRECTIONS) {
      const before = getPositionId(world, row - rowDelta, col - colDelta);
      const after = getPositionId(world, row + rowDelta, col + colDelta);

      if (causedById && before !== causedById && after !== causedById) {
        continue;
      }

      if (getPosition(before) && getPosition(after) && board[before] === player && board[after] === player) {
        sandwiched.add(id);
      }
    }
  }

  return [...sandwiched].map((from) => ({
    from,
    player: opponent,
  }));
}

function finishTurnAction(state, player, actionPositionId) {
  const winner = Object.values(WORLDS).some((world) => (
    hasExactWinningLineContaining(state.board, player, world, actionPositionId)
  ))
    ? player
    : null;

  if (winner) {
    return {
      ...state,
      winner,
      message: `${getPlayerLabel(winner)}の勝ちです。`,
    };
  }

  const sandwichedPieces = findSandwichedPieces(state.board, player, actionPositionId);
  if (sandwichedPieces.length > 0) {
    return {
      ...state,
      pendingForcedMove: {
        player,
        pieces: sandwichedPieces,
      },
      message: `${getPlayerLabel(player)}が${sandwichedPieces.length}個の駒を挟みました。飛ばす先を選んでください。`,
    };
  }

  return switchTurn(state);
}

function hasExactWinningLineContaining(board, player, world, positionId) {
  return getWinningLines(world).some(({ ids, extensions }) => {
    return ids.includes(positionId)
      && ids.every((id) => board[id] === player)
      && extensions.every((id) => board[id] !== player);
  });
}

function switchTurn(state, completedActionMessage = "") {
  const turnNumber = state.turnNumber + 1;
  const phase = state.placedCount[PLAYERS.RED] + state.placedCount[PLAYERS.BLUE] >= PIECES_PER_PLAYER * 2
    ? "movement"
    : "placement";
  const currentPlayer = getOpponent(state.currentPlayer);

  return {
    ...state,
    currentPlayer,
    turnNumber,
    phase,
    message: [
      completedActionMessage,
      `${getPlayerLabel(currentPlayer)}の${turnNumber}手目です。`,
    ].filter(Boolean).join(" "),
  };
}

function getWinningLines(world) {
  const lines = [];
  const size = WORLD_SIZES[world];

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      for (const [rowDelta, colDelta] of DIRECTIONS) {
        const line = [
          [row, col],
          [row + rowDelta, col + colDelta],
          [row + rowDelta * 2, col + colDelta * 2],
        ];

        if (!line.every(([lineRow, lineCol]) => isInside(world, lineRow, lineCol))) {
          continue;
        }

        const previous = [row - rowDelta, col - colDelta];
        const next = [row + rowDelta * 3, col + colDelta * 3];

        lines.push({
          ids: line.map(([lineRow, lineCol]) => getPositionId(world, lineRow, lineCol)),
          extensions: [previous, next]
            .filter(([lineRow, lineCol]) => isInside(world, lineRow, lineCol))
            .map(([lineRow, lineCol]) => getPositionId(world, lineRow, lineCol)),
        });
      }
    }
  }

  return dedupeLines(lines);
}

function dedupeLines(lines) {
  const unique = new Map();
  for (const line of lines) {
    unique.set(line.ids.join("|"), line);
  }
  return [...unique.values()];
}

function isInside(world, row, col) {
  const size = WORLD_SIZES[world];
  return row >= 0 && row < size && col >= 0 && col < size;
}

function withMessage(state, message) {
  return {
    ...state,
    message,
  };
}
