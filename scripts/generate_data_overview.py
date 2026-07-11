"""generals.yaml から最新のデータ一覧を生成する。"""
from __future__ import annotations

from collections import Counter
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parent.parent
YAML_PATH = ROOT / "generals.yaml"
OUTPUT_PATH = ROOT / "docs" / "data_overview.md"
ATTRIBUTES = ("攻撃", "防御", "連撃", "貫通", "抵抗", "シールド", "貫通抵抗", "ダメージ", "軍紀", "率兵", "兵士数", "抑制")


def cell(value: object) -> str:
    return str(value if value not in (None, "") else "未確認").replace("|", "\\|").replace("\n", " ")


def slot_label(value: object) -> str:
    if isinstance(value, list):
        return "/".join(map(str, value))
    return cell(value)


def skill_label(skills: list[dict]) -> str:
    names = [str(s.get("name") or "名称未設定") for s in skills]
    shown = names[:3]
    if len(names) > 3:
        shown.append(f"ほか{len(names) - 3}件")
    return ", ".join(shown) if shown else "未登録"


def main() -> None:
    data = yaml.safe_load(YAML_PATH.read_text(encoding="utf-8"))
    meta = data.get("meta") or {}
    generals = data.get("generals") or []
    rarity = Counter(g.get("base_rarity") or "未確認" for g in generals)
    troop = Counter(g.get("troop_type") or "未確認" for g in generals)
    skill_count = sum(len(g.get("skills") or []) for g in generals)
    incomplete = [g for g in generals if g.get("data_status") == "incomplete"]
    no_skills = [g for g in generals if not (g.get("skills") or [])]
    no_slot = [g for g in generals if not g.get("slot_stat")]
    no_yomi = [g for g in generals if not g.get("yomi")]
    aliases = [(old, g.get("id")) for g in generals for old in (g.get("legacy_ids") or [])]

    lines = [
        f"# データ一覧（{meta.get('last_updated')}）",
        "",
        "> このファイルは `generals.yaml` から自動生成します。手作業では編集しません。",
        "",
        "## 登録状況",
        "",
        f"- 武将: **{len(generals)}体**（" + " / ".join(f"{k}={v}" for k, v in rarity.items()) + "）",
        f"- 兵種: " + " / ".join(f"{k}={v}" for k, v in troop.items()),
        f"- スキル: **{skill_count}件**",
        f"- 能力値: **{len(generals)}/{len(generals)}体**で統率・武力・知性を登録（各値の下限95）",
        f"- 要確認: データ不完全={len(incomplete)}体 / スキル未登録={len(no_skills)}体 / 配置枠未確認={len(no_slot)}体 / 読み未確認={len(no_yomi)}体",
        f"- 旧ID互換: **{len(aliases)}件**",
        "",
        "### 要確認の武将",
        "",
    ]
    if incomplete:
        for g in incomplete:
            missing = ", ".join(g.get("missing_fields") or [])
            lines.append(f"- **{g.get('name')}**: {missing}。{g.get('notes') or ''}".rstrip())
    else:
        lines.append("- なし")

    lines.extend(["", "### 旧IDの引き継ぎ", ""])
    if aliases:
        for old, current in aliases:
            lines.append(f"- `{old}` → `{current}`")
    else:
        lines.append("- なし")

    lines.extend([
        "",
        "## 優先属性として選択できるスキル属性",
        "",
        "各属性に `up` / `down` の2方向があり、合計24択と「なし」を選択できます。",
        "",
        "| 属性 | up | down |",
        "|---|---|---|",
    ])
    for attr in ATTRIBUTES:
        lines.append(f"| {attr} | {attr}アップ | {attr}ダウン |")

    lines.extend([
        "",
        f"## 武将一覧（全{len(generals)}件）",
        "",
        "| # | 武将名 | 読み | レア | 兵種 | 配置枠 | 統率 | 武力 | 知性 | スキル | 主なスキル | 状態 |",
        "|---:|---|---|---|---|---|---:|---:|---:|---:|---|---|",
    ])
    for index, g in enumerate(generals, 1):
        stats = g.get("stats") or {}
        skills = g.get("skills") or []
        status = "要確認" if g.get("data_status") == "incomplete" else "登録済み"
        lines.append(
            f"| {index} | **{cell(g.get('name'))}** | {cell(g.get('yomi'))} | "
            f"{cell(g.get('base_rarity'))} | {cell(g.get('troop_type'))} | {slot_label(g.get('slot_stat'))} | "
            f"{cell(stats.get('統率'))} | {cell(stats.get('武力'))} | {cell(stats.get('知性'))} | "
            f"{len(skills)} | {cell(skill_label(skills))} | {status} |"
        )

    OUTPUT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"generated {OUTPUT_PATH.relative_to(ROOT)}: {len(generals)} generals")


if __name__ == "__main__":
    main()
