# Rule Worktree: Piece Traits

## Scope

This worktree isolates piece traits without covering or obstacles.

Included:

- Each player has one big heavy piece, one medium normal piece, and two small light pieces.
- Heavy pieces can only be relocated to adjacent empty cells when sandwiched.
- If a heavy piece has no adjacent empty relocation target, the capture effect is ignored for that piece.
- Each light piece can use one two-step move per game.

Excluded:

- Obstacle tokens.
- Size-based covering.
- Stacks and hidden pieces.

## Branch and Ports

- Branch: `rule/piece-traits`
- Frontend: `http://127.0.0.1:5176`
- API: `http://127.0.0.1:8013`
- DB: `server/data/simpei_cpu_piece_traits.sqlite3`

## Run

```bash
SIMPEI_DATABASE_PATH=server/data/simpei_cpu_piece_traits.sqlite3 \
SIMPEI_ALLOWED_ORIGINS='*' \
OLLAMA_MODEL=gpt-oss:20b \
uvicorn server.app.main:app --host 127.0.0.1 --port 8013
```

```bash
VITE_CPU_API_BASE=http://127.0.0.1:8013 npm run dev -- --port 5176
```

## Validate

```bash
npm test
python -m pytest server/tests
npm run lint
npm run build
```

`npm run build` requires the local Amplify output file `amplify_outputs.json`.
If it is missing, generate or copy that file before building.
