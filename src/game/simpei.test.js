import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLAYERS,
  WORLDS,
  createInitialGame,
  findSandwichedPieces,
  forceMovePiece,
  getAdjacentPositions,
  getForcedMoveTargets,
  getLegalPlacementTargets,
  getMovablePieces,
  getPositionId,
  hasExactWinningLine,
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

  it("resolves forced moves without triggering opponent wins or chains", () => {
    let state = createInitialGame();
    state = placePiece(state, getPositionId(WORLDS.UPPER, 1, 1));
    state = placePiece(state, getPositionId(WORLDS.LOWER, 1, 1));
    state = placePiece(state, getPositionId(WORLDS.LOWER, 1, 0));
    state = placePiece(state, getPositionId(WORLDS.UPPER, 0, 0));
    state = placePiece(state, getPositionId(WORLDS.LOWER, 1, 2));

    assert.equal(state.pendingForcedMove.pieces[0].from, getPositionId(WORLDS.LOWER, 1, 1));
    assert.equal(getForcedMoveTargets(state).includes(getPositionId(WORLDS.LOWER, 1, 1)), false);

    state = forceMovePiece(state, getPositionId(WORLDS.LOWER, 0, 0));
    assert.equal(state.winner, null);
    assert.equal(state.pendingForcedMove, null);
    assert.equal(state.currentPlayer, PLAYERS.BLUE);
  });
});
