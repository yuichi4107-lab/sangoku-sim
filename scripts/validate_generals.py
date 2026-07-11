"""generals.yaml の登録品質を検査する。"""
from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
import sys

import yaml


ROOT = Path(__file__).resolve().parent.parent
YAML_PATH = ROOT / "generals.yaml"
REQUIRED_STATS = ("統率", "武力", "知性")
REQUIRED_SKILL_FIELDS = ("name", "type", "scope", "unlocked_at", "effect", "unit", "value")
ALLOWED_DIRECTIONS = {"up", "down", "both", None}


def main() -> int:
    data = yaml.safe_load(YAML_PATH.read_text(encoding="utf-8"))
    meta = data.get("meta") or {}
    generals = data.get("generals") or []
    errors: dict[str, list[str]] = defaultdict(list)
    warnings: dict[str, list[str]] = defaultdict(list)

    ids = [str(g.get("id") or "") for g in generals]
    names = [str(g.get("name") or "") for g in generals]
    for value, count in Counter(ids).items():
        if not value:
            errors["missing_id"].append("ID未設定の武将があります")
        elif count > 1:
            errors["duplicate_id"].append(value)
    for value, count in Counter(names).items():
        if not value:
            errors["missing_name"].append("名称未設定の武将があります")
        elif count > 1:
            errors["duplicate_name"].append(value)

    id_set = set(ids)
    troop_types = set(meta.get("troop_types") or [])
    slot_stats = set(meta.get("slot_stats") or [])
    cap_rules = set((meta.get("cap_rules") or {}).keys())
    legacy_owner: dict[str, str] = {}

    for g in generals:
        name = str(g.get("name") or g.get("id") or "(名称未設定)")
        troop = g.get("troop_type")
        if troop is None:
            warnings["missing_troop_type"].append(name)
        elif troop not in troop_types:
            errors["invalid_troop_type"].append(f"{name}: {troop}")

        slot = g.get("slot_stat")
        slots = slot if isinstance(slot, list) else ([slot] if slot else [])
        if not slots:
            warnings["missing_slot_stat"].append(name)
        for value in slots:
            if value not in slot_stats:
                errors["invalid_slot_stat"].append(f"{name}: {value}")

        if not g.get("yomi"):
            warnings["missing_yomi"].append(name)
        if not isinstance(g.get("sources"), list) or not g.get("sources"):
            errors["missing_sources"].append(name)

        stats = g.get("stats") or {}
        for key in REQUIRED_STATS:
            value = stats.get(key)
            if not isinstance(value, (int, float)):
                errors["missing_stats"].append(f"{name}: {key}")
            elif value < 95:
                errors["stats_below_95"].append(f"{name}: {key}={value}")

        skills = g.get("skills")
        if not isinstance(skills, list):
            errors["invalid_skills"].append(name)
            skills = []
        if not skills and g.get("data_status") != "incomplete":
            warnings["unmarked_empty_skills"].append(name)

        for skill in skills:
            label = f"{name}::{skill.get('name') or '(スキル名未設定)'}"
            for field in REQUIRED_SKILL_FIELDS:
                if skill.get(field) is None:
                    errors[f"skill_missing_{field}"].append(label)
            value = skill.get("value") or {}
            by_breakthrough = value.get("by_breakthrough")
            if not isinstance(by_breakthrough, list) or len(by_breakthrough) != 5:
                errors["invalid_by_breakthrough"].append(label)
            if value.get("confidence") not in {"high", "medium", "low", "unknown"}:
                errors["invalid_confidence"].append(label)
            if not skill.get("effect_attribute"):
                errors["missing_effect_attribute"].append(label)
            if skill.get("direction") not in ALLOWED_DIRECTIONS:
                errors["invalid_direction"].append(label)
            cap_rule = (skill.get("cap") or {}).get("rule")
            if cap_rule and cap_rule not in cap_rules:
                errors["unknown_cap_rule"].append(f"{label}: {cap_rule}")

        for legacy_id in g.get("legacy_ids") or []:
            legacy_id = str(legacy_id)
            if legacy_id in id_set and legacy_id != str(g.get("id")):
                errors["legacy_id_collides_with_current_id"].append(f"{legacy_id} -> {g.get('id')}")
            if legacy_id in legacy_owner and legacy_owner[legacy_id] != str(g.get("id")):
                errors["duplicate_legacy_id"].append(
                    f"{legacy_id}: {legacy_owner[legacy_id]} / {g.get('id')}"
                )
            legacy_owner[legacy_id] = str(g.get("id"))

        for field in ("base_general_id", "awakened_id"):
            linked = g.get(field)
            if linked and str(linked) not in id_set:
                errors["broken_general_link"].append(f"{name}: {field}={linked}")

    skill_count = sum(len(g.get("skills") or []) for g in generals)
    print(
        f"generals={len(generals)} skills={skill_count} "
        f"version={meta.get('data_version')} updated={meta.get('last_updated')}"
    )
    for code, values in sorted(warnings.items()):
        sample = ", ".join(values[:12])
        suffix = " ..." if len(values) > 12 else ""
        print(f"WARN {code}: {len(values)} [{sample}{suffix}]")
    for code, values in sorted(errors.items()):
        sample = ", ".join(values[:12])
        suffix = " ..." if len(values) > 12 else ""
        print(f"ERROR {code}: {len(values)} [{sample}{suffix}]")
    print(f"result={'FAIL' if errors else 'OK'} warnings={sum(map(len, warnings.values()))} errors={sum(map(len, errors.values()))}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
