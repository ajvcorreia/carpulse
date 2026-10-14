# syntax=docker/dockerfile:1

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# `scrapling install` pulls the headless browser plus its system libraries
# (via apt), so it's the slow, cache-worthy layer — kept above COPY so
# editing server.py doesn't redo it.
RUN pip install --no-cache-dir "scrapling[fetchers]==0.4.15" \
    && scrapling install \
    && rm -rf /var/lib/apt/lists/*

COPY server.py ./

EXPOSE 8000
ENV PORT=8000

CMD ["python", "server.py"]
