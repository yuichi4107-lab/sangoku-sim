# グループ同期/受信箱 バックエンド（Google Apps Script）

`Code.gs` は、編成シミュレーターのクラウド同期・友人データ受信箱・兵士属性OCR を担う
GAS Web App のソースです。Google 側のプロジェクトが本体で、ここはそのバックアップ兼編集元。

## デプロイ手順
1. https://script.google.com を yuichi4107@gmail.com で開く
2. 対象プロジェクト（三国覇王戦記の同期用）を開く
3. `Code.gs` の中身を全削除 → このリポジトリの `gas/Code.gs` を貼り付けて保存
4. 「デプロイ」→「デプロイを管理」→ 鉛筆（編集）→ バージョン「新バージョン」→「デプロイ」
   - ※ URL は変わらない。**新バージョンでデプロイしないと反映されない**
5. 初回は権限承認（Drive / UrlFetch / Spreadsheet）

## Script Properties（必須）
- `GEMINI_API_KEY` : 兵士属性OCR（Gemini）用の API キー

## スプレッドシート構成（自動作成）
| シート | 役割 | 列/セル |
|---|---|---|
| `users_data` | 共有データの本体（1ユーザー=1行）| user_id / name / ownerships_json / player_stats_json / updated_at |
| `shared_meta` | 編成・優先など軽量データ | A1=更新時刻, A2=チャンク数, A3〜=metaJSON分割 |
| `inbox` | 友人 register.html からの送信 | user_name / ownerships_json / updated_at / image_refs_json / player_stats_json / pin |
| `requests` | 要望（同期モードのフォーム）| created_at / user_name / category / text / status / updated_at |
| `data`（旧）| 旧形式の共有state（B1に全JSON）。移行後は空 | A1/B1/C1 |

Drive: `sangoku_inbox_images`（受信画像）

## 設計のポイント（なぜ users_data 分割か）
- 旧方式は共有state全体を `data!B1` の1セルに格納していたが、**1セル50,000文字制限**により
  約49KBを超えると保存が**サイレント失敗**していた（最大50人×200体＝約1MBで確実に超過）。
- v2 で「1ユーザー=1行」に分割。1人≒20KBなので上限に収まり、1MB級でも保存可能。
- GET は全行＋metaを結合し、従来と同じ `{ok, data, updated_at}` 形式で返す（クライアント無改修）。

## エンドポイント
| メソッド | action | 動作 |
|---|---|---|
| GET | （なし）| 共有データ取得（全ユーザー結合） |
| GET | get_inbox | 受信箱一覧 |
| GET | get_user_by_pin | 暗証番号で本人の前回送信を取得（呼び戻し用）|
| GET | get_requests | 要望一覧 |
| POST | （schema付き）| 一括保存（旧クライアント互換。各ユーザー行＋metaに分解）|
| POST | save_user | 1ユーザー行だけ保存（軽量）|
| POST | save_meta | メタ（編成等）だけ保存 |
| POST | delete_user | 1ユーザー行削除 |
| POST | submit_user | 受信箱へ登録（画像Drive保存）|
| POST | update_stats | 受信箱 player_stats 更新 |
| POST | delete_inbox | 受信箱エントリ削除（画像も）|
| POST | re_ocr | 画像を再OCR |
| POST | submit_request | 要望を保存（同期モードのフォームから）|
| POST | update_request | 要望のステータス変更（id=created_at で特定）|
| POST | delete_request | 要望を削除 |
| POST | clear_all | 共有データ全消去（メンテ用。受信箱・要望は触らない）|

## メンテナンス
- 共有データだけリセットしたい時: `clear_all` をPOST（受信箱は無傷）。
- OCR動作確認: GASエディタで `testOcrLatest` を実行（受信箱最新ユーザーで試行、ログ確認）。
- Drive権限の再承認: `authorizeDrive` を実行。
