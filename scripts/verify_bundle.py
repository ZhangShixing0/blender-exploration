"""Verify asset integrity, glTF dependencies, module imports, and JS syntax."""
from pathlib import Path
from urllib.parse import unquote, urlsplit
import hashlib, json, re, shutil, struct, subprocess, sys

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'web/暮色海港3d'
def require_file(path):
    path = path.resolve()
    assert path.is_relative_to(ROOT), 'Dependency escapes repository'
    assert path.is_file(), f'Missing file: {path.relative_to(ROOT)}'

def main():
    manifest = json.loads((ROOT / 'asset-manifest.json').read_text(encoding='utf-8'))
    for row in manifest['files']:
        path = ROOT / row['path']; require_file(path)
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row['sha256'], f'Asset changed: {row["path"]}'
    glbs = list(WEB.rglob('*.glb'))
    for path in glbs:
        raw = path.read_bytes()
        magic, version, length = struct.unpack_from('<4sII', raw)
        assert magic == b'glTF' and version == 2 and length == len(raw), path.name
        size, kind = struct.unpack_from('<II', raw, 12)
        assert kind == 0x4E4F534A
        data = json.loads(raw[20:20+size])
        for entry in data.get('images', []) + data.get('buffers', []):
            uri = entry.get('uri', '')
            if uri and not uri.startswith('data:'):
                assert not urlsplit(uri).scheme, 'Remote model dependency'
                require_file(path.parent / unquote(uri))
    node = shutil.which('node')
    assert node, 'Node.js is required for JS syntax checks (not for preview).'
    modules = list(WEB.rglob('*.js'))
    for path in modules:
        subprocess.run([node, '--check', str(path)], check=True, capture_output=True)
        source = path.read_text(encoding='utf-8-sig')
        for target in re.findall(r'(?:from\s*|import\s*)[\'"]([^\'"]+)[\'"]', source):
            if target == 'three': require_file(WEB / 'vendor/three/three.module.min.js')
            elif target.startswith('.'):
                require_file(path.parent / unquote(urlsplit(target).path))
    for entry in json.loads((WEB / 'assets/cast-v340/manifest.json').read_text(encoding='utf-8')):
        require_file(WEB / 'assets/cast-v340' / entry['file'])
        source = ROOT / entry['source']; require_file(source)
        assert hashlib.sha256(source.read_bytes()).hexdigest() == entry['publishedSourceSha256']
    for name in ['index.html', 'styles.css', 'app.js', 'audio-credits.html']:
        require_file(WEB / name)
    for name in ['waves', 'wind', 'gulls', 'cafe']:
        require_file(WEB / f'assets/audio/{name}.mp3')
    print(f'PASS: {len(manifest["files"])} asset hashes, {len(glbs)} glTF files, {len(modules)} JavaScript syntax/import checks.')
    print('Scope: package integrity; browser appearance and interaction require browser review.')

if __name__ == '__main__':
    try: main()
    except (AssertionError, OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'FAIL: {error}', file=sys.stderr); raise SystemExit(1)
