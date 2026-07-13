# Simpei ML ポリシー

この文書は、CPU の自動学習データを SQLite から取り出し、policy/value モデルを学習し、そのモデルを CPU サーバーで使うまでの手順をまとめる。

## 全体の流れ

1. CPU サーバーとフロントエンドを起動し、画面の自動学習で CPU vs CPU の完了対戦を SQLite に蓄積する。
2. 終局済み CPU 手を SQLite から JSONL にエクスポートする。
3. JSONL を使って policy/value モデルを学習する。
4. 生成された `.pt` ファイルを指定して、CPU サーバーを `hybrid` または `ml` モードで起動する。

## 前提

作業はリポジトリルートで実行する。たとえば `~/dev/amplify_simpei` にいる状態を前提にする。

```bash
pwd
```

このコマンドは、現在の作業ディレクトリを確認するために使う。`server/data` の中に移動した状態で `server/data/...` というパスを指定すると、`server/data/server/data/...` を探して失敗する。

Linux 環境では `python` コマンドが存在しないことがあるため、この手順では `python3` と `python3 -m pip` を使う。

## CPU サーバーを起動する

```bash
SIMPEI_DATABASE_PATH=server/data/simpei_cpu_stacks_cover.sqlite3 \
SIMPEI_ALLOWED_ORIGINS='*' \
OLLAMA_MODEL=gpt-oss:20b \
python3 -m uvicorn server.app.main:app --host 127.0.0.1 --port 8012
```

このコマンドは、CPU の手を返す FastAPI サーバーを起動する。`SIMPEI_DATABASE_PATH` は対戦履歴を保存する SQLite ファイルを指定する。自動学習で増えたデータをあとで ML 学習に使うため、エクスポート時にも同じ DB パスを指定する。

`--host 127.0.0.1` は Acer 上のローカル接続だけを受け付ける設定。SSH ポートフォワードで使う場合はこのままでよい。LAN から直接アクセスしたい場合だけ `--host 0.0.0.0` を使う。

起動確認は Acer 上で行う。

```bash
curl http://127.0.0.1:8012/health
```

このコマンドは、CPU サーバーが `8012` で待ち受けているかを確認する。ここで通らない場合、フロントエンドや SSH トンネル以前に API サーバーが起動していない。

ポートの待ち受け確認には次を使う。

```bash
ss -ltnp | grep 8012
```

`uvicorn` が `127.0.0.1:8012` で `LISTEN` していれば、Acer 上の API サーバーは起動している。

## フロントエンドを起動する

```bash
VITE_CPU_API_BASE=http://127.0.0.1:8012 npm run dev
```

このコマンドは、Vite の開発サーバーを起動し、フロントエンドから CPU API へ接続する先を `127.0.0.1:8012` にする。`VITE_CPU_API_BASE` は Vite 起動時に読み込まれるため、値を変えた場合は `npm run dev` を再起動する。

`VITE_CPU_API_BASE=http://localhost:8000` のように古いポートを指定すると、CPU サーバーが `8012` にいる場合は接続に失敗する。

手元 PC のブラウザから Acer 上の Vite を見る場合、ブラウザから見た `127.0.0.1` は手元 PC 自身を指す。そのため、Vite と CPU API の両方を SSH で転送する。

```bash
ssh -N \
  -L 5173:127.0.0.1:5173 \
  -L 8012:127.0.0.1:8012 \
  rikuto@acer
```

このコマンドは、手元 PC の `5173` を Acer の Vite へ、手元 PC の `8012` を Acer の CPU API へ転送する。`channel 3: open failed: connect failed: Connection refused` が出る場合は、転送先ポートでサーバーが待ち受けていないか、転送先ホストが想定と違う可能性が高い。

手元 PC 側でも API に届くか確認する。

```bash
curl http://127.0.0.1:8012/health
```

この確認が通らない状態では、ブラウザの自動学習も通らない。

## 学習データ量を確認する

```bash
sqlite3 server/data/simpei_cpu_stacks_cover.sqlite3 \
  "select count(*) from moves where actor='cpu' and outcome is not null;"
```

このコマンドは、ML 学習に使える CPU 手の数を確認する。現在の実装では、終局結果が付与された CPU の 1 手が 1 学習サンプルになる。

目安は次の通り。

- `1,000` 未満: 動作確認レベル。
- `5,000` から `20,000`: 多少の傾向を見るレベル。
- `50,000` 以上: `hybrid` モードで試す価値が出る。
- `100,000` 以上: `ml` 単独との比較を始めたい水準。
- `500,000` 以上: 評価が安定しやすくなる。

SQLite ファイルのサイズより、上記のサンプル数を優先して見る。たとえば 19MB の DB でも、実際の学習サンプルが 1,000 件程度なら、強さを期待するにはまだ少ない。

## JSONL にエクスポートする

```bash
python3 -m server.ml.export_dataset \
  --database server/data/simpei_cpu_stacks_cover.sqlite3 \
  --output server/data/ml/policy_value.jsonl
```

このコマンドは、終局済み CPU 手を SQLite から読み出し、学習用 JSONL に変換する。`--database` には、自動学習で使った DB と同じパスを指定する。`--output` は生成する JSONL の保存先。

DB ファイルが存在しない、または `matches` / `moves` テーブルがない場合は、未初期化 DB として終了する。その場合は、同じ `SIMPEI_DATABASE_PATH` で CPU サーバーを起動し、自動学習で完了対戦を作ってから再実行する。

エクスポート後のサンプル数は次で確認できる。

```bash
wc -l server/data/ml/policy_value.jsonl
```

この行数が、そのまま学習に使うサンプル数になる。

## 依存関係を入れる

```bash
python3 -m pip install -r server/requirements-ml.txt
```

このコマンドは、ML 学習に必要な Python 依存関係をインストールする。`pip` コマンドが直接存在しない環境でも、`python3 -m pip` なら使えることが多い。

`uv` を使う場合は、仮想環境を作ってから `uv pip install -r server/requirements-ml.txt` を使ってもよい。プロジェクトの手順としては `python3 -m pip` で動くことを基準にする。

## モデルを学習する

```bash
python3 -m server.ml.train_policy_value \
  --dataset server/data/ml/policy_value.jsonl \
  --device auto
```

このコマンドは、JSONL から policy/value モデルを学習する。`--dataset` はエクスポートした JSONL を指定する。

`--device auto` は、CUDA が使える場合は CUDA、macOS の MPS が使える場合は MPS、それ以外は CPU を使う。GPU を必ず使いたい場合は次のように指定する。

```bash
python3 -m server.ml.train_policy_value \
  --dataset server/data/ml/policy_value.jsonl \
  --device cuda
```

このコマンドは、CUDA が使えない場合に明示的に失敗する。GPU を使っているかは、学習開始時の `training on device=...` の表示で確認する。

モデルは既定で次の形式のファイル名で保存される。

```text
server/models/simpei_policy_value_YYYYMMDDTHHMMSSZ_UUID.pt
```

作成日時と UUID を付けるため、学習のたびに既存モデルを上書きしない。`--output server/models/custom_model.pt` を指定した場合も、実際には `custom_model_YYYYMMDDTHHMMSSZ_UUID.pt` の形式で保存される。

## モデルを評価する

```bash
python3 -m server.ml.evaluate_policy \
  --dataset server/data/ml/policy_value.jsonl \
  --model server/models/simpei_policy_value_YYYYMMDDTHHMMSSZ_UUID.pt
```

このコマンドは、保存済みモデルが、エクスポート済みデータの選択手をどれくらい top-1 で当てるかを確認する。`--model` には、学習時に出力された実際の `.pt` ファイル名を指定する。

同じデータで学習・評価している場合、これは汎化性能ではなく、学習パイプラインの確認値として扱う。

## 学習済みモデルを CPU サーバーで使う

```bash
SIMPEI_CPU_POLICY=hybrid \
SIMPEI_POLICY_MODEL_PATH=server/models/simpei_policy_value_YYYYMMDDTHHMMSSZ_UUID.pt \
SIMPEI_DATABASE_PATH=server/data/simpei_cpu_stacks_cover.sqlite3 \
python3 -m uvicorn server.app.main:app --host 127.0.0.1 --port 8012
```

このコマンドは、学習済みモデルを読み込んだ CPU サーバーを起動する。`SIMPEI_POLICY_MODEL_PATH` には、実際に生成された `.pt` ファイルを指定する。

`hybrid` は既存のヒューリスティックに DNN の再ランク付けを足すため、学習データが少ない段階では `ml` より扱いやすい。`ml` はモデル中心でスコアリングし、モデルが読めない場合はヒューリスティックへフォールバックする。

## CPU ポリシーモード

- `SIMPEI_CPU_POLICY=heuristic`: 既存のヒューリスティック、キャッシュ、フィードバックの挙動を使う。
- `SIMPEI_CPU_POLICY=hybrid`: モデルが利用できる場合、ヒューリスティックのスコアリングに DNN の再ランク付けを組み合わせる。
- `SIMPEI_CPU_POLICY=ml`: モデルが利用できる場合は DNN でスコアリングし、モデルがない場合はヒューリスティックにフォールバックする。

API サーバーは、読み取り可能なモデルファイルを指定して `hybrid` または `ml` モードを有効にしない限り、PyTorch を必要としない。

## よくある詰まり

`python: command not found` が出る場合は、`python` ではなく `python3` を使う。

`pip: command not found` が出る場合は、`python3 -m pip` を使う。`python3 -m pip` も使えない場合は、OS 側に `python3-pip` を入れる。

```bash
sudo apt update
sudo apt install python3-pip
```

`no such table: moves` や未初期化 DB のエラーが出る場合は、指定している SQLite が自動学習で使った DB ではない可能性が高い。`SIMPEI_DATABASE_PATH` と `export_dataset --database` のパスをそろえる。

`unable to open database file` が出る場合は、現在のディレクトリと DB パスを確認する。

```bash
pwd
ls -lh server/data
```

`channel 3: open failed: connect failed: Connection refused` が出る場合は、SSH トンネルの転送先ポートでサーバーが待ち受けていない。Acer 側で `curl http://127.0.0.1:8012/health` と `ss -ltnp | grep 8012` を確認し、手元 PC 側でも `curl http://127.0.0.1:8012/health` を確認する。
