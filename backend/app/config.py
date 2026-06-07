from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import os


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
    Défaut : le Postgres local lancé via docker-compose.yml.
    """
    return os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://calculator:calculator@localhost:5432/calculator",
    )


def data_source() -> str:
    """Source de lecture du catalogue : 'db' (PostgreSQL) ou 'yaml'.

    Défaut 'db'. En mode 'db', les loaders se replient automatiquement sur
    les YAML si la base est injoignable ou vide (résilience).
    Non mémorisée pour rester surchargée à chaud (tests).
    """
    return os.getenv("CALCULATOR_SOURCE", "db").strip().lower()


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
    return project_root().parents[1] / "quoteflow"


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
