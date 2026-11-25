"""Adapt the pinned upstream Vue build. Fail on changed upstream code."""
from pathlib import Path
import gzip
import hashlib

root = Path(__file__).resolve().parents[2] / 'frontend-dist'
chunk = root / 'js/375.43b3c74e.js'
entry = root / 'js/app.b6b1d908.js'

def change(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f'Unexpected upstream bundle near {old}')
    return text.replace(old, new)

def write(path, text):
    path.write_text(text)
    path.with_suffix(path.suffix + '.gz').write_bytes(gzip.compress(text.encode(), mtime=0))

def build(path, text):
    text = text.split('//# sourceMappingURL=')[0]
    digest = hashlib.sha256(text.encode()).hexdigest()[:8]
    write(path.with_name(path.name.split('.')[0] + '.' + digest + '.js'), text)
    return digest

def main():
    text = chunk.read_text()
    text = change(text, 'const Ge=[{value:"telegram"', 'const Ge=[{value:"auto",label:"自动分流"},{value:"telegram"')
    text = change(text, 'hasConfiguredChannels(e){const', 'hasConfiguredChannels(e){if(e==="auto")return Array.isArray(this.availableChannels.auto);const')
    text = change(text, '"all"===this.channelVisibility?Ge:', '"all"===this.channelVisibility?Ge.filter(e=>e.value!=="auto"||this.hasConfiguredChannels("auto")):')
    text = change(text, 'this.availableChannels=e.data;const', 'this.availableChannels=e.data;if(Array.isArray(e.data.auto)&&!localStorage.getItem("imgbed.manualChannel")){this.uploadChannel="auto";this.channelName=""}const')
    text = change(text, 't[12]=e=>r.uploadChannel=e', 't[12]=e=>{localStorage.setItem("imgbed.manualChannel",e);r.uploadChannel=e}')
    text = change(text, '"discord"===a){const t=9437184', '("auto"===a||"discord"===a)){const t=9437184')
    text = change(text, 'i="discord"===o?9437184', 'i=("auto"===o||"discord"===o)?9437184')
    text = change(text, 't.append("totalChunks",s.toString())', 't.append("originalFileSize",String(l)),t.append("totalChunks",s.toString())')
    chunk_hash = build(chunk, text)
    entry_hash = build(entry, change(entry.read_text(), '375:"43b3c74e"', f'375:"{chunk_hash}"'))
    html = (root / 'index.html').read_text()
    import re
    html = re.sub(r'app\.[a-f0-9]{8}\.js', f'app.{entry_hash}.js', html)
    if 'account/navigation.js' not in html:
        html = change(html, '</body>', '<script type="module" src="/account/navigation.js"></script></body>')
    write(root / 'index.html', html)

if __name__ == '__main__':
    main()
