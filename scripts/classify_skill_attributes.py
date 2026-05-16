"""generals.yaml の各スキルに effect_attribute / direction を付与する。

属性カテゴリ（7コア + その他）:
  攻撃 / 防御 / 連撃 / 貫通 / 抵抗 / シールド / 貫通抵抗 / その他

direction:
  up / down / both / null
"""
import re
import yaml
from pathlib import Path

# プロジェクトルート（scripts/ の親ディレクトリ）からの相対指定。
# CI / Codespaces / ローカル どこでも同じ動作にする。
ROOT = Path(__file__).resolve().parent.parent
YAML_PATH = ROOT / 'generals.yaml'

# 非戦闘系（採取・生産・探訪など）→ 「その他」として早期リターン
NON_COMBAT_KEYWORDS = [
    '採掘', '採取', '生産', '探訪', '探宝', '助力',
    '建造', '築造', '農地', '市場', '糧秣', '訓練',
]

# 検査順序が重要:
#  1) 貫通抵抗を 貫通/抵抗 より先に
#  2) 新カテゴリ(抑制/軍紀/率兵/兵士数) を既存より先に判定
#  3) ダメージは最後(汎用的すぎるため、他の専用キーワードで拾えなかった残りを取る)
ATTRIBUTE_PATTERNS = [
    ('貫通抵抗', re.compile(r'貫通抵抗')),
    ('シールド',  re.compile(r'シールド')),
    # 新カテゴリ（A案で昇格、優先判定）
    ('抑制',     re.compile(r'抑制')),
    ('軍紀',     re.compile(r'軍紀')),
    ('率兵',     re.compile(r'率兵')),
    ('兵士数',   re.compile(r'殺害|撃破|負傷兵|複製|蘇生|治癒|死亡(?!率)|参戦兵|参戦可能')),
    # 既存
    ('連撃',     re.compile(r'連撃')),
    ('貫通',     re.compile(r'貫通')),
    ('抵抗',     re.compile(r'抵抗')),
    ('防御',     re.compile(r'防御')),
    ('攻撃',     re.compile(r'攻撃')),
    # ダメージは最後（他で拾えなかったダメ系をすくう）
    ('ダメージ', re.compile(r'ダメ')),
]

UP_KW = ['増', 'アップ', '+', 'UP', '上昇', 'up']
DOWN_KW = ['減', 'ダウン', '-', '低下', '失効', '反射']


def classify(effect_text: str, value: float | None):
    if not effect_text:
        text = ''
    else:
        text = effect_text
    # 非戦闘系（採掘・生産・探訪等）は早期にその他へ振り分ける
    if any(kw in text for kw in NON_COMBAT_KEYWORDS):
        attr = 'その他'
    else:
        attr = 'その他'
        for name, pat in ATTRIBUTE_PATTERNS:
            if pat.search(text):
                attr = name
                break

    # direction はテキストから判定（複数該当時は both）
    has_up = any(kw in text for kw in UP_KW)
    has_down = any(kw in text for kw in DOWN_KW)
    if has_up and has_down:
        direction = 'both'
    elif has_up:
        direction = 'up'
    elif has_down:
        direction = 'down'
    else:
        # フォールバック: 値の符号
        if isinstance(value, (int, float)):
            direction = 'up' if value > 0 else ('down' if value < 0 else None)
        else:
            direction = None

    return attr, direction


def main():
    with open(YAML_PATH, 'r', encoding='utf-8') as f:
        doc = yaml.safe_load(f)

    counts = {}
    for g in doc['generals']:
        for sk in g.get('skills', []):
            v = None
            if 'value' in sk and isinstance(sk['value'].get('by_breakthrough'), list):
                v = sk['value']['by_breakthrough'][-1]  # 突破4時点
            # 判別は effect 文のみ（name はフォールバックしない）。
            # 「スキル名ではなくスキル効果で判別する」方針を徹底するため、
            # effect が空のスキルは「その他/None」に分類される。
            attr, direction = classify(sk.get('effect') or '', v)
            sk['effect_attribute'] = attr
            sk['direction'] = direction
            key = f'{attr}/{direction}'
            counts[key] = counts.get(key, 0) + 1

    doc['meta']['data_version'] = '0.5'

    with open(YAML_PATH, 'w', encoding='utf-8') as f:
        yaml.safe_dump(doc, f, allow_unicode=True, sort_keys=False, width=200)

    print('=== classification counts ===')
    for k in sorted(counts.keys()):
        print(f'  {k}: {counts[k]}')
    total = sum(counts.values())
    print(f'  total skills: {total}')


if __name__ == '__main__':
    main()
