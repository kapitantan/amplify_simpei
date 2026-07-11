import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTION_TYPES,
  PLAYERS,
  WORLDS,
  applyAction,
  createInitialGame,
  findSandwichedPieces,
  forceMovePiece,
  getActionKey,
  getAdjacentPositions,
  getForcedMoveTargets,
  getLegalActions,
  getLegalLightMoveActions,
  getLegalPlacementTargets,
  getMovablePieces,
  getPositionId,
  hasExactWinningLine,
  isLegalAction,
  lightMovePiece,
  markDraw,
  movePiece,
  passTurn,
  placePiece,
} from "./simpei.js";

function emptyBoard() {
  return createInitialGame().board;
}

function fillPlacementWithoutWinner() {
  const placements = [
    getPositionId(WORLDS.UPPER, 1, 1),
    getPositionId(WORLDS.UPPER, 0, 0),
    getPositionId(WORLDS.LOWER, 0, 0),
    getPositionId(WORLDS.UPPER, 0, 3),
    getPositionId(WORLDS.LOWER, 2, 2),
    getPositionId(WORLDS.UPPER, 3, 0),
    getPositionId(WORLDS.UPPER, 3, 3),
    getPositionId(WORLDS.LOWER, 0, 2),
  ];

  return placements.reduce((state, positionId) => placePiece(state, positionId), createInitialGame());
}

describe("simpei rules", () => {
  it("limits the first move to the four upper center points", () => {
    const state = createInitialGame();

    assert.deepEqual(new Set(getLegalPlacementTargets(state)), new Set([
      getPositionId(WORLDS.UPPER, 1, 1),
      getPositionId(WORLDS.UPPER, 1, 2),
      getPositionId(WORLDS.UPPER, 2, 1),
      getPositionId(WORLDS.UPPER, 2, 2),
    ]));

    const rejected = placePiece(state, getPositionId(WORLDS.UPPER, 0, 0));
    assert.equal(rejected.board[getPositionId(WORLDS.UPPER, 0, 0)], null);
    assert.equal(rejected.currentPlayer, PLAYERS.RED);
  });

  it("lists and applies legal placement actions", () => {
    const state = createInitialGame();
    const actions = getLegalActions(state);

    assert.deepEqual(new Set(actions.map((action) => action.type)), new Set([ACTION_TYPES.PLACE]));
    assert.deepEqual(new Set(actions.map((action) => action.to)), new Set([
      getPositionId(WORLDS.UPPER, 1, 1),
      getPositionId(WORLDS.UPPER, 1, 2),
      getPositionId(WORLDS.UPPER, 2, 1),
      getPositionId(WORLDS.UPPER, 2, 2),
    ]));

    const action = { type: ACTION_TYPES.PLACE, to: getPositionId(WORLDS.UPPER, 1, 1) };
    assert.equal(isLegalAction(state, action), true);
    assert.equal(getActionKey(action), "place::upper-1-1");

    const nextState = applyAction(state, action);
    assert.equal(nextState.board[getPositionId(WORLDS.UPPER, 1, 1)], PLAYERS.RED);
    assert.equal(nextState.currentPlayer, PLAYERS.BLUE);
  });

  it("switches to movement after eight placements", () => {
    const state = fillPlacementWithoutWinner();

    assert.equal(state.phase, "movement");
    assert.equal(state.turnNumber, 9);
    assert.equal(state.placedCount[PLAYERS.RED], 4);
    assert.equal(state.placedCount[PLAYERS.BLUE], 4);
  });

  it("detects exact three-in-a-row but not four-in-a-row", () => {
    const board = emptyBoard();
    board[getPositionId(WORLDS.UPPER, 0, 0)] = PLAYERS.RED;
    board[getPositionId(WORLDS.UPPER, 0, 1)] = PLAYERS.RED;
    board[getPositionId(WORLDS.UPPER, 0, 2)] = PLAYERS.RED;

    assert.equal(hasExactWinningLine(board, PLAYERS.RED, WORLDS.UPPER), true);

    board[getPositionId(WORLDS.UPPER, 0, 3)] = PLAYERS.RED;
    assert.equal(hasExactWinningLine(board, PLAYERS.RED, WORLDS.UPPER), false);
  });

  it("stores the winning line for UI highlighting", () => {
    let state = createInitialGame();
    state = placePiece(state, getPositionId(WORLDS.UPPER, 1, 1));
    state = placePiece(state, getPositionId(WORLDS.LOWER, 0, 0));
    state = placePiece(state, getPositionId(WORLDS.UPPER, 1, 2));
    state = placePiece(state, getPositionId(WORLDS.LOWER, 2, 2));
    state = placePiece(state, getPositionId(WORLDS.UPPER, 1, 3));

    assert.equal(state.winner, PLAYERS.RED);
    assert.deepEqual(state.winningLine, [
      getPositionId(WORLDS.UPPER, 1, 1),
      getPositionId(WORLDS.UPPER, 1, 2),
      getPositionId(WORLDS.UPPER, 1, 3),
    ]);
  });

  it("does not win by moving away from a four-in-a-row", () => {
    const state = {
      ...createInitialGame(),
      phase: "movement",
      turnNumber: 9,
      placedCount: {
        [PLAYERS.RED]: 4,
        [PLAYERS.BLUE]: 4,
      },
      board: {
        ...emptyBoard(),
        [getPositionId(WORLDS.UPPER, 0, 0)]: PLAYERS.RED,
        [getPositionId(WORLDS.UPPER, 0, 1)]: PLAYERS.RED,
        [getPositionId(WORLDS.UPPER, 0, 2)]: PLAYERS.RED,
        [getPositionId(WORLDS.UPPER, 0, 3)]: PLAYERS.RED,
      },
    };

    const moved = movePiece(state, getPositionId(WORLDS.UPPER, 0, 3), getPositionId(WORLDS.LOWER, 0, 2));

    assert.equal(moved.winner, null);
    assert.equal(moved.currentPlayer, PLAYERS.BLUE);
  });

  it("does not treat lines across worlds as wins", () => {
    const board = emptyBoard();
    board[getPositionId(WORLDS.UPPER, 0, 0)] = PLAYERS.RED;
    board[getPositionId(WORLDS.UPPER, 0, 1)] = PLAYERS.RED;
    board[getPositionId(WORLDS.LOWER, 0, 2)] = PLAYERS.RED;

    assert.equal(hasExactWinningLine(board, PLAYERS.RED, WORLDS.UPPER), false);
    assert.equal(hasExactWinningLine(board, PLAYERS.RED, WORLDS.LOWER), false);
  });

  it("stops legal actions after a draw", () => {
    const state = markDraw(createInitialGame(), "repetition");

    assert.equal(state.drawReason, "repetition");
    assert.equal(getLegalActions(state).length, 0);
    assert.equal(isLegalAction(state, { type: ACTION_TYPES.PLACE, to: getPositionId(WORLDS.UPPER, 1, 1) }), false);
    assert.match(state.message, /引き分け/);
  });

  it("moves only to adjacent empty points in the other world", () => {
    const state = fillPlacementWithoutWinner();
    const from = getPositionId(WORLDS.UPPER, 1, 1);

    assert.deepEqual(new Set(getAdjacentPositions(from)), new Set([
      getPositionId(WORLDS.LOWER, 0, 0),
      getPositionId(WORLDS.LOWER, 0, 1),
      getPositionId(WORLDS.LOWER, 1, 0),
      getPositionId(WORLDS.LOWER, 1, 1),
    ]));

    const moved = movePiece(state, from, getPositionId(WORLDS.LOWER, 1, 1));
    assert.equal(moved.board[from], null);
    assert.equal(moved.board[getPositionId(WORLDS.LOWER, 1, 1)], PLAYERS.RED);
  });

  it("limits heavy piece relocation to adjacent empty points", () => {
    let state = createInitialGame();
    state = placePiece(state, getPositionId(WORLDS.UPPER, 1, 1), "red-MID");
    state = placePiece(state, getPositionId(WORLDS.UPPER, 1, 2), "blue-BIG");
    state = placePiece(state, getPositionId(WORLDS.UPPER, 1, 3), "red-SMALL_1");

    assert.equal(state.pendingForcedMove.pieces[0].trait, "heavy");
    assert.deepEqual(new Set(getForcedMoveTargets(state)), new Set([
      getPositionId(WORLDS.LOWER, 0, 1),
      getPositionId(WORLDS.LOWER, 0, 2),
      getPositionId(WORLDS.LOWER, 1, 1),
      getPositionId(WORLDS.LOWER, 1, 2),
    ]));
  });

  it("allows each light piece to use a two-step move once", () => {
    let state = {
      ...createInitialGame(),
      currentPlayer: PLAYERS.RED,
      phase: "movement",
      turnNumber: 9,
      placedCount: {
        [PLAYERS.RED]: 4,
        [PLAYERS.BLUE]: 4,
      },
      board: {
        ...emptyBoard(),
        [getPositionId(WORLDS.UPPER, 1, 1)]: PLAYERS.RED,
      },
      piecePositions: {
        ...createInitialGame().piecePositions,
        "red-SMALL_1": getPositionId(WORLDS.UPPER, 1, 1),
      },
    };

    const actions = getLegalLightMoveActions(state, getPositionId(WORLDS.UPPER, 1, 1));
    const action = actions.find((candidate) => candidate.to === getPositionId(WORLDS.UPPER, 0, 0));

    assert.ok(action);

    state = lightMovePiece(state, action.from, action.via, action.to);

    assert.equal(state.board[getPositionId(WORLDS.UPPER, 0, 0)], PLAYERS.RED);
    assert.equal(state.usedSpecialMoves.includes("red-SMALL_1"), true);
    assert.equal(getLegalLightMoveActions({
      ...state,
      currentPlayer: PLAYERS.RED,
    }, getPositionId(WORLDS.UPPER, 0, 0)).length, 0);
  });

  it("lists move actions or pass actions in movement phase", () => {
    const state = fillPlacementWithoutWinner();
    const moveActions = getLegalActions(state);

    assert.equal(moveActions.every((action) => (
      action.type === ACTION_TYPES.MOVE || action.type === ACTION_TYPES.LIGHT_MOVE
    )), true);
    assert.equal(moveActions.some((action) => action.from === getPositionId(WORLDS.UPPER, 1, 1)), true);

    const blockedState = {
      ...state,
      board: {
        ...state.board,
        [getPositionId(WORLDS.UPPER, 0, 1)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.UPPER, 1, 0)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.UPPER, 2, 2)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.UPPER, 2, 3)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.UPPER, 3, 2)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.LOWER, 0, 1)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.LOWER, 1, 0)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.LOWER, 1, 1)]: PLAYERS.BLUE,
      },
    };

    assert.deepEqual(getLegalActions(blockedState), [{ type: ACTION_TYPES.PASS }]);
  });

  it("uses the overlaid board adjacency between upper corners, edges, centers, and lower points", () => {
    assert.deepEqual(getAdjacentPositions(getPositionId(WORLDS.UPPER, 0, 0)), [
      getPositionId(WORLDS.LOWER, 0, 0),
    ]);

    assert.deepEqual(new Set(getAdjacentPositions(getPositionId(WORLDS.UPPER, 0, 1))), new Set([
      getPositionId(WORLDS.LOWER, 0, 0),
      getPositionId(WORLDS.LOWER, 0, 1),
    ]));

    assert.deepEqual(new Set(getAdjacentPositions(getPositionId(WORLDS.UPPER, 1, 1))), new Set([
      getPositionId(WORLDS.LOWER, 0, 0),
      getPositionId(WORLDS.LOWER, 0, 1),
      getPositionId(WORLDS.LOWER, 1, 0),
      getPositionId(WORLDS.LOWER, 1, 1),
    ]));

    assert.deepEqual(new Set(getAdjacentPositions(getPositionId(WORLDS.LOWER, 0, 0))), new Set([
      getPositionId(WORLDS.UPPER, 0, 0),
      getPositionId(WORLDS.UPPER, 0, 1),
      getPositionId(WORLDS.UPPER, 1, 0),
      getPositionId(WORLDS.UPPER, 1, 1),
    ]));

    assert.deepEqual(new Set(getAdjacentPositions(getPositionId(WORLDS.LOWER, 1, 1))), new Set([
      getPositionId(WORLDS.UPPER, 1, 1),
      getPositionId(WORLDS.UPPER, 1, 2),
      getPositionId(WORLDS.UPPER, 2, 1),
      getPositionId(WORLDS.UPPER, 2, 2),
    ]));
  });

  it("allows pass only when the current player has no legal moves", () => {
    const state = fillPlacementWithoutWinner();
    const rejected = passTurn(state);

    assert.equal(rejected.currentPlayer, state.currentPlayer);
    assert.match(rejected.message, /合法手/);

    const blockedState = {
      ...state,
      board: {
        ...state.board,
        [getPositionId(WORLDS.UPPER, 0, 1)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.UPPER, 1, 0)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.UPPER, 2, 2)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.UPPER, 2, 3)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.UPPER, 3, 2)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.LOWER, 0, 1)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.LOWER, 1, 0)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.LOWER, 1, 1)]: PLAYERS.BLUE,
      },
    };

    assert.equal(getMovablePieces(blockedState).length, 0);
    const passed = passTurn(blockedState);
    assert.equal(passed.currentPlayer, PLAYERS.BLUE);
    assert.match(passed.message, /パスしました/);
  });

  it("finds sandwiched pieces in a single world", () => {
    const board = emptyBoard();
    board[getPositionId(WORLDS.LOWER, 1, 0)] = PLAYERS.RED;
    board[getPositionId(WORLDS.LOWER, 1, 1)] = PLAYERS.BLUE;
    board[getPositionId(WORLDS.LOWER, 1, 2)] = PLAYERS.RED;
    board[getPositionId(WORLDS.UPPER, 1, 1)] = PLAYERS.BLUE;

    assert.deepEqual(findSandwichedPieces(board, PLAYERS.RED), [
      {
        from: getPositionId(WORLDS.LOWER, 1, 1),
        player: PLAYERS.BLUE,
      },
    ]);
  });

  it("finds multiple contiguous sandwiched pieces in a single line", () => {
    const board = emptyBoard();
    board[getPositionId(WORLDS.UPPER, 1, 0)] = PLAYERS.RED;
    board[getPositionId(WORLDS.UPPER, 1, 1)] = PLAYERS.BLUE;
    board[getPositionId(WORLDS.UPPER, 1, 2)] = PLAYERS.BLUE;
    board[getPositionId(WORLDS.UPPER, 1, 3)] = PLAYERS.RED;

    assert.deepEqual(findSandwichedPieces(board, PLAYERS.RED), [
      {
        from: getPositionId(WORLDS.UPPER, 1, 1),
        player: PLAYERS.BLUE,
      },
      {
        from: getPositionId(WORLDS.UPPER, 1, 2),
        player: PLAYERS.BLUE,
      },
    ]);
  });

  it("resolves forced moves without triggering opponent wins or chains", () => {
    let state = createInitialGame();
    state = placePiece(state, getPositionId(WORLDS.UPPER, 1, 1));
    state = placePiece(state, getPositionId(WORLDS.LOWER, 1, 1));
    state = placePiece(state, getPositionId(WORLDS.LOWER, 1, 0));
    state = placePiece(state, getPositionId(WORLDS.UPPER, 0, 0));
    state = placePiece(state, getPositionId(WORLDS.LOWER, 1, 2));

    assert.equal(state.pendingForcedMove.pieces[0].from, getPositionId(WORLDS.LOWER, 1, 1));
    assert.equal(getForcedMoveTargets(state).includes(getPositionId(WORLDS.LOWER, 1, 1)), false);
    assert.equal(getLegalActions(state).every((action) => action.type === ACTION_TYPES.FORCE_MOVE), true);

    state = forceMovePiece(state, getForcedMoveTargets(state)[0]);
    assert.equal(state.winner, null);
    assert.equal(state.pendingForcedMove, null);
    assert.equal(state.currentPlayer, PLAYERS.BLUE);
  });

  it("allows every piece to be moved when two contiguous pieces are sandwiched", () => {
    let state = {
      ...createInitialGame(),
      currentPlayer: PLAYERS.RED,
      phase: "movement",
      turnNumber: 9,
      placedCount: {
        [PLAYERS.RED]: 4,
        [PLAYERS.BLUE]: 4,
      },
      board: {
        ...emptyBoard(),
        [getPositionId(WORLDS.UPPER, 1, 0)]: PLAYERS.RED,
        [getPositionId(WORLDS.UPPER, 1, 1)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.UPPER, 1, 2)]: PLAYERS.BLUE,
        [getPositionId(WORLDS.LOWER, 1, 2)]: PLAYERS.RED,
      },
    };

    state = movePiece(
      state,
      getPositionId(WORLDS.LOWER, 1, 2),
      getPositionId(WORLDS.UPPER, 1, 3)
    );

    assert.deepEqual(state.pendingForcedMove.pieces, [
      {
        from: getPositionId(WORLDS.UPPER, 1, 1),
        player: PLAYERS.BLUE,
        id: "blue-legacy-upper-1-1",
        size: 2,
        trait: "normal",
      },
      {
        from: getPositionId(WORLDS.UPPER, 1, 2),
        player: PLAYERS.BLUE,
        id: "blue-legacy-upper-1-2",
        size: 2,
        trait: "normal",
      },
    ]);

    state = forceMovePiece(state, getPositionId(WORLDS.LOWER, 0, 0));
    assert.equal(state.pendingForcedMove.pieces.length, 1);
    assert.equal(getForcedMoveTargets(state).includes(getPositionId(WORLDS.UPPER, 1, 1)), true);

    state = forceMovePiece(state, getPositionId(WORLDS.UPPER, 1, 1));
    assert.equal(state.pendingForcedMove, null);
    assert.equal(state.currentPlayer, PLAYERS.BLUE);
    assert.equal(state.board[getPositionId(WORLDS.LOWER, 0, 0)], PLAYERS.BLUE);
    assert.equal(state.board[getPositionId(WORLDS.UPPER, 1, 1)], PLAYERS.BLUE);
    assert.equal(state.board[getPositionId(WORLDS.UPPER, 1, 2)], null);
  });
});
