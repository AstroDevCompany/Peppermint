# Mintch

Mintch is Peppermint's default search engine: a themed [SearXNG](https://docs.searxng.org) instance.

```
peppermint/mintch/          server (this folder)
peppermint/search/mintch.json   engine definition used by the browser
peppermint/scripts/apply-search-config.mjs   writes it into the search config dump
```

## Run locally

```bash
cd peppermint/mintch
docker compose up -d --build
```

Open http://localhost:8888. Stop with `docker compose down`.

For anything reachable from the internet, put a real secret and base URL in `.env` (ignored by git):

```
MINTCH_SECRET=<long random string>
MINTCH_BASE_URL=https://search.example.com/
```

## Layout

| Path | Purpose |
| --- | --- |
| `Dockerfile` | SearXNG pinned by digest, theme and settings baked in |
| `settings.yml` | Instance settings (dark theme, GET searches, autocomplete) |
| `theme/static/` | `mintch.css`, logo, optimized space background |
| `theme/templates/index.html` | Start page: brand on top, search bar in the center |
| `theme/patch_templates.py` | Small anchored patches to SearXNG templates; the build fails if an anchor moves |

Changing CSS only: `docker cp theme/static/mintch.css mintch:/usr/local/searxng/searx/static/themes/simple/mintch.css`, then hard reload.

## Pointing the browser at a host

The default engine URL is `baseUrl` in `peppermint/search/mintch.json` (currently the local instance). Release builds can override it without editing the file:

```bash
MINTCH_URL=https://search.example.com npm run import
```

## Upgrading SearXNG

Pull a new image, replace the digest in the `Dockerfile`, rebuild. If the build fails on an anchor in `patch_templates.py`, update that anchor.
