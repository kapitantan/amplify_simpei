# Simpei ML ポリシー

## 流れ

1. 自動学習を実行し、完了した CPU 対戦を SQLite に蓄積する。
2. 完了済みの CPU 手を JSONL にエクスポートする。
3. ローカルで policy/value モデルを学習する。
4. CPU サーバーを `hybrid` または `ml` モードで起動する。

## コマンド

```bash
python -m server.ml.export_dataset \
  --database server/data/simpei_cpu_stacks_cover.sqlite3 \
  --output server/data/ml/policy_value.jsonl
```

```bash
pip install -r server/requirements-ml.txt
python -m server.ml.train_policy_value \
  --dataset server/data/ml/policy_value.jsonl \
  --output server/models/simpei_policy_value.pt
```

```bash
python -m server.ml.evaluate_policy \
  --dataset server/data/ml/policy_value.jsonl \
  --model server/models/simpei_policy_value.pt
```

```bash
SIMPEI_CPU_POLICY=hybrid \
SIMPEI_POLICY_MODEL_PATH=server/models/simpei_policy_value.pt \
SIMPEI_DATABASE_PATH=server/data/simpei_cpu_stacks_cover.sqlite3 \
uvicorn server.app.main:app --host 127.0.0.1 --port 8012
```

## モード

- `SIMPEI_CPU_POLICY=heuristic`: 既存のヒューリスティック、キャッシュ、フィードバックの挙動を使う。
- `SIMPEI_CPU_POLICY=hybrid`: モデルが利用できる場合、ヒューリスティックのスコアリングに DNN の再ランク付けを組み合わせる。
- `SIMPEI_CPU_POLICY=ml`: モデルが利用できる場合は DNN でスコアリングし、モデルがない場合はヒューリスティックにフォールバックする。

API サーバーは、読み取り可能なモデルファイルを指定して `hybrid` または `ml` モードを有効にしない限り、PyTorch を必要としない。
