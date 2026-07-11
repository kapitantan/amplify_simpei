export const PLAYERS = {
  RED: "red",
  BLUE: "blue",
};

export const WORLDS = {
  UPPER: "upper",
  LOWER: "lower",
};

export const ACTION_TYPES = {
  PLACE: "place",
  MOVE: "move",
  LIGHT_MOVE: "lightMove",
  FORCE_MOVE: "forceMove",
  PASS: "pass",
};

const WORLD_SIZES = {
  [WORLDS.UPPER]: 4,
  [WORLDS.LOWER]: 3,
};

const PIECES_PER_PLAYER = 4;

const PIECE_SETUP = [
  { suffix: "BIG", size: 3, trait: "heavy" },
  { suffix: "MID", size: 2, trait: "normal" },
  { suffix: "SMALL_1", size: 1, trait: "light" },
  { suffix: "SMALL_2", size: 1, trait: "light" },
];

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
  const pieces = createPieces();
  return {
    board: Object.fromEntries(POSITIONS.map(({ id }) => [id, null])),
    pieces,
    piecePositions: Object.fromEntries(Object.keys(pieces).map((id) => [id, null])),
    usedSpecialMoves: [],
    currentPlayer: PLAYERS.RED,
    turnNumber: 1,
    placedCount: {
      [PLAYERS.RED]: 0,
      [PLAYERS.BLUE]: 0,
    },
    phase: "placement",
    pendingForcedMove: null,
    winner: null,
    winningLine: null,
    drawReason: null,
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
  if (state.phase !== "placement" || isTerminal(state) || state.pendingForcedMove) {
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
  if (state.phase !== "movement" || isTerminal(state) || state.pendingForcedMove) {
    return [];
  }

  if (state.board[fromId] !== state.currentPlayer) {
    return [];
  }

  return getAdjacentPositions(fromId).filter((toId) => !state.board[toId]);
}

export function getLegalLightMoveActions(state, fromId) {
  const piece = getPieceAtPosition(state, fromId);
  if (
    state.phase !== "movement"
    || isTerminal(state)
    || state.pendingForcedMove
    || !piece
    || piece.owner !== state.currentPlayer
    || piece.trait !== "light"
    || state.usedSpecialMoves?.includes(piece.id)
  ) {
    return [];
  }

  return getAdjacentPositions(fromId).flatMap((via) => {
    if (state.board[via]) {
      return [];
    }
    return getAdjacentPositions(via)
      .filter((to) => to !== fromId && !state.board[to])
      .map((to) => ({
        type: ACTION_TYPES.LIGHT_MOVE,
        from: fromId,
        via,
        to,
        pieceId: piece.id,
      }));
  });
}

export function getMovablePieces(state, player = state.currentPlayer) {
  if (state.phase !== "movement" || isTerminal(state) || state.pendingForcedMove) {
    return [];
  }

  return POSITIONS.filter(({ id }) => state.board[id] === player)
    .map(({ id }) => id)
    .filter((id) => {
      const playerState = { ...state, currentPlayer: player };
      return getLegalMoveTargets(playerState, id).length > 0 || getLegalLightMoveActions(playerState, id).length > 0;
    });
}

export function getForcedMoveTargets(state) {
  const forcedPiece = state.pendingForcedMove?.pieces[0];
  if (!forcedPiece || isTerminal(state)) {
    return [];
  }

  if (forcedPiece.trait === "heavy") {
    return getHeavyForcedMoveTargets(state, forcedPiece.from);
  }

  return POSITIONS.filter(({ id }) => id !== forcedPiece.from && !state.board[id]).map(({ id }) => id);
}

export function getLegalActions(state) {
  if (isTerminal(state)) {
    return [];
  }

  if (state.pendingForcedMove) {
    const forcedPiece = state.pendingForcedMove.pieces[0];
    return getForcedMoveTargets(state).map((to) => ({
      type: ACTION_TYPES.FORCE_MOVE,
      from: forcedPiece.from,
      pieceId: forcedPiece.id,
      to,
    }));
  }

  if (state.phase === "placement") {
    return getUnplacedPieces(state, state.currentPlayer).flatMap((piece) => (
      getLegalPlacementTargets(state).map((to) => ({
        type: ACTION_TYPES.PLACE,
        pieceId: piece.id,
        to,
      }))
    ));
  }

  const moveActions = getMovablePieces(state).flatMap((from) => (
    [
      ...getLegalMoveTargets(state, from).map((to) => ({
        type: ACTION_TYPES.MOVE,
        from,
        to,
      })),
      ...getLegalLightMoveActions(state, from),
    ]
  ));

  if (moveActions.length > 0) {
    return moveActions;
  }

  return [{ type: ACTION_TYPES.PASS }];
}

export function applyAction(state, action) {
  if (isTerminal(state)) {
    return withMessage(state, "対局は終了しています。");
  }

  if (!action) {
    return withMessage(state, "手が選択されていません。");
  }

  switch (action.type) {
    case ACTION_TYPES.PLACE:
      return placePiece(state, action.to, action.pieceId);
    case ACTION_TYPES.MOVE:
      return movePiece(state, action.from, action.to);
    case ACTION_TYPES.LIGHT_MOVE:
      return lightMovePiece(state, action.from, action.via, action.to);
    case ACTION_TYPES.FORCE_MOVE:
      return forceMovePiece(state, action.to);
    case ACTION_TYPES.PASS:
      return passTurn(state);
    default:
      return withMessage(state, "未対応の手です。");
  }
}

export function isLegalAction(state, action) {
  const actionKey = getActionKey(action);
  return Boolean(actionKey) && getLegalActions(state).some((legalAction) => getActionKey(legalAction) === actionKey);
}

export function getActionKey(action) {
  if (!action?.type) {
    return "";
  }

  if (action.type === ACTION_TYPES.LIGHT_MOVE) {
    return [action.type, action.from ?? "", action.via ?? "", action.to ?? ""].join(":");
  }
  return [action.type, action.from ?? "", action.to ?? ""].join(":");
}

export function markDraw(state, reason) {
  const message = reason === "repetition"
    ? "同じ局面が3回出たため引き分けです。"
    : "手数上限に達したため引き分けです。";

  return {
    ...state,
    pendingForcedMove: null,
    drawReason: reason,
    message,
  };
}

export function placePiece(state, toId, pieceId = null) {
  if (!getLegalPlacementTargets(state).includes(toId)) {
    return withMessage(state, "そこには配置できません。");
  }
  const piece = pieceId ? state.pieces[pieceId] : getNextUnplacedPiece(state);
  if (!piece || piece.owner !== state.currentPlayer || state.piecePositions[piece.id]) {
    return withMessage(state, "配置するコマがありません。");
  }

  const player = state.currentPlayer;
  const board = {
    ...state.board,
    [toId]: player,
  };

  const nextState = {
    ...state,
    board,
    piecePositions: {
      ...state.piecePositions,
      [piece.id]: toId,
    },
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
  const piece = getPieceAtPosition(state, fromId);
  const board = {
    ...state.board,
    [fromId]: null,
    [toId]: player,
  };

  return finishTurnAction({
    ...state,
    board,
    piecePositions: {
      ...state.piecePositions,
      [piece.id]: toId,
    },
  }, player, toId);
}

export function lightMovePiece(state, fromId, viaId, toId) {
  const legalAction = getLegalLightMoveActions(state, fromId)
    .find((action) => action.via === viaId && action.to === toId);
  if (!legalAction) {
    return withMessage(state, "その特殊移動はできません。");
  }

  const player = state.currentPlayer;
  const board = {
    ...state.board,
    [fromId]: null,
    [toId]: player,
  };

  return finishTurnAction({
    ...state,
    board,
    piecePositions: {
      ...state.piecePositions,
      [legalAction.pieceId]: toId,
    },
    usedSpecialMoves: [...(state.usedSpecialMoves ?? []), legalAction.pieceId],
  }, player, toId);
}

export function passTurn(state) {
  if (state.phase !== "movement" || isTerminal(state) || state.pendingForcedMove) {
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
  const piecePositions = forcedPiece.id ? {
    ...state.piecePositions,
    [forcedPiece.id]: toId,
  } : state.piecePositions;
  const remainingPieces = state.pendingForcedMove.pieces.slice(1);

  if (remainingPieces.length > 0) {
    return {
      ...state,
      board,
      piecePositions,
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
      piecePositions,
      pendingForcedMove: null,
    },
    `${getPlayerLabel(forcedPiece.player)}の駒を飛ばしました。`
  );
}

export function hasExactWinningLine(board, player, world) {
  return Boolean(getExactWinningLine(board, player, world));
}

export function getExactWinningLine(board, player, world) {
  const winningLine = getWinningLines(world).find(({ ids, extensions }) => {
    return ids.every((id) => board[id] === player) && extensions.every((id) => board[id] !== player);
  });

  return winningLine?.ids ?? null;
}

function getExactWinningLineContaining(board, player, world, positionId) {
  const winningLine = getWinningLines(world).find(({ ids, extensions }) => {
    return ids.includes(positionId)
      && ids.every((id) => board[id] === player)
      && extensions.every((id) => board[id] !== player);
  });

  return winningLine?.ids ?? null;
}

export function findSandwichedPieces(board, player, causedById = null, state = null) {
  const opponent = getOpponent(player);
  const sandwiched = new Set();

  for (const { world, row, col, id } of POSITIONS) {
    if (board[id] !== opponent) {
      continue;
    }

    for (const [rowDelta, colDelta] of DIRECTIONS) {
      const before = findSandwichBoundary(board, opponent, world, row, col, -rowDelta, -colDelta);
      const after = findSandwichBoundary(board, opponent, world, row, col, rowDelta, colDelta);

      if (causedById && before !== causedById && after !== causedById) {
        continue;
      }

      if (getPosition(before) && getPosition(after) && board[before] === player && board[after] === player) {
        sandwiched.add(id);
      }
    }
  }

  return [...sandwiched].map((from) => {
    const piece = state ? getPieceAtPosition(state, from) : null;
    const captured = {
      from,
      player: opponent,
    };
    if (piece) {
      captured.id = piece.id;
      captured.size = piece.size;
      captured.trait = piece.trait;
    }
    return captured;
  });
}

function findSandwichBoundary(board, opponent, world, row, col, rowDelta, colDelta) {
  let currentRow = row + rowDelta;
  let currentCol = col + colDelta;

  while (isInside(world, currentRow, currentCol)) {
    const id = getPositionId(world, currentRow, currentCol);
    if (board[id] !== opponent) {
      return id;
    }

    currentRow += rowDelta;
    currentCol += colDelta;
  }

  return null;
}

function finishTurnAction(state, player, actionPositionId) {
  const winningLine = Object.values(WORLDS)
    .map((world) => getExactWinningLineContaining(state.board, player, world, actionPositionId))
    .find(Boolean) ?? null;
  const winner = winningLine ? player : null;

  if (winner) {
    return {
      ...state,
      winner,
      winningLine,
      message: `${getPlayerLabel(winner)}の勝ちです。`,
    };
  }

  const sandwichedPieces = findSandwichedPieces(state.board, player, actionPositionId, state)
    .filter((piece) => piece.trait !== "heavy" || getHeavyForcedMoveTargets(state, piece.from).length > 0);
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

function createPieces() {
  return Object.fromEntries(
    Object.values(PLAYERS).flatMap((owner) => (
      PIECE_SETUP.map(({ suffix, size, trait }) => {
        const id = `${owner}-${suffix}`;
        return [id, { id, owner, size, trait }];
      })
    ))
  );
}

function getUnplacedPieces(state, player) {
  return Object.values(state.pieces ?? createPieces())
    .filter((piece) => piece.owner === player && !getPiecePosition(state, piece.id));
}

function getNextUnplacedPiece(state) {
  return getUnplacedPieces(state, state.currentPlayer)[0] ?? null;
}

function getPiecePosition(state, pieceId) {
  if (state.piecePositions) {
    return state.piecePositions[pieceId] ?? null;
  }

  return null;
}

function getPieceAtPosition(state, positionId) {
  if (state.piecePositions && state.pieces) {
    const pieceId = Object.entries(state.piecePositions)
      .find(([, piecePosition]) => piecePosition === positionId)?.[0];
    if (pieceId) {
      return state.pieces[pieceId];
    }
  }

  const owner = state.board?.[positionId];
  return owner ? { id: `${owner}-legacy-${positionId}`, owner, size: 2, trait: "normal" } : null;
}

function getHeavyForcedMoveTargets(state, fromId) {
  return getAdjacentPositions(fromId).filter((toId) => !state.board[toId]);
}

function isTerminal(state) {
  return Boolean(state.winner || state.drawReason);
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
