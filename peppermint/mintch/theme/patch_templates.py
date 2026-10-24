"""Build-time patches for the SearXNG simple theme.

Each anchor must exist exactly once; the image build fails loudly when a SearXNG
upgrade moves one, instead of shipping a half-branded page.
"""
import pathlib

ROOT = pathlib.Path("/usr/local/searxng/searx/templates/simple")


def patch(name, replacements):
    path = ROOT / name
    text = path.read_text(encoding="utf-8")
    for old, new in replacements:
        if text.count(old) != 1:
            raise SystemExit(f"{name}: anchor not found exactly once: {old[:60]!r}")
        text = text.replace(old, new)
    path.write_text(text, encoding="utf-8")


patch(
    "base.html",
    [
        (
            "  {% block head %}\n",
            "  <link rel=\"stylesheet\" href=\"{{ url_for('static', filename='mintch.css') }}\" type=\"text/css\" media=\"screen\">\n"
            "  <meta name=\"theme-color\" content=\"#020611\">\n"
            "  {% block head %}\n",
        ),
        (
            "SearXNG — a privacy-respecting, open metasearch engine\">",
            "Mintch, private ad-free search by Peppermint\">",
        ),
        (
            "SearXNG, search, search engine, metasearch, meta search",
            "Mintch, Peppermint, search, private search, metasearch",
        ),
        (
            "  <link rel=\"icon\" href=\"{{ url_for('static', filename='img/favicon.png') }}\" sizes=\"any\">\n",
            "",
        ),
        (
            "  <link rel=\"apple-touch-icon\" href=\"{{ url_for('static', filename='img/favicon.png') }}\">\n",
            "",
        ),
    ],
)

patch(
    "search.html",
    [
        (
            "      <span hidden>SearXNG</span>\n"
            "      {% include 'simple/searxng-wordmark.min.svg' without context %}\n",
            "      <img src=\"{{ url_for('static', filename='mintch-logo.svg') }}\" alt=\"\" width=\"38\" height=\"38\">\n"
            "      <span>Mintch</span>\n",
        ),
    ],
)
