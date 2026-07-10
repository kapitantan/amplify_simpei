import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACTION_TYPES,
  PLAYERS,
  POSITIONS,
  WORLDS,
  applyAction,
  createInitialGame,
  getForcedMoveTargets,
  getLegalActions,
  getLegalMoveTargets,
  getLegalPlacementTargets,
  getMovablePieces,
  getPlayerLabel,
  isLegalAction,
} from "../game/simpei";
import {
  createCpuMatch,
  recordHumanMove,
  recordMatchResult,
  requestCpuMove,
} from "../lib/cpuClient";

const HUMAN_PLAYER = PLAYERS.RED;
const CPU_PLAYER = PLAYERS.BLUE;
const CPU_DIFFICULTY = "normal";
const AUTO_LEARN_RESTART_DELAY_MS = 900;
const CPU_TURN_DELAY_MS = 360;

export default function GamePage() {
  const [game, setGame] = useState(() => createInitialGame());
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [cpuMode, setCpuMode] = useState(false);
  const [autoLearnMode, setAutoLearnMode] = useState(false);
  const [cpuThinking, setCpuThinking] = useState(false);
  const [cpuError, setCpuError] = useState("");
  const [matchId, setMatchId] = useState(null);
  const [moveHistory, setMoveHistory] = useState([]);
  const [autoLearnStats, setAutoLearnStats] = useState({
    games: 0,
    redWins: 0,
    blueWins: 0,
  });
  const [flyingPiece, setFlyingPiece] = useState(null);
  const [uiEffect, setUiEffect] = useState({
    locked: false,
    action: null,
    invalidTarget: null,
    selectedCell: null,
  });
  const effectTimeoutRef = useRef(null);
  const cpuTimeoutRef = useRef(null);
  const autoLearnTimeoutRef = useRef(null);
  const forcedMoveTimeoutRef = useRef(null);
  const cpuModeRef = useRef(false);
  const autoLearnModeRef = useRef(false);
  const cpuThinkingRef = useRef(false);
  const pendingCpuTurnRef = useRef(null);
  const gameRef = useRef(game);
  const matchIdRef = useRef(null);
  const historyRef = useRef([]);
  const resultRecordedRef = useRef(false);
  const boardRef = useRef(null);
  const pointRefs = useRef(new Map());

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
      window.clearTimeout(cpuTimeoutRef.current);
      window.clearTimeout(autoLearnTimeoutRef.current);
      window.clearTimeout(forcedMoveTimeoutRef.current);
    };
  }, []);

  function setCurrentGame(nextGame) {
    gameRef.current = nextGame;
    setGame(nextGame);
  }

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

  function playForcedMoveAnimation(piece, toId, onComplete) {
    const boardRect = boardRef.current?.getBoundingClientRect();
    const fromRect = pointRefs.current.get(piece.from)?.getBoundingClientRect();
    const toRect = pointRefs.current.get(toId)?.getBoundingClientRect();

    if (!boardRect || !fromRect || !toRect) {
      onComplete();
      return;
    }

    window.clearTimeout(forcedMoveTimeoutRef.current);
    setFlyingPiece({
      from: piece.from,
      to: toId,
      player: piece.player,
      left: fromRect.left + fromRect.width / 2 - boardRect.left,
      top: fromRect.top + fromRect.height / 2 - boardRect.top,
      size: fromRect.width,
      deltaX: toRect.left + toRect.width / 2 - fromRect.left - fromRect.width / 2,
      deltaY: toRect.top + toRect.height / 2 - fromRect.top - fromRect.height / 2,
    });
    setUiEffect((current) => ({
      ...current,
      locked: true,
      action: null,
      invalidTarget: null,
      selectedCell: toId,
    }));

    forcedMoveTimeoutRef.current = window.setTimeout(() => {
      setFlyingPiece(null);
      onComplete();
      playEffect({ type: "relocated", id: toId }, 120);
    }, 540);
  }

  function updateGame(nextGame, previousGame = game) {
    setCurrentGame(nextGame);
    if (nextGame.pendingForcedMove || nextGame.winner || nextGame.phase !== "movement") {
      setSelectedPiece(null);
    } else if (selectedPiece && nextGame.board[selectedPiece] !== nextGame.currentPlayer) {
      setSelectedPiece(null);
    }

    handleCompletedGame(nextGame);

    if (cpuModeRef.current) {
      queueCpuTurn(nextGame, previousGame);
    }
  }

  function handleCompletedGame(nextGame) {
    if (!cpuModeRef.current || !nextGame.winner || !matchIdRef.current || resultRecordedRef.current) {
      return;
    }

    const completedMatchId = matchIdRef.current;
    resultRecordedRef.current = true;
    recordMatchResult({
      matchId: completedMatchId,
      winner: nextGame.winner,
      finalState: nextGame,
    }).catch(() => {
      setCpuError("CPUサーバーに終局結果を保存できませんでした。");
    });

    if (autoLearnModeRef.current) {
      setAutoLearnStats((current) => ({
        games: current.games + 1,
        redWins: current.redWins + (nextGame.winner === PLAYERS.RED ? 1 : 0),
        blueWins: current.blueWins + (nextGame.winner === PLAYERS.BLUE ? 1 : 0),
      }));
      queueAutoLearnRestart();
    }
  }

  function queueAutoLearnRestart() {
    window.clearTimeout(autoLearnTimeoutRef.current);
    autoLearnTimeoutRef.current = window.setTimeout(() => {
      if (!autoLearnModeRef.current) {
        return;
      }
      startFreshMatch();
    }, AUTO_LEARN_RESTART_DELAY_MS);
  }

  function appendHistory(entry) {
    const nextHistory = [...historyRef.current, entry];
    historyRef.current = nextHistory;
    setMoveHistory(nextHistory);
    return nextHistory;
  }

  function commitAction(action, actor = "human") {
    const legalActionsBefore = getLegalActions(game);
    if (!isLegalAction(game, action)) {
      showInvalidTarget(action?.to ?? action?.from ?? null);
      return;
    }

    const previousGame = game;
    const nextGame = applyAction(game, action);
    const historyEntry = {
      actor,
      player: previousGame.currentPlayer,
      turnNumber: previousGame.turnNumber,
      action,
    };
    const nextHistory = appendHistory(historyEntry);

    if (actor === "human" && cpuMode && !autoLearnModeRef.current && matchIdRef.current) {
      recordHumanMove({
        matchId: matchIdRef.current,
        player: previousGame.currentPlayer,
        turnNumber: previousGame.turnNumber,
        action,
        gameStateBefore: previousGame,
        gameStateAfter: nextGame,
        legalActions: legalActionsBefore,
      }).catch(() => {
        setCpuError("CPUサーバーに人間の手を保存できませんでした。");
      });
    }

    updateGame(nextGame, previousGame);
    return { nextGame, nextHistory };
  }

  function queueCpuTurn(nextGame, previousGame = gameRef.current) {
    if (!isCpuTurn(nextGame)) {
      pendingCpuTurnRef.current = null;
      return;
    }

    if (cpuThinkingRef.current) {
      pendingCpuTurnRef.current = { nextGame, previousGame };
      return;
    }

    window.clearTimeout(cpuTimeoutRef.current);
    cpuTimeoutRef.current = window.setTimeout(() => {
      playCpuTurn(nextGame, previousGame);
    }, CPU_TURN_DELAY_MS);
  }

  async function playCpuTurn(cpuGame) {
    const currentMatchId = matchIdRef.current;
    const cpuLegalActions = getLegalActions(cpuGame);
    if (cpuThinkingRef.current || !currentMatchId || cpuLegalActions.length === 0 || !isCpuTurn(cpuGame)) {
      return;
    }

    cpuThinkingRef.current = true;
    setCpuThinking(true);
    setCpuError("");

    try {
      const candidateActions = cpuLegalActions.map((action) => ({
        action,
        next_state: applyAction(cpuGame, action),
      }));
      const response = await requestCpuMove({
        matchId: currentMatchId,
        gameState: cpuGame,
        legalActions: cpuLegalActions,
        candidateActions,
        cpuPlayer: cpuGame.currentPlayer,
        difficulty: CPU_DIFFICULTY,
        moveHistory: historyRef.current,
      });
      const selectedAction = response.selected_action;

      if (!isLegalAction(cpuGame, selectedAction)) {
        throw new Error("CPU returned an illegal action");
      }

      const completeCpuAction = () => {
        const nextGame = applyAction(cpuGame, selectedAction);
        appendHistory({
          actor: "cpu",
          player: cpuGame.currentPlayer,
          turnNumber: cpuGame.turnNumber,
          action: selectedAction,
          reason: response.reason,
          fallback: response.fallback,
        });
        setCurrentGame(nextGame);
        setSelectedPiece(null);
        if (selectedAction.type !== ACTION_TYPES.FORCE_MOVE) {
          playEffect({ type: getActionEffectType(selectedAction), id: selectedAction.to ?? selectedAction.from }, 240);
        }

        handleCompletedGame(nextGame);

        queueCpuTurn(nextGame, cpuGame);
      };

      const forcedCpuPiece = cpuGame.pendingForcedMove?.pieces[0];
      if (selectedAction.type === ACTION_TYPES.FORCE_MOVE && forcedCpuPiece) {
        playForcedMoveAnimation(forcedCpuPiece, selectedAction.to, completeCpuAction);
      } else {
        completeCpuAction();
      }
    } catch (error) {
      setCpuError(error instanceof Error ? error.message : "CPU手番でエラーが発生しました。");
    } finally {
      cpuThinkingRef.current = false;
      setCpuThinking(false);
      const pendingCpuTurn = pendingCpuTurnRef.current;
      pendingCpuTurnRef.current = null;
      if (pendingCpuTurn) {
        queueCpuTurn(pendingCpuTurn.nextGame, pendingCpuTurn.previousGame);
      }
    }
  }

  function handlePointClick(positionId) {
    if (game.winner || uiEffect.locked || isCpuTurn(game)) {
      return;
    }

    if (game.pendingForcedMove) {
      if (!forcedMoveTargets.has(positionId)) {
        showInvalidTarget(positionId);
        return;
      }

      playForcedMoveAnimation(forcedPiece, positionId, () => {
        commitAction({ type: ACTION_TYPES.FORCE_MOVE, from: forcedPiece.from, to: positionId });
      });
      return;
    }

    if (game.phase === "placement") {
      if (!legalPlacementTargets.has(positionId)) {
        showInvalidTarget(positionId);
        return;
      }

      const result = commitAction({ type: ACTION_TYPES.PLACE, to: positionId });
      playEffect({ type: "placed", id: positionId }, result?.nextGame.pendingForcedMove ? 380 : 240);
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
        return;
      }

      const result = commitAction({ type: ACTION_TYPES.MOVE, from: selectedPiece, to: positionId });
      playEffect({ type: "moved", id: positionId }, result?.nextGame.pendingForcedMove ? 380 : 240);
      return;
    }

    showInvalidTarget(positionId);
  }

  function resetGame() {
    window.clearTimeout(autoLearnTimeoutRef.current);
    startFreshMatch();
  }

  function startFreshMatch() {
    const nextGame = createInitialGame();
    setCurrentGame(nextGame);
    setSelectedPiece(null);
    setMoveHistory([]);
    historyRef.current = [];
    resultRecordedRef.current = false;
    setCpuError("");
    setUiEffect({
      locked: false,
      action: null,
      invalidTarget: null,
      selectedCell: null,
    });

    if (cpuModeRef.current) {
      startCpuMatch(nextGame);
    }
  }

  function handlePass() {
    commitAction({ type: ACTION_TYPES.PASS });
  }

  async function handleCpuModeChange(event) {
    const enabled = event.target.checked;
    cpuModeRef.current = enabled;
    setCpuMode(enabled);
    setCpuError("");

    if (!enabled) {
      autoLearnModeRef.current = false;
      setAutoLearnMode(false);
      window.clearTimeout(autoLearnTimeoutRef.current);
      window.clearTimeout(cpuTimeoutRef.current);
      pendingCpuTurnRef.current = null;
      matchIdRef.current = null;
      setMatchId(null);
      return;
    }

    await startCpuMatch(gameRef.current);
  }

  async function handleAutoLearnModeChange(event) {
    const enabled = event.target.checked;
    autoLearnModeRef.current = enabled;
    setAutoLearnMode(enabled);
    setCpuError("");

    if (!enabled) {
      window.clearTimeout(autoLearnTimeoutRef.current);
      return;
    }

    if (!cpuModeRef.current) {
      cpuModeRef.current = true;
      setCpuMode(true);
      await startCpuMatch(gameRef.current);
    } else if (gameRef.current.winner) {
      queueAutoLearnRestart();
    } else {
      queueCpuTurn(gameRef.current, gameRef.current);
    }
  }

  async function startCpuMatch(currentGame) {
    try {
      const response = await createCpuMatch({
        humanPlayer: autoLearnModeRef.current ? "none" : HUMAN_PLAYER,
        cpuPlayer: autoLearnModeRef.current ? "both" : CPU_PLAYER,
        difficulty: CPU_DIFFICULTY,
      });
      matchIdRef.current = response.match_id;
      setMatchId(response.match_id);
      resultRecordedRef.current = false;
      if (isCpuTurn(currentGame)) {
        queueCpuTurn(currentGame, currentGame);
      }
    } catch (error) {
      cpuModeRef.current = false;
      setCpuMode(false);
      setCpuError(error instanceof Error ? error.message : "CPUサーバーに接続できませんでした。");
    }
  }

  function isCpuTurn(state) {
    if (!cpuModeRef.current || state.winner) {
      return false;
    }
    return autoLearnModeRef.current || state.currentPlayer === CPU_PLAYER;
  }

  function getActionEffectType(action) {
    if (action.type === ACTION_TYPES.FORCE_MOVE) {
      return "relocated";
    }
    if (action.type === ACTION_TYPES.MOVE) {
      return "moved";
    }
    return "placed";
  }

  return (
    <main className="game-page">
      <header className="game-header">
        <div>
          <p className="eyebrow">Local match</p>
          <h1>シンペイ</h1>
          <p className="game-lead">
            ログインなしで遊べるローカル対戦です。CPUモードでは赤が人間、青がCPUです。自動学習ではCPU同士が対戦を繰り返します。
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
          {cpuThinking && <span>CPU思考中</span>}
          {autoLearnMode && <span>自動学習中</span>}
        </div>
        <p>{game.message}</p>
        {cpuError && <p className="cpu-error">{cpuError}</p>}
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
          boardRef={boardRef}
          pointRefs={pointRefs}
          selectedPiece={selectedPiece}
          legalPlacementTargets={legalPlacementTargets}
          legalMoveTargets={legalMoveTargets}
          forcedMoveTargets={forcedMoveTargets}
          forcedPieceId={forcedPiece?.from}
          flyingPiece={flyingPiece}
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
          disabled={game.phase !== "movement" || game.winner || game.pendingForcedMove || movablePieces.size > 0 || isCpuTurn(game)}
        >
          パス
        </button>
        <label className="cpu-toggle">
          <input
            type="checkbox"
            checked={cpuMode}
            onChange={handleCpuModeChange}
            disabled={cpuThinking}
          />
          CPU対戦
        </label>
        <label className="cpu-toggle">
          <input
            type="checkbox"
            checked={autoLearnMode}
            onChange={handleAutoLearnModeChange}
          />
          自動学習
        </label>
        <div>
          <strong>残り手駒</strong>
          <span>赤 {4 - game.placedCount[PLAYERS.RED]} 個</span>
          <span>青 {4 - game.placedCount[PLAYERS.BLUE]} 個</span>
        </div>
        {cpuMode && matchId && (
          <div>
            <strong>CPU履歴</strong>
            <span>{moveHistory.length} 手</span>
          </div>
        )}
        {autoLearnMode && (
          <div>
            <strong>学習対局</strong>
            <span>{autoLearnStats.games} 局</span>
            <span>赤 {autoLearnStats.redWins}</span>
            <span>青 {autoLearnStats.blueWins}</span>
          </div>
        )}
      </section>
    </main>
  );
}

function IntegratedBoard({
  game,
  boardRef,
  pointRefs,
  selectedPiece,
  legalPlacementTargets,
  legalMoveTargets,
  forcedMoveTargets,
  forcedPieceId,
  flyingPiece,
  movablePieces,
  uiEffect,
  onPointClick,
}) {
  return (
    <section className="integrated-board-panel">
      <h2>ボード</h2>
      <div className="simpei-board" ref={boardRef}>
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
              ref={(element) => {
                if (element) {
                  pointRefs.current.set(id, element);
                } else {
                  pointRefs.current.delete(id);
                }
              }}
              aria-label={occupant ? `${label}: ${getPlayerLabel(occupant)}の駒` : `${label}: 空き`}
            >
              <span className="point-hole" />
              {isLegalTarget && !occupant && <span className="target-marker" />}
              {occupant && flyingPiece?.from !== id && (
                <span className="piece">
                  <span className="piece-head">{getPlayerLabel(occupant)}</span>
                  <span className="piece-stem" />
                </span>
              )}
              {!occupant && <span className="point-label">{getPointLabel(world, row, col)}</span>}
            </button>
          );
        })}
        {flyingPiece && (
          <span
            className={`flying-piece ${flyingPiece.player}`}
            style={{
              left: flyingPiece.left,
              top: flyingPiece.top,
              width: flyingPiece.size,
              "--fly-x": `${flyingPiece.deltaX}px`,
              "--fly-y": `${flyingPiece.deltaY}px`,
            }}
            aria-hidden="true"
          >
            <span className="piece">
              <span className="piece-head">{getPlayerLabel(flyingPiece.player)}</span>
              <span className="piece-stem" />
            </span>
          </span>
        )}
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
