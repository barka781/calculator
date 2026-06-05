"""Couche d'accès PostgreSQL (SQLAlchemy 2.x).

Fournit l'engine, la fabrique de sessions et la Base déclarative.
L'URL de connexion vient de config.database_url() (env DATABASE_URL).
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import database_url


class Base(DeclarativeBase):
    """Base déclarative commune à tous les modèles ORM."""


engine = create_engine(database_url(), pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    """Crée les tables manquantes (idempotent)."""
    from . import db_models  # noqa: F401 — enregistre les modèles sur Base.metadata

    Base.metadata.create_all(bind=engine)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Session transactionnelle : commit au succès, rollback sinon."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Iterator[Session]:
    """Dépendance FastAPI : une session par requête."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
