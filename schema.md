# 武将データベース スキーマ定義（v0.4）

> 対象: `generals.yaml`（および `generals_sample.yaml`）
> 確定日: 2026-05-14
> 関連: `HANDOFF.md` セクション4の決定 + ユーザー提供 `3_20251224.xlsx` の解析結果

## 0. 決定事項サマリ

### v0.3 から継続

| 決定 | 内容 |
|---|---|
| 段階配列の運用 | **案A**: `by_breakthrough` 5要素配列を完全維持。判明分のみ実数、未判明は `null` |
| 将印段数 | **0〜5 の6段** |
| ステータス収録 | **しない**。スキル特化。`stats` ブロックは持たない |

### v0.4 追加・確定

| 決定 | 内容 |
|---|---|
| 一次情報源 | xlsx（提供資料）。wiki / haou-no-waza は補助 |
| 兵種「共通」 | スキーマ上の `万能` と同一 |
| 配置 | `slot_stat` フィールド必須（統率 / 武力 / 知性、複数可） |
| プレイヤー所持データ | 武将定義から分離（別ファイル `loadouts.yaml` で扱う、本スキーマ対象外） |
| xlsx D列「上限」 | 意味不明のため当面取り込まない。必要なら後で扱う |

---

## 1. ファイル全体構造

```yaml
meta: { ... }       # ゲーム定数・上限ルール定義
generals:           # 武将エントリの配列
  - { ... }
```

---

## 2. `meta` セクション

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `game` | string | ✓ | `"三国覇王戦記～乱世の系譜～"` |
| `publisher` | string | ✓ | `"Six Waves Inc."` |
| `data_version` | string | ✓ | データバージョン（例 `"0.4"`） |
| `last_updated` | string | ✓ | YYYY-MM-DD |
| `rarity_order` | array<string> | ✓ | `["緑","青","紫","橙","玄"]` |
| `troop_types` | array<string> | ✓ | `["歩兵","騎兵","弓兵","戦車","万能"]` |
| `slot_stats` | array<string> | ✓ | `["統率","武力","知性"]`（v0.4新規） |
| `progression_axes` | object | ✓ | 育成段階の4軸定義（§3） |
| `skill_scopes` | object | ✓ | スキル効果スコープ（§4） |
| `cap_rules` | object | ✓ | 上限ルール定義（§5） |
| `value_model` | object | 任意 | 値モデルの説明用 |

---

## 3. `progression_axes`（育成段階の4軸）

| 軸キー | 値域 | 説明 |
|---|---|---|
| `breakthrough` | `[0,1,2,3,4]` | 武将突破。`4`で玄武将化・覚醒スキル解放 |
| `equipment` | `[0,1,2,3,4]` | 装備強化段 |
| `level_break` | `[false, true]` | Lv上限突破 |
| `seal` | `[0,1,2,3,4,5]` | 将印強化枠（0〜5の6段） |

---

## 4. `skill_scopes`（スキル効果スコープ）

| scope | 意味 | 上限の扱い |
|---|---|---|
| `self` | 武将自身/所属部隊のみ | 上限なし |
| `legion` | 軍団全体 | 軍団上限の累加対象 |
| `rally` | 集結全体 | 集結上限の累加対象 |
| `array` | 角陣（戦車副陣） | 別系統 |

---

## 5. `cap_rules`（上限ルール定義）

### 5.1 cap_type 一覧（v0.4 拡張）

| cap_type | 説明 | 必須フィールド |
|---|---|---|
| `none` | 上限なし（積み得） | なし |
| `fixed_percent` | 固定%上限 | `cap_value` |
| `fixed_value` | 固定実数上限 | `cap_value` |
| `ratio_of_base` | 基準値の比率 | `cap_value`, `cap_basis` |
| `bounded` | 上下限ペア | `cap_value`（上限）, `floor_value`（下限） |
| `non_stackable` | 同種同時複数時、**1つしか効かない**（最大値採用） | — |
| `conditional` | 条件で上限値が変わる | `conditions[]`（§5.4） |
| `dynamic_base` | 動的に計算される基準値（味方残兵率等） | `base_formula`（文字列） |
| `unknown` | 未確認 | `note` 推奨 |

### 5.2 共有プール（shared cap）

複数武将のスキルが**1つの上限プールを共有**するパターンに対応。

```yaml
meta:
  cap_rules:
    rally_renge_down_shared:
      scope: "rally"
      cap_type: "fixed_percent"
      cap_value: -50
      shared: true                # ← 共有プール
      shared_group_id: "renge_down_50"  # 同 group_id を持つ他ルールと連帯
      note: "連撃ダウン系。複数武将で合計-50%まで"
```

スキル側:
```yaml
cap:
  rule: "rally_renge_down_shared"
```

**シミュレーター動作**: 同じ `shared_group_id` を持つルールに紐づくスキルは合算してから上限適用。違う `shared_group_id` または `shared:false` のスキルは独立。

### 5.3 共有 vs 非共有 vs 累加不可（重要）

xlsx備考の表記マッピング:

| xlsx表記 | スキーマ表現 |
|---|---|
| `（上限X%）`（無印） | `shared: false`（独立cap） |
| `（上限X%・共有）` | `shared: true`（共有cap） |
| `（上限X%・非共有）` | `shared: false`（独立cap、明示） |
| `（累加不可）` | `cap_type: non_stackable` |
| `（上限累加可、1スキル上限X%）` | `shared:true` + `per_skill_cap: X` |

### 5.4 条件付き上限（`conditional`）

例: 王双「（上限30%、馬スキル時上限15%、典韋・曹仁の80%・共有）」

```yaml
cap:
  rule: "rally_resistance_complex"
  cap_type: "conditional"
  conditions:
    - when: "default"
      cap_value: 30
    - when: "from_horse_skill"
      cap_value: 15
    - when: "shared_with"
      with_generals: ["typai", "souzin"]
      cap_value: 80
      shared: true
```

v0.4 では構造のみ定義、シミュレーターは段階的に対応。

### 5.5 既存ルール一覧（v0.4 時点）

| ルール名 | scope | cap_type | cap_value | shared | 用途 |
|---|---|---|---|---|---|
| `no_cap` | （任意） | `none` | — | — | 上限なし |
| `legion_buff_default` | `legion` | `unknown` | — | unknown | 軍団バフ未確認 |
| `rally_debuff_attack` | `rally` | `fixed_percent` | -50 | true | 集結・敵攻撃ダウン |
| `rally_suppress` | `rally` | `fixed_percent` | 80 | true | 集結・抑制操作 |
| `rally_shield_reduce` | `rally` | `fixed_value` | -10000000 | true | 集結・敵シールド減少 |
| `rally_attack_up` | `rally` | `fixed_percent` | 50 | true | 集結・全体攻撃up |
| `rally_renge_up` | `rally` | `fixed_percent` | 60 | true | 集結・連撃up |
| `rally_renge_down_shared` | `rally` | `fixed_percent` | -50 | true | 連撃down共有 |
| `rally_per_soldier_pt` | `rally` | `fixed_value` | 50 | false | 兵士1人当たりpt（玄趙雲死闘） |
| `rally_target_ratio_dynamic` | `rally` | `dynamic_base` | 0.10 | false | 動的: 集結軍団兵力少ない方の10%（過関斬将） |

新ルールは武将収録時に追加可能。

---

## 6. `generals[]` エントリ（武将）

### 必須フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 一意ID（ローマ字スネーク） |
| `name` | string | 表示名（漢字） |
| `yomi` | string | 読み（ひらがな） |
| `base_rarity` | string | `rarity_order` のいずれか |
| `troop_type` | string | `troop_types` のいずれか（**共通=万能**） |
| `slot_stat` | string \| array<string> | **v0.4新規**: 配置先スロット属性。`"統率"` または `["武力","知性"]` のように複数指定可（玄呂蒙等） |
| `skills` | array<Skill> | スキル配列（§7） |
| `sources` | array<string> | 出典URL or `"xlsx:3_20251224.xlsx#武将!Bn"` のような内部参照 |

### 任意フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `faction` | string | 所属勢力（魏/呉/蜀/群/漢/晋/他） |
| `role_tags` | array<string> | 役割タグ |
| `base_general_id` | string | このエントリが玄武将版の場合の覚醒元ID |
| `awakened_id` | string | このエントリが通常版で玄武将版が存在する場合の玄武将ID |
| `seal_bonus` | object | 将印効果（§8） |
| `notes` | string | 編集者メモ |

---

## 7. `Skill` オブジェクト

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `name` | string | ✓ | スキル名 |
| `type` | string | ✓ | `buff` / `debuff` / `convert` / `amplify` / `passive` / `proc`（確率発動） / その他 |
| `scope` | string | ✓ | `self` / `legion` / `rally` / `array` |
| `unlocked_at` | int | ✓ | 解放される突破段（0〜4）。**装備で解放される場合は§7.3 を参照** |
| `unlocked_at_equipment` | int | 任意 | **v0.4新規**: 装備段で解放されるスキル用（0〜4）。`unlocked_at` と併用可 |
| `effect` | string | ✓ | 効果文 |
| `unit` | string | ✓ | `percent` / `value` / `pt_per_soldier` / `count` 等 |
| `value` | object | ✓ | 段階別実数テーブル（§7.1） |
| `cap` | object | 任意 | 上限指定（§7.2） |
| `stacking` | string | 任意 | **v0.4新規**: `additive`（既定）/ `non_stackable`（累加不可、最大値採用） |
| `proc_chance` | number | 任意 | **v0.4新規**: 発動確率（％）。type:proc 用 |
| `proc_max_targets` | int | 任意 | **v0.4新規**: 確率発動の最大対象数 |
| `confidence` | string | 任意 | スキル全体の確度 |
| `sources` | array<string> | 任意 | スキル個別の出典 |

### 7.1 `value` テーブル

```yaml
value:
  by_breakthrough: [null, null, null, null, 20]
  by_equipment:    [0, null, null, null, null]
  confidence: "low"
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `by_breakthrough` | array(5) | ✓ | 5要素必須。判明分のみ実数、未判明は `null` |
| `by_equipment` | array(5) | 任意 | 5要素、装備段ごとの加算 |
| `confidence` | string | ✓ | `high` / `medium` / `low` / `unknown` |

### 7.2 `cap` フィールド

```yaml
cap:
  rule: "rally_suppress"          # meta.cap_rules のキー
  cap_value: 80                   # 再掲（可読性のため）
  cap_basis: "敵の元の貫通値"      # ratio_of_base 系
  per_skill_cap: 10               # 1スキル上限（per_skill_cap オプション）
  conditions: [...]               # conditional 用
  note: "..."
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `rule` | string | ✓ | `meta.cap_rules` のキー |
| `cap_value` | number\|null | 任意 | ルール側の値を再掲 |
| `cap_basis` | string | 任意 | `ratio_of_base` 時の基準説明 |
| `per_skill_cap` | number | 任意 | 1スキル上限 |
| `conditions` | array | 任意 | `conditional` 用 |
| `note` | string | 任意 | 補足 |

### 7.3 装備で解放される追加効果

xlsx備考の「【装備】敵貫通5%減（累加不可）」のように、装備強化で**追加スキル効果**が出現するパターンは、独立した skill エントリとして表現する:

```yaml
skills:
  - name: "兵士5%殺傷"                 # 通常スキル
    scope: "rally"
    unlocked_at: 4
    value: { by_breakthrough: [null,null,null,null,5], confidence: "high" }
    cap: { rule: "rally_kill_ratio", cap_value: 10 }
  - name: "敵貫通5%減（装備）"          # 装備で追加されるサブ効果
    scope: "rally"
    unlocked_at: 0
    unlocked_at_equipment: 1           # ←装備1で解放
    stacking: "non_stackable"           # ←累加不可
    value: { by_breakthrough: [null,null,null,null,-5], confidence: "low" }
```

---

## 8. `seal_bonus`（将印効果）

```yaml
seal_bonus:
  by_seal: [null, null, null, null, null, null]
  effect_note: "将印固有の強化。要確認。"
  confidence: "unknown"
```

将印効果の構造は v0.4 時点で xlsx に詳細データなし。`by_seal` 配列（長さ6）で枠だけ確保。

---

## 9. confidence 体系

| 値 | 基準 |
|---|---|
| `high` | xlsx備考に明記、または公式/ゲーム内実測 |
| `medium` | wiki＋xlsx等 複数ソース一致 |
| `low` | 単一ソース、または推測の余地あり |
| `unknown` | 未確認 |

---

## 10. バリデーションルール

1. `meta` トップレベルキーが全て存在
2. `generals[].id` ユニーク
3. `generals[].troop_type` が `meta.troop_types` に含まれる
4. `generals[].base_rarity` が `meta.rarity_order` に含まれる
5. `generals[].slot_stat` が `meta.slot_stats` のいずれか（配列の場合は各要素が含まれる）
6. 全 `skill.scope` が `meta.skill_scopes` のキーに含まれる
7. 全 `skill.cap.rule` が `meta.cap_rules` のキーに含まれる
8. 全 `value.by_breakthrough` が長さ5
9. `value.by_equipment` 存在時は長さ5
10. `seal_bonus.by_seal` 存在時は長さ6
11. `unlocked_at` が `0..4` の整数
12. `unlocked_at_equipment` 存在時は `0..4` の整数
13. `sources` が空でない

検証スクリプト `scripts/validate_generals.py`（フェーズ4で作成予定）。

---

## 11. バージョン履歴

| バージョン | 日付 | 変更 |
|---|---|---|
| 0.1 | — | 初版（1エントリ＝1段階固定） |
| 0.2 | — | 段階別テーブル化 |
| 0.3 | 2026-05-14 | `stats` 非収録、将印0〜5確定、案A確定、スキーマ明文化 |
| 0.4 | 2026-05-14 | xlsx由来の概念取り込み: `slot_stat`、共有cap、累加不可、条件付きcap、装備で追加効果、`万能` troop_type、`troop_type` の「共通」エイリアス、`proc_*` 等 |
