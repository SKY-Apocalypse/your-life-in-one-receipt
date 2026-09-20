"""
build_site.py — inlines src/ + data/data.json into one deployable dist/index.html.

Run this after editing anything in src/ or after regenerating data/data.json:

    python3 build_site.py

Requires no dependencies beyond the standard library.
"""

import pathlib

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "src"
DATA = ROOT / "data" / "data.json"
DIST = ROOT / "dist"


def main():
    DIST.mkdir(exist_ok=True)
    html = (SRC / "index.html").read_text()

    html = html.replace("/*__CSS__*/", (SRC / "styles.css").read_text())
    html = html.replace("/*__DATA__*/", DATA.read_text())
    html = html.replace("/*__JS__*/", (SRC / "app.js").read_text())

    out = DIST / "index.html"
    out.write_text(html)
    print(f"wrote {out}  ({out.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
