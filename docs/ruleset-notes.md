# Rule Worktree: Stacks and Covering

## Scope

This worktree isolates size-based pieces, stacks, and covering.

Included:

- Each player has one size-3 piece, one size-2 piece, and two size-1 pieces.
- Larger pieces can cover smaller top pieces.
- Top pieces alone count for ownership, wins, movement, and sandwich captures.
- Moving or relocating the top piece reveals the covered piece below.
- Revealed pieces never trigger wins or sandwich chains by themselves.
- Forced relocation moves only the top piece and can land only on empty cells.
- During placement, players can choose which remaining size piece to place.
- The board shows the visible top piece size and stack depth.

Excluded:

- Obstacle tokens.
- Heavy-piece relocation limits.
- Light-piece two-step movement.

## Branch and Ports

- Branch: `rule/stacks-cover`
- Frontend: `http://127.0.0.1:5175`
- API: `http://127.0.0.1:8012`
- DB: `server/data/simpei_cpu_stacks_cover.sqlite3`

## Run

```bash
SIMPEI_DATABASE_PATH=server/data/simpei_cpu_stacks_cover.sqlite3 \
SIMPEI_ALLOWED_ORIGINS='*' \
OLLAMA_MODEL=gpt-oss:20b \
uvicorn server.app.main:app --host 127.0.0.1 --port 8012
```

```bash
VITE_CPU_API_BASE=http://127.0.0.1:8012 npm run dev -- --port 5175
```

## Validate

```bash
npm test
python -m pytest server/tests
npm run lint
npm run build
```

`npm run build` does not require a local `amplify_outputs.json`.
To enable the sample `/notes` Amplify screen locally, provide the generated
Amplify outputs JSON through `VITE_AMPLIFY_OUTPUTS_JSON`.
