from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import os
from urllib.parse import quote_plus


@lru_cache(maxsize=1)
def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


@lru_cache(maxsize=1)
def data_root() -> Path:
    configured = os.getenv("CALCULATOR_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return project_root() / "data"


def database_url() -> str:
    """URL SQLAlchemy de la base PostgreSQL.

    Surchargée par la variable d'environnement DATABASE_URL.
    Peut aussi être construite depuis CALCULATOR_POSTGRES_*.
    """
    configured = os.getenv("DATABASE_URL")
    if configured:
        return configured

    user = os.getenv("CALCULATOR_POSTGRES_USER", "calculator")
    password = os.getenv("CALCULATOR_POSTGRES_PASSWORD", "calculator")
    host = os.getenv("CALCULATOR_POSTGRES_HOST", "localhost")
    port = os.getenv("CALCULATOR_POSTGRES_PORT", "5432")
    database = os.getenv("CALCULATOR_POSTGRES_DB", "calculator")
    return (
        "postgresql+psycopg2://"
        f"{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{quote_plus(database)}"
    )


def data_source() -> str:
    """Source de lecture du catalogue : 'db' (PostgreSQL) ou 'yaml'.

    Défaut 'db'. En mode 'db', les loaders se replient automatiquement sur
    les YAML si la base est injoignable ou vide (résilience).
    Non mémorisée pour rester surchargée à chaud (tests).
    """
    return os.getenv("CALCULATOR_SOURCE", "db").strip().lower()


def calculator_version() -> str:
    configured = os.getenv("CALCULATOR_VERSION")
    if configured and configured.strip():
        return configured.strip()

    candidates = (
        project_root().parent / "Version",
        project_root() / "Version",
        Path("/app/Version"),
    )
    for candidate in candidates:
        try:
            value = candidate.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if value:
            return value
    return "0.1.0"


def live_git_url() -> str | None:
    value = os.getenv("CALCULATOR_LIVE_GIT_URL")
    return value.strip() if value and value.strip() else None


def live_git_ref() -> str:
    return os.getenv("CALCULATOR_LIVE_GIT_REF", "main").strip() or "main"


@lru_cache(maxsize=1)
def live_git_cache_dir() -> Path:
    configured = os.getenv("CALCULATOR_LIVE_GIT_CACHE_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return data_root() / "_live_quoteflow"


def live_git_enabled() -> bool:
    return live_git_url() is not None


def catalogs_dir() -> Path:
    return data_root() / "CATALOGS"


def licences_file() -> Path:
    return data_root() / "LICENCES" / "licences.yaml"


@lru_cache(maxsize=1)
def quoteflow_root() -> Path:
    configured = os.getenv("CALCULATOR_QUOTEFLOW_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    # Dev : .../Quoteflow/calculator/backend → QuoteFlow voisin .../Quoteflow/quoteflow.
    # Conteneur / arborescence plate (project_root == /app) : pas de voisin ;
    # on évite l'IndexError et on renvoie un chemin (inexistant) cohérent, ce qui
    # marque simplement la source live comme indisponible.
    parents = project_root().parents
    base = parents[1] if len(parents) >= 2 else project_root()
    return base / "quoteflow"


def source_root() -> Path:
    if live_git_enabled():
        return live_git_cache_dir()
    return quoteflow_root()


def source_catalogs_dir() -> Path:
    configured = os.getenv("CALCULATOR_SOURCE_CATALOGS_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return source_root() / "CATALOGS"


def source_licences_dir() -> Path:
    configured = os.getenv("CALCULATOR_SOURCE_LICENCES_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return source_root() / "LICENCES"
