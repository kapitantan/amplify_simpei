import { useMemo, useState } from "react";
import {
  PLAYERS,
  POSITIONS,
  WORLDS,
  createInitialGame,
  forceMovePiece,
  getForcedMoveTargets,
  getLegalMoveTargets,
  getLegalPlacementTargets,
  getMovablePieces,
  getPlayerLabel,
  movePiece,
  passTurn,
  placePiece,
} from "../game/simpei";

const WORLD_LABELS = {
  [WORLDS.UPPER]: "上の世界 4x4",
  [WORLDS.LOWER]: "下の世界 3x3",
};

export default function GamePage() {
  const [game, setGame] = useState(() => createInitialGame());
  const [selectedPiece, setSelectedPiece] = useState(null);

  const legalPlacementTargets = useMemo(() => new Set(getLegalPlacementTargets(game)), [game]);
  const forcedMoveTargets = useMemo(() => new Set(getForcedMoveTargets(game)), [game]);
  const movablePieces = useMemo(() => new Set(getMovablePieces(game)), [game]);
  const legalMoveTargets = useMemo(() => (
    selectedPiece ? new Set(getLegalMoveTargets(game, selectedPiece)) : new Set()
  ), [game, selectedPiece]);
  const forcedPiece = game.pendingForcedMove?.pieces[0] ?? null;

  function updateGame(nextGame) {
    setGame(nextGame);
    if (nextGame.pendingForcedMove || nextGame.winner || nextGame.phase !== "movement") {
      setSelectedPiece(null);
      return;
    }

    if (selectedPiece && nextGame.board[selectedPiece] !== nextGame.currentPlayer) {
      setSelectedPiece(null);
    }
  }

  function handlePointClick(positionId) {
    if (game.winner) {
      return;
    }

    if (game.pendingForcedMove) {
      updateGame(forceMovePiece(game, positionId));
      return;
    }

    if (game.phase === "placement") {
      updateGame(placePiece(game, positionId));
      return;
    }

    if (game.board[positionId] === game.currentPlayer) {
      setSelectedPiece(movablePieces.has(positionId) ? positionId : null);
      return;
    }

    if (selectedPiece) {
      updateGame(movePiece(game, selectedPiece, positionId));
    }
  }

  function resetGame() {
    setGame(createInitialGame());
    setSelectedPiece(null);
  }

  function handlePass() {
    updateGame(passTurn(game));
  }

  return (
    <main className="game-page">
      <header className="game-header">
        <div>
          <p className="eyebrow">Local match</p>
          <h1>シンペイ</h1>
          <p className="game-lead">
            ログインなしで遊べるローカル2人対戦です。赤が先手、青が後手です。
          </p>
        </div>
        <div className="game-actions">
          <a href="/auth">ログイン検証</a>
          <a href="/notes">Notes サンプル</a>
          <button type="button" onClick={resetGame}>リセット</button>
        </div>
      </header>

      <section className="game-status" aria-live="polite">
        <div>
          <span className={`player-dot ${game.currentPlayer}`} />
          <strong>{game.winner ? `${getPlayerLabel(game.winner)}の勝ち` : `${getPlayerLabel(game.currentPlayer)}の手番`}</strong>
          <span>{game.phase === "placement" ? "配置フェーズ" : "移動フェーズ"}</span>
          <span>{game.turnNumber}手目</span>
        </div>
        <p>{game.message}</p>
        {game.pendingForcedMove && (
          <p>
            {getPlayerLabel(game.pendingForcedMove.player)}が挟んだ
            {getPlayerLabel(forcedPiece.player)}の駒を飛ばしてください。
            残り {game.pendingForcedMove.pieces.length} 個。
          </p>
        )}
      </section>

      <section className="game-layout" aria-label="シンペイ盤面">
        <WorldBoard
          world={WORLDS.UPPER}
          game={game}
          selectedPiece={selectedPiece}
          legalPlacementTargets={legalPlacementTargets}
          legalMoveTargets={legalMoveTargets}
          forcedMoveTargets={forcedMoveTargets}
          forcedPieceId={forcedPiece?.from}
          movablePieces={movablePieces}
          onPointClick={handlePointClick}
        />
        <WorldBoard
          world={WORLDS.LOWER}
          game={game}
          selectedPiece={selectedPiece}
          legalPlacementTargets={legalPlacementTargets}
          legalMoveTargets={legalMoveTargets}
          forcedMoveTargets={forcedMoveTargets}
          forcedPieceId={forcedPiece?.from}
          movablePieces={movablePieces}
          onPointClick={handlePointClick}
        />
      </section>

      <section className="game-controls">
        <button
          type="button"
          onClick={handlePass}
          disabled={game.phase !== "movement" || game.winner || game.pendingForcedMove || movablePieces.size > 0}
        >
          パス
        </button>
        <div>
          <strong>残り手駒</strong>
          <span>赤 {4 - game.placedCount[PLAYERS.RED]} 個</span>
          <span>青 {4 - game.placedCount[PLAYERS.BLUE]} 個</span>
        </div>
      </section>
    </main>
  );
}

function WorldBoard({
  world,
  game,
  selectedPiece,
  legalPlacementTargets,
  legalMoveTargets,
  forcedMoveTargets,
  forcedPieceId,
  movablePieces,
  onPointClick,
}) {
  const size = world === WORLDS.UPPER ? 4 : 3;
  const positions = POSITIONS.filter((position) => position.world === world);

  return (
    <section className={`world-board ${world}`}>
      <h2>{WORLD_LABELS[world]}</h2>
      <div className="board-grid" style={{ "--board-size": size }}>
        {positions.map(({ id, row, col }) => {
          const occupant = game.board[id];
          const isSelected = selectedPiece === id;
          const isForcedPiece = forcedPieceId === id;
          const isLegalTarget = legalPlacementTargets.has(id)
            || legalMoveTargets.has(id)
            || forcedMoveTargets.has(id);
          const isMovable = movablePieces.has(id);
          const label = `${WORLD_LABELS[world]} ${row + 1}行 ${col + 1}列`;

          return (
            <button
              key={id}
              type="button"
              className={[
                "board-point",
                occupant ? `occupied ${occupant}` : "",
                isSelected ? "selected" : "",
                isForcedPiece ? "forced" : "",
                isLegalTarget ? "legal-target" : "",
                isMovable ? "movable" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => onPointClick(id)}
              aria-label={occupant ? `${label}: ${getPlayerLabel(occupant)}の駒` : `${label}: 空き`}
            >
              <span>{occupant ? getPlayerLabel(occupant) : getPointLabel(world, row, col)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function getPointLabel(world, row, col) {
  if (world === WORLDS.UPPER && row >= 1 && row <= 2 && col >= 1 && col <= 2) {
    return "中";
  }

  return "";
}
