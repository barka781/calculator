#!/usr/bin/env bash
# Démarrage du backend dans le conteneur.
# Philosophie disponibilité-d'abord (contexte ANSSI) : on tente d'attendre
# PostgreSQL et d'ingérer les YAML, mais AUCUNE de ces étapes ne bloque le
# démarrage de l'API — en mode 'db', les loaders se replient automatiquement
# sur les YAML embarqués si la base est injoignable ou vide.
set -uo pipefail

HOST="${UVICORN_HOST:-0.0.0.0}"
PORT="${UVICORN_PORT:-8001}"

# 1. Attente de PostgreSQL (best-effort, borné). depends_on:service_healthy
#    couvre déjà le cas nominal ; cette boucle ajoute une marge.
echo "[entrypoint] Attente de PostgreSQL…"
python - <<'PY'
import time
from app.config import database_url
from sqlalchemy import create_engine, text

url = database_url()
deadline = 30  # tentatives ~= 30 s
for attempt in range(1, deadline + 1):
    try:
        engine = create_engine(url, pool_pre_ping=True)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print(f"[entrypoint] PostgreSQL prêt (tentative {attempt}).")
        break
    except Exception as exc:  # noqa: BLE001
        if attempt == deadline:
            print(f"[entrypoint] PostgreSQL toujours injoignable après {deadline}s "
                  f"({exc!s}). On continue : repli YAML assuré.")
        else:
            time.sleep(1)
PY

# 2. Ingestion idempotente des YAML vers PostgreSQL (best-effort).
echo "[entrypoint] Ingestion du catalogue…"
if python -m app.ingest; then
    echo "[entrypoint] Ingestion terminée."
else
    echo "[entrypoint] Ingestion échouée — l'API démarre quand même (repli YAML)."
fi

# 3. Lancement de l'API (processus principal du conteneur).
echo "[entrypoint] Démarrage d'uvicorn sur ${HOST}:${PORT}…"
exec uvicorn app.main:app --host "${HOST}" --port "${PORT}"
