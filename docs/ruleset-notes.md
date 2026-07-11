# Rule Worktree: Obstacles

## Scope

This worktree isolates the obstacle-token rule.

Included:

- Each player has one obstacle token.
- Obstacles can be placed during the movement phase instead of moving a piece.
- Obstacles block placement, movement, covering, forced relocation, and future obstacle placement.
- Obstacles do not count for wins or sandwich captures.

Excluded:

- Size-based covering.
- Piece traits.
- Light-piece two-step movement.

## Branch and Ports

- Branch: `rule/obstacles`
- Frontend: `http://127.0.0.1:5174`
- API: `http://127.0.0.1:8011`
- DB: `server/data/simpei_cpu_obstacles.sqlite3`

## Run

```bash
SIMPEI_DATABASE_PATH=server/data/simpei_cpu_obstacles.sqlite3 \
SIMPEI_ALLOWED_ORIGINS='*' \
OLLAMA_MODEL=gpt-oss:20b \
uvicorn server.app.main:app --host 127.0.0.1 --port 8011
```

```bash
VITE_CPU_API_BASE=http://127.0.0.1:8011 npm run dev -- --port 5174
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
