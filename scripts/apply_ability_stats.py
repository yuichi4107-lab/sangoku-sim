"""画像から作った能力値一覧を generals.yaml の stats に反映する。"""
from __future__ import annotations

import csv
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
YAML_PATH = ROOT / "generals.yaml"
ABILITY_CSV = ROOT.parent / "三国覇王戦記_武将情報" / "能力値" / "武将能力値一覧.csv"
DEFAULT_MISSING_STATS = {"統率": 95, "武力": 95, "知性": 95}
MIN_REQUIRED_STAT = 95


def normalize_required_stats(stats: dict[str, int]) -> dict[str, int]:
    return {
        key: max(int(stats[key]), MIN_REQUIRED_STAT)
        for key in ("統率", "武力", "知性")
    }


def load_ability_rows() -> dict[str, dict[str, int]]:
    with ABILITY_CSV.open("r", encoding="utf-8-sig", newline="") as f:
        rows = csv.DictReader(f)
        return {
            row["武将名"]: normalize_required_stats({
                "統率": int(row["統率値"]),
                "武力": int(row["武力値"]),
                "知性": int(row["知力値"]),
            })
            for row in rows
        }


def entry_ranges(lines: list[str]) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    start = None
    for i, line in enumerate(lines):
        if line.startswith("- id: "):
            if start is not None:
                ranges.append((start, i))
            start = i
    if start is not None:
        ranges.append((start, len(lines)))
    return ranges


def entry_name(lines: list[str], start: int, end: int) -> str | None:
    for line in lines[start:end]:
        match = re.match(r"^  name:\s*(.+?)\s*$", line)
        if match:
            return match.group(1).strip().strip('"').strip("'")
    return None


def stat_line(key: str, value: int) -> str:
    return f"    {key}: {value}\n"


def update_stats_block(lines: list[str], start: int, end: int, stats: dict[str, int]) -> tuple[int, int]:
    stats_start = None
    for i in range(start, end):
        if lines[i] == "  stats:\n":
            stats_start = i
            break

    if stats_start is None:
        insert_at = find_stats_insert_position(lines, start, end)
        block = ["  stats:\n"] + [stat_line(key, stats[key]) for key in ("統率", "武力", "知性")]
        lines[insert_at:insert_at] = block
        return len(block), 0

    stats_end = stats_start + 1
    while stats_end < end and lines[stats_end].startswith("    "):
        stats_end += 1

    existing = lines[stats_start + 1:stats_end]
    seen = set()
    replaced: list[str] = []
    changed = 0
    for line in existing:
        match = re.match(r"^    (統率|武力|知性):\s*\d+\s*$", line)
        if match:
            key = match.group(1)
            new_line = stat_line(key, stats[key])
            if new_line != line:
                changed += 1
            replaced.append(new_line)
            seen.add(key)
        else:
            replaced.append(line)

    for key in ("統率", "武力", "知性"):
        if key not in seen:
            replaced.append(stat_line(key, stats[key]))
            changed += 1

    lines[stats_start + 1:stats_end] = replaced
    return len(replaced) - len(existing), changed


def has_all_required_stats(lines: list[str], start: int, end: int) -> bool:
    return read_required_stats(lines, start, end) is not None


def read_required_stats(lines: list[str], start: int, end: int) -> dict[str, int] | None:
    stats_start = None
    for i in range(start, end):
        if lines[i] == "  stats:\n":
            stats_start = i
            break
    if stats_start is None:
        return None

    found = {}
    for i in range(stats_start + 1, end):
        if not lines[i].startswith("    "):
            break
        match = re.match(r"^    (統率|武力|知性):\s*(\d+)\s*$", lines[i])
        if match:
            found[match.group(1)] = int(match.group(2))
    if all(key in found for key in DEFAULT_MISSING_STATS):
        return found
    return None


def find_stats_insert_position(lines: list[str], start: int, end: int) -> int:
    for anchor in ("  seal_bonus:\n", "  sources:\n"):
        for i in range(start, end):
            if lines[i] == anchor:
                return i
    return end


def update_meta(lines: list[str]) -> None:
    in_meta = False
    for i, line in enumerate(lines):
        if line == "meta:\n":
            in_meta = True
            continue
        if in_meta and line == "generals:\n":
            break
        if in_meta and re.match(r"^  data_version:", line):
            lines[i] = "  data_version: '0.6'\n"
        if in_meta and re.match(r"^  last_updated:", line):
            lines[i] = "  last_updated: '2026-06-05'\n"


def main() -> None:
    ability = load_ability_rows()
    lines = YAML_PATH.read_text(encoding="utf-8").splitlines(keepends=True)
    update_meta(lines)

    updated = 0
    defaulted = 0
    clamped = 0
    matched_names = set()
    offset = 0
    for start, end in entry_ranges(lines):
        start += offset
        end += offset
        name = entry_name(lines, start, end)
        if not name or name not in ability:
            continue
        delta, _changed = update_stats_block(lines, start, end, ability[name])
        offset += delta
        updated += 1
        matched_names.add(name)

    for start, end in entry_ranges(lines):
        start += offset
        end += offset
        name = entry_name(lines, start, end)
        if not name or name in matched_names:
            continue
        if has_all_required_stats(lines, start, end):
            continue
        delta, _changed = update_stats_block(lines, start, end, DEFAULT_MISSING_STATS)
        offset += delta
        defaulted += 1

    for start, end in entry_ranges(lines):
        start += offset
        end += offset
        current_stats = read_required_stats(lines, start, end)
        if current_stats is None:
            continue
        normalized_stats = normalize_required_stats(current_stats)
        if current_stats == normalized_stats:
            continue
        delta, _changed = update_stats_block(lines, start, end, normalized_stats)
        offset += delta
        clamped += 1

    missing = [name for name in ability if name not in matched_names]

    YAML_PATH.write_text("".join(lines), encoding="utf-8")
    print(f"updated={updated}")
    print(f"defaulted={defaulted}")
    print(f"clamped={clamped}")
    print("added=0")
    print("skipped_missing=" + ",".join(missing))


if __name__ == "__main__":
    main()
