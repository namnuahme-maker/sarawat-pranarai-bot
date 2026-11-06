import sys
import os
import io
import urllib.request
from PIL import Image

def remove_background(input_source, output_path):
    if input_source.startswith('http://') or input_source.startswith('https://'):
        req = urllib.request.Request(
            input_source,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
            img = Image.open(io.BytesIO(data))
    else:
        img = Image.open(input_source)

    import rembg

    session = None
    try:
        session = rembg.new_session('u2net_human_seg')
    except Exception:
        try:
            session = rembg.new_session('u2netp')
        except Exception:
            session = None

    if session:
        output = rembg.remove(img, session=session)
    else:
        output = rembg.remove(img)

    if output.mode != 'RGBA':
        output = output.convert('RGBA')

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    output.save(output_path, format='PNG')
    print(f"SUCCESS:{output_path}")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python remove_bg.py <input_url_or_path> <output_path>", file=sys.stderr)
        sys.exit(1)

    input_src = sys.argv[1]
    output_dest = sys.argv[2]
    try:
        remove_background(input_src, output_dest)
    except Exception as exc:
        print(f"ERROR:{exc}", file=sys.stderr)
        sys.exit(1)
