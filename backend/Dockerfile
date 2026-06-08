# Image du backend FastAPI du Cloud Temple Calculator.
# Sert l'API ; lit PostgreSQL (repli auto YAML si la base est indisponible).
FROM python:3.12-slim

# git : requis par la sync vivante (clone/fetch de la source live via subprocess).
# Pas de toolchain de compilation : psycopg2-binary, reportlab et openpyxl
# s'installent depuis des wheels.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system calculator \
    && useradd --system --gid calculator --home-dir /app --shell /usr/sbin/nologin calculator

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dépendances d'abord (cache de couche Docker tant que requirements ne change pas).
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Code applicatif + données YAML embarquées (catalogues + licences).
COPY --chown=calculator:calculator Version ./Version
COPY --chown=calculator:calculator backend/app ./app
COPY --chown=calculator:calculator backend/data ./data
COPY --chown=calculator:calculator backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 8001

# Healthcheck sans dépendance externe (pas de curl dans l'image slim).
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0) if urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=4).status==200 else sys.exit(1)"]

USER calculator

ENTRYPOINT ["./docker-entrypoint.sh"]
