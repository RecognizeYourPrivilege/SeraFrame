FROM node:22-bookworm-slim AS spa

WORKDIR /src/client

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

FROM debian:bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PATH="/opt/venv/bin:$PATH" \
    SERAFRAME_DATA_DIR=/data \
    SERAFRAME_PORT=8081 \
    SERAFRAME_SPA_DIR=/app/spa

# Bookworm ships Python 3.11. Build CPython 3.12 from the upstream tarball.
ARG PYTHON_VERSION=3.12.14
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        libffi-dev \
        libsqlite3-dev \
        libssl-dev \
        pkg-config \
        zlib1g-dev \
        libffi8 \
        libsqlite3-0 \
        libssl3 \
        zlib1g \
    && curl -fsSL "https://www.python.org/ftp/python/${PYTHON_VERSION}/Python-${PYTHON_VERSION}.tgz" -o /tmp/python.tgz \
    && tar -xzf /tmp/python.tgz -C /tmp \
    && cd "/tmp/Python-${PYTHON_VERSION}" \
    && ./configure --prefix=/usr/local --with-ensurepip=install \
    && make -j"$(nproc)" \
    && make install \
    && cd / \
    && rm -rf "/tmp/Python-${PYTHON_VERSION}" /tmp/python.tgz \
    && python3.12 -m venv /opt/venv \
    && apt-get purge -y \
        build-essential \
        libffi-dev \
        libsqlite3-dev \
        libssl-dev \
        pkg-config \
        zlib1g-dev \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY --from=spa /src/client/dist ./spa
COPY docker/entrypoint.sh /usr/local/bin/seraframe-entrypoint

RUN chmod 755 /usr/local/bin/seraframe-entrypoint \
    && groupadd --gid 10001 seraframe \
    && useradd --uid 10001 --gid 10001 --home-dir /home/seraframe --create-home --shell /usr/sbin/nologin seraframe \
    && mkdir -p /data \
    && chown -R seraframe:seraframe /data /home/seraframe /app/spa

USER seraframe

EXPOSE 8081

ENTRYPOINT ["seraframe-entrypoint"]
