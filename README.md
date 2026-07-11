# 三国覇王戦記 編成シミュレーター

[![build](https://github.com/yuichi4107-lab/sangoku-sim/actions/workflows/build.yml/badge.svg)](https://github.com/yuichi4107-lab/sangoku-sim/actions/workflows/build.yml)

ブラウザだけで動く、自己完結型の編成シミュレーター。プレイヤー（最大可変）× 軍団8件の集結編成と、属性別の集計・自動編成・cap pool 考慮を提供する。

**公開URL**: <https://yuichi4107-lab.github.io/sangoku-sim/>

## 主な機能

- プレイヤー単位の所持武将管理（突破・装備・将印・Lv突破）
- 集結（最大4プレイヤー × 2軍団 = 8軍団）の編成
- 集結共通の第一/第二優先属性、軍団ごとの兵種設定で自動編成
- 属性マトリクスでの集計（編成内のみ / 全所持武将）
- cap pool（共有 / 非共有）を考慮した上限管理
- JSON エクスポート/インポートで端末間の所持データ移行

## 技術構成

- **`index.html`** — 単一ファイル。データを `<script>window.GENERALS_DATA = {...};</script>` として埋め込んだ自己完結 HTML。`file://` でも `https://` でも動く
- **`generals.yaml`** — 武将マスターデータ（スキル・cap rule・将印など）。これが一次データ
- **`scripts/`** — Python ビルドツール
  - `build_generals_from_xlsx.py` — xlsx 一次資料から武将を生成（手動実行）
  - `classify_skill_attributes.py` — 各スキルに `effect_attribute` / `direction` を付与
  - `validate_generals.py` — 重複・能力値・旧ID・スキル構造などを検査
  - `generate_data_overview.py` — 現在の登録状況を `docs/data_overview.md` に一覧化
  - `inline_data_to_html.py` — `generals.yaml` を JSON 化して各画面に埋め込む

## 開発フロー

### 通常編集（任意の端末から）

1. **github.dev** で開く: <https://github.dev/yuichi4107-lab/sangoku-sim>
   またはリポジトリページで `.` キー
2. ファイルを編集
3. 変更をコミット & push（ブラウザ UI 完結）
4. **`generals.yaml` を編集した場合**は自動で属性再分類・データ検査・一覧更新・HTML 再埋め込みが走る（[GitHub Actions](.github/workflows/build.yml)）
5. push 後 1〜2 分で <https://yuichi4107-lab.github.io/sangoku-sim/> に反映

### ターミナル必要時（Codespaces）

xlsx 解析や `build_generals_from_xlsx.py` 実行など、スクリプトを直接走らせたい場合:

1. リポジトリページ → 「Code」→「Codespaces」→「Create codespace on main」
2. ブラウザ上の VS Code が起動し、Python 3.12 + pyyaml + openpyxl が自動セットアップ済み
3. ターミナルで `python scripts/build_generals_from_xlsx.py` など実行
4. 編集 → コミット → push

### ローカル開発（任意）

```powershell
git clone https://github.com/yuichi4107-lab/sangoku-sim.git
cd sangoku-sim
pip install pyyaml openpyxl
python -m http.server 8000     # → http://localhost:8000/
```

スクリプトは `scripts/` 配下にあり、すべて `python scripts/<name>.py` で実行できる（パスは相対指定）。

## 自動化（GitHub Actions）

`generals.yaml` または関連するデータ処理スクリプトが push されると、`build` ワークフローが:

1. `classify_skill_attributes.py` を実行（属性再付与）
2. `validate_generals.py` を実行（マスターデータ検査）
3. `generate_data_overview.py` を実行（現状一覧の更新）
4. `inline_data_to_html.py` を実行（全画面の埋め込みデータ更新）
5. 差分があれば自動コミット & push

その後 GitHub Pages が自動再デプロイ。

`3_20251224.xlsx` の更新による武将リスト再生成（`build_generals_from_xlsx.py`）は自動化していない（差分が大きすぎるため手動レビュー推奨）。

## ライセンス / データ出典

- ゲーム名・キャラクター名は『三国覇王戦記〜乱世の系譜〜』（Six Waves Inc.）に帰属
- 本リポジトリのコードは個人利用範囲のサポートツール
- スキル効果データは公開 wiki（gamer-wiki 等）および筆者が独自に整理したものを参照
