"""generals.yaml を JSON 化して index.html 内のマーカー部分に埋め込む。

これにより file:// でも GitHub Pages でも動く自己完結HTMLになる。
データ更新時はこのスクリプトを再実行する。
"""
import json
import re
import yaml
from pathlib import Path

# プロジェクトルート（scripts/ の親ディレクトリ）。
# CI / Codespaces / ローカル どこでも同じ動作にする。
ROOT = Path(__file__).resolve().parent.parent
YAML_PATH = ROOT / 'generals.yaml'
# 埋め込み対象の HTML ファイル一覧。新しいページを増やしたらここに追加する。
HTML_TARGETS = [
    ROOT / 'index.html',     # メインシミュレータ
    ROOT / 'register.html',  # 友人配布用 所持登録ツール
    ROOT / 'status.html',    # 登録状況ダッシュボード
]

START = '<!--DATA_START-->'
END = '<!--DATA_END-->'


def embed(html_path: Path, block: str, count: int) -> None:
    if not html_path.exists():
        print(f'  skip (not found): {html_path.name}')
        return
    html = html_path.read_text(encoding='utf-8')
    if START in html and END in html:
        html = re.sub(
            re.escape(START) + r'.*?' + re.escape(END),
            block,
            html,
            flags=re.DOTALL,
        )
    elif '</body>' in html:
        # マーカーが無いファイルには </body> の前に注入
        html = html.replace('</body>', block + '\n</body>', 1)
    elif '</header>' in html:
        html = html.replace('</header>', '</header>\n' + block, 1)
    else:
        # フォールバック: ファイル末尾に追記
        html = html + '\n' + block + '\n'
    html_path.write_text(html, encoding='utf-8')
    print(f'  embedded {count} generals into {html_path.name}')


def main():
    with open(YAML_PATH, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f)
    json_text = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    block = (
        f'{START}\n'
        f'<script>window.GENERALS_DATA = {json_text};</script>\n'
        f'{END}'
    )
    print(f'json size: {len(json_text)} bytes, generals: {len(data["generals"])}')
    for path in HTML_TARGETS:
        embed(path, block, len(data['generals']))


if __name__ == '__main__':
    main()
