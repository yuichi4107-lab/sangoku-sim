"""generals.yaml の cap.rule を effect 文の内容から正しい共有プール識別子に振り直す。

判別は effect 文に含まれる `（上限X%・共有）` `（上限X%・非共有）` パターンと
属性（連撃 / 抵抗 / 攻撃 等）の組み合わせから推定する。
スキル名は使わない（「effect で判別」原則）。

注意: 王双のような複合条件スキルは別途手動レビュー（needs_review コメント）。
"""
import sys
import io
import re
import yaml
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = Path(__file__).resolve().parent.parent
YAML_PATH = ROOT / 'generals.yaml'

# 追加する cap_rules（既存になければ追加）
NEW_RULES = {
    'rally_resist_down_80_shared': {
        'scope': 'rally',
        'cap_type': 'fixed_percent',
        'cap_value': -80,
        'shared': True,
        'note': '集結・敵抵抗ダウン（典韋・曹仁・王双系の共有プール、上限80%）',
    },
    'rally_resist_down_50_non_shared': {
        'scope': 'rally',
        'cap_type': 'fixed_percent',
        'cap_value': -50,
        'shared': False,
        'note': '集結・敵抵抗ダウン（個別プール、上限50%）',
    },
    'rally_renge_down_non_shared': {
        'scope': 'rally',
        'cap_type': 'fixed_percent',
        'cap_value': -50,
        'shared': False,
        'note': '集結・敵連撃ダウン（個別プール、上限50%）',
    },
}

# 連撃 / 抵抗 / 攻撃 などの属性キーワード（effect 文判別、name は見ない）
ATTR_PATTERNS = [
    ('連撃', re.compile(r'連撃')),
    ('抵抗', re.compile(r'抵抗')),
    ('攻撃', re.compile(r'攻撃')),
    ('防御', re.compile(r'防御')),
    ('貫通', re.compile(r'貫通')),
    ('シールド', re.compile(r'シールド')),
]

# (上限X%・共有) / (上限X%・非共有) パターン
CAP_PAT = re.compile(r'上限\s*(\d+)\s*[%％]\s*[・,、]\s*(共有|非共有)')


def infer_rule(effect: str) -> str | None:
    """effect 文から最適な cap.rule を推定する。判別不能なら None。"""
    m = CAP_PAT.search(effect)
    if not m:
        return None
    limit = int(m.group(1))
    shared = m.group(2) == '共有'

    # 属性を判定
    attr = None
    for name, pat in ATTR_PATTERNS:
        if pat.search(effect):
            attr = name
            break
    if attr is None:
        return None

    # ルックアップテーブル
    if attr == '連撃' and shared and limit == 50:
        return 'rally_renge_down_shared'
    if attr == '連撃' and not shared and limit == 50:
        return 'rally_renge_down_non_shared'
    if attr == '抵抗' and shared and limit == 80:
        return 'rally_resist_down_80_shared'
    if attr == '抵抗' and not shared and limit == 50:
        return 'rally_resist_down_50_non_shared'
    return None


def main():
    with open(YAML_PATH, 'r', encoding='utf-8') as f:
        doc = yaml.safe_load(f)

    # cap_rules に新ルールを追加（既存は触らない）
    cap_rules = doc['meta']['cap_rules']
    for rid, rdef in NEW_RULES.items():
        if rid not in cap_rules:
            cap_rules[rid] = rdef
            print(f'added cap_rule: {rid}')

    fixed = 0
    needs_review = []
    for g in doc['generals']:
        for sk in g.get('skills', []):
            eff = sk.get('effect') or ''
            if '共有' not in eff and '非共有' not in eff:
                continue
            inferred = infer_rule(eff)
            current = (sk.get('cap') or {}).get('rule')
            if inferred is None:
                needs_review.append((g['name'], sk['name'], eff))
                continue
            if current != inferred:
                if 'cap' not in sk or sk['cap'] is None:
                    sk['cap'] = {}
                sk['cap']['rule'] = inferred
                # cap.shared を effect から確定
                sk['cap']['shared'] = '非共有' not in eff
                fixed += 1
                print(f'  {g["name"]}/{sk["name"]}: rule={current} -> {inferred}')

    print()
    print(f'fixed: {fixed}件')
    print(f'needs manual review: {len(needs_review)}件')
    for x in needs_review:
        print(f'  - {x[0]}/{x[1]}')
        print(f'    {x[2]}')

    with open(YAML_PATH, 'w', encoding='utf-8') as f:
        yaml.safe_dump(doc, f, allow_unicode=True, sort_keys=False, width=200)


if __name__ == '__main__':
    main()
