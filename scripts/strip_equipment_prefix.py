"""generals.yaml のスキル名から先頭の `【装備】` プレフィックスを除去する一回限りスクリプト。

判別は `unlocked_at_equipment` フィールド（構造化フィールド）が正準。
名前は人間向けのラベルなので、`【装備】` を含めない。

旧データに対する後方互換マイグレーション。新規取込（build_generals_from_xlsx.py）も
既に修正済みで、今後はプレフィックスを付けない方針。
"""
import sys
import io
import yaml
from pathlib import Path

# Windows でも UTF-8 出力にする
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = Path(__file__).resolve().parent.parent
YAML_PATH = ROOT / 'generals.yaml'

PREFIX = '【装備】'


def main():
    with open(YAML_PATH, 'r', encoding='utf-8') as f:
        doc = yaml.safe_load(f)

    renamed = 0
    auto_field = 0
    for g in doc['generals']:
        for sk in g.get('skills', []):
            nm = sk.get('name', '')
            if nm.startswith(PREFIX):
                sk['name'] = nm[len(PREFIX):].strip()
                renamed += 1
                # 構造化フィールドが立っていなければ補完（既定: 装備4で解放）
                if sk.get('unlocked_at_equipment') is None:
                    sk['unlocked_at_equipment'] = 4
                    auto_field += 1

    with open(YAML_PATH, 'w', encoding='utf-8') as f:
        yaml.safe_dump(doc, f, allow_unicode=True, sort_keys=False, width=200)

    print(f'rename: {renamed}件 / auto-fill unlocked_at_equipment: {auto_field}件')


if __name__ == '__main__':
    main()
