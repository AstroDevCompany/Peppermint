# Mintch: SearXNG with the Peppermint theme baked in.
# Pinned by digest so theme patches keep matching; bump on purpose (see README.md).
FROM searxng/searxng@sha256:7c7cbe509429e82755104b2a95f52085a98633c95d53f44e4e905fa3a59f08c8

ENV SEARXNG_ROOT=/usr/local/searxng/searx

COPY theme/static/ ${SEARXNG_ROOT}/static/themes/simple/
COPY theme/templates/index.html ${SEARXNG_ROOT}/templates/simple/index.html
COPY theme/patch_templates.py /tmp/patch_templates.py

# Mintch logo as the favicon; drop the precompressed copies of the originals.
RUN set -eu; \
    img="${SEARXNG_ROOT}/static/themes/simple/img"; \
    rm -f "$img"/favicon.svg.* "$img"/searxng.svg.* "$img"/favicon.png; \
    cp "${SEARXNG_ROOT}/static/themes/simple/mintch-logo.svg" "$img/favicon.svg"; \
    cp "${SEARXNG_ROOT}/static/themes/simple/mintch-logo.svg" "$img/searxng.svg"; \
    python3 /tmp/patch_templates.py; \
    rm /tmp/patch_templates.py

COPY settings.yml /etc/searxng/settings.yml
