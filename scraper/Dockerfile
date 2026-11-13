# syntax=docker/dockerfile:1

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# `scrapling install` pulls the headless browser plus its system libraries
# (via apt), so it's the slow, cache-worthy layer — kept above COPY so
# editing server.py doesn't redo it. It downloads the Chromium build for
# *playwright*'s version, but StealthyFetcher launches through patchright,
# which can lag a version behind and expect a different build — so fetch
# patchright's own Chromium too, or launches fail with "Executable doesn't
# exist".
#
# libatomic1: the browser installer's bundled node needs it, and newer
# python:3.12-slim bases no longer ship it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libatomic1 \
    && pip install --no-cache-dir "scrapling[fetchers]==0.4.15" \
    && scrapling install \
    && patchright install chromium \
    && rm -rf /var/lib/apt/lists/*

COPY server.py details.py ./

EXPOSE 8000
ENV PORT=8000

CMD ["python", "server.py"]
