"""generals.yaml を JSON 化して index.html 内のマーカー部分に埋め込む。

これにより file:// でも GitHub Pages でも動く自己完結HTMLになる。
データ更新時はこのスクリプトを再実行する。
"""
import json
import re
import yaml
from pathlib import Path

ROOT = Path(r'C:/Users/fcmdt/OneDrive/デスクトップ/三国覇王戦記')
YAML_PATH = ROOT / 'generals.yaml'
HTML_PATH = ROOT / 'index.html'

START = '<!--DATA_START-->'
END = '<!--DATA_END-->'


def main():
    with open(YAML_PATH, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f)
    json_text = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    # JSON を JS 変数として定義する <script> ブロック。
    # JS 文字列リテラルではなく JSON.parse 経由にすることでクオート問題を回避。
    # （ただし JSON は valid JS literal でもあるので、直代入が最も単純で速い）
    block = (
        f'{START}\n'
        f'<script>window.GENERALS_DATA = {json_text};</script>\n'
        f'{END}'
    )
    html = HTML_PATH.read_text(encoding='utf-8')
    if START in html and END in html:
        html = re.sub(
            re.escape(START) + r'.*?' + re.escape(END),
            block,
            html,
            flags=re.DOTALL,
        )
    else:
        html = html.replace('</header>', '</header>\n' + block, 1)
    HTML_PATH.write_text(html, encoding='utf-8')
    print(f'embedded {len(data["generals"])} generals, json size {len(json_text)} bytes')


if __name__ == '__main__':
    main()
