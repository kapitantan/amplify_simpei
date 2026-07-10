# ローカルLLM CPU サーバー計画

## 目的

シンペイに人間 vs CPU を追加し、自宅サーバー `acer` 上のローカル LLM で CPU の手を選ばせる。
CPU の判断材料と対戦履歴を保存し、将来のプロンプト改善・評価・微調整に使える形にする。

## v1 方針

- フロントは既存のゲームロジックで合法手を列挙する。
- FastAPI は `gameState` と `legalActions` を受け取り、Ollama に候補手から1つ選ばせる。
- LLM が不正手、壊れた JSON、タイムアウトを返した場合は、先頭の合法手をフォールバックとして返す。
- SQLite に対戦と1手ごとの履歴を保存する。
- 開発中は公開 HTTPS 化せず、SSH トンネルで接続する。

## 採用モデル

既定モデルは `gpt-oss:120b` とする。

理由:

- Ollama で直接取得・実行できる open-weight reasoning model。
- Apache 2.0 ライセンスで、実験・改変・将来の商用利用を妨げにくい。
- 構造化出力、tool use、reasoning effort に対応しており、合法手候補から JSON で1手を選ばせる今回の用途に合う。
- Ollama 上のサイズは約 65GB、context は 128K。大きいが、家庭サーバーで「性能優先」の第一候補として現実的に扱える上限に近い。

注意:

- 純粋な推論性能だけを最優先し、400GB 以上のメモリ/VRAMを確保できるなら `deepseek-r1:671b` も候補になる。ただし Ollama 上のサイズが約 404GB で、通常の自宅サーバーでは運用負荷がかなり高い。
- `gpt-oss:120b` が重すぎる場合の実用代替は `gpt-oss:20b`。同じモデル系で API 契約を変えずに試せる。

FastAPI 側の既定値も `gpt-oss:120b` にしている。変更する場合は `OLLAMA_MODEL` を指定する。

```sh
OLLAMA_MODEL=gpt-oss:20b uvicorn server.app.main:app --host 127.0.0.1 --port 8000
```

## acer への Ollama インストール手順

手元端末から自宅サーバーへ入る。

```sh
ssh acer
```

OS と CPU/GPU を確認する。

```sh
uname -a
free -h
df -h
lscpu | head
nvidia-smi || true
```

Ollama をインストールする。

```sh
curl -fsSL https://ollama.com/install.sh | sh
```

systemd サービスとして起動・自動起動を確認する。

```sh
sudo systemctl enable --now ollama
sudo systemctl status ollama --no-pager
```

Ollama API がローカルで応答することを確認する。

```sh
curl http://localhost:11434/api/tags
```

## 再起動後のセットアップ手順

自宅サーバーを再起動した後は、まず GPU ドライバの状態を確認する。

```sh
nvidia-smi
```

RTX 4070 が表示されれば GPU は利用可能。まだ `Driver/library version mismatch` が出る場合は、推奨ドライバを入れ直して再起動する。

```sh
sudo apt update
sudo apt install nvidia-driver-595-open
sudo reboot
```

Ollama が起動しているか確認する。

```sh
sudo systemctl status ollama --no-pager
curl http://localhost:11434/api/tags
```

未インストールの場合は Ollama を入れる。

```sh
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable --now ollama
curl http://localhost:11434/api/tags
```

この acer は RAM 31GiB / 空きディスク約60GB のため、まずは `gpt-oss:20b` を使う。

```sh
ollama pull gpt-oss:20b
ollama run gpt-oss:20b 'Return JSON only: {"ok": true}'
```

repo が acer 上にある場合は移動する。

```sh
cd ~/workspace/dev/simpei
```

まだ repo がない場合は clone する。

```sh
mkdir -p ~/workspace/dev
cd ~/workspace/dev
git clone <このrepoのURL> simpei
cd simpei
```

FastAPI の Python 環境を作る。

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
```

FastAPI を `gpt-oss:20b` で起動する。

```sh
OLLAMA_MODEL=gpt-oss:20b uvicorn server.app.main:app --host 127.0.0.1 --port 8000
```

別ターミナルで確認する。

```sh
curl http://127.0.0.1:8000/health
```

期待値:

```json
{
  "ok": true,
  "ollama_ok": true,
  "model": "gpt-oss:20b",
  "database_path": "server/data/simpei_cpu.sqlite3"
}
```

手元 Mac から acer の FastAPI へつなぐ場合は、Mac 側で SSH トンネルを張る。

```sh
ssh -L 8000:localhost:8000 acer
```

Mac 側の repo でフロントを起動する。

```sh
VITE_CPU_API_BASE=http://localhost:8000 npm run dev
```

ブラウザで開く。

```text
http://127.0.0.1:5173/
```

画面の `CPU対戦` を ON にする。

採用モデルを取得する。`gpt-oss:120b` は約 65GB あるため、ディスク容量と回線時間に注意する。

```sh
ollama pull gpt-oss:120b
```

簡単に応答確認する。

```sh
ollama run gpt-oss:120b 'Return JSON only: {"ok": true}'
```

モデル一覧に入っているか確認する。

```sh
ollama list
```

メモリ不足や速度が厳しい場合は、同じ手順で軽量版を取得する。

```sh
ollama pull gpt-oss:20b
ollama run gpt-oss:20b 'Return JSON only: {"ok": true}'
```

## FastAPI との接続確認

acer 上でこの repo に入り、Python 依存を入れる。

```sh
cd /path/to/simpei
python -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
```

FastAPI を `gpt-oss:120b` で起動する。

```sh
OLLAMA_MODEL=gpt-oss:120b uvicorn server.app.main:app --host 127.0.0.1 --port 8000
```

別シェルで health check を確認する。

```sh
curl http://127.0.0.1:8000/health
```

期待値:

```json
{
  "ok": true,
  "ollama_ok": true,
  "model": "gpt-oss:120b",
  "database_path": "server/data/simpei_cpu.sqlite3"
}
```

CPU 手の API を直接確認する。

```sh
curl -s -X POST http://127.0.0.1:8000/cpu/move \
  -H 'Content-Type: application/json' \
  -d '{
    "game_state": {"turnNumber": 1, "currentPlayer": "blue"},
    "legal_actions": [{"type": "place", "to": "upper-1-1"}],
    "cpu_player": "blue"
  }'
```

`selected_action` が `legal_actions` の中から返れば接続は成功。

## 手元フロントから acer の FastAPI へつなぐ

手元端末で SSH トンネルを張る。

```sh
ssh -L 8000:localhost:8000 acer
```

手元端末でフロントを起動する。

```sh
VITE_CPU_API_BASE=http://localhost:8000 npm run dev
```

画面で `CPU対戦` を有効にする。

## トラブルシュート

- `/health` の `ollama_ok` が `false`
  - `sudo systemctl status ollama --no-pager`
  - `curl http://localhost:11434/api/tags`
  - `ollama list`
- `gpt-oss:120b` が遅い、またはメモリ不足
  - `OLLAMA_MODEL=gpt-oss:20b` に落として検証する。
- ディスク不足
  - `df -h`
  - 不要モデルは `ollama rm <model>` で削除する。
- FastAPI は動くがフロントから接続できない
  - SSH トンネルを確認する。
  - `curl http://localhost:8000/health` を手元端末で確認する。

## 起動方法

acer 側で Ollama と FastAPI を起動する。

```sh
ollama serve
cd /path/to/simpei
python -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
OLLAMA_MODEL=gpt-oss:120b uvicorn server.app.main:app --host 127.0.0.1 --port 8000
```

手元端末から接続する場合は SSH トンネルを張る。

```sh
ssh -L 8000:localhost:8000 acer
```

フロントは既定で `http://localhost:8000` に接続する。
変更する場合は Vite の環境変数を使う。

```sh
VITE_CPU_API_BASE=http://localhost:8000 npm run dev
```

## API 契約

### `POST /matches`

対戦を作成する。

入力:

```json
{
  "human_player": "red",
  "cpu_player": "blue",
  "difficulty": "normal"
}
```

出力:

```json
{
  "match_id": "uuid"
}
```

### `POST /cpu/move`

CPU の手を要求する。

入力:

```json
{
  "match_id": "uuid",
  "game_state": {},
  "legal_actions": [{ "type": "place", "to": "upper-1-1" }],
  "cpu_player": "blue",
  "difficulty": "normal",
  "move_history": []
}
```

出力:

```json
{
  "selected_action": { "type": "place", "to": "upper-1-1" },
  "reason": "Selected by local LLM.",
  "model": "gpt-oss:120b",
  "latency_ms": 1234,
  "fallback": false
}
```

`selected_action` は必ず `legal_actions` のいずれかでなければならない。
FastAPI 側でも検証し、フロント側でも再検証してから盤面へ適用する。

### `POST /matches/{match_id}/moves`

人間の手を保存する。CPU の手は `/cpu/move` 内で保存する。

### `PATCH /matches/{match_id}/result`

終局結果と最終盤面を保存する。

### `GET /health`

FastAPI と Ollama 到達性を確認する。

## action 表現

フロントと FastAPI の境界では、手を次の JSON で表す。

```json
{ "type": "place", "to": "upper-1-1" }
{ "type": "move", "from": "upper-1-1", "to": "lower-0-0" }
{ "type": "forceMove", "from": "lower-1-1", "to": "upper-0-0" }
{ "type": "pass" }
```

合法手の列挙と適用は `src/game/simpei.js` の `getLegalActions` と `applyAction` を使う。

## SQLite 保存内容

既定の DB は `server/data/simpei_cpu.sqlite3`。

- `matches`: 対戦ID、開始/終了時刻、人間/CPUの色、難易度、モデル、勝者、最終盤面
- `moves`: 手番、手番プレイヤー、合法手一覧、選択手、適用前後の局面、LLM理由、モデル、レイテンシ

確認例:

```sh
sqlite3 server/data/simpei_cpu.sqlite3 'select id, winner, result_reason from matches;'
sqlite3 server/data/simpei_cpu.sqlite3 'select match_id, actor, player, turn_number, action_json from moves;'
```

## 今後の拡張

- JSONL エクスポートを追加し、学習・評価データを作りやすくする。
- CPU vs CPU の自己対戦バッチを追加する。
- Minimax/MCTS などの探索 AI と LLM 評価を比較する。
- 対戦履歴が十分に集まってから LoRA/SFT の効果を検証する。
