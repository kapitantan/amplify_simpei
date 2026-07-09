import { useEffect, useMemo, useRef, useState } from "react";
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

export default function GamePage() {
  const [game, setGame] = useState(() => createInitialGame());
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [uiEffect, setUiEffect] = useState({
    locked: false,
    action: null,
    invalidTarget: null,
    selectedCell: null,
  });
  const effectTimeoutRef = useRef(null);

  const legalPlacementTargets = useMemo(() => new Set(getLegalPlacementTargets(game)), [game]);
  const forcedMoveTargets = useMemo(() => new Set(getForcedMoveTargets(game)), [game]);
  const movablePieces = useMemo(() => new Set(getMovablePieces(game)), [game]);
  const legalMoveTargets = useMemo(() => (
    selectedPiece ? new Set(getLegalMoveTargets(game, selectedPiece)) : new Set()
  ), [game, selectedPiece]);
  const forcedPiece = game.pendingForcedMove?.pieces[0] ?? null;

  useEffect(() => {
    return () => {
      window.clearTimeout(effectTimeoutRef.current);
    };
  }, []);

  function playEffect(action, durationMs) {
    window.clearTimeout(effectTimeoutRef.current);
    setUiEffect({
      locked: durationMs > 0,
      action,
      invalidTarget: null,
      selectedCell: action?.id ?? null,
    });
    effectTimeoutRef.current = window.setTimeout(() => {
      setUiEffect((current) => ({
        ...current,
        locked: false,
        action: null,
      }));
    }, durationMs);
  }

  function showInvalidTarget(positionId) {
    window.clearTimeout(effectTimeoutRef.current);
    setUiEffect((current) => ({
      ...current,
      locked: false,
      action: null,
      invalidTarget: positionId,
      selectedCell: positionId,
    }));
    effectTimeoutRef.current = window.setTimeout(() => {
      setUiEffect((current) => ({
        ...current,
        invalidTarget: null,
      }));
    }, 220);
  }

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
    if (game.winner || uiEffect.locked) {
      return;
    }

    if (game.pendingForcedMove) {
      if (!forcedMoveTargets.has(positionId)) {
        showInvalidTarget(positionId);
        return;
      }

      updateGame(forceMovePiece(game, positionId));
      playEffect({ type: "relocated", id: positionId }, 460);
      return;
    }

    if (game.phase === "placement") {
      if (!legalPlacementTargets.has(positionId)) {
        showInvalidTarget(positionId);
        updateGame(placePiece(game, positionId));
        return;
      }

      const nextGame = placePiece(game, positionId);
      updateGame(nextGame);
      playEffect({ type: "placed", id: positionId }, nextGame.pendingForcedMove ? 380 : 240);
      return;
    }

    if (game.board[positionId] === game.currentPlayer) {
      if (!movablePieces.has(positionId)) {
        showInvalidTarget(positionId);
        setSelectedPiece(null);
        return;
      }

      setSelectedPiece(positionId);
      setUiEffect((current) => ({
        ...current,
        selectedCell: positionId,
        invalidTarget: null,
      }));
      return;
    }

    if (selectedPiece) {
      if (!legalMoveTargets.has(positionId)) {
        showInvalidTarget(positionId);
        updateGame(movePiece(game, selectedPiece, positionId));
        return;
      }

      const nextGame = movePiece(game, selectedPiece, positionId);
      updateGame(nextGame);
      playEffect({ type: "moved", id: positionId }, nextGame.pendingForcedMove ? 380 : 240);
      return;
    }

    showInvalidTarget(positionId);
  }

  function resetGame() {
    setGame(createInitialGame());
    setSelectedPiece(null);
    setUiEffect({
      locked: false,
      action: null,
      invalidTarget: null,
      selectedCell: null,
    });
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
        <IntegratedBoard
          game={game}
          selectedPiece={selectedPiece}
          legalPlacementTargets={legalPlacementTargets}
          legalMoveTargets={legalMoveTargets}
          forcedMoveTargets={forcedMoveTargets}
          forcedPieceId={forcedPiece?.from}
          movablePieces={movablePieces}
          uiEffect={uiEffect}
          onPointClick={handlePointClick}
        />
        <BoardLegend />
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

function IntegratedBoard({
  game,
  selectedPiece,
  legalPlacementTargets,
  legalMoveTargets,
  forcedMoveTargets,
  forcedPieceId,
  movablePieces,
  uiEffect,
  onPointClick,
}) {
  return (
    <section className="integrated-board-panel">
      <h2>ボード</h2>
      <div className="simpei-board">
        {Array.from({ length: 4 }, (_, index) => (
          <span
            key={`h-${index}`}
            className="board-line horizontal"
            style={{
              gridRow: index * 2 + 1,
              gridColumn: "1 / 8",
            }}
          />
        ))}
        {Array.from({ length: 4 }, (_, index) => (
          <span
            key={`v-${index}`}
            className="board-line vertical"
            style={{
              gridRow: "1 / 8",
              gridColumn: index * 2 + 1,
            }}
          />
        ))}
        {POSITIONS.map(({ id, world, row, col }) => {
          const occupant = game.board[id];
          const isSelected = selectedPiece === id;
          const isForcedPiece = forcedPieceId === id;
          const isLegalTarget = legalPlacementTargets.has(id)
            || legalMoveTargets.has(id)
            || forcedMoveTargets.has(id);
          const isMovable = movablePieces.has(id);
          const isInvalid = uiEffect.invalidTarget === id;
          const isSelectedCell = uiEffect.selectedCell === id;
          const isRecentAction = uiEffect.action?.id === id;
          const isWinningPoint = game.winningLine?.includes(id);
          const label = `${getWorldLabel(world)} ${row + 1}行 ${col + 1}列`;
          const gridPosition = getBoardGridPosition(world, row, col);

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
                isInvalid ? "invalid" : "",
                isSelectedCell ? "cell-selected" : "",
                isRecentAction ? uiEffect.action.type : "",
                isWinningPoint ? "winning" : "",
                world === WORLDS.UPPER ? "upper-point" : "lower-point",
              ].filter(Boolean).join(" ")}
              style={{
                gridRow: gridPosition.row,
                gridColumn: gridPosition.col,
              }}
              onClick={() => onPointClick(id)}
              aria-label={occupant ? `${label}: ${getPlayerLabel(occupant)}の駒` : `${label}: 空き`}
            >
              <span className="point-hole" />
              {isLegalTarget && !occupant && <span className="target-marker" />}
              {occupant && (
                <span className="piece">
                  <span className="piece-head">{getPlayerLabel(occupant)}</span>
                  <span className="piece-stem" />
                </span>
              )}
              {!occupant && <span className="point-label">{getPointLabel(world, row, col)}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function BoardLegend() {
  return (
    <aside className="board-legend">
      <h2>盤面の見方</h2>
      <p>大きい点が上の世界 U、交点の間にある小さい点が下の世界 L です。</p>
      <dl>
        <div>
          <dt>上の世界</dt>
          <dd>4x4 の交点。先手の初手は中央4点です。</dd>
        </div>
        <div>
          <dt>下の世界</dt>
          <dd>上の世界のマス目の中心にある 3x3 の交点です。</dd>
        </div>
        <div>
          <dt>移動</dt>
          <dd>必ず隣接する別の世界へ移動します。</dd>
        </div>
      </dl>
    </aside>
  );
}

function getBoardGridPosition(world, row, col) {
  if (world === WORLDS.UPPER) {
    return {
      row: row * 2 + 1,
      col: col * 2 + 1,
    };
  }

  return {
    row: row * 2 + 2,
    col: col * 2 + 2,
  };
}

function getWorldLabel(world) {
  return world === WORLDS.UPPER ? "上の世界" : "下の世界";
}

function getPointLabel(world, row, col) {
  if (world === WORLDS.UPPER && row >= 1 && row <= 2 && col >= 1 && col <= 2) {
    return "中";
  }

  return "";
}
