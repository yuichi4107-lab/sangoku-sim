"""スクショOCRした武将スキルを generals.yaml にマージ（上書き）する。

入力: scripts/screenshot_skills.yaml （コンパクト形式）
  generals:
    厳顔:
      troop_type: 歩兵      # 新規作成時のみ使用（既存は据え置き）
      slot_stat: 統率        # 同上
      skills:
        - {name: 縛虎, effect: "...", v: 40}
        - {name: 機変, effect: "...", v: 30, cap: 20, scope: rally}
        - {name: 古の悪来, effect: "...", v: 35, down: true, cap: 80,
           cap_rule: rally_resist_down_80_shared, shared: true}

各スキルのフィールド:
  name(必須), effect(必須), v(突破4の数値・正の大きさ。null可),
  down(bool: 低下/減 系。value/cap を負にする),
  cap(数値・正), cap_rule(str), shared(bool), per_skill(数値), scope(str),
  type(明示する場合), value(by_breakthrough を明示する場合)

既存武将は skills のみ上書き（troop_type/slot_stat/role_tags は据え置き）。
新規武将は最小エントリを作成。
"""
import sys
import yaml
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
YAML_PATH = ROOT / 'generals.yaml'
STAGING = ROOT / 'scripts' / 'screenshot_skills.yaml'


def expand_skill(s):
    name = s['name']
    effect = s['effect']
    down = bool(s.get('down'))
    v = s.get('v', None)
    unit = 'percent' if ('%' in effect or '％' in effect) else 'value'

    if 'type' in s:
        stype = s['type']
    elif v is None:
        stype = 'passive'
    elif down:
        stype = 'debuff'
    else:
        stype = 'buff'

    if 'value' in s:
        bt = s['value']
    else:
        if v is None:
            bt = [None, None, None, None, None]
        else:
            val = -abs(v) if down else v
            bt = [None, None, None, None, val]

    skill = {
        'name': name,
        'type': stype,
        'scope': s.get('scope', 'legion'),
        'unlocked_at': 0,
        'effect': effect,
        'unit': unit,
        'value': {
            'by_breakthrough': bt,
            'confidence': 'high',
        },
    }
    if 'cap' in s and s['cap'] is not None:
        cap_v = s['cap']
        cap_v = -abs(cap_v) if down else cap_v
        cap = {
            'rule': s.get('cap_rule', 'no_cap'),
            'cap_value': cap_v,
            'note': 'スクショ由来の上限',
        }
        if 'shared' in s:
            cap['shared'] = bool(s['shared'])
        if 'per_skill' in s:
            cap['per_skill_cap'] = s['per_skill']
        skill['cap'] = cap
    elif s.get('cap_rule'):
        skill['cap'] = {'rule': s['cap_rule'], 'note': 'スクショ由来'}
    if s.get('unlocked_at_equipment'):
        skill['unlocked_at_equipment'] = s['unlocked_at_equipment']
    return skill


def main():
    doc = yaml.safe_load(open(YAML_PATH, encoding='utf-8'))
    staging = yaml.safe_load(open(STAGING, encoding='utf-8'))
    gens = staging.get('generals', {})

    by_name = {g['name']: g for g in doc['generals']}
    updated, created = [], []

    for name, info in gens.items():
        skills = [expand_skill(s) for s in info.get('skills', [])]
        if name in by_name:
            by_name[name]['skills'] = skills
            updated.append(name)
        else:
            rarity = '玄' if name.startswith('玄') else '橙'
            entry = {
                'id': name,
                'name': name,
                'yomi': None,
                'base_rarity': rarity,
                'troop_type': info.get('troop_type', '万能'),
                'slot_stat': info.get('slot_stat', None),
                'role_tags': info.get('role_tags', []),
                'skills': skills,
                'seal_bonus': {
                    'by_seal': [None] * 11,
                    'effect_note': '未確認',
                    'confidence': 'unknown',
                },
                'sources': ['screenshot:三国覇王戦記_武将情報'],
            }
            doc['generals'].append(entry)
            by_name[name] = entry
            created.append(name)

    yaml.safe_dump(doc, open(YAML_PATH, 'w', encoding='utf-8'),
                   allow_unicode=True, sort_keys=False, width=200)
    print(f'[merge] 更新 {len(updated)}件 / 新規 {len(created)}件', file=sys.stderr)
    print('  更新:', ' '.join(updated), file=sys.stderr)
    print('  新規:', ' '.join(created), file=sys.stderr)


if __name__ == '__main__':
    main()
